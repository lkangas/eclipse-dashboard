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

// No bbox clip at all -- every variant tried (`-clip bbox=`, `-clip
// bbox2=`, `-erase` a dateline wedge first, an explicit rectangle layer
// via plain `-clip`) either inserted spurious edges through Russia's
// polygon or silently dropped it (Eurasia mainland vanishing entirely)
// depending on the exact combination. Root cause traced to Russia's
// Arctic coast repeatedly approaching the antimeridian in a way none of
// mapshaper's clip code paths handled cleanly against a bbox that itself
// never wraps -- not fixable by picking a different clip flag. Simplify
// the WHOLE WORLD instead and let the client-side stereographic
// projection's own `.clipAngle()` (already correct and proven artifact-
// free -- MapPanel.svelte) do all the regional clipping at render time.
// File size stays reasonable (under 100KB at this simplify level) since
// simplification happens before nothing is ever clipped away wastefully.
// `-filter-islands` drops flyspeck islands that would otherwise be
// indistinguishable noise at this map's small on-screen scale.
// `-clean rewind` is load-bearing, not cosmetic: without it, mapshaper's
// topojson re-export of this (whole-world, unclipped) source silently
// corrupts every ring's CW/CCW winding, so d3-geo's fill/contains logic
// treats the *entire globe* as "inside" the land polygon -- confirmed
// directly with d3.geoContains() (e.g. mid-Pacific Ocean reads as land)
// before this fix, correct after. basemap.mjs doesn't need this because
// clipping to a small bbox happens to sidestep whatever triggers it here
// -- reproduced down to a single plain `-i ... -o format=topojson ...`
// re-export with zero other transforms, so it's specific to exporting
// this large a topology, not any one command in the pipeline.
const commands = [
  `-i "${SOURCE}"`,
  '-target land',
  '-filter-islands min-area=200km2',
  '-simplify 15% keep-shapes',
  '-clean rewind',
  `-o format=topojson quantization=1e5 "${path.join(OUTPUT_DIR, 'basemap-global.topojson')}"`,
].join(' ');

await mapshaper.runCommands(commands);
console.log(`Wrote ${path.join(OUTPUT_DIR, 'basemap-global.topojson')}`);
