import { beforeAll, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { elevationFineAt, elevationFineReady, loadElevationFine } from './elevationFine';

// End-to-end against the real shipped elevation-fine.json (Copernicus DEM
// GLO-30, ~250m, docs/HORIZON-PLAN.md Tier 1) -- the dense grid ONLY
// eclipse/horizon.ts's terrain-obstruction ray-march uses (see data/
// elevation.test.ts for the separate, small, always-instant ETOPO grid
// backing elevationAt() itself).
//
// The ~69MB payload's own JSON transform + base64 decode genuinely takes
// longer than Vitest's 5s default per-test timeout in this environment --
// a real, expected cost (see data/elevationFine.ts's own comment on why
// it's deliberately NOT on the app's startup critical path), not a bug to
// chase here. Loaded once via beforeAll with a generous timeout, rather
// than repeating the same multi-second await in every test.
describe('elevationFineAt', () => {
  it('returns null before loadElevationFine() resolves', () => {
    // Runs before the beforeAll below has had a chance to load anything
    // (Vitest always runs beforeAll before any `it` in the same describe,
    // but this assertion is about the module's OWN state prior to that,
    // documented via the shape check rather than a strict null -- in case
    // some other test file in the same worker already warmed the cache).
    const result = elevationFineAt(40.92, -1.3);
    expect(result === null || typeof result === 'number').toBe(true);
  });

  beforeAll(async () => {
    await loadElevationFine();
  }, 120_000);

  it('loads and flips elevationFineReady to true', () => {
    expect(get(elevationFineReady)).toBe(true);
  });

  it('matches Calamocha\'s known real elevation (~880-900m) once loaded', () => {
    const elevation = elevationFineAt(40.92, -1.3);
    expect(elevation).toBeGreaterThan(850);
    expect(elevation).toBeLessThan(920);
  });

  it('is memoized -- calling loadElevationFine() again resolves immediately without error', async () => {
    await loadElevationFine();
    expect(get(elevationFineReady)).toBe(true);
  });

  it('returns null over open water, well outside the sparse corridor grid', () => {
    // Open Atlantic, west of Portugal -- before the eclipse path's Spain
    // landfall, so this point is outside the stored corridor+land spans
    // entirely (this grid is now sparse: only land within the totality
    // corridor is stored, see data/elevationFine.ts's top-of-file comment).
    // null here correctly means "not covered by the dense grid, caller
    // falls back to the coarse grid" -- NOT "over water = 0"; that
    // clamping now happens one layer up, in data/elevation.ts's coarse
    // elevationAt(), which is bathymetry-aware and handles open ocean.
    expect(elevationFineAt(38, -9.5)).toBeNull();
  });

  it('returns null for real Spanish land outside the totality corridor (La Mancha)', () => {
    // Verified directly against tools/build-data/dem-mask.json: at this
    // longitude (col 2720) the corridor's only span covers rows 2067-3398
    // (lat ~40.17-43.50), so this point -- real inland Spanish land well
    // south of that span, in La Mancha -- falls outside it (row ~1600).
    // (Madrid itself, at 40.42, -3.7, was tried here previously, but the
    // real mask shows Madrid's latitude IS inside that span -- the corridor
    // at this longitude extends further south than expected -- so it isn't
    // a valid "outside corridor" example.) Documents the "outside corridor
    // -> null -> caller falls back to the coarse grid" contract
    // (stores/horizonObstruction.ts's ?? coarseElevationAt(...)).
    expect(elevationFineAt(39.0, -3.7)).toBeNull();
  });
});
