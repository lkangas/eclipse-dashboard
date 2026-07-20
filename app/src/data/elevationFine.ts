// Async-loaded 250m Copernicus DEM GLO-30 grid (docs/HORIZON-PLAN.md
// Tier 1), used ONLY by eclipse/horizon.ts's terrain-obstruction ray-march
// -- NOT by data/elevation.ts's own elevationAt() (the observer's own
// ground-elevation display), which stays on the small, always-instant
// coarse grid.
//
// SPARSE, not a dense whole-Iberia-bbox raster: only cells that are both
// (a) real land (from basemap.topojson's coastline) and (b) within the
// umbral totality corridor (plus a small ray-march margin) are stored --
// about 4.1M cells instead of a dense grid's ~25.85M, which keeps this
// file under Cloudflare Pages' 25MiB-per-file limit (see
// tools/build-data/generate_dem_mask.mjs and generate_elevation_fine.py).
// The grid is still laid out on the same lonMin/lonStep/latMin/latStep
// raster as before, but the data is stored as a per-COLUMN list of row
// SPANS (contiguous runs of covered rows), not a full rows*cols array --
// most columns (those entirely outside the corridor, or entirely at sea)
// have ZERO spans, which is normal and expected, not a bug. `colSpanStart`
// is a CSR-style pointer array (length cols+1): column c's spans are
// `spanRowStart`/`spanRowCount`/elevation data at indices
// [colSpanStart[c], colSpanStart[c + 1]), typically 0, 1, or rarely 2 of
// them. Elevation samples for every span are concatenated back-to-back
// (span 0's rows, then span 1's, etc, in span order, no padding) into one
// flat Int16 buffer (`dataBase64`); this module reconstructs a per-span
// start offset into that buffer once at load time (`spanDataOffset`, a
// prefix sum of `spanRowCount` -- NOT itself stored in the file).
//
// Because coverage is sparse, `elevationFineAt()` returning `null` now
// means TWO different things, both requiring the SAME caller behavior:
//  1. (pre-existing) the grid hasn't finished loading yet -- callers must
//     check elevationFineReady first (stores/horizonObstruction.ts does).
//  2. (NEW) this lat/lon simply isn't covered by the sparse corridor grid
//     at all -- open ocean, or real land far outside the totality corridor
//     (e.g. Madrid). This is an entirely normal, common result, not an
//     error.
// This file's job is ONLY to answer for the cells it actually has --
// EVERY caller must fall back to the coarse, always-fully-covering
// data/elevation.ts elevationAt() (which already clamps ocean to 0) when
// this returns null, regardless of which of the two reasons applies. See
// stores/horizonObstruction.ts for that fallback.
//
// Deliberately a DYNAMIC import(), not a static top-level one: measured
// in isolation, JSON.parse + base64-decode of this payload is well under
// 1s (see the commit message/PR notes) -- the real cost is a browser
// having to parse/compile a bundle that's meaningfully bigger before
// ANYTHING in the app can run, regardless of when the decode logic itself
// is invoked. Splitting it into its own lazily-fetched chunk keeps
// startup instant; horizon.ts's ray-march (the only consumer) tolerates a
// brief "not ready yet" window, surfaced via elevationFineReady below
// (stores/horizonObstruction.ts's `loading` flag; SkyPanel shows
// "Rendering horizon..." while it's true).
import { writable } from 'svelte/store';

interface ElevationFineData {
  lonMin: number;
  lonStep: number;
  cols: number;
  latMin: number;
  latStep: number;
  colSpanStart: number[];
  spanRowStart: number[];
  spanRowCount: number[];
  dataBase64: string;
}

interface ElevationFineGrid {
  lonMin: number;
  lonStep: number;
  cols: number;
  latMin: number;
  latStep: number;
  /** CSR-style pointer array, length cols+1: column c's spans are indices
   * [colSpanStart[c], colSpanStart[c + 1]) into spanRowStart/spanRowCount/
   * spanDataOffset below. */
  colSpanStart: Int32Array;
  /** First row index (global row r, i.e. lat = latMin + r*latStep)
   * covered by each span. */
  spanRowStart: Int32Array;
  /** Number of consecutive rows (cells) covered by each span. */
  spanRowCount: Int32Array;
  /** Precomputed (NOT read from the file) prefix sum of spanRowCount --
   * span s's elevation values live at
   * elevationsM[spanDataOffset[s] + i] for i in [0, spanRowCount[s]). */
  spanDataOffset: Int32Array;
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
// faster for a large decode than the universal atob()-loop fallback, which
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
      const spanRowCount = Int32Array.from(data.spanRowCount);
      const spanDataOffset = new Int32Array(spanRowCount.length);
      let offset = 0;
      for (let s = 0; s < spanRowCount.length; s++) {
        spanDataOffset[s] = offset;
        offset += spanRowCount[s];
      }
      grid = {
        lonMin: data.lonMin,
        lonStep: data.lonStep,
        cols: data.cols,
        latMin: data.latMin,
        latStep: data.latStep,
        colSpanStart: Int32Array.from(data.colSpanStart),
        spanRowStart: Int32Array.from(data.spanRowStart),
        spanRowCount,
        spanDataOffset,
        elevationsM: decodeBase64ToInt16Array(data.dataBase64),
      };
      elevationFineReady.set(true);
    });
  }
  return loadPromise;
}

/** Looks up the real elevation at exact grid cell (row, col), or null if
 * this cell isn't covered by any stored span -- i.e. it's outside the
 * sparse corridor+land grid entirely (open ocean, or real land outside
 * the totality corridor). `colSpanStart` is indexed directly by `col`
 * (it's a CSR-style pointer array, one entry per column, not something to
 * search): column `col`'s spans are exactly
 * [colSpanStart[col], colSpanStart[col + 1]) (typically 0, 1, or rarely 2
 * of them), each then checked for whether it contains `row`. */
function cellValueOrNull(row: number, col: number): number | null {
  const g = grid!;
  if (col < 0 || col >= g.cols) return null;
  const spanStart = g.colSpanStart[col];
  const spanEnd = g.colSpanStart[col + 1];
  for (let s = spanStart; s < spanEnd; s++) {
    const rowStart = g.spanRowStart[s];
    const rowCount = g.spanRowCount[s];
    if (row >= rowStart && row < rowStart + rowCount) {
      return g.elevationsM[g.spanDataOffset[s] + (row - rowStart)];
    }
  }
  return null;
}

/** Bilinear-interpolated 250m elevation at `lat`/`lon`, clamped to >=0
 * (same reasoning as data/elevation.ts's own elevationAt -- every real
 * observer stands on land). Returns null in TWO cases (see this module's
 * top-of-file comment): the grid hasn't finished loading yet, OR `lat`/
 * `lon` (or any of its 4 bilinear-interpolation corners) simply isn't
 * covered by the sparse corridor grid. Deliberately does NOT blend a
 * phantom 0 for a missing corner -- if ANY of the 4 surrounding cells has
 * no data, the whole interpolation is meaningless and this returns null
 * outright, so the caller falls back to the coarse grid instead of
 * getting a wrong answer right at the sparse/coverage boundary. Every
 * caller must treat null as "use data/elevation.ts's elevationAt()
 * instead" (stores/horizonObstruction.ts does). */
export function elevationFineAt(lat: number, lon: number): number | null {
  if (!grid) return null;
  const { latMin, lonMin, latStep, lonStep } = grid;
  const rowF = (lat - latMin) / latStep;
  const colF = (lon - lonMin) / lonStep;
  const r0 = Math.floor(rowF);
  const c0 = Math.floor(colF);
  const fr = rowF - r0;
  const fc = colF - c0;

  const v00 = cellValueOrNull(r0, c0);
  const v01 = cellValueOrNull(r0, c0 + 1);
  const v10 = cellValueOrNull(r0 + 1, c0);
  const v11 = cellValueOrNull(r0 + 1, c0 + 1);
  if (v00 === null || v01 === null || v10 === null || v11 === null) return null;

  const top = v00 + (v01 - v00) * fc;
  const bottom = v10 + (v11 - v10) * fc;
  return Math.max(0, top + (bottom - top) * fr);
}
