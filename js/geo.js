/*!
 * LingsGeo — 中国帝陵地图用的纯几何/坐标工具（无依赖，可在浏览器与 Node 复用）
 * 坐标基准：数据存 WGS84；高德底图为 GCJ-02，渲染前转换。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LingsGeo = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var PI = Math.PI;
  var A = 6378137.0;
  var EE = 0.00669342162296594323;

  /* ---------- GCJ-02 / WGS-84 ---------- */
  function outOfChina(lng, lat) {
    return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
  }
  function transformLat(x, y) {
    var ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
    ret += (160.0 * Math.sin(y / 12.0 * PI) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
    return ret;
  }
  function transformLng(x, y) {
    var ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
    ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
    return ret;
  }
  function wgs84ToGcj02(lng, lat) {
    if (outOfChina(lng, lat)) return [lng, lat];
    var dLat = transformLat(lng - 105.0, lat - 35.0);
    var dLng = transformLng(lng - 105.0, lat - 35.0);
    var radLat = lat / 180.0 * PI;
    var magic = Math.sin(radLat);
    magic = 1 - EE * magic * magic;
    var sqrtMagic = Math.sqrt(magic);
    dLat = (dLat * 180.0) / ((A * (1 - EE)) / (magic * sqrtMagic) * PI);
    dLng = (dLng * 180.0) / (A / sqrtMagic * Math.cos(radLat) * PI);
    return [lng + dLng, lat + dLat];
  }
  function gcj02ToWgs84(lng, lat) {
    if (outOfChina(lng, lat)) return [lng, lat];
    var wlng = lng, wlat = lat, i, g;
    for (i = 0; i < 3; i++) {
      g = wgs84ToGcj02(wlng, wlat);
      wlng += lng - g[0];
      wlat += lat - g[1];
    }
    return [wlng, wlat];
  }

  /* ---------- Web Mercator（256px 瓦片） ---------- */
  var MAX_LAT = 85.0511287798;
  function project(lng, lat, zoom) {
    var size = 256 * Math.pow(2, zoom);
    var la = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
    var sin = Math.sin(la * PI / 180);
    return {
      x: (lng + 180) / 360 * size,
      y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * PI)) * size
    };
  }
  function unproject(x, y, zoom) {
    var size = 256 * Math.pow(2, zoom);
    var n = PI - 2 * PI * y / size;
    return {
      lng: x / size * 360 - 180,
      lat: 180 / PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
    };
  }
  function metersPerPixel(lat, zoom) {
    return 156543.03392804097 * Math.cos(lat * PI / 180) / Math.pow(2, zoom);
  }

  /* ---------- 距离 / 行程估算 ---------- */
  function haversineKm(a, b) {
    var R = 6371.0088;
    var dLat = (b.lat - a.lat) * PI / 180;
    var dLng = (b.lng - a.lng) * PI / 180;
    var la1 = a.lat * PI / 180, la2 = b.lat * PI / 180;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function routeLegs(points) {
    var legs = [], total = 0, i, km;
    for (i = 1; i < points.length; i++) {
      km = haversineKm(points[i - 1], points[i]);
      total += km;
      legs.push({ from: i - 1, to: i, km: km });
    }
    return { legs: legs, totalKm: total };
  }
  // 直线 → 公路里程 / 行车时间（经验系数，仅作规划参考）
  function estimateRoadKm(straightKm) {
    return straightKm * 1.32 + 2;
  }
  function estimateDriveHours(straightKm) {
    return estimateRoadKm(straightKm) / 68;
  }
  function suggestDays(straightKm, stopCount) {
    var drive = estimateDriveHours(straightKm);
    var visit = Math.max(0, stopCount) * 1.6; // 每个点约 1.6 小时
    return Math.max(1, Math.ceil((drive + visit) / 8));
  }

  /* ---------- 路线排序：最近邻 + 2-opt ---------- */
  function optimizeOrder(points) {
    var n = points.length;
    var order = [], used = [], i, j, k, best, bestD, cur, d;
    if (n <= 2) { for (i = 0; i < n; i++) order.push(i); return order; }
    // 最近邻：以第 0 点为起点（保持用户设定的起点）
    cur = 0; used[0] = true; order.push(0);
    for (i = 1; i < n; i++) {
      best = -1; bestD = Infinity;
      for (j = 0; j < n; j++) {
        if (used[j]) continue;
        d = haversineKm(points[cur], points[j]);
        if (d < bestD) { bestD = d; best = j; }
      }
      used[best] = true; order.push(best); cur = best;
    }
    // 2-opt 改进（固定起点）
    function totalLen(ord) {
      var s = 0;
      for (var t = 1; t < ord.length; t++) s += haversineKm(points[ord[t - 1]], points[ord[t]]);
      return s;
    }
    var improved = true, guard = 0;
    while (improved && guard < 40) {
      improved = false; guard++;
      for (i = 0; i < n - 1; i++) {
        for (j = i + 2; j < n; j++) {
          var a = order[i], b = order[i + 1], c = order[j], e = order[(j + 1) % n];
          var oldD = haversineKm(points[a], points[b]) + haversineKm(points[c], points[e]);
          var newD = haversineKm(points[a], points[c]) + haversineKm(points[b], points[e]);
          if (newD + 1e-9 < oldD) {
            // reverse order[i+1..j]
            var rev = order.slice(i + 1, j + 1).reverse();
            for (k = 0; k < rev.length; k++) order[i + 1 + k] = rev[k];
            improved = true;
          }
        }
      }
    }
    return order;
  }

  /* ---------- 展示辅助 ---------- */
  function formatYear(y) {
    if (y === null || y === undefined || y === '') return '—';
    var n = Number(y);
    if (!isFinite(n)) return String(y);
    if (n < 0) return '前' + Math.abs(n) + '年';
    return '公元' + n + '年';
  }
  function formatKm(km) {
    if (km < 1) return (km * 1000).toFixed(0) + ' 米';
    if (km < 10) return km.toFixed(1) + ' 公里';
    return Math.round(km) + ' 公里';
  }
  function formatHours(h) {
    if (h < 1) return Math.round(h * 60) + ' 分钟';
    if (h < 6) return h.toFixed(1).replace(/\.0$/, '') + ' 小时';
    return Math.round(h) + ' 小时';
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  return {
    wgs84ToGcj02: wgs84ToGcj02,
    gcj02ToWgs84: gcj02ToWgs84,
    outOfChina: outOfChina,
    project: project,
    unproject: unproject,
    metersPerPixel: metersPerPixel,
    haversineKm: haversineKm,
    routeLegs: routeLegs,
    estimateRoadKm: estimateRoadKm,
    estimateDriveHours: estimateDriveHours,
    suggestDays: suggestDays,
    optimizeOrder: optimizeOrder,
    formatYear: formatYear,
    formatKm: formatKm,
    formatHours: formatHours,
    pad2: pad2
  };
});
