/**
 * 地图引擎回归测试（零依赖，直接 node 运行）：
 *   node imperial-tombs/tests/map.zoom.test.mjs
 *
 * 用最小 DOM 桩在 vm 里跑真实的 js/geo.js + js/map.js，重点守住缩放手势的
 * 屏幕坐标语义——_zoomAt 的前两个参数是「屏幕像素」，不是经纬度/缩放级。
 * 2026-11 的线上 bug：滚轮/按钮/双击把参数顺序传反，导致任何缩放都直接跳到
 * z18 并把视野抛到境外（瓦片空白）。
 */
import fs from 'node:fs';
import vm from 'node:vm';

const HERE = new URL('.', import.meta.url);
const JS = new URL('../js/', import.meta.url);
const DATA = new URL('../data/tombs.json', import.meta.url);
const MAP_W = 1077, MAP_H = 999, MAP_LEFT = 477, MAP_TOP = 73; // 模拟侧栏/顶栏偏移，验证屏幕坐标换算

let canvasOps = 0;

class ClassList {
  constructor() { this.s = new Set(); }
  add(...c) { c.forEach(x => this.s.add(x)); }
  remove(...c) { c.forEach(x => this.s.delete(x)); }
  toggle(c, f) { const on = f === undefined ? !this.s.has(c) : !!f; on ? this.s.add(c) : this.s.delete(c); return on; }
  contains(c) { return this.s.has(c); }
}
function ctxStub() {
  const noop = () => { canvasOps++; };
  return new Proxy({}, { get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => { t[k] = v; return true; } });
}
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.children = []; this.parentNode = null;
    this.style = {}; this.classList = new ClassList(); this.handlers = {}; this.attrs = {};
    this.className = ''; this.hidden = false; this.width = 0; this.height = 0;
    this.clientWidth = 0; this.clientHeight = 0;
    this.rect = { left: 0, top: 0, width: 0, height: 0 };
    if (this.tagName === 'CANVAS') this._ctx = ctxStub();
  }
  getContext() { return this._ctx; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; }
  get firstChild() { return this.children[0] || null; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(t, fn) { (this.handlers[t] = this.handlers[t] || []).push(fn); }
  removeEventListener() { }
  dispatch(t, ev) { (this.handlers[t] || []).slice().forEach(fn => fn(ev)); }
  setPointerCapture() { }
  getBoundingClientRect() { return { ...this.rect, right: this.rect.left + this.rect.width, bottom: this.rect.top + this.rect.height }; }
  querySelector() { return null; }
}

const sandbox = {
  console, devicePixelRatio: 2,
  document: { createElement: (t) => new El(t), addEventListener() { } },
  ResizeObserver: class { observe() { } disconnect() { } },
  requestAnimationFrame(cb) { sandbox.__raf.push(cb); return 1; },
  cancelAnimationFrame() { },
  performance: { now: () => sandbox.__clock },
  setTimeout, clearTimeout, Math, Date, JSON, Object, Array, String, Number, Boolean, isNaN, isFinite,
  __raf: [], __clock: 1000
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['geo.js', 'map.js']) {
  vm.runInContext(fs.readFileSync(new URL(f, JS), 'utf8'), sandbox, { filename: f });
}
function flush() {
  let n = 0;
  while (sandbox.__raf.length && n++ < 5000) {
    const q = sandbox.__raf; sandbox.__raf = [];
    q.forEach(cb => { sandbox.__clock += 20; cb(sandbox.__clock); });
  }
}

const G = sandbox.LingsGeo;
const mapEl = new El('div');
mapEl.clientWidth = MAP_W; mapEl.clientHeight = MAP_H;
mapEl.rect = { left: MAP_LEFT, top: MAP_TOP, width: MAP_W, height: MAP_H };
const map = new sandbox.LingsMap(mapEl, { layer: 'amap' });
flush();
const tileEl = mapEl.children.find(c => /lm-tiles/.test(c.className));

function geoToScreen(lng, lat) {
  const v = map.getView();
  const p = G.project(lng, lat, v.zoom), c = G.project(v.lng, v.lat, v.zoom);
  return { x: p.x - c.x + MAP_W / 2, y: p.y - c.y + MAP_H / 2 };
}
function screenToGeo(x, y) {
  const v = map.getView();
  const c = G.project(v.lng, v.lat, v.zoom);
  return G.unproject(c.x - MAP_W / 2 + x, c.y - MAP_H / 2 + y, v.zoom);
}
function parseTile(node) {
  const m = /translate3d\((-?[\d.]+)px,(-?[\d.]+)px,0\) scale\(([\d.]+)\)/.exec(node.style.transform || '');
  if (!m) return null;
  return { x: +m[1], y: +m[2], scale: +m[3], size: 256 * +m[3] };
}
function coverage() {
  const vis = tileEl.children.filter(c => c.style.display !== 'none').map(parseTile).filter(Boolean);
  const pts = [[0, 0], [MAP_W, 0], [0, MAP_H], [MAP_W, MAP_H], [MAP_W / 2, MAP_H / 2]];
  const missing = pts.filter(([x, y]) => !vis.some(t => x >= t.x - 0.5 && x <= t.x + t.size + 0.5 && y >= t.y - 0.5 && y <= t.y + t.size + 0.5));
  return { tiles: vis.length, missing: missing.length, maxAbs: Math.max(0, ...vis.map(t => Math.max(Math.abs(t.x), Math.abs(t.y)))) };
}
const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail }); }
function wheel(dy, x = MAP_W / 2, y = MAP_H / 2) {
  mapEl.dispatch('wheel', { deltaY: dy, deltaMode: 0, preventDefault() { }, clientX: MAP_LEFT + x, clientY: MAP_TOP + y });
  flush();
}

/* 1. 初始 */
{
  const v = map.getView(), c = coverage();
  check('初始视野为全国（z3–7）', v.zoom >= 3 && v.zoom <= 7, JSON.stringify(v));
  check('初始瓦片铺满视口', c.tiles > 0 && c.missing === 0, `tiles=${c.tiles} missing=${c.missing}`);
}

/* 2. 滚轮逐级缩放 + 鼠标锚点不动 + 视野不出中国 */
{
  const cur = { x: 760, y: 420 }, g0 = screenToGeo(cur.x, cur.y);
  const bad = [], off = [], out = [];
  for (let i = 0; i < 14; i++) {
    const z0 = map.getView().zoom;
    wheel(-100, cur.x, cur.y);
    const v = map.getView();
    if (Math.abs(v.zoom - z0 - 1) > 1e-6) bad.push(`${z0}->${v.zoom}`);
    if (v.lng < 70 || v.lng > 141 || v.lat < 12 || v.lat > 56) out.push(`z${v.zoom}:${v.lng.toFixed(1)},${v.lat.toFixed(1)}`);
    const p = geoToScreen(g0.lng, g0.lat);
    if (Math.abs(p.x - cur.x) > 2 || Math.abs(p.y - cur.y) > 2) off.push(`z${v.zoom}(${p.x.toFixed(1)},${p.y.toFixed(1)})`);
    if (coverage().missing) bad.push(`z${v.zoom} 瓦片缺口`);
  }
  check('滚轮每格恰好 +1 级', bad.length === 0, bad.slice(0, 4).join(' | '));
  check('滚轮缩放时鼠标下的地点保持不动', off.length === 0, off.slice(0, 3).join(' | '));
  check('连续放大不会把视野抛出中国', out.length === 0, out.slice(0, 3).join(' | '));
  const c = coverage();
  check('z18 瓦片仍铺满视口', c.tiles > 0 && c.missing === 0, `tiles=${c.tiles}`);
  check('z18 瓦片 transform 在合理像素范围', c.maxAbs < 5000, 'maxAbs=' + c.maxAbs.toFixed(0));
}

/* 3. 缩小 */
{
  const bad = [];
  for (let i = 0; i < 13; i++) {
    const z0 = map.getView().zoom;
    wheel(100);
    if (Math.abs(map.getView().zoom - z0 + 1) > 1e-6) bad.push(`${z0}->${map.getView().zoom}`);
  }
  check('滚轮缩小每格恰好 -1 级', bad.length === 0, bad.slice(0, 4).join(' | '));
  check('连续缩小回到 z5', Math.abs(map.getView().zoom - 5) < 1e-6, JSON.stringify(map.getView()));
}

/* 4. 触控板小步滚动会累积，不会一次跳多级 */
{
  const z0 = map.getView().zoom;
  wheel(-3); wheel(-3); wheel(-3);
  check('触控板小步滚动不立刻跳级', Math.abs(map.getView().zoom - z0) < 1e-6, `zoom=${map.getView().zoom}`);
  for (let i = 0; i < 5; i++) wheel(-3);
  check('触控板累积后缩放一级', Math.abs(map.getView().zoom - z0 - 1) < 1e-6, `${z0}->${map.getView().zoom}`);
}

/* 5. 按钮 / 双击 */
{
  const z0 = map.getView().zoom;
  map.zoomBy(1); flush();
  check('＋按钮 +1 级', Math.abs(map.getView().zoom - z0 - 1) < 1e-6, `${z0}->${map.getView().zoom}`);
  map.zoomBy(-1); flush();
  check('－按钮 -1 级', Math.abs(map.getView().zoom - z0) < 1e-6, `->${map.getView().zoom}`);
  mapEl.dispatch('dblclick', { clientX: MAP_LEFT + 700, clientY: MAP_TOP + 400 });
  flush();
  check('双击 +1 级', Math.abs(map.getView().zoom - z0 - 1) < 1e-6, `->${map.getView().zoom}`);
}

/* 6. flyTo 精度 + 点位命中 */
{
  const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const tombs = data.tombs || data;
  map.setTombs(tombs);
  const qin = tombs.find(t => t.id === 'qin-shihuang');
  map.flyTo(qin.lng, qin.lat, 16, 300); flush();
  const q = map.hits.find(h => h.type === 'tomb' && h.id === 'qin-shihuang');
  check('flyTo z16 后秦始皇陵点位在屏幕中心 3px 内', !!q && Math.hypot(q.x - MAP_W / 2, q.y - MAP_H / 2) < 3, q ? `(${q.x.toFixed(1)},${q.y.toFixed(1)})` : '未命中');
  check('flyTo 后 canvas 有绘制', canvasOps > 0, 'ops=' + canvasOps);
  const c = coverage();
  check('flyTo 后瓦片铺满', c.tiles > 0 && c.missing === 0, `tiles=${c.tiles}`);
}

/* 7. 切底图 / 拖拽 */
{
  map.setLayer('osm'); flush();
  const v = map.getView();
  const p = G.project(v.lng, v.lat, v.zoom);
  check('切到 OSM 后视野数值有效', Number.isFinite(p.x) && Number.isFinite(p.y), JSON.stringify(v));
  map.setLayer('amap'); flush();
  map.flyTo(109.253828, 34.381381, 17, 0); flush();
  mapEl.dispatch('pointerdown', { button: 0, pointerType: 'mouse', pointerId: 1, clientX: MAP_LEFT + 500, clientY: MAP_TOP + 500 });
  let bad = 0;
  for (let i = 1; i <= 10; i++) {
    mapEl.dispatch('pointermove', { pointerId: 1, clientX: MAP_LEFT + 500 + i * 20, clientY: MAP_TOP + 500 + i * 8 });
    flush();
    if (coverage().missing) bad++;
  }
  mapEl.dispatch('pointerup', { pointerId: 1, clientX: MAP_LEFT + 700, clientY: MAP_TOP + 580 });
  check('拖拽过程中瓦片始终铺满', bad === 0, `badFrames=${bad}`);
}

/* 8. 混合底图：按缩放级自动切换矢量 / 卫星 */
{
  const el2 = new El('div');
  el2.clientWidth = MAP_W; el2.clientHeight = MAP_H;
  el2.rect = { left: MAP_LEFT, top: MAP_TOP, width: MAP_W, height: MAP_H };
  const m2 = new sandbox.LingsMap(el2, { layer: 'hybrid' });
  flush();
  const u14 = m2._urlsFor(14), u15 = m2._urlsFor(15);
  check('混合底图 z14 使用矢量瓦片', u14.length === 1 && /webrd/.test(u14[0](14, 1, 1)), u14[0](14, 1, 1).slice(0, 48));
  check('混合底图 z15 使用卫星+标注瓦片', u15.length === 2 && /webst0\d/.test(u15[0](15, 1, 1)) && /style=6/.test(u15[0](15, 1, 1)) && /style=8/.test(u15[1](15, 1, 1)), u15.length + ' urls');
  const t2 = el2.children.find(c => /lm-tiles/.test(c.className));
  m2.flyTo(109.253828, 34.381381, 17, 0); flush();
  const vis = [...t2.children].filter(c => c.style.display !== 'none');
  const imgs = vis.flatMap(c => [...c.children]);
  check('混合底图 z17 每片瓦片都有卫星图 + 标注图', vis.length > 0 && vis.every(c => c.children.length === 2) && imgs.some(i => /webst0\d/.test(i.src) && /style=6/.test(i.src)) && imgs.some(i => /webst0\d/.test(i.src) && /style=8/.test(i.src)), `tiles=${vis.length} imgs=${imgs.length}`);
}

/* 报告 */
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.name + (r.detail ? '   [' + r.detail + ']' : ''));
}
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
