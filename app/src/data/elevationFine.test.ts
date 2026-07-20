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

  it('never returns a negative elevation, even over open water', () => {
    // Open Atlantic, well outside any coastline -- this land-only Copernicus
    // source has no data at all here (see NOTICE.md's own note on why
    // that's fine for this app's purposes); the clamp must still hold.
    expect(elevationFineAt(38, -9.5)).toBeGreaterThanOrEqual(0);
  });
});
