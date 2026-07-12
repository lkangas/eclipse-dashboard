// Generates app/src/data/cities.json (PLAN.md Sec3): major cities for the
// Spain map panel, Iberia + France + neighbors (same extent as
// basemap.mjs). Run manually:
//
//     cd tools/build-data && npm install && npm run cities
//
// Needs .cache/ne_10m_populated_places_simple.geojson (Natural Earth
// 1:10m populated places, public domain) -- download it first:
//
//     curl -o .cache/ne_10m_populated_places_simple.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson
//
// Not in world-atlas (that package only ships land/countries) -- Natural
// Earth doesn't publish this layer as its own npm package, hence the
// direct download above, same pattern as stars.mjs's HYG CSV.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(HERE, '.cache', 'ne_10m_populated_places_simple.geojson');
const OUTPUT = path.join(HERE, '..', '..', 'app', 'src', 'data', 'cities.json');

// Same bbox as basemap.mjs -- Iberia + all of mainland France + neighbors.
const [LON_MIN, LAT_MIN, LON_MAX, LAT_MAX] = [-10.5, 35, 9.5, 51.5];
// pop_max (metro population) >= this keeps ~75 cities in this extent --
// every major Spanish/French/Portuguese city plus reasonable neighbor
// context, not a solid mass of dots on a 280x200 panel. No labels yet
// (a direct, explicitly near-term follow-up), so `name` is kept in the
// output now rather than needing to re-fetch/refilter later for it.
const POP_MIN = 300_000;

function round(n, decimals) {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

const source = JSON.parse(readFileSync(SOURCE, 'utf8'));
const cities = source.features
  .filter((f) => {
    const [lon, lat] = f.geometry.coordinates;
    return (
      lon >= LON_MIN &&
      lon <= LON_MAX &&
      lat >= LAT_MIN &&
      lat <= LAT_MAX &&
      f.properties.pop_max >= POP_MIN
    );
  })
  .map((f) => ({
    name: f.properties.name,
    lat: round(f.geometry.coordinates[1], 4),
    lon: round(f.geometry.coordinates[0], 4),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

writeFileSync(OUTPUT, JSON.stringify({ cities }, null, 2));
console.log(`Wrote ${OUTPUT} (${cities.length} cities, pop_max >= ${POP_MIN})`);
