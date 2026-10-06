// Builds an inline SVG locator map from Natural Earth data (world-atlas, public
// domain): focus countries in red, neighbours in slate, optional marker.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { geoMercator, geoPath, geoBounds, geoCentroid, geoArea } from 'd3-geo';
import { feature } from 'topojson-client';

const require = createRequire(import.meta.url);
let WORLD;
function world() {
  if (!WORLD) {
    const topo = JSON.parse(fs.readFileSync(require.resolve('world-atlas/countries-50m.json'), 'utf8'));
    WORLD = feature(topo, topo.objects.countries).features;
  }
  return WORLD;
}

const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
const ALIASES = { unitedstates: 'unitedstatesofamerica', usa: 'unitedstatesofamerica', us: 'unitedstatesofamerica',
  uk: 'unitedkingdom', britain: 'unitedkingdom', russia: 'russia', southkorea: 'southkorea', northkorea: 'northkorea',
  drc: 'demrepcongo', democraticrepublicofthecongo: 'demrepcongo', congo: 'demrepcongo', czechia: 'czechia' };
export function findCountry(name) {
  const n = ALIASES[norm(name)] || norm(name);
  return world().find(f => norm(f.properties.name) === n) || null;
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function mapSvg({ focus = [], marker = null, labels = {}, width = 420, height = 440 }) {
  const focusF = focus.map(findCountry).filter(Boolean);
  if (!focusF.length && !marker) return null;
  const fc = { type: 'FeatureCollection', features: focusF.length ? focusF : [] };
  let [[x0, y0], [x1, y1]] = focusF.length ? geoBounds(fc) : [[marker.lon - 4, marker.lat - 4], [marker.lon + 4, marker.lat + 4]];
  if (x1 - x0 > 180) { x0 = -170; x1 = 170; } // antimeridian / huge countries
  const padX = Math.max((x1 - x0) * 0.6, 3); const padY = Math.max((y1 - y0) * 0.6, 3);
  const box = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[
    [x0 - padX, Math.max(y0 - padY, -80)], [x1 + padX, Math.max(y0 - padY, -80)], [x1 + padX, Math.min(y1 + padY, 82)],
    [x0 - padX, Math.min(y1 + padY, 82)], [x0 - padX, Math.max(y0 - padY, -80)]]] } };
  const proj = geoMercator().fitExtent([[0, 0], [width, height]], box);
  const path = geoPath(proj);
  const focusIds = new Set(focusF.map(f => f.id));
  const visible = world().filter(f => {
    const [[a, b], [c, d]] = path.bounds(f);
    return c > 0 && a < width && d > 0 && b < height;
  });
  const shapes = visible.map(f => `<path d="${path(f)}" class="${focusIds.has(f.id) ? 'focus' : 'land'}"/>`).join('');
  const named = visible.filter(f => !focusIds.has(f.id))
    .map(f => ({ f, area: geoArea(f) })).sort((a, b) => b.area - a.area).slice(0, 4).map(x => x.f);
  const label = (f, cls) => {
    const p = proj(geoCentroid(f));
    if (!p || p[0] < 30 || p[0] > width - 30 || p[1] < 20 || p[1] > height - 20) return '';
    const text = labels[f.properties.name] || f.properties.name;
    return `<text x="${p[0].toFixed(1)}" y="${p[1].toFixed(1)}" class="${cls}">${esc(text.toUpperCase())}</text>`;
  };
  const texts = [...named.map(f => label(f, 'lbl')), ...focusF.map(f => label(f, 'lbl-focus'))].join('');
  let pin = '';
  if (marker && Number.isFinite(marker.lat) && Number.isFinite(marker.lon)) {
    const p = proj([marker.lon, marker.lat]);
    if (p) {
      const tx = Math.min(p[0] + 18, width - 10); const ty = Math.max(p[1] - 26, 30);
      pin = `<circle cx="${p[0]}" cy="${p[1]}" r="11" class="pin-halo"/><circle cx="${p[0]}" cy="${p[1]}" r="7" class="pin"/>`
        + (marker.label ? `<g class="pin-label"><text x="${tx}" y="${ty}" text-anchor="${tx > width * 0.6 ? 'end' : 'start'}">${esc(marker.label.toUpperCase())}</text></g>` : '');
    }
  }
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`
    + `<style>.land{fill:#1c2a44;stroke:#3a4d72;stroke-width:.8}.focus{fill:#c1121f;stroke:#ff4d4d;stroke-width:1.4}`
    + `.lbl{font:600 15px Oswald,Arial;fill:#8fa3c7;letter-spacing:2px;text-anchor:middle}`
    + `.lbl-focus{font:700 30px Anton,Impact,Arial;fill:#fff;letter-spacing:2px;text-anchor:middle;paint-order:stroke;stroke:#0a0f1c;stroke-width:4px}`
    + `.pin{fill:#ff2a2a;stroke:#fff;stroke-width:2}.pin-halo{fill:rgba(255,42,42,.35)}`
    + `.pin-label text{font:700 18px Oswald,Arial;fill:#fff;paint-order:stroke;stroke:#c1121f;stroke-width:10px;stroke-linejoin:round}</style>`
    + `<rect width="${width}" height="${height}" fill="#0b1426"/>${shapes}${texts}${pin}</svg>`;
}
