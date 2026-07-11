// Generates app/src/data/basemap-global.topojson (PLAN.md Sec8 #2): a
// much wider, coarser companion to basemap.topojson -- the Global map
// tab shows the whole event path (Siberia/Arctic through Iceland to
// Spain), far outside basemap.topojson's tight Iberia-only clip, so it
// needs its own wider-but-lower-detail source instead. Run manually:
//
//     cd tools/build-data && npm install && npm run basemap-global
//
// Source: same world-atlas countries-50m.json as basemap.mjs (Natural
// Earth 1:50m, ISC license -- see node_modules/world-atlas/LICENSE).

import mapshaper from 'mapshaper';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(HERE, 'node_modules', 'world-atlas', 'countries-50m.json');
const OUTPUT_DIR = path.join(HERE, '..', '..', 'app', 'src', 'data');

// lonMin,latMin,lonMax,latMax -- covers the whole 2026-08-12 path from
// Arctic Russia/Svalbard through Greenland/Iceland to Spain, with margin.
const BBOX = '-65,45,135,90';

const commands = [
  `-i "${SOURCE}"`,
  `-clip bbox=${BBOX}`,
  '-simplify 15% keep-shapes',
  `-o format=topojson quantization=1e5 "${path.join(OUTPUT_DIR, 'basemap-global.topojson')}"`,
].join(' ');

await mapshaper.runCommands(commands);
console.log(`Wrote ${path.join(OUTPUT_DIR, 'basemap-global.topojson')}`);
