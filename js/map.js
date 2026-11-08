/*!
 * LingsMap — 零依赖的轻量中国地图引擎（瓦片 + Canvas 标注）
 * - 底图：高德矢量/卫星（GCJ-02）、OSM（WGS84）、无底图（经纬网）
 * - 交互：拖动、滚轮/双击缩放、双指缩放、点击、悬停
 * - 标注：聚类、帝陵点位、路线连线、编号徽标、注记
 */
(function (global) {
  'use strict';
  var G = global.LingsGeo;
  var TILE = 256;
  var PI2 = Math.PI * 2;

  /* ---------------- 底图定义 ---------------- */
  function amapVec(z, x, y) {
    return 'https://webrd0' + (1 + ((x + y) % 4)) + '.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x=' + x + '&y=' + y + '&z=' + z;
  }
  function amapSat(z, x, y) {
    return 'https://webst0' + (1 + ((x + y) % 4)) + '.is.autonavi.com/appmaptile?style=6&x=' + x + '&y=' + y + '&z=' + z;
  }
  function amapSatLabel(z, x, y) {
    return 'https://webst0' + (1 + ((x + y) % 4)) + '.is.autonavi.com/appmaptile?style=8&x=' + x + '&y=' + y + '&z=' + z;
  }
  function osmTile(z, x, y) {
    return 'https://tile.openstreetmap.org/' + z + '/' + x + '/' + y + '.png';
  }

  var LAYERS = {
    // 混合（默认）：z≤14 用矢量路网（清晰、有地名），z≥15 自动切卫星影像+标注。
    // 原因：高德矢量瓦片在草原/荒漠/山地等无细节区域，z15 以上会返回 179B 纯色空白瓦片，
    // 直接显示就是“白屏”；卫星影像在这些地方始终有数据，适合看陵区地貌。
    hybrid: {
      label: '高德 · 混合（推荐）',
      crs: 'gcj', maxZoom: 18, attr: '© 高德地图',
      urls: function (z) { return z >= 15 ? [amapSat, amapSatLabel] : [amapVec]; }
    },
    // fallback：矢量瓦片遇到 179B 空白时用同位置卫星瓦片补位
    amap: { label: '高德 · 矢量', crs: 'gcj', maxZoom: 18, attr: '© 高德地图', urls: [amapVec], fallback: amapSat },
    amapSat: { label: '高德 · 卫星', crs: 'gcj', maxZoom: 18, attr: '© 高德地图', urls: [amapSat] },
    amapSatLabel: { label: '高德 · 卫星+标注', crs: 'gcj', maxZoom: 18, attr: '© 高德地图', urls: [amapSat, amapSatLabel] },
    osm: { label: 'OpenStreetMap', crs: 'wgs', maxZoom: 19, attr: '© OpenStreetMap contributors', urls: [osmTile] },
    none: { label: '无底图（离线可用）', crs: 'gcj', maxZoom: 18, attr: '', urls: [] }
  };

  var CITIES = [
    ['北京', 116.407, 39.904], ['西安', 108.954, 34.266], ['洛阳', 112.454, 34.619],
    ['南京', 118.797, 32.06], ['成都', 104.066, 30.572], ['广州', 113.264, 23.129],
    ['沈阳', 123.431, 41.805], ['银川', 106.231, 38.487], ['拉萨', 91.132, 29.66],
    ['乌鲁木齐', 87.617, 43.792], ['哈尔滨', 126.535, 45.803], ['杭州', 120.155, 30.274],
    ['武汉', 114.305, 30.593], ['郑州', 113.625, 34.746], ['太原', 112.549, 37.857],
    ['呼和浩特', 111.749, 40.842], ['西宁', 101.778, 36.617], ['昆明', 102.832, 24.88],
    ['兰州', 103.834, 36.061], ['长春', 125.324, 43.817], ['石家庄', 114.514, 38.042]
  ];

  /* ---------------- 工具 ---------------- */
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

  function LingsMap(el, opts) {
    opts = opts || {};
    this.el = el;
    this.opts = opts;
    this.layerKey = LAYERS[opts.layer] ? opts.layer : 'hybrid';
    this.view = { lng: 105.5, lat: 34.2, zoom: 5 };
    this.tombs = [];
    this.filter = null;
    this.plan = [];
    this.selectedId = null;
    this.visited = function () { return false; };
    this.hits = [];
    this._tileNodes = {};
    this._tileZoom = null;
    this._tileFailures = 0;
    this._tileOk = 0;
    this._raf = 0;
    this._pointer = null;
    this._pointers = {};
    this._pinch = null;
    this._dragMoved = false;
    this._wheelAcc = 0;
    this._mouse = null;
    this._hover = null;
    this._size = { w: 0, h: 0, dpr: 1 };
    this._lastDraw = 0;
    this._anim = null;

    // DOM
    this.tileEl = document.createElement('div');
    this.tileEl.className = 'lm-tiles';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'lm-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.ctx = this.canvas.getContext('2d');
    this.el.appendChild(this.tileEl);
    this.el.appendChild(this.canvas);
    this.el.classList.add('lm-root');

    this._bind();
    var self = this;
    this._ro = new ResizeObserver(function () { self.resize(); });
    this._ro.observe(this.el);
    this.resize();
    this._fitChina(true);
  }

  LingsMap.prototype._display = function (lng, lat) {
    if (LAYERS[this.layerKey].crs === 'gcj') return G.wgs84ToGcj02(lng, lat);
    return [lng, lat];
  };

  // 当前缩放级下这一层要请求的瓦片 URL 列表（支持按缩放级切换底图）
  LingsMap.prototype._urlsFor = function (z) {
    var def = LAYERS[this.layerKey];
    return typeof def.urls === 'function' ? def.urls(z) : def.urls;
  };

  LingsMap.prototype.setLayer = function (key) {
    if (!LAYERS[key] || key === this.layerKey) return;
    var oldCrs = LAYERS[this.layerKey].crs, newCrs = LAYERS[key].crs;
    if (oldCrs !== newCrs) {
      var v = this.view;
      if (oldCrs === 'gcj') { var w = G.gcj02ToWgs84(v.lng, v.lat); v.lng = w[0]; v.lat = w[1]; }
      if (newCrs === 'gcj') { var g = G.wgs84ToGcj02(v.lng, v.lat); v.lng = g[0]; v.lat = g[1]; }
    }
    this.layerKey = key;
    this.view.zoom = Math.min(this.view.zoom, LAYERS[key].maxZoom);
    this._clearTiles();
    this._tileFailures = 0;
    if (this.opts.onLayerChange) this.opts.onLayerChange(key, LAYERS[key]);
    this.render();
  };

  LingsMap.prototype.getLayer = function () { return this.layerKey; };
  LingsMap.prototype.getLayerDef = function () { return LAYERS[this.layerKey]; };

  /* ---------------- 数据 ---------------- */
  LingsMap.prototype.setTombs = function (arr) { this.tombs = arr || []; this.render(); };
  LingsMap.prototype.setFilter = function (fn) { this.filter = fn || null; this.render(); };
  LingsMap.prototype.setPlan = function (ids) { this.plan = ids || []; this.render(); };
  LingsMap.prototype.setSelected = function (id) { this.selectedId = id || null; this.render(); };
  LingsMap.prototype.setVisited = function (fn) { this.visited = fn || function () { return false; }; this.render(); };

  /* ---------------- 视图 ---------------- */
  LingsMap.prototype._fitChina = function (instant) {
    var self = this;
    var box = { w: this._size.w || 800, h: this._size.h || 600 };
    var lonSpan = 73, latSpan = 54;
    var zoom = 4;
    for (var z = 7; z >= 3; z--) {
      var p1 = G.project(73, 54, z), p2 = G.project(136, 18, z);
      if (p2.x - p1.x <= box.w * 0.86 && p2.y - p1.y <= box.h * 0.8) { zoom = z; break; }
    }
    var c = G.wgs84ToGcj02(104.5, 35.5);
    if (instant) { this.view = { lng: c[0], lat: c[1], zoom: zoom }; this.render(); return; }
    this.flyTo(c[0], c[1], zoom, 520);
  };

  LingsMap.prototype.setView = function (lng, lat, zoom) {
    this.view.lng = lng; this.view.lat = lat;
    if (zoom != null) this.view.zoom = clamp(Math.round(zoom), 3, LAYERS[this.layerKey].maxZoom);
    this.render();
  };

  LingsMap.prototype.flyTo = function (lng, lat, zoom, dur) {
    var crs = LAYERS[this.layerKey].crs;
    var lnglat = this._display(lng, lat);
    var self = this;
    if (this._anim) { cancelAnimationFrame(this._anim); this._anim = null; }
    if (!dur) { this.view.lng = lnglat[0]; this.view.lat = lnglat[1]; if (zoom != null) this.view.zoom = clamp(Math.round(zoom), 3, LAYERS[this.layerKey].maxZoom); this.render(); return; }
    var from = { lng: this.view.lng, lat: this.view.lat, zoom: this.view.zoom };
    var to = { lng: lnglat[0], lat: lnglat[1], zoom: zoom == null ? this.view.zoom : clamp(Math.round(zoom), 3, LAYERS[this.layerKey].maxZoom) };
    var t0 = now(), span = Math.max(1, parseInt(dur, 10) || 500);
    function step() {
      var t = clamp((now() - t0) / span, 0, 1), k = ease(t);
      self.view.lng = from.lng + (to.lng - from.lng) * k;
      self.view.lat = from.lat + (to.lat - from.lat) * k;
      self.view.zoom = from.zoom + (to.zoom - from.zoom) * k;
      self.render();
      if (t < 1) { self._anim = requestAnimationFrame(step); } else { self._anim = null; }
    }
    step();
  };

  // 缩放到包含所有点（WGS84）
  LingsMap.prototype.fitPoints = function (points, padding) {
    if (!points || !points.length) return;
    padding = padding == null ? 70 : padding;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    var z0 = 15, p, d;
    for (var i = 0; i < points.length; i++) {
      d = this._display(points[i].lng, points[i].lat);
      p = G.project(d[0], d[1], z0);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    // 估算合适的整数缩放级
    var w = this._size.w - padding * 2, h = this._size.h - padding * 2;
    var scaleW = w / Math.max(1, maxX - minX), scaleH = h / Math.max(1, maxY - minY);
    var scale = Math.min(scaleW, scaleH);
    var zoom = clamp(Math.floor(z0 + Math.log2(scale)), 3, LAYERS[this.layerKey].maxZoom);
    var c = this._display((Math.min.apply(null, points.map(function (t) { return t.lng; })) + Math.max.apply(null, points.map(function (t) { return t.lng; }))) / 2,
      (Math.min.apply(null, points.map(function (t) { return t.lat; })) + Math.max.apply(null, points.map(function (t) { return t.lat; }))) / 2);
    this.flyTo(c[0], c[1], points.length === 1 ? 12 : zoom, 480);
  };

  LingsMap.prototype.screenOf = function (lng, lat) {
    var d = this._display(lng, lat);
    var p = G.project(d[0], d[1], this.view.zoom);
    var cp = G.project(this.view.lng, this.view.lat, this.view.zoom);
    return { x: p.x - cp.x + this._size.w / 2, y: p.y - cp.y + this._size.h / 2 };
  };

  /* ---------------- 尺寸 / 渲染 ---------------- */
  LingsMap.prototype.resize = function () {
    var w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    var dpr = Math.min(2.5, global.devicePixelRatio || 1);
    this._size = { w: w, h: h, dpr: dpr };
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
    }
    this._clearTiles();
    this.render();
    if (this.opts.onResize) this.opts.onResize();
  };

  LingsMap.prototype.render = function () {
    var self = this;
    if (this._raf) return;
    this._raf = requestAnimationFrame(function () { self._raf = 0; self._draw(); });
  };

  LingsMap.prototype._origin = function () {
    var cp = G.project(this.view.lng, this.view.lat, this.view.zoom);
    return { x: cp.x - this._size.w / 2, y: cp.y - this._size.h / 2 };
  };

  LingsMap.prototype._clearTiles = function () {
    this._tileNodes = {};
    this._tileZoom = null;
    while (this.tileEl.firstChild) this.tileEl.removeChild(this.tileEl.firstChild);
  };

  // 高德矢量瓦片在草原/沙漠/山地等无细节区域返回 179B 的纯色空白图，直接显示就是“白屏”。
  // 用 fetch 探测体积（CORS 由高德返回 *），空白瓦片换成同位置卫星影像补位。
  LingsMap.prototype._probeTile = function (url, img, fallbackUrl) {
    var fetchFn = global.fetch;
    if (typeof fetchFn !== 'function' || !fallbackUrl) return;
    fetchFn(url, { mode: 'cors', credentials: 'omit' }).then(function (r) {
      return r && r.ok ? r.blob() : null;
    }).then(function (b) {
      if (b && b.size < 400) { img.style.opacity = '0'; img.src = fallbackUrl; }
    }).catch(function () { /* 跨域/离线时保持原瓦片 */ });
  };

  LingsMap.prototype._drawTiles = function (origin) {
    var def = LAYERS[this.layerKey];
    var zoom = this.view.zoom;
    var z = Math.floor(zoom);
    var scale = Math.pow(2, zoom - z);        // 小数缩放：瓦片本体按 scale 放大
    var w = this._size.w, h = this._size.h;
    if (this._tileZoom !== z) { this._clearTiles(); this._tileZoom = z; }
    // 关键：瓦片直接用“屏幕坐标”定位，不再用巨大的世界坐标 + 父层大平移，
    // 否则在 z≈17+ 时世界像素超过 CSS transform 的 float 精度上限，瓦片会错位/消失。
    this.tileEl.style.transform = 'none';
    var urls = this._urlsFor(z);
    if (!urls.length) return;
    var n = Math.pow(2, z);
    var origin0 = { x: origin.x / scale, y: origin.y / scale };
    var tileScreen = TILE * scale;
    var tx0 = Math.floor(origin0.x / TILE), ty0 = Math.floor(origin0.y / TILE);
    var tx1 = Math.floor((origin0.x + w / scale) / TILE), ty1 = Math.floor((origin0.y + h / scale) / TILE);
    var wanted = {};
    var self = this;
    for (var ty = ty0; ty <= ty1; ty++) {
      if (ty < 0 || ty >= n) continue;
      for (var tx = tx0; tx <= tx1; tx++) {
        var wx = ((tx % n) + n) % n;
        var key = z + '/' + tx + '/' + ty;
        wanted[key] = true;
        var sx = tx * tileScreen - origin.x;
        var sy = ty * tileScreen - origin.y;
        var tf = 'translate3d(' + sx.toFixed(2) + 'px,' + sy.toFixed(2) + 'px,0) scale(' + scale + ')';
        var node = this._tileNodes[key];
        if (!node) {
          node = document.createElement('div');
          node.className = 'lm-tile';
          node.style.transform = tf;
          node._tf = tf;
          for (var u = 0; u < urls.length; u++) {
            (function (url, fallbackUrl) {
              var img = document.createElement('img');
              img.className = 'lm-tile-img';
              img.alt = '';
              img.draggable = false;
              img.decoding = 'async';
              img.onload = function () { img.style.opacity = '1'; self._tileOk++; };
              img.onerror = function () {
                self._tileFailures++;
                img.style.display = 'none';
                if (self._tileFailures === 8 && self.opts.onTileError) self.opts.onTileError();
              };
              img.src = url;
              node.appendChild(img);
              if (fallbackUrl) self._probeTile(url, img, fallbackUrl);
            })(urls[u](z, wx, ty), def.fallback ? def.fallback(z, wx, ty) : null);
          }
          this.tileEl.appendChild(node);
          this._tileNodes[key] = node;
        } else if (node._tf !== tf) {
          node.style.transform = tf;
          node._tf = tf;
        }
        if (node.style.display === 'none') node.style.display = '';
      }
    }
    // 视野外的旧瓦片不删除（避免来回平移时反复请求），先隐藏；缩放层级变化时整体重建
    var allKeys = Object.keys(this._tileNodes);
    var hiddenCount = 0;
    for (var i = 0; i < allKeys.length; i++) {
      if (wanted[allKeys[i]]) continue;
      var hidden = this._tileNodes[allKeys[i]];
      if (hidden && hidden.style.display !== 'none') hidden.style.display = 'none';
      hiddenCount++;
    }
    // 隐藏节点过多时清理，防止长距离平移后 DOM / 解码位图无限增长
    if (allKeys.length > 120 && hiddenCount > 0) {
      for (var j = 0; j < allKeys.length; j++) {
        var keyJ = allKeys[j];
        if (wanted[keyJ]) continue;
        var oldNode = this._tileNodes[keyJ];
        if (oldNode && oldNode.parentNode) oldNode.parentNode.removeChild(oldNode);
        delete this._tileNodes[keyJ];
      }
    }
  };

  LingsMap.prototype._drawGrid = function (ctx, w, h, origin, z) {
    ctx.fillStyle = '#efe9dc';
    ctx.fillRect(0, 0, w, h);
    var step = z <= 4 ? 5 : z <= 5 ? 2 : z <= 6 ? 1 : z <= 7 ? 0.5 : z <= 8 ? 0.2 : z <= 9 ? 0.1 : z <= 10 ? 0.05 : 0.02;
    var tl = G.unproject(origin.x, origin.y, z);
    var br = G.unproject(origin.x + w, origin.y + h, z);
    ctx.strokeStyle = 'rgba(120,108,88,.18)';
    ctx.fillStyle = 'rgba(110,100,82,.7)';
    ctx.lineWidth = 1;
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    var x, y, lng, lat;
    for (lng = Math.ceil(tl.lng / step) * step; lng <= br.lng; lng += step) {
      x = G.project(lng, 0, z).x - origin.x;
      if (x < -20 || x > w + 20) continue;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      ctx.fillText(lng.toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0) + '°E', x + 3, 12);
    }
    for (lat = Math.ceil(br.lat / step) * step; lat <= tl.lat; lat += step) {
      y = G.project(0, lat, z).y - origin.y;
      if (y < -20 || y > h + 20) continue;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      ctx.fillText(lat.toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0) + '°N', 4, y - 3);
    }
  };

  LingsMap.prototype._drawCities = function (ctx, origin, z) {
    if (z > 8) return;
    var i, c, p;
    ctx.font = '11px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    for (i = 0; i < CITIES.length; i++) {
      c = CITIES[i];
      p = this._display(c[1], c[2]);
      var w = G.project(p[0], p[1], z);
      var x = w.x - origin.x, y = w.y - origin.y;
      if (x < -40 || y < -20 || x > this._size.w + 40 || y > this._size.h + 20) continue;
      ctx.fillStyle = 'rgba(120,110,92,.55)';
      ctx.beginPath(); ctx.arc(x, y, 2.2, 0, PI2); ctx.fill();
      ctx.fillStyle = 'rgba(90,82,68,.85)';
      ctx.fillText(c[0], x + 5, y + 3.5);
    }
  };

  function drawMarker(ctx, x, y, tomb, opt) {
    var r = (tomb.kind === '陵区' || tomb.kind === '待考') ? 5 : 5.8;
    var color = tomb.color || '#a63a2e';
    var uncertain = tomb.precision === 'low';
    ctx.save();
    // 阴影
    ctx.beginPath(); ctx.arc(x, y + 1.5, r + 1.2, 0, PI2);
    ctx.fillStyle = 'rgba(30,24,18,.22)'; ctx.fill();
    if (uncertain) {
      ctx.beginPath(); ctx.arc(x, y, r + 0.5, 0, PI2);
      ctx.fillStyle = 'rgba(255,252,244,.95)'; ctx.fill();
      ctx.setLineDash([2.6, 2.2]);
      ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(x, y, 1.8, 0, PI2); ctx.fillStyle = color; ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(x, y, r, 0, PI2);
      ctx.fillStyle = color; ctx.fill();
      ctx.lineWidth = 1.8; ctx.strokeStyle = '#fffdf7'; ctx.stroke();
    }
    if (opt && opt.hover) {
      ctx.beginPath(); ctx.arc(x, y, r + 4, 0, PI2);
      ctx.strokeStyle = 'rgba(40,32,24,.55)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    if (opt && opt.selected) {
      ctx.beginPath(); ctx.arc(x, y, r + 4.5, 0, PI2);
      ctx.strokeStyle = '#241f18'; ctx.lineWidth = 2.2; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, r + 7.5, 0, PI2);
      ctx.strokeStyle = 'rgba(36,31,24,.25)'; ctx.lineWidth = 1.2; ctx.stroke();
    }
    ctx.restore();
  }

  function drawPlanBadge(ctx, x, y, num) {
    var label = String(num);
    ctx.save();
    ctx.font = 'bold 10px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    var tw = Math.max(14, ctx.measureText(label).width + 8);
    var bx = x + 5, by = y - 15;
    ctx.beginPath();
    var rr = 4;
    ctx.moveTo(bx + rr, by);
    ctx.lineTo(bx + tw - rr, by); ctx.quadraticCurveTo(bx + tw, by, bx + tw, by + rr);
    ctx.lineTo(bx + tw, by + 13 - rr); ctx.quadraticCurveTo(bx + tw, by + 13, bx + tw - rr, by + 13);
    ctx.lineTo(bx + rr, by + 13); ctx.quadraticCurveTo(bx, by + 13, bx, by + 13 - rr);
    ctx.lineTo(bx, by + rr); ctx.quadraticCurveTo(bx, by, bx + rr, by);
    ctx.fillStyle = '#241f18'; ctx.fill();
    ctx.fillStyle = '#f5c96a'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + 4, by + 6.8);
    ctx.restore();
  }

  LingsMap.prototype._draw = function () {
    var ctx = this.ctx, w = this._size.w, h = this._size.h, dpr = this._size.dpr;
    if (!w || !h) return;
    var z = this.view.zoom;
    this._lastDraw = now();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    var origin = this._origin();
    var i, t, p, x, y;

    var isNone = this._urlsFor(Math.floor(z)).length === 0;
    if (isNone) { this._drawGrid(ctx, w, h, origin, z); this._drawCities(ctx, origin, z); }
    this._drawTiles(origin);

    var planById = {};
    for (i = 0; i < this.plan.length; i++) planById[this.plan[i]] = i + 1;

    // 路线连线
    var planPts = [];
    for (i = 0; i < this.plan.length; i++) {
      var pt = this.tombs.filter(function (tt) { return tt.id === this.plan[i]; }.bind(this))[0];
      if (!pt) continue;
      var d = this._display(pt.lng, pt.lat);
      planPts.push(G.project(d[0], d[1], z));
    }
    if (planPts.length > 1) {
      ctx.save();
      ctx.beginPath();
      for (i = 0; i < planPts.length; i++) {
        var px = planPts[i].x - origin.x, py = planPts[i].y - origin.y;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = 'rgba(166,58,46,.28)';
      ctx.lineWidth = 7; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.stroke();
      ctx.strokeStyle = 'rgba(166,58,46,.9)';
      ctx.lineWidth = 2; ctx.setLineDash([7, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // 标注：聚类
    var cell = z <= 5 ? 66 : z <= 6 ? 58 : z <= 7 ? 50 : z <= 8 ? 42 : z <= 9 ? 34 : 0;
    var clusters = {};
    var singles = [];
    for (i = 0; i < this.tombs.length; i++) {
      t = this.tombs[i];
      if (!t.lng || !t.lat) continue;
      if (this.filter && !this.filter(t)) {
        // 已规划的点即使被过滤也显示为小点
        if (!planById[t.id]) continue;
      }
      var dd = this._display(t.lng, t.lat);
      p = G.project(dd[0], dd[1], z);
      x = p.x - origin.x; y = p.y - origin.y;
      if (x < -30 || y < -30 || x > w + 30 || y > h + 30) continue;
      if (cell) {
        var key = Math.round(x / cell) + '_' + Math.round(y / cell);
        if (!clusters[key]) clusters[key] = { x: 0, y: 0, items: [] };
        clusters[key].items.push({ t: t, x: x, y: y });
      } else {
        singles.push({ t: t, x: x, y: y });
      }
    }
    this.hits = [];
    var clusterKeys = Object.keys(clusters);
    for (i = 0; i < clusterKeys.length; i++) {
      var cl = clusters[clusterKeys[i]];
      if (cl.items.length === 1) { singles.push(cl.items[0]); continue; }
      var cx = 0, cy = 0, eraCount = {};
      for (var j = 0; j < cl.items.length; j++) {
        cx += cl.items[j].x; cy += cl.items[j].y;
        var er = cl.items[j].t.era || '其他';
        eraCount[er] = (eraCount[er] || 0) + 1;
      }
      cx /= cl.items.length; cy /= cl.items.length;
      var topEra = Object.keys(eraCount).sort(function (a, b) { return eraCount[b] - eraCount[a]; })[0];
      var col = (cl.items[0].t.color || '#a63a2e');
      var eraColors = { '秦': '#7a4e2d', '汉': '#a6322e', '魏晋南北朝': '#4f6d7a', '隋唐': '#c08a2e', '五代十国': '#8c6a4a', '宋': '#2f7d6d', '辽金西夏': '#6c5b7b', '元': '#5c7a3d', '明': '#b5651d', '清': '#2e5e8c', '边疆': '#8e6c88' };
      col = eraColors[topEra] || col;
      var cr = 11 + Math.min(9, Math.log2(cl.items.length) * 3.2);
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy + 1.5, cr + 1.5, 0, PI2);
      ctx.fillStyle = 'rgba(30,24,18,.22)'; ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy, cr, 0, PI2);
      ctx.fillStyle = col; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,252,244,.92)'; ctx.stroke();
      ctx.fillStyle = '#fffdf7';
      ctx.font = 'bold ' + (cr > 15 ? 13 : 12) + 'px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(cl.items.length), cx, cy + 0.5);
      ctx.restore();
      var span = clusterSpan(cl.items);
      this.hits.push({ type: 'cluster', x: cx, y: cy, r: cr + 5, count: cl.items.length, lng: span.lng, lat: span.lat, zoom: Math.min(z + 2, LAYERS[this.layerKey].maxZoom) });
    }

    // 单个点位
    var showLabel = z >= 10;
    for (i = 0; i < singles.length; i++) {
      var s = singles[i];
      var tmb = s.t;
      var sel = tmb.id === this.selectedId;
      var hov = this._hover && this._hover.id === tmb.id;
      drawMarker(ctx, s.x, s.y, tmb, { selected: sel, hover: hov });
      if (planById[tmb.id]) drawPlanBadge(ctx, s.x, s.y, planById[tmb.id]);
      if (this.visited(tmb.id)) {
        ctx.save();
        ctx.beginPath(); ctx.arc(s.x - 7, s.y - 7, 3.4, 0, PI2);
        ctx.fillStyle = '#2f7d6d'; ctx.fill();
        ctx.strokeStyle = '#fffdf7'; ctx.lineWidth = 1; ctx.stroke();
        ctx.restore();
      }
      if (showLabel) {
        var label = tmb.name;
        ctx.save();
        ctx.font = '600 11px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,253,247,.92)';
        ctx.strokeText(label, s.x, s.y - 8);
        ctx.fillStyle = 'rgba(43,38,32,.92)';
        ctx.fillText(label, s.x, s.y - 8);
        ctx.restore();
      }
      this.hits.push({ type: 'tomb', id: tmb.id, x: s.x, y: s.y, r: 14 });
    }
    if (this.hits.length) {
      // 点位优先于聚类命中
      this.hits.sort(function (a, b) { return (a.type === 'tomb' ? 0 : 1) - (b.type === 'tomb' ? 0 : 1); });
    }
    if (this.opts.onMove) this.opts.onMove();
  };

  function clusterSpan(items) {
    // 返回 WGS-84 均值；绘制与飞行时由引擎统一换算（若返回 GCJ 会被 flyTo 二次偏移）
    var sumLng = 0, sumLat = 0, i, t;
    for (i = 0; i < items.length; i++) {
      t = items[i].t;
      sumLng += t.lng; sumLat += t.lat;
    }
    return { lng: sumLng / items.length, lat: sumLat / items.length };
  }

  /* ---------------- 交互 ---------------- */
  LingsMap.prototype._hitTest = function (sx, sy) {
    var i, hh;
    for (i = 0; i < this.hits.length; i++) {
      hh = this.hits[i];
      var dx = sx - hh.x, dy = sy - hh.y;
      if (dx * dx + dy * dy <= hh.r * hh.r) return hh;
    }
    return null;
  };

  LingsMap.prototype._bind = function () {
    var self = this;
    var el = this.el;

    // 拖动地图时禁止浏览器把瓦片图片当成“可拖拽图片”拖走、也禁止顺带选中文字
    el.addEventListener('dragstart', function (e) { e.preventDefault(); });
    el.addEventListener('selectstart', function (e) { e.preventDefault(); });
    el.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
      el.setPointerCapture(e.pointerId);
      self._pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(self._pointers);
      if (ids.length === 1) {
        self._pointer = { id: e.pointerId, startX: e.clientX, startY: e.clientY, lng: self.view.lng, lat: self.view.lat, zoom: self.view.zoom, moved: false };
        self._dragMoved = false;
      } else if (ids.length === 2) {
        var a = self._pointers[ids[0]], b = self._pointers[ids[1]];
        var rect = el.getBoundingClientRect();
        var midX = (a.x + b.x) / 2 - rect.left, midY = (a.y + b.y) / 2 - rect.top;
        self._pinch = {
          dist: Math.hypot(a.x - b.x, a.y - b.y),
          zoom: self.view.zoom,
          anchor: G.unproject((G.project(self.view.lng, self.view.lat, self.view.zoom).x - self._size.w / 2 + midX),
            (G.project(self.view.lng, self.view.lat, self.view.zoom).y - self._size.h / 2 + midY), self.view.zoom)
        };
        self._pointer = null;
      }
    });

    el.addEventListener('pointermove', function (e) {
      var rect = el.getBoundingClientRect();
      var sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      if (self._pointers[e.pointerId]) { self._pointers[e.pointerId].x = e.clientX; self._pointers[e.pointerId].y = e.clientY; }
      var ids = Object.keys(self._pointers);
      if (self._pinch && ids.length >= 2) {
        var a = self._pointers[ids[0]], b = self._pointers[ids[1]];
        var dist = Math.hypot(a.x - b.x, a.y - b.y);
        var dZoom = Math.round(Math.log(dist / self._pinch.dist) / Math.LN2);
        if (dZoom !== 0) {
          var nz = clamp(self._pinch.zoom + dZoom, 3, LAYERS[self.layerKey].maxZoom);
          self._pinch.zoom = nz;
          self._pinch.dist = dist;
          self._zoomAt((a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top, nz, self._pinch.anchor);
          self._pinch.anchor = G.unproject(
            G.project(self.view.lng, self.view.lat, self.view.zoom).x - self._size.w / 2 + ((a.x + b.x) / 2 - rect.left),
            G.project(self.view.lng, self.view.lat, self.view.zoom).y - self._size.h / 2 + ((a.y + b.y) / 2 - rect.top), self.view.zoom);
        }
        self._dragMoved = true;
        return;
      }
      if (self._pointer && self._pointer.id === e.pointerId) {
        var dx = e.clientX - self._pointer.startX, dy = e.clientY - self._pointer.startY;
        if (Math.abs(dx) + Math.abs(dy) > 3) { self._pointer.moved = true; self._dragMoved = true; }
        if (self._pointer.moved) {
          var cp = G.project(self._pointer.lng, self._pointer.lat, self.view.zoom);
          var lnglat = G.unproject(cp.x - dx, cp.y - dy, self.view.zoom);
          self.view.lng = lnglat.lng; self.view.lat = lnglat.lat;
          self.render();
        }
      } else {
        // 悬停
        var hit = self._hitTest(sx, sy);
        var newHover = hit && hit.type === 'tomb' ? self._tombById(hit.id) : null;
        if ((newHover && newHover.id) !== (self._hover && self._hover.id)) {
          self._hover = newHover;
          self.render();
          if (self.opts.onHover) self.opts.onHover(newHover, e);
        }
        el.style.cursor = hit ? 'pointer' : (self._pointer ? 'grabbing' : 'grab');
      }
    });

    function up(e) {
      delete self._pointers[e.pointerId];
      var ids = Object.keys(self._pointers);
      if (ids.length < 2) self._pinch = null;
      if (ids.length === 0) {
        var wasDrag = self._dragMoved;
        var ptr = self._pointer;
        self._pointer = null;
        self._dragMoved = false;
        if (!wasDrag && ptr) {
          var rect = el.getBoundingClientRect();
          var hit = self._hitTest(e.clientX - rect.left, e.clientY - rect.top);
          if (hit) {
            if (hit.type === 'tomb') {
              var t = self._tombById(hit.id);
              if (t && self.opts.onSelect) self.opts.onSelect(t);
            } else if (hit.type === 'cluster') {
              self.flyTo(hit.lng, hit.lat, hit.zoom, 420);
            }
          } else if (self.opts.onMapClick) {
            self.opts.onMapClick(e);
          }
        }
      }
    }
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', function (e) { delete self._pointers[e.pointerId]; self._pointer = null; self._pinch = null; });
    el.addEventListener('pointerleave', function () {
      if (self._hover) { self._hover = null; self.render(); }
    });

    el.addEventListener('wheel', function (e) {
      e.preventDefault();
      var rect = el.getBoundingClientRect();
      // 滚轮累积：鼠标滚一格（~100）立刻缩放，触控板小步滚动累积到阈值再缩放，避免一划就跑到最大级
      var d = e.deltaY;
      if (e.deltaMode === 1) d *= 16;
      else if (e.deltaMode === 2) d *= self._size.h || 800;
      self._wheelAcc += d;
      if (Math.abs(self._wheelAcc) < 20) return;
      var dir = self._wheelAcc < 0 ? 1 : -1;
      self._wheelAcc = 0;
      var nz = clamp(Math.round(self.view.zoom) + dir, 3, LAYERS[self.layerKey].maxZoom);
      self._zoomAt(e.clientX - rect.left, e.clientY - rect.top, nz);
    }, { passive: false });

    el.addEventListener('dblclick', function (e) {
      var rect = el.getBoundingClientRect();
      var nz = clamp(Math.round(self.view.zoom) + 1, 3, LAYERS[self.layerKey].maxZoom);
      self._zoomAt(e.clientX - rect.left, e.clientY - rect.top, nz);
    });

    el.addEventListener('mousemove', function (e) {
      if (self._pointer) el.style.cursor = 'grabbing';
    });

    el.addEventListener('keydown', function (e) {
      var step = 80;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        var cp = G.project(self.view.lng, self.view.lat, self.view.zoom);
        var dx = e.key === 'ArrowLeft' ? step : e.key === 'ArrowRight' ? -step : 0;
        var dy = e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0;
        var ll = G.unproject(cp.x + dx, cp.y + dy, self.view.zoom);
        self.view.lng = ll.lng; self.view.lat = ll.lat; self.render();
      }
    });
  };

  // 以屏幕坐标 (sx, sy) 为锚点缩放到 zoom（sx/sy 为相对地图容器的像素）
  LingsMap.prototype._zoomAt = function (sx, sy, zoom, anchorLL) {
    var target = Number(zoom);
    if (!isFinite(target)) target = this.view.zoom;
    target = clamp(Math.round(target), 3, LAYERS[this.layerKey].maxZoom);
    var z0 = G.project(this.view.lng, this.view.lat, this.view.zoom);
    var anchorScreen = { x: (sx == null ? this._size.w / 2 : sx), y: (sy == null ? this._size.h / 2 : sy) };
    var anchorGeo;
    if (anchorLL) anchorGeo = anchorLL;
    else {
      var origin = { x: z0.x - this._size.w / 2, y: z0.y - this._size.h / 2 };
      anchorGeo = G.unproject(origin.x + anchorScreen.x, origin.y + anchorScreen.y, this.view.zoom);
    }
    this.view.zoom = target;
    var np = G.project(anchorGeo.lng, anchorGeo.lat, this.view.zoom);
    var newOrigin = { x: np.x - anchorScreen.x, y: np.y - anchorScreen.y };
    var c = G.unproject(newOrigin.x + this._size.w / 2, newOrigin.y + this._size.h / 2, this.view.zoom);
    this.view.lng = c.lng; this.view.lat = c.lat;
    this._clearTiles();
    this.render();
  };

  LingsMap.prototype._tombById = function (id) {
    for (var i = 0; i < this.tombs.length; i++) if (this.tombs[i].id === id) return this.tombs[i];
    return null;
  };

  LingsMap.prototype.zoomBy = function (delta) {
    var nz = clamp(Math.round(this.view.zoom) + delta, 3, LAYERS[this.layerKey].maxZoom);
    this._zoomAt(this._size.w / 2, this._size.h / 2, nz);
  };

  LingsMap.prototype.reset = function () { this._fitChina(false); };
  LingsMap.prototype.getView = function () { return { lng: this.view.lng, lat: this.view.lat, zoom: this.view.zoom }; };

  /* ---------------- 导出 ---------------- */
  LingsMap.LAYERS = LAYERS;
  global.LingsMap = LingsMap;
})(typeof window !== 'undefined' ? window : globalThis);
