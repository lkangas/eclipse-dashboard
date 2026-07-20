// Computes WHICH cells of the dense 250m Copernicus grid to keep: land
// (real coastline, from basemap.topojson) intersected with the umbral
// corridor (shadow-frames.json's northLimit/southLimit + an asymmetric
// margin), rather than the whole Iberia+Balearics bounding box. That whole
// bbox is ~90% open ocean at this resolution -- storing it produced a
// 69MB file, over Cloudflare Pages' 25MiB-per-file limit. This script only
// decides the geometry (which columns/row-spans to keep); the actual
// Copernicus elevation values are sampled by generate_elevation_fine.py,
// which reads this mask's output and sample-per-span instead of
// rasterizing the whole bbox.
//
// Margin is asymmetric, not a uniform buffer: it exists ONLY to cover
// horizon.ts's ray-march, which looks ~30-50km out from the observer in
// the Sun's direction -- not "how far someone might drive to chase
// weather" (there is no such margin; observers only make sense within the
// umbral path itself). The path runs NW->SE across Spain and the Sun's
// azimuth is consistently WSW for observers on it, so a sightline from the
// NORTH edge points back INTO the corridor (no margin needed) while one
// from the SOUTH edge points away from it (needs the full ray-march
// distance). See docs/HORIZON-PLAN.md.
import fs from 'fs';
import * as topojsonClient from 'topojson-client';

const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const APP_DATA = HERE + '../../app/src/data/';
const OUTPUT = HERE + 'dem-mask.json';

// Same grid origin/step/extent as the (previous, whole-bbox) elevation-fine.json
// -- keeping these identical means every downstream index/lat/lon formula
// stays unchanged; only which cells actually get a span narrows.
const LON_MIN = -10.5, LAT_MIN = 35.0, LON_MAX = 6.5, LAT_MAX = 44.5;
const STEP = 1 / 400; // ~0.0025deg, ~250-280m at this latitude

const SOUTH_MARGIN_KM = 40;
const NORTH_MARGIN_KM = 10;
const KM_PER_DEG = 111; // approximation, consistent with the corridor sanity-check map

function loadLandRings() {
  const topo = JSON.parse(fs.readFileSync(APP_DATA + 'basemap.topojson', 'utf8'));
  const objName = Object.keys(topo.objects)[0];
  const geo = topojsonClient.feature(topo, topo.objects[objName]);
  const feats = geo.features || [geo];
  const PAD = 0.5;
  const rings = [];
  for (const f of feats) {
    const geom = f.geometry;
    if (!geom) continue;
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
    for (const poly of polys) {
      const ring = poly[0];
      let latMin = Infinity, latMax = -Infinity, lonMin = Infinity, lonMax = -Infinity;
      for (const [lon, lat] of ring) {
        if (lat < latMin) latMin = lat; if (lat > latMax) latMax = lat;
        if (lon < lonMin) lonMin = lon; if (lon > lonMax) lonMax = lon;
      }
      // Only rings mostly CONTAINED in the target bbox -- excludes giant
      // multi-country landmasses (e.g. all of mainland Europe) that merely
      // clip a corner of it, which would otherwise blow up projected
      // coordinates and cost real time in the crossing scan for no benefit.
      if (latMin < LAT_MIN - PAD || latMax > LAT_MAX + PAD || lonMin < LON_MIN - PAD || lonMax > LON_MAX + PAD) continue;
      rings.push(ring);
    }
  }
  return rings;
}

// Exact scanline crossings of `ring` at fixed longitude `x` -> sorted lats.
function ringCrossings(ring, x) {
  const ys = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[j], [x2, y2] = ring[i];
    if ((x1 <= x && x2 > x) || (x2 <= x && x1 > x)) {
      const t = (x - x1) / (x2 - x1);
      ys.push(y1 + t * (y2 - y1));
    }
  }
  ys.sort((a, b) => a - b);
  return ys;
}

function landIntervalsAt(landRings, lon) {
  const intervals = [];
  for (const ring of landRings) {
    const ys = ringCrossings(ring, lon);
    for (let i = 0; i + 1 < ys.length; i += 2) intervals.push([ys[i], ys[i + 1]]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const iv of intervals) {
    if (merged.length && iv[0] <= merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], iv[1]);
    } else {
      merged.push([iv[0], iv[1]]);
    }
  }
  return merged;
}

function makeLonInterpolator(curve) {
  const sorted = curve.slice().sort((a, b) => a.lon - b.lon);
  return function (lon) {
    if (lon <= sorted[0].lon) return sorted[0].lat;
    if (lon >= sorted[sorted.length - 1].lon) return sorted[sorted.length - 1].lat;
    let lo = 0, hi = sorted.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid].lon < lon) lo = mid; else hi = mid;
    }
    const a = sorted[lo], b = sorted[hi];
    const t = (lon - a.lon) / (b.lon - a.lon || 1e-9);
    return a.lat + t * (b.lat - a.lat);
  };
}

function intersectIntervals(a, b) {
  const lo = Math.max(a[0], b[0]), hi = Math.min(a[1], b[1]);
  return hi > lo ? [lo, hi] : null;
}

function main() {
  const sf = JSON.parse(fs.readFileSync(APP_DATA + 'shadow-frames.json', 'utf8'));
  const landRings = loadLandRings();

  const northLat = makeLonInterpolator(sf.northLimit);
  const southLat = makeLonInterpolator(sf.southLimit);
  const southMarginDeg = SOUTH_MARGIN_KM / KM_PER_DEG;
  const northMarginDeg = NORTH_MARGIN_KM / KM_PER_DEG;

  const cols = Math.round((LON_MAX - LON_MIN) / STEP) + 1;

  const colSpanStart = [0];
  const spanRowStart = [];
  const spanRowCount = [];
  // Per-span lon/latStart, redundant with the index math above but kept
  // explicit so generate_elevation_fine.py doesn't need to re-derive
  // column geometry -- it just samples (lon, lat) pairs it's handed.
  const spanLon = [];
  const spanLatStart = [];

  for (let c = 0; c < cols; c++) {
    const lon = LON_MIN + c * STEP;
    const corridorLatMin = southLat(lon) - southMarginDeg;
    const corridorLatMax = northLat(lon) + northMarginDeg;
    const landIvs = landIntervalsAt(landRings, lon);
    for (const iv of landIvs) {
      const clipped = intersectIntervals(iv, [corridorLatMin, corridorLatMax]);
      if (!clipped) continue;
      const rowStart = Math.ceil((clipped[0] - LAT_MIN) / STEP);
      const rowEndExcl = Math.floor((clipped[1] - LAT_MIN) / STEP) + 1;
      const rowCount = rowEndExcl - rowStart;
      if (rowCount <= 0) continue;
      spanRowStart.push(rowStart);
      spanRowCount.push(rowCount);
      spanLon.push(lon);
      spanLatStart.push(LAT_MIN + rowStart * STEP);
    }
    colSpanStart.push(spanRowStart.length);
  }

  const totalCells = spanRowCount.reduce((a, b) => a + b, 0);
  console.log(`cols=${cols} spans=${spanRowStart.length} totalCells=${totalCells.toLocaleString()}`);
  console.log(`estimated raw Int16 bytes: ${(totalCells * 2 / 1024 / 1024).toFixed(2)} MiB`);

  const mask = {
    lonMin: LON_MIN,
    lonStep: STEP,
    cols,
    latMin: LAT_MIN,
    latStep: STEP,
    southMarginKm: SOUTH_MARGIN_KM,
    northMarginKm: NORTH_MARGIN_KM,
    colSpanStart,
    spanRowStart,
    spanRowCount,
    spanLon,
    spanLatStart,
  };
  fs.writeFileSync(OUTPUT, JSON.stringify(mask));
  console.log(`Wrote ${OUTPUT}`);
}

main();
