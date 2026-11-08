// 生成最终数据：master + OSM 校正坐标 + intros → js/data.tombs.js / data/tombs.json / data/tombs.csv
// 用法：node imperial-tombs/scripts/build-data.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); } catch (e) { if (fallback !== undefined) return fallback; throw e; } };

const master = read('data/tombs.master.json');
const matches = read('data/osm-matches.json', {});
const intros = read('data/intros.json', {});
const baiduRefined = read('data/baidu-refined.json', {});

const ERA_META = [
  { era: '秦', color: '#7a4e2d' },
  { era: '汉', color: '#a6322e' },
  { era: '魏晋南北朝', color: '#4f6d7a' },
  { era: '隋唐', color: '#c08a2e' },
  { era: '五代十国', color: '#8c6a4a' },
  { era: '宋', color: '#2f7d6d' },
  { era: '辽金西夏', color: '#6c5b7b' },
  { era: '元', color: '#5c7a3d' },
  { era: '明', color: '#b5651d' },
  { era: '清', color: '#2e5e8c' },
  { era: '边疆', color: '#8e6c88' }
];
const ERA_INDEX = {};
ERA_META.forEach((e, i) => { ERA_INDEX[e.era] = i; });

const VALID_ERA = new Set(Object.keys(ERA_INDEX));
const VALID_KIND = new Set(['帝陵', '追尊陵', '后陵', '王陵', '陵区', '纪念陵']);
const VALID_STATUS = new Set(['开放', '遗址', '未开放', '待考']);

function fmtYear(y) {
  if (y === null || y === undefined) return '—';
  const n = Number(y);
  return n < 0 ? '前' + Math.abs(n) + '年' : '公元' + n + '年';
}

const errors = [];
const seen = new Set();
const tombs = master.tombs.map((t) => {
  if (seen.has(t.id)) errors.push('重复 id: ' + t.id);
  seen.add(t.id);
  if (!VALID_ERA.has(t.era)) errors.push(`${t.id}: 非法 era ${t.era}`);
  if (!VALID_KIND.has(t.kind)) errors.push(`${t.id}: 非法 kind ${t.kind}`);
  if (!VALID_STATUS.has(t.status)) errors.push(`${t.id}: 非法 status ${t.status}`);
  if (!(t.lat > 3 && t.lat < 54 && t.lng > 73 && t.lng < 136)) errors.push(`${t.id}: 坐标越界 ${t.lat},${t.lng}`);

  const m = matches[t.id];
  const bd = baiduRefined[t.id];
  const lat = m ? m.lat : (bd ? bd.lat : t.lat);
  const lng = m ? m.lng : (bd ? bd.lng : t.lng);
  const precision = m ? 'high' : (bd ? 'mid' : (t.precision || 'mid'));
  const intro = intros[t.id] || {};
  const era = ERA_META[ERA_INDEX[t.era]];
  const place = (t.city || '') + (t.county || '');
  const aliases = [];
  if (t.dynasty && t.name.indexOf(t.dynasty) !== 0) aliases.push(t.dynasty + t.name);
  const owner = t.owner || '';
  if (owner) aliases.push(owner);

  return {
    id: t.id,
    name: t.name,
    dynasty: t.dynasty,
    era: t.era,
    owner,
    kind: t.kind,
    year: t.year,
    yearText: fmtYear(t.year),
    province: t.province,
    city: t.city,
    county: t.county,
    place,
    lat,
    lng,
    precision,
    coordSource: m ? 'OSM' : (bd ? '百度POI' : (t.coordSource || '估算')),
    coordNote: m && m.deltaKm > 8 ? `OSM 实测与初稿相差 ${m.deltaKm}km，已采用 OSM` : (bd && bd.deltaKm > 5 ? `百度 POI「${bd.poiName}」与初稿相差 ${bd.deltaKm}km，已采用该点位` : ''),
    status: t.status,
    tags: t.tags || [],
    note: t.note || '',
    summary: intro.summary || '',
    tip: intro.tip || '',
    color: era.color,
    eraOrder: ERA_INDEX[t.era],
    sortKey: ERA_INDEX[t.era] * 100000 + (t.year === null || t.year === undefined ? 9999 : Number(t.year) + 3000),
    aliases,
    searchText: [t.name, t.dynasty, t.owner, place, t.province, (t.tags || []).join(' '), (intro.summary || '').slice(0, 40), (t.note || '').slice(0, 40), aliases.join(' ')].filter(Boolean).join(' ')
  };
});

// 排序：时代 → 年代
tombs.sort((a, b) => a.sortKey - b.sortKey);

// 数据完整性统计
const introMissing = master.tombs.filter((t) => !intros[t.id] || !intros[t.id].summary).map((t) => t.id);
const matched = Object.keys(matches).length;
const baiduCount = tombs.filter((t) => t.coordSource === '百度POI').length;

const meta = {
  builtAt: new Date().toISOString(),
  total: tombs.length,
  eraCount: ERA_META.length,
  osmMatched: matched,
  baiduRefined: baiduCount,
  introMissing
};
if (introMissing.length) errors.push('缺少简介: ' + introMissing.join(','));

if (errors.length) {
  console.error('数据校验失败：');
  errors.forEach((e) => console.error('  - ' + e));
  process.exit(1);
}

// 1) 浏览器数据
const js = [
  '/* 自动生成，勿手改。源：data/tombs.master.json + data/osm-matches.json + data/intros.json */',
  'window.ERA_META = ' + JSON.stringify(ERA_META, null, 2) + ';',
  'window.TOMBS_META = ' + JSON.stringify(meta, null, 2) + ';',
  'window.TOMBS = ' + JSON.stringify(tombs, null, 2) + ';',
  ''
].join('\n');
fs.writeFileSync(path.join(ROOT, 'js/data.tombs.js'), js, 'utf8');

// 2) JSON 备份
fs.writeFileSync(path.join(ROOT, 'data/tombs.json'), JSON.stringify({ meta, tombs }, null, 2), 'utf8');

// 3) CSV
const cols = ['id', 'name', 'dynasty', 'era', 'owner', 'kind', 'year', 'province', 'city', 'county', 'lat', 'lng', 'precision', 'coordSource', 'status', 'tags'];
const esc = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const csv = [cols.join(',')].concat(tombs.map((t) => cols.map((c) => esc(c === 'tags' ? (t.tags || []).join('|') : t[c])).join(','))).join('\n');
fs.writeFileSync(path.join(ROOT, 'data/tombs.csv'), '\ufeff' + csv, 'utf8');

// 4) 预设路线（可选）
let routeCount = 0;
try {
  const presets = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/routes.presets.json'), 'utf8'));
  const routes = (presets.routes || []).map((r) => ({
    id: r.id,
    name: r.name,
    subtitle: r.subtitle || '',
    days: r.days || 1,
    note: r.note || '',
    tombIds: (r.tombIds || []).filter((id) => tombs.some((t) => t.id === id))
  })).filter((r) => r.tombIds.length >= 2);
  fs.writeFileSync(path.join(ROOT, 'js/data.routes.js'),
    '/* 自动生成，勿手改。源：data/routes.presets.json */\nwindow.ROUTE_PRESETS = ' + JSON.stringify({ routes }, null, 2) + ';\n', 'utf8');
  routeCount = routes.length;
} catch (e) {
  fs.writeFileSync(path.join(ROOT, 'js/data.routes.js'),
    '/* 自动生成：暂无预设路线 */\nwindow.ROUTE_PRESETS = { routes: [] };\n', 'utf8');
}

console.log(`OK 生成 ${tombs.length} 条帝陵`);
console.log(`   OSM 校正 ${matched} 条，百度 POI 补全 ${baiduCount} 条，缺简介 ${introMissing.length} 条，预设路线 ${routeCount} 条`);
console.log('   → js/data.tombs.js, data/tombs.json, data/tombs.csv, js/data.routes.js');
