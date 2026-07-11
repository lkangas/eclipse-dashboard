// Precomputes the Spain-tab map's central line + N/S umbral limits
// (PLAN.md §3 item 4): static geometry for the whole event -- not
// observer- or clock-dependent -- so it's generated once here instead
// of being recomputed in every browser. Run manually:
//
//     cd app && npx tsx scripts/generate-shadow-frames.ts
//
// Commit the output JSON when path.ts's math changes; the app reads it
// directly, this only runs at build time (matches the
// generate_besselian.py / basemap.mjs / stars.mjs pattern in
// tools/build-data, just living in app/ since it imports app/src/
// TypeScript directly rather than calling out to eclipse-calc).

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { coefficients, ttHoursToDate } from '../src/data/besselian-2026';
import { centralLineAt, shadowLimitsAt } from '../src/eclipse/path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT = path.join(HERE, '..', 'src', 'data', 'shadow-frames.json');

// Spans the shadow's Spain transit (~18:18-18:33 UT), padded a bit
// beyond the known ~0.32-0.56h window -- matches what MapPanel sampled
// client-side before this was precomputed.
const WINDOW_START_H = 0.25;
const WINDOW_END_H = 0.58;
const SAMPLES = 150;

function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

const centralLine: { lat: number; lon: number; utMs: number }[] = [];
const northLimit: { lat: number; lon: number }[] = [];
const southLimit: { lat: number; lon: number }[] = [];

for (let i = 0; i <= SAMPLES; i++) {
  const t = WINDOW_START_H + ((WINDOW_END_H - WINDOW_START_H) * i) / SAMPLES;

  const central = centralLineAt(coefficients, t);
  if (central) {
    centralLine.push({
      lat: round(central.lat, 5),
      lon: round(central.lon, 5),
      utMs: ttHoursToDate(t).getTime(),
    });
  }

  const limits = shadowLimitsAt(coefficients, t);
  if (limits.north) northLimit.push({ lat: round(limits.north.lat, 5), lon: round(limits.north.lon, 5) });
  if (limits.south) southLimit.push({ lat: round(limits.south.lat, 5), lon: round(limits.south.lon, 5) });
}

writeFileSync(
  OUTPUT,
  JSON.stringify(
    {
      event: '2026-08-12 total solar eclipse, Spain -- map path/shadow frames',
      generated_by: 'app/scripts/generate-shadow-frames.ts',
      windowStartH: WINDOW_START_H,
      windowEndH: WINDOW_END_H,
      samples: SAMPLES,
      centralLine,
      northLimit,
      southLimit,
    },
    null,
    2,
  ),
);
console.log(`Wrote ${OUTPUT} (centralLine=${centralLine.length}, northLimit=${northLimit.length}, southLimit=${southLimit.length})`);
