// Validates the actual shipped basemap file (not a copy) decodes correctly
// and covers the expected extent -- using topojson-client, the same
// library the real map rendering will use (PLAN.md Sec2 stack decision).

import { describe, expect, it } from 'vitest';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import basemap from './basemap.topojson';

describe('basemap.topojson', () => {
  it('is a valid topology with the expected layers', () => {
    expect(basemap.type).toBe('Topology');
    expect(Object.keys(basemap.objects)).toEqual(['countries', 'land']);
  });

  it('decodes to GeoJSON covering Spain, Portugal, France, and neighbors', () => {
    const topology = basemap as unknown as Topology;
    const countries = feature<{ name: string }>(
      topology,
      topology.objects.countries as GeometryCollection<{ name: string }>,
    );
    const names = countries.features.map((f) => f.properties?.name).sort();
    // Widened from Iberia-only (which cut off right at the Pyrenees) to
    // include all of mainland France -- pulls in France's own neighbors
    // (and the Channel Islands) too, not just Spain/Portugal's.
    expect(names).toEqual([
      'Algeria',
      'Andorra',
      'Belgium',
      'France',
      'Germany',
      'Guernsey',
      'Ireland',
      'Italy',
      'Jersey',
      'Liechtenstein',
      'Luxembourg',
      'Monaco',
      'Morocco',
      'Netherlands',
      'Portugal',
      'Spain',
      'Switzerland',
      'Tunisia',
      'United Kingdom',
    ]);

    const spain = countries.features.find((f) => f.properties?.name === 'Spain')!;
    const coords: number[][] = [];
    (function flatten(a: unknown) {
      if (Array.isArray(a) && typeof a[0] === 'number') coords.push(a as number[]);
      else if (Array.isArray(a)) a.forEach(flatten);
    })((spain.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon).coordinates);

    const lons = coords.map((c) => c[0]);
    const lats = coords.map((c) => c[1]);
    // Mainland Spain's real extent is roughly lon -9.3..3.3, lat 36..43.8.
    expect(Math.min(...lons)).toBeGreaterThan(-10);
    expect(Math.max(...lons)).toBeLessThan(5);
    expect(Math.min(...lats)).toBeGreaterThan(35.5);
    expect(Math.max(...lats)).toBeLessThan(44.5);
  });
});
