// Typed wrapper around elevation.json -- a bundled offline elevation-above-
// sea-level grid (ETOPO 2022, see NOTICE.md), so setObserver() can look up
// a real ground elevation for any manually-entered or map-dragged location
// instead of the previous hardcoded 0.
import elevationData from './elevation.json';

const { latMin, lonMin, latStep, lonStep, rows, cols, elevationsM } = elevationData;

function cellValue(row: number, col: number): number {
  const r = Math.min(rows - 1, Math.max(0, row));
  const c = Math.min(cols - 1, Math.max(0, col));
  return elevationsM[r * cols + c];
}

/** Ground-level elevation above sea level, in meters, at `lat`/`lon` --
 * bilinear interpolation over the bundled ETOPO 2022 grid, clamped to
 * >=0. The clamp isn't about the source data's own sea/land split (it's
 * correctly bathymetry-aware, negative offshore) -- it's that every real
 * observer using this app stands on land, so a query that lands exactly
 * on or near a coastline should never report a "the observer is
 * underwater" result just because the coarse grid's nearest interpolation
 * corners happen to dip into the sea. Coordinates outside the bundled
 * Iberia/western-Mediterranean bbox clamp to the nearest edge cell rather
 * than extrapolating. Ground-level only -- not meant for anything
 * airborne. */
export function elevationAt(lat: number, lon: number): number {
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
  const value = top + (bottom - top) * fr;

  return Math.max(0, value);
}
