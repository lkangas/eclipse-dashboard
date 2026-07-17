// Export the current observer's contact times as the JSON schema used by
// third-party eclipse-photography tooling (direct request) -- e.g.
// komakallio/eclipse2024's times.json:
// github.com/komakallio/eclipse2024/blob/main/times.json. A plain
// {times: {C1,C2,MAX,C3,C4}} object, ISO 8601 UTC timestamps to one
// decimal -- matching that exact schema (nothing else this app tracks,
// e.g. sunset/magnitude, is added).
import { formatIsoTenths } from './format';

export interface TimesJson {
  times: {
    C1: string;
    C2: string;
    MAX: string;
    C3: string;
    C4: string;
  };
}

export function buildTimesJson(c1: Date, c2: Date, max: Date, c3: Date, c4: Date): TimesJson {
  return {
    times: {
      C1: formatIsoTenths(c1),
      C2: formatIsoTenths(c2),
      MAX: formatIsoTenths(max),
      C3: formatIsoTenths(c3),
      C4: formatIsoTenths(c4),
    },
  };
}

/** Triggers a browser "Save As" for `json` -- a Blob + a temporary
 * object-URL anchor click, entirely client-side, matching this app's
 * zero-runtime-network architecture (no server/upload involved). */
export function downloadTimesJson(json: TimesJson, filename = 'times.json'): void {
  const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
