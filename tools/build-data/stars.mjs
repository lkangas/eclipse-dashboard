// Generates app/src/data/stars.json (PLAN.md Sec3 item 2): the HYG star
// catalog, filtered to naked-eye-bright stars only. Run manually:
//
//     cd tools/build-data && npm install && npm run stars
//
// Needs .cache/hygdata_v41.csv (HYG v4.1 "CURRENT", CC BY-SA 4.0) --
// download it first:
//
//     curl -o .cache/hygdata_v41.csv https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv
//
// Filtered to mag < 3, not the ~6.5 naked-eye-dark-sky limit PLAN.md
// originally assumed: totality here is a low-altitude, twilight-bright
// sky (Sec1), not a dark-sky viewing session, so only bright stars and
// planets will actually be visible -- confirmed with the user.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(HERE, '.cache', 'hygdata_v41.csv');
const OUTPUT = path.join(HERE, '..', '..', 'app', 'src', 'data', 'stars.json');
const MAG_LIMIT = 3;

// Minimal but correct CSV line parser (handles quoted fields with commas,
// which HYG's "proper"/"bf" columns can contain) -- not worth a dependency
// for a handful of columns out of a file we only ever read once.
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
  const lines = readFileSync(SOURCE, 'utf-8').split('\n');
  const header = parseCsvLine(lines[0]);
  const col = Object.fromEntries(header.map((name, i) => [name, i]));

  const stars = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const fields = parseCsvLine(line);

    const id = fields[col.id];
    const proper = fields[col.proper];
    if (id === '0' || proper === 'Sol') continue; // the Sun itself -- handled separately (astronomy-engine)

    const mag = parseFloat(fields[col.mag]);
    if (!(mag < MAG_LIMIT)) continue;

    stars.push({
      proper: proper || null,
      bf: fields[col.bf] || null,
      ra: round(parseFloat(fields[col.ra]), 5), // decimal hours, HYG's native unit
      dec: round(parseFloat(fields[col.dec]), 5), // decimal degrees
      mag: round(mag, 2),
      ci: fields[col.ci] ? round(parseFloat(fields[col.ci]), 2) : null,
      spect: fields[col.spect] || null,
    });
  }

  stars.sort((a, b) => a.mag - b.mag);

  const data = {
    source: 'HYG v4.1 (astronexus/HYG-Database), CC BY-SA 4.0',
    filter: `mag < ${MAG_LIMIT}`,
    units: { ra: 'decimal hours (0-24)', dec: 'decimal degrees (-90..90)' },
    count: stars.length,
    stars,
  };

  writeFileSync(OUTPUT, JSON.stringify(data, null, 2));
  console.log(`Wrote ${OUTPUT} (${stars.length} stars, mag < ${MAG_LIMIT})`);
}

main();
