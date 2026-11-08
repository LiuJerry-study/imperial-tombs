// 纯逻辑测试（不依赖 node:test，避免沙箱内 spawn EPERM）
// 运行：node imperial-tombs/tests/geo.test.mjs
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const G = require('../js/geo.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  ok   ' + name); pass++; }
  catch (e) { console.error('  FAIL ' + name + '\n        ' + e.message); fail++; }
}
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} vs ${b} (eps ${eps})`);

console.log('LingsGeo tests');

t('project / unproject roundtrip', () => {
  for (const z of [3, 5, 8, 12, 16]) {
    for (const [lng, lat] of [[116.3975, 39.9087], [109.2538, 34.3814], [91.68, 29.04], [121.5, 31.24]]) {
      const p = G.project(lng, lat, z);
      const back = G.unproject(p.x, p.y, z);
      near(back.lng, lng, 1e-9, 'lng');
      near(back.lat, lat, 1e-9, 'lat');
    }
  }
});

t('wgs84 -> gcj02 known offset (Tiananmen)', () => {
  const [lng, lat] = G.wgs84ToGcj02(116.3975, 39.9087);
  near(lng, 116.4039, 0.0025, 'gcj lng');
  near(lat, 39.9101, 0.003, 'gcj lat');
});

t('gcj02 -> wgs84 roundtrip within 0.5m', () => {
  for (const [lng, lat] of [[116.3975, 39.9087], [108.9423, 34.4433], [117.657, 40.187], [119.715, 30.234]]) {
    const [glng, glat] = G.wgs84ToGcj02(lng, lat);
    const [wlng, wlat] = G.gcj02ToWgs84(glng, glat);
    near(wlng, lng, 5e-6, 'wgs lng');
    near(wlat, lat, 5e-6, 'wgs lat');
  }
});

t('haversine: Beijing-Shanghai ~1067km', () => {
  const d = G.haversineKm({ lng: 116.4074, lat: 39.9042 }, { lng: 121.4737, lat: 31.2304 });
  near(d, 1067, 30, 'BJ-SH');
});

t('formatYear', () => {
  assert.equal(G.formatYear(-210), '前210年');
  assert.equal(G.formatYear(5), '公元5年');
  assert.equal(G.formatYear(null), '—');
});

t('metersPerPixel', () => {
  near(G.metersPerPixel(0, 0), 156543.03, 1);
  near(G.metersPerPixel(0, 10), 152.874, 0.5);
});

t('optimizeOrder improves a scrambled square', () => {
  const pts = [{ lng: 0, lat: 0 }, { lng: 1, lat: 1 }, { lng: 1, lat: 0 }, { lng: 0, lat: 1 }];
  const order = G.optimizeOrder(pts);
  assert.equal(order[0], 0, '起点保持');
  assert.equal(new Set(order).size, 4, '不重不漏');
  const len = (o) => { let s = 0; for (let i = 1; i < o.length; i++) s += G.haversineKm(pts[o[i - 1]], pts[o[i]]); return s; };
  assert.ok(len(order) < len([0, 1, 2, 3]) - 1e-6, '比原始顺序短');
});

t('routeLegs + estimates', () => {
  const pts = [{ lng: 108.954, lat: 34.266 }, { lng: 108.569, lat: 34.338 }, { lng: 108.214, lat: 34.576 }];
  const r = G.routeLegs(pts);
  assert.equal(r.legs.length, 2);
  assert.ok(r.totalKm > 20 && r.totalKm < 120);
  assert.ok(G.suggestDays(r.totalKm, 3) >= 1);
  assert.ok(G.estimateRoadKm(100) > 100);
});

t('formatKm / formatHours', () => {
  assert.equal(G.formatKm(0.3), '300 米');
  assert.equal(G.formatKm(55.4), '55 公里');
  assert.equal(G.formatHours(0.5), '30 分钟');
  assert.equal(G.formatHours(2.0), '2 小时');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

