// Generates app/src/data/basemap.topojson (PLAN.md Sec3 item 1): Natural
// Earth countries + land, clipped to the Iberia + western Mediterranean +
// Balearics extent (PLAN.md Sec14 #3) and lightly simplified. Run manually:
//
//     cd tools/build-data && npm install && npm run basemap
//
// Source: world-atlas's bundled countries-50m.json (Natural Earth 1:50m,
// ISC license -- see node_modules/world-atlas/LICENSE). Admin-1 province
// detail (martynafford, PLAN.md Sec3 item 1) is a separate, not-yet-done
// follow-up -- this is countries + coastline only.

import mapshaper from 'mapshaper';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(HERE, 'node_modules', 'world-atlas', 'countries-50m.json');
const OUTPUT_DIR = path.join(HERE, '..', '..', 'app', 'src', 'data');

// lonMin,latMin,lonMax,latMax -- Iberia (incl. Portugal) + W-Mediterranean +
// Balearics, with a little margin. Same decision as the mock's map tab.
const BBOX = '-10.5,35,6.5,44.5';

const commands = [
  `-i "${SOURCE}"`,
  `-clip bbox=${BBOX}`,
  '-simplify 50% keep-shapes',
  `-o format=topojson quantization=1e5 "${path.join(OUTPUT_DIR, 'basemap.topojson')}"`,
].join(' ');

await mapshaper.runCommands(commands);
console.log(`Wrote ${path.join(OUTPUT_DIR, 'basemap.topojson')}`);
