import { describe, expect, it } from 'vitest';
import { aux1Elements, ksiEtaToLatLon } from './ellipsoid';
import golden from '../../test/fixtures/golden-central-line.json';

describe('aux1Elements / ksiEtaToLatLon vs. eclipse-calc central-line golden cases', () => {
  for (const c of golden.cases) {
    it(`matches ${c.utc}`, () => {
      const aux = aux1Elements(c.d);
      expect(aux.rho1).toBeCloseTo(c.rho1, 9);
      expect(aux.rho2).toBeCloseTo(c.rho2, 9);
      expect(aux.sind1).toBeCloseTo(c.sind1, 9);
      expect(aux.cosd1).toBeCloseTo(c.cosd1, 9);
      expect(aux.sind1d2).toBeCloseTo(c.sind1d2, 9);
      expect(aux.cosd1d2).toBeCloseTo(c.cosd1d2, 9);

      // Central line is exactly the ksi=x, eta=y point (the shadow axis
      // itself) -- same call eclipse_calc.central_line.central_elements makes.
      const latlon = ksiEtaToLatLon(aux, c.d, c.mu0, c.x, c.y);
      expect(latlon).not.toBeNull();
      expect(latlon!.lat).toBeCloseTo(c.lat, 6);
      expect(latlon!.lon).toBeCloseTo(c.lon, 6);
    });
  }
});
