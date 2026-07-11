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

// Plain `-clip bbox=` mishandles Russia here: its unclipped polygon
// crosses the antimeridian (continuing past +180 as negative longitudes
// toward Alaska), and a naive planar box-clip of that -- even though our
// own bbox above never wraps -- inserted long spurious straight edges
// at constant latitude (e.g. one ran from 67E to -65W along a single
// parallel), several thousand km of straight "coastline" nowhere near
// any real coast. `bbox2` (mapshaper's alternate/fast clip
// implementation) doesn't have this bug -- confirmed by scanning every
// ring for consecutive points with a >10deg longitude jump but <1deg
// latitude change (the signature of one of these fake edges): many with
// plain bbox=, zero with bbox2=. `-filter-islands` drops the flyspeck
// islands that would otherwise be indistinguishable noise at this map's
// small on-screen scale.
const commands = [
  `-i "${SOURCE}"`,
  `-clip bbox2=${BBOX}`,
  '-filter-islands min-area=200km2',
  '-simplify 15% keep-shapes',
  `-o format=topojson quantization=1e5 "${path.join(OUTPUT_DIR, 'basemap-global.topojson')}"`,
].join(' ');

await mapshaper.runCommands(commands);
console.log(`Wrote ${path.join(OUTPUT_DIR, 'basemap-global.topojson')}`);
