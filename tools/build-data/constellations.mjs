// Generates app/src/data/constellation-lines.json (All-sky view, direct
// request): the 88 IAU "western" constellations' traditional stick-figure
// lines, baked to real ra/dec at build time so the app never needs to
// carry star-ID lookups at runtime.
//
// Needs .cache/hygdata_v41.csv (same HYG v4.1 catalog stars.mjs uses --
// see its own header for the download command) plus the Stellarium
// western-sky-culture line topology (HIP-numbered polylines, AGPL-3.0),
// which is NOT the same file as the old-format "constellationship.fab"
// (that path 404s now -- Stellarium moved to a JSON format with an
// `index.json` per sky culture). Download it first:
//
//     curl -o .cache/western_index.json \
//       https://raw.githubusercontent.com/Stellarium/stellarium-skycultures/master/western/index.json
//
// Line endpoints are looked up by HIP number against the FULL HYG
// catalog (not stars.mjs's mag<3-filtered subset) -- most constellation-
// figure stars are fainter than mag 3 (this app's twilight-sky cutoff,
// see stars.mjs), so they wouldn't resolve against the bundled star dots
// at all. That's fine and expected: this file only needs each point's
// position, not whether it's separately drawn as a star -- the app
// renders these lines very dim specifically because a fair number of
// their endpoints won't have a visible dot of their own (direct
// request).

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HYG_SOURCE = path.join(HERE, '.cache', 'hygdata_v41.csv');
const LINES_SOURCE = path.join(HERE, '.cache', 'western_index.json');
const OUTPUT = path.join(HERE, '..', '..', 'app', 'src', 'data', 'constellation-lines.json');

// Same minimal CSV parser as stars.mjs (kept local rather than shared --
// each build-data script is self-contained, matching this directory's
// existing convention).
function parseCsvLine(line) {
  const fields = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      fields.push(field);
      field = '';
    } else {
      field += c;
    }
  }
  fields.push(field);
  return fields;
}

function round(n, decimals) {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

function main() {
  const hygLines = readFileSync(HYG_SOURCE, 'utf-8').split('\n');
  const header = parseCsvLine(hygLines[0]);
  const col = Object.fromEntries(header.map((name, i) => [name, i]));

  // HIP -> [ra (decimal hours), dec (decimal degrees)], full catalog
  // (not magnitude-filtered) since a line endpoint doesn't need to be
  // one of the app's own displayed star dots.
  const byHip = new Map();
  for (let i = 1; i < hygLines.length; i++) {
    const line = hygLines[i];
    if (!line.trim()) continue;
    const fields = parseCsvLine(line);
    const hip = fields[col.hip];
    if (!hip) continue;
    const ra = parseFloat(fields[col.ra]);
    const dec = parseFloat(fields[col.dec]);
    if (!Number.isFinite(ra) || !Number.isFinite(dec)) continue;
    byHip.set(parseInt(hip, 10), [round(ra, 5), round(dec, 5)]);
  }

  const westernIndex = JSON.parse(readFileSync(LINES_SOURCE, 'utf-8'));

  let missing = 0;
  const lines = [];
  for (const con of westernIndex.constellations) {
    for (const hipPolyline of con.lines) {
      const points = [];
      for (const hip of hipPolyline) {
        const p = byHip.get(hip);
        if (!p) {
          missing++;
          continue;
        }
        points.push(p);
      }
      if (points.length >= 2) lines.push({ con: con.iau, points });
    }
  }

  const data = {
    source:
      "Stellarium stellarium-skycultures 'western' sky culture, index.json (AGPL-3.0) -- " +
      'line topology (HIP-numbered polylines) cross-referenced against HYG v4.1 ' +
      '(astronexus/HYG-Database, CC BY-SA 4.0) for ra/dec',
    units: { ra: 'decimal hours (0-24)', dec: 'decimal degrees (-90..90)' },
    count: lines.length,
    lines,
  };

  writeFileSync(OUTPUT, JSON.stringify(data, null, 2));
  console.log(
    `Wrote ${OUTPUT} (${lines.length} polylines, ${missing} unresolved HIP refs skipped)`,
  );
}

main();
