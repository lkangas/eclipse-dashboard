import { describe, expect, it } from 'vitest';
import { evaluateDerivatives, evaluateElements, type BesselianCoefficients } from './elements';
import golden from '../../test/fixtures/golden-elements.json';

const coefficients = golden.coefficients as unknown as BesselianCoefficients;
const ELEMENT_KEYS = ['x', 'y', 'd', 'mu0', 'l1', 'l2', 'tanf1', 'tanf2'] as const;

describe('evaluateElements vs. eclipse-calc golden samples', () => {
  for (const sample of golden.samples) {
    it(`matches at t=${sample.t_hours_from_t0}h`, () => {
      const result = evaluateElements(coefficients, sample.t_hours_from_t0);
      for (const key of ELEMENT_KEYS) {
        expect(result[key]).toBeCloseTo(sample[key], 12);
      }
    });
  }
});

describe('evaluateDerivatives vs. eclipse-calc golden samples', () => {
  for (const sample of golden.samples) {
    it(`matches at t=${sample.t_hours_from_t0}h`, () => {
      const result = evaluateDerivatives(coefficients, sample.t_hours_from_t0);
      for (const key of ELEMENT_KEYS) {
        expect(result[key]).toBeCloseTo(sample[`d_${key}` as keyof typeof sample] as number, 10);
      }
    });
  }
});
