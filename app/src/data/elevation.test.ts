import { describe, expect, it } from 'vitest';
import { elevationAt, isWithinElevationBounds } from './elevation';

// End-to-end against the real shipped elevation.json (ETOPO 2022, resampled
// to its own native ~1.4-1.9km -- docs/HORIZON-PLAN.md's "Tier 0.5") -- not
// just a schema check. Values cross-checked against this project's own
// known real-world references (the Calamocha default site's long-
// established ~880-900m; the other preset sites' plausible real
// elevations). This is deliberately the SMALL grid backing elevationAt()
// itself (the location picker's instant display) -- see data/
// elevationFine.test.ts for the separate, much denser Copernicus DEM grid
// that eclipse/horizon.ts's terrain-obstruction ray-march uses instead.
describe('elevationAt against the real bundled ETOPO grid', () => {
  it('matches Calamocha\'s known real elevation (~880-900m)', () => {
    const elevation = elevationAt(40.92, -1.3);
    expect(elevation).toBeGreaterThan(850);
    expect(elevation).toBeLessThan(920);
  });

  it('gives low elevations for real coastal preset sites', () => {
    for (const [lat, lon] of [
      [43.37, -8.4], // A Coruna
      [43.46, -3.8], // Santander
      [43.26, -2.93], // Bilbao
      [39.47, -0.38], // Valencia
      [39.57, 2.65], // Palma de Mallorca
    ]) {
      expect(elevationAt(lat, lon)).toBeLessThan(100);
    }
  });

  it('never returns a negative elevation, even over open water', () => {
    // Open Atlantic, well outside any coastline -- the underlying land-only
    // DEM has no data at all here (see NOTICE.md's own note on why that's
    // fine for this app's purposes); the clamp must still hold.
    expect(elevationAt(38, -9.5)).toBeGreaterThanOrEqual(0);
  });
});

describe('isWithinElevationBounds', () => {
  it('is true for Calamocha (well inside the bundled bbox)', () => {
    expect(isWithinElevationBounds(40.92, -1.3)).toBe(true);
  });

  it('is false well outside the bundled bbox', () => {
    expect(isWithinElevationBounds(0, 0)).toBe(false);
    expect(isWithinElevationBounds(60, 20)).toBe(false);
  });
});
