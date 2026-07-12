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
import { feature } from 'topojson-client';
import { geoArea, geoContains } from 'd3-geo';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(HERE, 'node_modules', 'world-atlas', 'countries-50m.json');
const OUTPUT_DIR = path.join(HERE, '..', '..', 'app', 'src', 'data');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'basemap-global.topojson');

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
//
// Deliberately NOT `-clean rewind` here: mapshaper's topojson re-export
// of this (whole-world, unclipped) source silently corrupts polygon
// winding (confirmed with d3.geoContains() -- e.g. mid-Pacific Ocean
// read as "inside" the land polygon), but `-clean`'s rewind fix runs
// through the same deep-clean/intersection-cutting machinery responsible
// for the *other* mapshaper bug this file already works around (see the
// no-bbox-clip comment above) -- and it reintroduces exactly that bug:
// confirmed directly by scanning the exported rings for the same
// "long-longitude-jump at near-constant-latitude, nowhere near +-180"
// signature used to diagnose the original clip bug, going from 0 such
// jumps without `-clean rewind` to 20 with it. Fixed at the arc-index
// level instead, below -- reversing a ring's traversal order and arc
// signs doesn't touch a single coordinate, so it can't introduce this
// class of bug no matter how mangled the input.
const commands = [
  `-i "${SOURCE}"`,
  '-target land',
  '-filter-islands min-area=200km2',
  '-simplify 15% keep-shapes',
  '-o format=topojson quantization=1e5',
].join(' ');

const output = await mapshaper.applyCommands(commands, {});
const filenames = Object.keys(output);
const topology = JSON.parse(output[filenames[0]]);

// Reverses a ring's winding at the topology level (reverse arc order +
// bitwise-complement each arc index) -- the standard topojson technique,
// touches only which direction each ring is traversed in, never a
// coordinate. A ring's spherical area (d3.geoArea, in steradians) comes
// out over half the sphere (2*PI) if wound backwards for an exterior
// ring, under it if wound backwards for a hole -- there are no holes in
// this "land" layer in practice, but handled generically anyway.
function fixWinding(topology, objectName) {
  const obj = topology.objects[objectName];
  const resolved = feature(topology, obj);
  const resolvedGeoms =
    resolved.type === 'FeatureCollection'
      ? resolved.features.map((f) => f.geometry)
      : [resolved.geometry ?? resolved];
  const topoGeoms = obj.type === 'GeometryCollection' ? obj.geometries : [obj];

  let fixedCount = 0;
  topoGeoms.forEach((topoGeom, gi) => {
    const resolvedGeom = resolvedGeoms[gi];
    if (!resolvedGeom) return;
    const topoPolys = topoGeom.type === 'Polygon' ? [topoGeom.arcs] : topoGeom.arcs;
    const resolvedPolys =
      resolvedGeom.type === 'Polygon' ? [resolvedGeom.coordinates] : resolvedGeom.coordinates;
    topoPolys.forEach((ringArcsList, pi) => {
      ringArcsList.forEach((ringArcs, ri) => {
        const ringCoords = resolvedPolys[pi][ri];
        const area = geoArea({ type: 'Polygon', coordinates: [ringCoords] });
        const isExterior = ri === 0;
        const backwards = isExterior ? area > 2 * Math.PI : area < 2 * Math.PI;
        if (backwards) {
          fixedCount++;
          ringArcs.reverse();
          for (let i = 0; i < ringArcs.length; i++) ringArcs[i] = ~ringArcs[i];
        }
      });
    });
  });
  return fixedCount;
}

const fixedCount = fixWinding(topology, 'land');
console.log(`Fixed winding on ${fixedCount} ring(s)`);

// Spot-check against known land/ocean points before trusting the file --
// this whole post-process step exists because that trust was misplaced
// once already (see the comment above), so verify rather than assume.
const land = feature(topology, topology.objects.land);
const checks = [
  ['mid-Pacific Ocean', [-150, 0], false],
  ['mid-Atlantic Ocean', [-30, 50], false],
  ['open ocean off Iceland (greatest eclipse)', [-25.24, 65.2233], false],
  ['Moscow', [37.6, 55.75], true],
  ['Siberia (Arctic terminator start)', [108.68362, 75.86508], true],
];
const failures = checks.filter(([, pt, want]) => geoContains(land, pt) !== want);
if (failures.length > 0) {
  throw new Error(
    `Winding fix verification failed: ${failures.map(([name]) => name).join(', ')}`,
  );
}
console.log('Winding verified against 5 known land/ocean reference points.');

fs.writeFileSync(OUTPUT_PATH, JSON.stringify(topology));
console.log(`Wrote ${OUTPUT_PATH}`);
