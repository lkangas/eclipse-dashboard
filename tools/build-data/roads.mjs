// Generates app/src/data/roads.topojson (PLAN.md Sec3): major highways
// for the Spain map panel, same extent as basemap.mjs. Run manually:
//
//     cd tools/build-data && npm install && npm run roads
//
// Needs the Natural Earth 1:10m roads shapefile downloaded and unzipped
// first (not in world-atlas -- that package only ships land/countries;
// Natural Earth doesn't publish roads as its own npm package either):
//
//     curl -o .cache/ne_10m_roads.zip https://naciscdn.org/naturalearth/10m/cultural/ne_10m_roads.zip
//     unzip -o .cache/ne_10m_roads.zip -d .cache/ne_10m_roads
//
// Public domain (naturalearthdata.com/about/terms-of-use/), same as
// basemap.mjs's source.

import mapshaper from 'mapshaper';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(HERE, '.cache', 'ne_10m_roads', 'ne_10m_roads.shp');
const OUTPUT_DIR = path.join(HERE, '..', '..', 'app', 'src', 'data');

// Same bbox as basemap.mjs -- Iberia + all of mainland France + neighbors.
const BBOX = '-10.5,35,9.5,51.5';

// "Major Highway" only (not "Secondary Highway"/"Road"/"Ferry Route") --
// this is a small on-screen reference map, not a road atlas. No
// attribute data kept (drop-table) -- lines are rendered plain, no
// labels yet (a direct, explicitly near-term follow-up), so route
// numbers/names would just be dead weight in the bundle for now.
const commands = [
  `-i "${SOURCE}"`,
  `-clip bbox=${BBOX}`,
  "-filter \"type=='Major Highway'\"",
  '-simplify 30% keep-shapes',
  `-o format=topojson quantization=1e5 drop-table "${path.join(OUTPUT_DIR, 'roads.topojson')}"`,
].join(' ');

await mapshaper.runCommands(commands);
console.log(`Wrote ${path.join(OUTPUT_DIR, 'roads.topojson')}`);

// One tier down ("Secondary Highway"), rendered dimmer/more transparent
// than the major layer above (same stroke-width, lower stroke-opacity --
// MapPanel.svelte's .roads-minor) so it reads as background context
// rather than competing with it. Plain "Road" (the next tier after this)
// is left out -- at this map's scale it'd just be visual noise.
const minorCommands = [
  `-i "${SOURCE}"`,
  `-clip bbox=${BBOX}`,
  "-filter \"type=='Secondary Highway'\"",
  '-simplify 30% keep-shapes',
  `-o format=topojson quantization=1e5 drop-table "${path.join(OUTPUT_DIR, 'roads-minor.topojson')}"`,
].join(' ');

await mapshaper.runCommands(minorCommands);
console.log(`Wrote ${path.join(OUTPUT_DIR, 'roads-minor.topojson')}`);
