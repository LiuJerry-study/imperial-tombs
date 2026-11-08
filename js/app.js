/*!
 * 帝陵图志 — 页面逻辑（无构建、无外部依赖，可直接 file:// 打开）
 */
(function () {
  'use strict';
  var G = window.LingsGeo;
  var TOMBS = window.TOMBS || [];
  var ERA_META = window.ERA_META || [];
  var ROUTES = (window.ROUTE_PRESETS && window.ROUTE_PRESETS.routes) || [];
  var STATUSES = ['全部', '开放', '遗址', '未开放', '待考'];
  var TAG_FILTERS = ['世遗', '5A', '国保'];
  var KEY = { plan: 'lings-plan-v2', visited: 'lings-visited-v2', layer: 'lings-layer-v3' };
  var BUILD = '2026-11-08.5';
  window.LINGS_BUILD = BUILD;

  var byId = {};
  TOMBS.forEach(function (t) { byId[t.id] = t; });

  var state = {
    era: {}, status: '全部', tags: {}, query: '', hideVisited: false,
    tab: 'tombs', plan: [], visited: {}, layer: 'hybrid',
    selectedId: null, popupId: null
  };
  var map = null;
  var searchTimer = 0;

  /* ---------------- DOM 工具 ---------------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $all(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function hasPlan(id) { return state.plan.indexOf(id) >= 0; }
  function storeSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  function storeGet(k, fb) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch (e) { return fb; } }

  /* ---------------- 筛选 / 列表 ---------------- */
  function tombPasses(t) {
    var eraSel = Object.keys(state.era).filter(function (k) { return state.era[k]; });
    if (eraSel.length && !state.era[t.era]) return false;
    if (state.status !== '全部' && t.status !== state.status) return false;
    var tags = Object.keys(state.tags).filter(function (k) { return state.tags[k]; });
    for (var i = 0; i < tags.length; i++) if (t.tags.indexOf(tags[i]) < 0) return false;
    if (state.hideVisited && state.visited[t.id]) return false;
    if (state.query) {
      var q = state.query.trim().toLowerCase();
      if (q && t.searchText.toLowerCase().indexOf(q) < 0) return false;
    }
    return true;
  }

  function statusPill(t) {
    var cls = { '开放': 'st-open', '遗址': 'st-site', '未开放': 'st-closed', '待考': 'st-unknown' }[t.status] || '';
    return '<span class="pill ' + cls + '">' + esc(t.status) + '</span>';
  }
  function tagPills(t) {
    return (t.tags || []).map(function (g) { return '<span class="pill tag">' + esc(g) + '</span>'; }).join('');
  }

  function renderEraChips() {
    var box = $('#eraChips');
    var total = TOMBS.length;
    var html = '<button class="chip' + (Object.keys(state.era).every(function (k) { return !state.era[k]; }) ? ' active' : '') + '" data-era="__all">全部 <b>' + total + '</b></button>';
    ERA_META.forEach(function (e) {
      var n = TOMBS.filter(function (t) { return t.era === e.era; }).length;
      html += '<button class="chip' + (state.era[e.era] ? ' active' : '') + '" data-era="' + esc(e.era) + '">' +
        '<i class="dot" style="background:' + e.color + '"></i>' + esc(e.era) + ' <b>' + n + '</b></button>';
    });
    box.innerHTML = html;
  }

  function renderTagChips() {
    var box = $('#tagChips');
    box.innerHTML = TAG_FILTERS.map(function (g) {
      var n = TOMBS.filter(function (t) { return t.tags.indexOf(g) >= 0; }).length;
      return '<button class="chip small' + (state.tags[g] ? ' active' : '') + '" data-tag="' + g + '">' + g + ' <b>' + n + '</b></button>';
    }).join('');
  }

  function renderList() {
    var items = TOMBS.filter(tombPasses);
    $('#tombCount').textContent = '共 ' + items.length + ' / ' + TOMBS.length + ' 处';
    var list = $('#tombList');
    var keepScroll = list.scrollTop;
    if (!items.length) {
      list.innerHTML = '<div class="empty">没有符合条件的帝陵。<br>试试清空筛选，或换个关键词。</div>';
      return;
    }
    var html = items.map(function (t) {
      var idx = state.plan.indexOf(t.id);
      var planNo = idx >= 0 ? idx + 1 : 0;
      return '<div class="tomb-item' + (state.selectedId === t.id ? ' active' : '') + '" data-id="' + t.id + '">' +
        '<span class="era-bar" style="background:' + t.color + '"></span>' +
        '<div class="ti-main">' +
          '<div class="ti-title"><span class="ti-name">' + esc(t.name) + '</span>' +
            '<span class="ti-dyn" style="color:' + t.color + '">' + esc(t.dynasty) + '</span>' +
            '<span class="ti-year">' + esc(t.yearText) + '</span></div>' +
          '<div class="ti-sub">' + esc(t.owner || '') + (t.owner ? ' · ' : '') + esc(t.place) + '</div>' +
          '<div class="ti-meta">' + statusPill(t) + tagPills(t) +
            (state.visited[t.id] ? '<span class="pill visited-mark">已打卡</span>' : '') + '</div>' +
        '</div>' +
        '<div class="ti-actions">' +
          (planNo ? '<span class="plan-no" title="行程第 ' + planNo + ' 站">' + planNo + '</span>' :
            '<button class="btn-add" data-add="' + t.id + '" title="加入行程" aria-label="加入行程">＋</button>') +
        '</div>' +
      '</div>';
    }).join('');
    list.innerHTML = html;
    list.scrollTop = keepScroll;
  }

  /* ---------------- 行程 ---------------- */
  function planTombs() {
    return state.plan.map(function (id) { return byId[id]; }).filter(Boolean);
  }
  function savePlan() {
    storeSet(KEY.plan, state.plan);
    map.setPlan(state.plan);
    renderList(); renderPlan(); updateHeader();
  }
  function addToPlan(id) {
    if (!byId[id] || hasPlan(id)) return;
    state.plan.push(id);
    savePlan();
    toast('已加入行程：第 ' + state.plan.length + ' 站 · ' + byId[id].name);
    if (state.popupId === id) openPopup(byId[id]);
  }
  function removeFromPlan(id) {
    var i = state.plan.indexOf(id);
    if (i < 0) return;
    var name = byId[id] ? byId[id].name : '';
    state.plan.splice(i, 1);
    savePlan();
    toast('已移出行程：' + name);
    if (state.popupId === id) openPopup(byId[id]);
  }
  function clearPlan() {
    if (!state.plan.length) return;
    state.plan = [];
    savePlan();
    toast('行程已清空');
  }
  function movePlan(index, delta) {
    var j = index + delta;
    if (j < 0 || j >= state.plan.length) return;
    var tmp = state.plan[index];
    state.plan[index] = state.plan[j];
    state.plan[j] = tmp;
    savePlan();
  }
  function optimizePlan() {
    var pts = planTombs();
    if (pts.length < 3) { toast('至少 3 站才能优化顺序'); return; }
    var order = G.optimizeOrder(pts.map(function (t) { return { lng: t.lng, lat: t.lat }; }));
    state.plan = order.map(function (i) { return pts[i].id; });
    savePlan();
    toast('已按直线距离优化顺序（保留第 1 站为起点）');
  }

  function planStats() {
    var pts = planTombs();
    var r = G.routeLegs(pts);
    var road = 0;
    r.legs.forEach(function (l) { road += G.estimateRoadKm(l.km); });
    var drive = road / 68;
    var days = G.suggestDays(r.totalKm, pts.length);
    return { pts: pts, legs: r.legs, straight: r.totalKm, road: road, drive: drive, days: days };
  }

  function renderPlan() {
    var s = planStats();
    var list = $('#planList');
    var stats = $('#planStats');
    var empty = $('#planEmpty');
    if (!state.plan.length) {
      stats.innerHTML = '<div class="ps-empty">还没有安排站点</div>';
      list.innerHTML = '';
      empty.style.display = '';
      $('#planActions').style.display = 'none';
      $('#planExport').style.display = 'none';
      return;
    }
    empty.style.display = 'none';
    $('#planActions').style.display = '';
    $('#planExport').style.display = '';
    stats.innerHTML =
      '<div class="ps-row"><span>站点</span><b>' + s.pts.length + ' 处</b></div>' +
      '<div class="ps-row"><span>直线距离</span><b>' + G.formatKm(s.straight) + '</b></div>' +
      '<div class="ps-row"><span>估算公路</span><b>' + G.formatKm(s.road) + '</b></div>' +
      '<div class="ps-row"><span>行车时间</span><b>约 ' + G.formatHours(s.drive) + '</b></div>' +
      '<div class="ps-row"><span>建议天数</span><b>' + s.days + ' 天</b></div>' +
      '<div class="ps-hint">里程为直线估算后按 1.32 折算公路，仅供参考；实际以导航为准。</div>';

    list.innerHTML = s.pts.map(function (t, i) {
      var next = s.legs[i];
      var sub = esc(t.dynasty) + ' · ' + esc(t.place);
      if (next) sub += ' · <span class="leg">距下一站 ' + G.formatKm(next.km) + '</span>';
      return '<div class="plan-item" data-id="' + t.id + '" data-index="' + i + '">' +
        '<div class="plan-order">' + (i + 1) + '</div>' +
        '<div class="plan-main">' +
          '<div class="plan-name">' + esc(t.name) + ' <span class="plan-dyn" style="color:' + t.color + '">' + esc(t.dynasty) + '</span>' +
          (state.visited[t.id] ? '<span class="pill visited-mark">已打卡</span>' : '') + '</div>' +
          '<div class="plan-sub">' + sub + '</div>' +
        '</div>' +
        '<div class="plan-actions">' +
          '<button data-act="up" title="上移" aria-label="上移">↑</button>' +
          '<button data-act="down" title="下移" aria-label="下移">↓</button>' +
          '<button data-act="del" title="移出" aria-label="移出">×</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function updateHeader() {
    var total = TOMBS.length;
    $('#statTotal').textContent = total;
    $('#statEra').textContent = ERA_META.length;
    $('#statPlan').textContent = state.plan.length;
    $('#tabPlan .badge').textContent = state.plan.length ? state.plan.length : '';
    $('#tabPlan').classList.toggle('has-items', state.plan.length > 0);
  }

  /* ---------------- 预设路线 ---------------- */
  function renderPresets() {
    var box = $('#presetList');
    var sel = $('#presetSelect');
    if (sel) {
      sel.innerHTML = '<option value="">载入路线模板…</option>' + ROUTES.map(function (r) {
        return '<option value="' + esc(r.id) + '">' + esc(r.name) + '（' + (r.days || '?') + ' 天）</option>';
      }).join('');
    }
    if (!ROUTES.length) { box.innerHTML = '<div class="empty small">暂无预设路线</div>'; return; }
    box.innerHTML = ROUTES.map(function (r) {
      return '<button class="preset-card" data-route="' + esc(r.id) + '">' +
        '<span class="preset-top"><b>' + esc(r.name) + '</b><em>' + (r.days || '?') + ' 天</em></span>' +
        '<span class="preset-sub">' + esc(r.subtitle || '') + '</span>' +
        '<span class="preset-meta">' + (r.tombIds || []).length + ' 站</span>' +
      '</button>';
    }).join('');
  }
  function applyPreset(id) {
    var r = null;
    for (var i = 0; i < ROUTES.length; i++) if (ROUTES[i].id === id) r = ROUTES[i];
    if (!r) return;
    var ids = (r.tombIds || []).filter(function (x) { return byId[x]; });
    if (!ids.length) { toast('预设数据缺失'); return; }
    if (state.plan.length && !window.confirm('用「' + r.name + '」替换当前行程？')) return;
    state.plan = ids.slice();
    savePlan();
    switchTab('plan');
    var pts = planTombs();
    if (pts.length) map.fitPoints(pts, 90);
    toast('已载入路线：' + r.name + '（' + ids.length + ' 站）');
  }

  /* ---------------- 弹窗 ---------------- */
  function closePopup() {
    state.popupId = null;
    $('#popup').classList.remove('show');
    map.setSelected(null);
    state.selectedId = null;
    renderList();
  }
  function openPopup(t) {
    if (!t) return;
    state.popupId = t.id;
    var idx = state.plan.indexOf(t.id);
    var pop = $('#popup');
    var isPlan = idx >= 0;
    var visit = state.visited[t.id] ? '已打卡' : '打卡';
    var tagHtml = (t.tags || []).map(function (g) { return '<span class="pill tag">' + esc(g) + '</span>'; }).join('');
    var coordNote = t.precision === 'low'
      ? '<div class="popup-warn">位置待考：图中为大致陵区范围，出行前请再核对。</div>'
      : (t.precision === 'mid' ? '<div class="popup-warn soft">坐标为近似位置，已尽量校正。</div>' : '');
    pop.innerHTML =
      '<button class="popup-close" data-act="close" aria-label="关闭">×</button>' +
      '<div class="popup-head"><span class="popup-era" style="background:' + t.color + '">' + esc(t.era) + '</span>' +
        '<span class="popup-dyn">' + esc(t.dynasty) + ' · ' + esc(t.kind) + '</span></div>' +
      '<h2 class="popup-name">' + esc(t.name) + '</h2>' +
      '<div class="popup-owner">' + esc(t.owner || '') + '<span class="popup-year">' + esc(t.yearText) + '</span></div>' +
      '<div class="popup-place">' + esc(t.province) + ' · ' + esc(t.place) + ' ' + statusPill(t) + tagHtml + '</div>' +
      (t.summary ? '<p class="popup-summary">' + esc(t.summary) + '</p>' : '') +
      (t.tip ? '<p class="popup-tip"><b>到访</b>' + esc(t.tip) + '</p>' : '') +
      (t.note ? '<p class="popup-note">' + esc(t.note) + '</p>' : '') +
      coordNote +
      '<div class="popup-coord">WGS-84 ' + t.lat.toFixed(4) + ', ' + t.lng.toFixed(4) +
        ' <button class="link-btn" data-act="copy-coord">复制</button></div>' +
      '<div class="popup-actions">' +
        '<button class="btn primary" data-act="' + (isPlan ? 'remove' : 'add') + '">' + (isPlan ? '移出行程（第 ' + (idx + 1) + ' 站）' : '＋ 加入行程') + '</button>' +
        '<button class="btn ghost" data-act="visit">' + (state.visited[t.id] ? '✓ 已打卡' : '打卡') + '</button>' +
        '<a class="btn ghost" href="' + amapSearchUrl(t) + '" target="_blank" rel="noopener">高德搜索</a>' +
      '</div>';
    pop.classList.add('show');
    positionPopup(true);
    map.setSelected(t.id);
    state.selectedId = t.id;
    renderList();
  }
  function positionPopup(force) {
    var pop = $('#popup');
    if (!state.popupId || !pop.classList.contains('show')) return;
    if (window.innerWidth <= 880) { pop.classList.add('mobile'); return; }
    pop.classList.remove('mobile');
    var t = byId[state.popupId];
    if (!t) return;
    var p = map.screenOf(t.lng, t.lat);
    var W = $('#map').clientWidth, H = $('#map').clientHeight;
    var pw = pop.offsetWidth || 320, ph = pop.offsetHeight || 260;
    var left = clamp(p.x - pw / 2, 10, W - pw - 10);
    var top = p.y - ph - 26;
    if (top < 10) top = p.y + 24;
    top = clamp(top, 10, H - ph - 10);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }

  function amapLL(t) {
    var g = G.wgs84ToGcj02(t.lng, t.lat);
    return g[0].toFixed(6) + ',' + g[1].toFixed(6);
  }
  function amapSearchUrl(t) {
    return 'https://uri.amap.com/search?keyword=' + encodeURIComponent(t.name + ' ' + (t.place || '')) + '&src=lings&coordinate=gaode';
  }

  /* ---------------- 导出 ---------------- */
  function itineraryText() {
    var s = planStats();
    var lines = [];
    lines.push('中国帝陵 · 行程计划');
    lines.push('共 ' + s.pts.length + ' 站 · 直线 ' + G.formatKm(s.straight) + ' · 估算公路 ' + G.formatKm(s.road) + ' · 约 ' + s.days + ' 天');
    lines.push('');
    s.pts.forEach(function (t, i) {
      lines.push((i + 1) + '. ' + t.dynasty + t.name + '（' + (t.owner || '') + '）');
      lines.push('   ' + t.province + t.place + ' · ' + t.status + ' · ' + t.yearText);
      lines.push('   坐标 ' + t.lat.toFixed(5) + ',' + t.lng.toFixed(5) + '　高德 ' + amapMarkerUrl(t));
      if (s.legs[i]) lines.push('   ↓ 直线 ' + G.formatKm(s.legs[i].km));
    });
    return lines.join('\n');
  }
  function amapMarkerUrl(t) {
    return 'https://uri.amap.com/marker?position=' + amapLL(t) + '&name=' + encodeURIComponent(t.name) + '&src=lings&coordinate=gaode';
  }
  function amapRouteUrl() {
    var pts = planTombs();
    if (pts.length < 2) return '';
    var from = pts[0], to = pts[pts.length - 1];
    var vias = pts.slice(1, pts.length - 1);
    var truncated = false;
    if (vias.length > 15) { vias = vias.slice(0, 15); truncated = true; }
    var parts = [
      'from%5Bname%5D=' + encodeURIComponent(from.name),
      'from%5Blnglat%5D=' + encodeURIComponent(amapLL(from)),
      'to%5Bname%5D=' + encodeURIComponent(to.name),
      'to%5Blnglat%5D=' + encodeURIComponent(amapLL(to))
    ];
    vias.forEach(function (v, i) {
      parts.push('via%5B' + i + '%5D%5Bname%5D=' + encodeURIComponent(v.name));
      parts.push('via%5B' + i + '%5D%5Blnglat%5D=' + encodeURIComponent(amapLL(v)));
    });
    return { url: 'https://ditu.amap.com/dir?type=car&' + parts.join('&'), truncated: truncated };
  }
  function geoJSON() {
    var s = planStats();
    var features = s.pts.map(function (t, i) {
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [+t.lng.toFixed(6), +t.lat.toFixed(6)] },
        properties: { order: i + 1, id: t.id, name: t.name, dynasty: t.dynasty, owner: t.owner, year: t.year, status: t.status, kind: t.kind, place: t.place }
      };
    });
    if (s.pts.length > 1) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: s.pts.map(function (t) { return [+t.lng.toFixed(6), +t.lat.toFixed(6)]; }) },
        properties: { name: '行程路线（直线示意）', straightKm: +s.straight.toFixed(1) }
      });
    }
    return JSON.stringify({ type: 'FeatureCollection', name: '中国帝陵行程', features: features }, null, 2);
  }
  function gpx() {
    var s = planStats();
    var x = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="LingsMap" xmlns="http://www.topografix.com/GPX/1/1">\n';
    x += '  <metadata><name>中国帝陵行程</name><desc>' + s.pts.length + ' 站，直线 ' + s.straight.toFixed(1) + ' km</desc></metadata>\n';
    s.pts.forEach(function (t) {
      x += '  <wpt lat="' + t.lat.toFixed(6) + '" lon="' + t.lng.toFixed(6) + '"><name>' + escXml(t.name) + '</name><desc>' + escXml(t.dynasty + ' · ' + (t.owner || '') + ' · ' + t.place) + '</desc></wpt>\n';
    });
    if (s.pts.length > 1) {
      x += '  <rte><name>行程路线</name>\n';
      s.pts.forEach(function (t) {
        x += '    <rtept lat="' + t.lat.toFixed(6) + '" lon="' + t.lng.toFixed(6) + '"><name>' + escXml(t.name) + '</name></rtept>\n';
      });
      x += '  </rte>\n';
    }
    return x + '</gpx>\n';
  }
  function escXml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]; }); }
  function planCSV() {
    var lines = ['序号,名称,朝代,墓主,年代,省,市,县,纬度,经度,坐标精度,开放状态'];
    planTombs().forEach(function (t, i) {
      lines.push([i + 1, t.name, t.dynasty, t.owner, t.yearText, t.province, t.city, t.county, t.lat, t.lng, t.precision, t.status].map(function (v) {
        var s = String(v == null ? '' : v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(','));
    });
    return '\ufeff' + lines.join('\n');
  }
  function download(name, text, mime) {
    var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('已复制到剪贴板'); }, function () { fallbackCopy(text); });
    } else fallbackCopy(text);
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('已复制到剪贴板'); } catch (e) { toast('复制失败，请手动选择文本'); }
    ta.remove();
  }

  /* ---------------- 提示 / 图例 / 比例尺 ---------------- */
  var toastTimer = 0;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  function buildLegend() {
    var box = $('#legendBody');
    var html = '<div class="legend-sec"><div class="legend-title">时代</div><div class="legend-eras">';
    ERA_META.forEach(function (e) {
      var n = TOMBS.filter(function (t) { return t.era === e.era; }).length;
      html += '<span class="legend-item"><i class="dot" style="background:' + e.color + '"></i>' + esc(e.era) + ' <em>' + n + '</em></span>';
    });
    html += '</div></div><div class="legend-sec"><div class="legend-title">符号</div>' +
      '<div class="legend-item"><i class="sym solid"></i>帝陵 / 王陵</div>' +
      '<div class="legend-item"><i class="sym dashed"></i>位置待考 / 陵区（虚线）</div>' +
      '<div class="legend-item"><i class="sym cluster"></i>聚类（点数字放大）</div>' +
      '<div class="legend-item"><i class="sym route"></i>行程连线</div>' +
      '<div class="legend-item"><i class="sym badge">3</i>行程顺序</div>' +
      '<div class="legend-item"><i class="sym visited"></i>已打卡</div>' +
      '</div>';
    box.innerHTML = html;
  }

  function updateScale() {
    if (!map) return;
    var v = map.getView();
    var mpp = G.metersPerPixel(v.lat, v.zoom);
    var target = 86 * mpp;
    var pow = Math.pow(10, Math.floor(Math.log(target) / Math.LN10));
    var n = target / pow;
    var nice = (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * pow;
    var px = nice / mpp;
    var label = nice >= 1000 ? (nice / 1000) + ' km' : Math.round(nice) + ' m';
    $('#scalebar').innerHTML = '<span class="sb-line" style="width:' + px.toFixed(1) + 'px"></span><span class="sb-label">' + label + '</span>';
  }

  function updateAttribution() {
    var def = map.getLayerDef();
    var html = def.attr || '无底图模式';
    html += def.crs === 'gcj'
      ? ' · 帝陵图志（坐标已做 GCJ-02 偏移校正）'
      : ' · 帝陵图志（WGS-84 坐标）';
    html += ' · 版本 ' + BUILD;
    $('#attribution').innerHTML = html;
  }

  /* ---------------- 选中 / 飞行 ---------------- */
  function selectTomb(t, fly) {
    if (!t) return;
    state.selectedId = t.id;
    if (fly) map.flyTo(t.lng, t.lat, Math.max(11, Math.round(map.getView().zoom)), 620);
    openPopup(t);
    var item = $('.tomb-item[data-id="' + t.id + '"]');
    if (item) item.classList.add('active');
    renderList();
  }

  /* ---------------- 标签页 ---------------- */
  function switchTab(tab) {
    state.tab = tab;
    $all('.sb-tab').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-tab') === tab); });
    $('#panelTombs').classList.toggle('active', tab === 'tombs');
    $('#panelPlan').classList.toggle('active', tab === 'plan');
    if (window.innerWidth <= 880) document.body.classList.add('sidebar-open');
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    // 恢复本地状态
    var savedPlan = storeGet(KEY.plan, []);
    if (Array.isArray(savedPlan)) state.plan = savedPlan.filter(function (id) { return byId[id]; });
    var savedVisited = storeGet(KEY.visited, {});
    if (savedVisited && typeof savedVisited === 'object') state.visited = savedVisited;
    var savedLayer = storeGet(KEY.layer, 'hybrid');
    if (window.LingsMap && window.LingsMap.LAYERS[savedLayer]) state.layer = savedLayer;

    map = new window.LingsMap($('#map'), {
      layer: state.layer,
      onSelect: function (t) { selectTomb(t, false); },
      onMapClick: function () { closePopup(); },
      onMove: function () { positionPopup(); updateScale(); },
      onLayerChange: function () { updateAttribution(); },
      onTileError: function () {
        toast('底图瓦片加载失败：请检查网络，或切换到「无底图」模式');
        var warn = $('#tileWarn');
        if (warn) warn.hidden = false;
      }
    });
    window.__LINGS_MAP__ = map;  // 调试/自动化测试钩子
    map.setTombs(TOMBS);
    map.setVisited(function (id) { return !!state.visited[id]; });
    map.setPlan(state.plan);
    map.setSelected(state.selectedId);
    applyFilter();

    renderEraChips();
    renderTagChips();
    renderList();
    renderPlan();
    renderPresets();
    buildLegend();
    updateHeader();
    updateAttribution();
    updateScale();
    buildAbout();
    buildLayerSelect();
    bind();
    if (state.plan.length > 1) {
      var pts = planTombs();
      if (pts.length) map.fitPoints(pts, 90);
    }
    if (!sessionStorage.getItem('lings-hint')) {
      setTimeout(function () { toast('滚轮缩放 · 拖拽平移 · 点击帝陵查看详情并加入行程'); sessionStorage.setItem('lings-hint', '1'); }, 900);
    }
  }

  function buildLayerSelect() {
    var sel = $('#layerSelect');
    sel.innerHTML = Object.keys(window.LingsMap.LAYERS).map(function (k) {
      return '<option value="' + k + '">' + esc(window.LingsMap.LAYERS[k].label) + '</option>';
    }).join('');
    sel.value = state.layer;
  }

  function buildAbout() {
    var matched = (window.TOMBS_META && window.TOMBS_META.osmMatched) || 0;
    var baiduCount = (window.TOMBS_META && window.TOMBS_META.baiduRefined) || 0;
    var total = TOMBS.length;
    var html =
      '<p>这是一张中国历代帝王陵墓的地图索引，收录 <b>' + total + '</b> 处帝陵、王陵与陵区，从秦始皇陵到清西陵，含追尊陵、衣冠冢与尚待确认的陵区。点击点位可看简介与到访提示，并把它们编成自己的行程。</p>' +
      '<h3>怎么用</h3><ul>' +
      '<li>拖动/滚轮缩放地图；点击点位看详情；点「＋ 加入行程」。</li>' +
      '<li>「行程」页可排序、优化顺路顺序、复制文本、导出 GPX/GeoJSON/CSV，或一键在高德地图中打开驾车路线。</li>' +
      '<li>「打卡」记录去过的陵，行程与打卡都存在本机浏览器里。</li></ul>' +
      '<h3>数据与坐标</h3><ul>' +
      '<li>共 ' + total + ' 条，其中 <b>' + matched + '</b> 条用 OpenStreetMap 公开数据校正、<b>' + baiduCount + '</b> 条用百度地图 POI 补全，其余为手工标注（精度分「精确 / 近似 / 待考」）。</li>' +
      '<li>坐标基准 WGS-84；高德底图为 GCJ-02，页面已自动做偏移转换，因此点位与底图对齐。</li>' +
      '<li>底图默认「混合」：低倍用高德矢量路网，放大到 15 级以上自动换成卫星影像+标注——高德矢量瓦片在草原、荒漠、山地等无细节区域会返回空白瓦片，混用卫星可避免放大后白屏。也可手动切换为纯矢量 / 纯卫星 / OpenStreetMap；「无底图」只画经纬网，断网也能查看点位。</li></ul>' +
      '<h3>关于「所有帝陵」</h3><p>本图覆盖中国历史上主要王朝与割据政权的帝王陵墓。以下情况未单独立点，避免误导：元代诸帝的真陵（起辇谷）至今未发现；十六国、部分东汉/西晋/东晋帝陵位置尚未确认，图中以「陵区」示意；南明、北元等流亡政权的葬地多不可考。</p>' +
      '<h3>免责</h3><p>陵墓开放状态与参观政策会变化，出行前请以景区/文物部门最新公告为准；里程与天数为直线估算，导航以高德地图为准。数据整理：帝陵图志 · ' + (window.TOMBS_META && window.TOMBS_META.builtAt ? window.TOMBS_META.builtAt.slice(0, 10) : '') + '</p>' +
      '<p class="about-ver">页面版本 ' + BUILD + '</p>';
    $('#aboutBody').innerHTML = html;
  }

  function bind() {
    // 头部
    $('#btnMenu').addEventListener('click', function () {
      if (window.innerWidth <= 880) document.body.classList.toggle('sidebar-open');
      else document.querySelector('#app').classList.toggle('sidebar-collapsed');
    });
    $('#filterReset').addEventListener('click', resetFilters);
    $('#btnAbout').addEventListener('click', function () { $('#aboutModal').classList.add('show'); });
    $('#aboutClose').addEventListener('click', function () { $('#aboutModal').classList.remove('show'); });
    $('#aboutModal').addEventListener('click', function (e) { if (e.target === this) this.classList.remove('show'); });
    $('#layerSelect').addEventListener('change', function () {
      state.layer = this.value;
      storeSet(KEY.layer, state.layer);
      map.setLayer(state.layer);
      var warnEl = $('#tileWarn');
      if (warnEl) warnEl.hidden = true;
      updateAttribution();
    });
    // 标签页
    $all('.sb-tab').forEach(function (b) {
      b.addEventListener('click', function () { switchTab(this.getAttribute('data-tab')); });
    });
    // 搜索
    $('#searchInput').addEventListener('input', function () {
      var v = this.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { state.query = v; applyFilter(); }, 120);
    });
    $('#searchClear').addEventListener('click', function () {
      clearTimeout(searchTimer);
      $('#searchInput').value = ''; state.query = ''; applyFilter(); $('#searchInput').focus();
    });
    // 时代 chips
    $('#eraChips').addEventListener('click', function (e) {
      var b = e.target.closest('[data-era]');
      if (!b) return;
      var era = b.getAttribute('data-era');
      if (era === '__all') state.era = {};
      else state.era[era] = !state.era[era];
      renderEraChips(); applyFilter();
    });
    // 标签 chips
    $('#tagChips').addEventListener('click', function (e) {
      var b = e.target.closest('[data-tag]');
      if (!b) return;
      var tag = b.getAttribute('data-tag');
      state.tags[tag] = !state.tags[tag];
      renderTagChips(); applyFilter();
    });
    // 状态
    $('#statusSelect').addEventListener('change', function () { state.status = this.value; applyFilter(); });
    $('#btnHideVisited').addEventListener('click', function () {
      state.hideVisited = !state.hideVisited;
      this.classList.toggle('active', state.hideVisited);
      applyFilter();
    });
    // 列表
    $('#tombList').addEventListener('click', function (e) {
      var add = e.target.closest('[data-add]');
      if (add) { e.stopPropagation(); addToPlan(add.getAttribute('data-add')); return; }
      var item = e.target.closest('.tomb-item');
      if (item) selectTomb(byId[item.getAttribute('data-id')], true);
    });
    // 行程
    $('#planList').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      var item = e.target.closest('.plan-item');
      if (!item) return;
      var idx = parseInt(item.getAttribute('data-index'), 10);
      if (btn) {
        var act = btn.getAttribute('data-act');
        if (act === 'up') movePlan(idx, -1);
        else if (act === 'down') movePlan(idx, 1);
        else if (act === 'del') removeFromPlan(item.getAttribute('data-id'));
        return;
      }
      selectTomb(byId[item.getAttribute('data-id')], true);
    });
    $('#btnOptimize').addEventListener('click', optimizePlan);
    $('#btnClear').addEventListener('click', function () { if (state.plan.length && window.confirm('清空当前行程？')) clearPlan(); });
    $('#presetList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-route]');
      if (b) applyPreset(b.getAttribute('data-route'));
    });
    $('#presetSelect').addEventListener('change', function () {
      var v = this.value;
      this.value = '';
      if (v) applyPreset(v);
    });
    // 导出
    $('#btnCopy').addEventListener('click', function () { copyText(itineraryText()); });
    $('#btnAmapRoute').addEventListener('click', function () {
      var r = amapRouteUrl();
      if (!r) { toast('至少需要 2 站'); return; }
      if (r.truncated) toast('高德单次最多 16 个途经点，已截取前段；完整行程请用「复制行程」');
      window.open(r.url, '_blank', 'noopener');
    });
    $('#btnGpx').addEventListener('click', function () { download('lings-itinerary.gpx', gpx(), 'application/gpx+xml'); toast('已导出 GPX'); });
    $('#btnGeoJson').addEventListener('click', function () { download('lings-itinerary.geojson', geoJSON(), 'application/geo+json'); toast('已导出 GeoJSON'); });
    $('#btnCsv').addEventListener('click', function () { download('lings-itinerary.csv', planCSV(), 'text/csv'); toast('已导出 CSV'); });
    // 弹窗
    $('#popup').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var act = b.getAttribute('data-act');
      var t = state.popupId ? byId[state.popupId] : null;
      if (!t) return;
      if (act === 'close') closePopup();
      else if (act === 'add') addToPlan(t.id);
      else if (act === 'remove') removeFromPlan(t.id);
      else if (act === 'visit') { toggleVisited(t.id); openPopup(t); }
      else if (act === 'copy-coord') copyText(t.lat.toFixed(6) + ',' + t.lng.toFixed(6));
    });
    $('#tileWarnClose').addEventListener('click', function () { $('#tileWarn').hidden = true; });
    // 地图控件
    $('#zoomIn').addEventListener('click', function () { map.zoomBy(1); });
    $('#zoomOut').addEventListener('click', function () { map.zoomBy(-1); });
    $('#btnReset').addEventListener('click', function () { map.reset(); });
    // 键盘
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closePopup(); $('#aboutModal').classList.remove('show'); }
    });
    // 视口变化时重排弹窗
    window.addEventListener('resize', function () { positionPopup(); updateScale(); });
  }

  function toggleVisited(id) {
    if (state.visited[id]) delete state.visited[id];
    else state.visited[id] = true;
    storeSet(KEY.visited, state.visited);
    map.setVisited(function (x) { return !!state.visited[x]; });
    renderList();
    toast(state.visited[id] ? '已打卡：' + byId[id].name : '已取消打卡');
  }

  function applyFilter() {
    if (map) map.setFilter(tombPasses);
    renderList();
    var active = Object.keys(state.era).some(function (k) { return state.era[k]; }) ||
      Object.keys(state.tags).some(function (k) { return state.tags[k]; }) ||
      state.status !== '全部' || state.query || state.hideVisited;
    $('#filterReset').classList.toggle('show', !!active);
  }

  function resetFilters() {
    clearTimeout(searchTimer);
    state.era = {}; state.tags = {}; state.status = '全部'; state.query = ''; state.hideVisited = false;
    $('#searchInput').value = '';
    $('#statusSelect').value = '全部';
    $('#btnHideVisited').classList.remove('active');
    renderEraChips(); renderTagChips(); applyFilter();
  }

  // 暴露少量接口便于调试
  window.LingsApp = { state: state, map: function () { return map; }, addToPlan: addToPlan, select: selectTomb, toast: toast };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();


