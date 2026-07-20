// Async-loaded 250m Copernicus DEM GLO-30 grid (docs/HORIZON-PLAN.md
// Tier 1), used ONLY by eclipse/horizon.ts's terrain-obstruction ray-march
// -- NOT by data/elevation.ts's own elevationAt() (the observer's own
// ground-elevation display), which stays on the small, always-instant
// coarse grid.
//
// Deliberately a DYNAMIC import(), not a static top-level one: measured
// in isolation, JSON.parse + base64-decode of this ~69MB payload is well
// under 1s (see the commit message/PR notes) -- the real cost is a
// browser having to parse/compile a bundle that's ~70MB bigger before
// ANYTHING in the app can run, regardless of when the decode logic itself
// is invoked. Splitting it into its own lazily-fetched chunk keeps
// startup instant; horizon.ts's ray-march (the only consumer) tolerates a
// brief "not ready yet" window, surfaced via elevationFineReady below
// (stores/horizonObstruction.ts's `loading` flag; SkyPanel shows
// "Rendering horizon..." while it's true).
import { writable } from 'svelte/store';

interface ElevationFineData {
  latMin: number;
  lonMin: number;
  latStep: number;
  lonStep: number;
  rows: number;
  cols: number;
  dataBase64: string;
}

interface ElevationFineGrid {
  latMin: number;
  lonMin: number;
  latStep: number;
  lonStep: number;
  rows: number;
  cols: number;
  elevationsM: Int16Array;
}

let grid: ElevationFineGrid | null = null;
let loadPromise: Promise<void> | null = null;

/** True once the fine grid has finished loading and elevationFineAt() will
 * return real values -- a store (not a plain flag) so
 * stores/horizonObstruction.ts's `derived` can react to it directly. */
export const elevationFineReady = writable(false);

// Prefer the native Uint8Array.fromBase64 (TC39 base64/hex proposal, C++-
// implemented, landed in recent Chromium) when available -- meaningfully
// faster for a ~50MB decode than the universal atob()-loop fallback, which
// still works everywhere (older engines, non-Chromium browsers).
function decodeBase64ToInt16Array(b64: string): Int16Array {
  const nativeFromBase64 = (Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array })
    .fromBase64;
  if (typeof nativeFromBase64 === 'function') {
    return new Int16Array(nativeFromBase64(b64).buffer);
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

/** Kicks off the (memoized) dynamic import + decode -- safe to call from
 * multiple places; the actual work only ever runs once. Callers don't
 * need the returned promise if they're just reacting to
 * elevationFineReady instead. */
export function loadElevationFine(): Promise<void> {
  if (!loadPromise) {
    loadPromise = import('./elevation-fine.json').then((mod) => {
      const data = mod.default as ElevationFineData;
      grid = {
        latMin: data.latMin,
        lonMin: data.lonMin,
        latStep: data.latStep,
        lonStep: data.lonStep,
        rows: data.rows,
        cols: data.cols,
        elevationsM: decodeBase64ToInt16Array(data.dataBase64),
      };
      elevationFineReady.set(true);
    });
  }
  return loadPromise;
}

function cellValue(row: number, col: number): number {
  const g = grid!;
  const r = Math.min(g.rows - 1, Math.max(0, row));
  const c = Math.min(g.cols - 1, Math.max(0, col));
  return g.elevationsM[r * g.cols + c];
}

/** Bilinear-interpolated 250m elevation at `lat`/`lon`, clamped to >=0
 * (same reasoning as data/elevation.ts's own elevationAt -- every real
 * observer stands on land, and this land-only Copernicus source has no
 * data at all over open water anyway, which is fine: no terrain there
 * means no obstruction, exactly what this function's only caller,
 * eclipse/horizon.ts's ray-march, needs). Returns null before
 * loadElevationFine() has finished -- callers must check
 * elevationFineReady first (stores/horizonObstruction.ts does). */
export function elevationFineAt(lat: number, lon: number): number | null {
  if (!grid) return null;
  const { latMin, lonMin, latStep, lonStep } = grid;
  const rowF = (lat - latMin) / latStep;
  const colF = (lon - lonMin) / lonStep;
  const r0 = Math.floor(rowF);
  const c0 = Math.floor(colF);
  const fr = rowF - r0;
  const fc = colF - c0;

  const v00 = cellValue(r0, c0);
  const v01 = cellValue(r0, c0 + 1);
  const v10 = cellValue(r0 + 1, c0);
  const v11 = cellValue(r0 + 1, c0 + 1);
  const top = v00 + (v01 - v00) * fc;
  const bottom = v10 + (v11 - v10) * fc;
  return Math.max(0, top + (bottom - top) * fr);
}
