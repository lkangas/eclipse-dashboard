// The umbral shadow's instantaneous footprint polygon on Earth's surface
// (PLAN.md Sec4/Sec8) -- distinct from the central line / N-S umbral
// limits (shadow-frames.json, precomputed at build time): this is a
// function of "right now", evaluated client-side once per clock tick,
// the same way localCircumstances.ts's contact-time search already runs
// per-observer, on demand, rather than being precomputed. Evaluating one
// instant is cheap (a handful of trig ops per boundary point, ~60
// points), so there's no reason to store a pre-sampled time series.
//
// Ported from eclipse_calc.shadow.shadow_outlines (umbra=True) and the
// aux1_elements/ksieta_to_latlon helpers it depends on
// (eclipse_calc.ellipsoid) -- previously lived as shadowOutlineAt in the
// since-deleted app/src/eclipse/path.ts + ellipsoid.ts (commit
// 175a974dbb1e8081f3918080c9b2b97861e203eb), revived here as a narrower,
// single-purpose module now that centralLineAt/shadowLimitsAt correctly
// stay precomputed instead.

import { evaluateElements, type BesselianCoefficients } from './elements';
import { E2, F } from './constants';

interface Aux1Elements {
  rho1: number;
  rho2: number;
  sind1: number;
  cosd1: number;
  sind1d2: number;
  cosd1d2: number;
}

/** Earth-flattening-dependent quantities that depend only on the shadow
 * axis's declination `dDeg`. Ported from eclipse_calc.ellipsoid.aux1_elements. */
function aux1Elements(dDeg: number): Aux1Elements {
  const dRad = (dDeg * Math.PI) / 180;
  const sind = Math.sin(dRad);
  const cosd = Math.cos(dRad);

  const rho1 = Math.sqrt(1 - E2 * cosd ** 2);
  const rho2 = Math.sqrt(1 - E2 * sind ** 2);

  const sind1 = sind / rho1;
  const cosd1 = (Math.sqrt(1 - E2) * cosd) / rho1;
  const sind1d2 = (E2 * sind * cosd) / rho1 / rho2;
  const cosd1d2 = Math.sqrt(1 - E2) / rho1 / rho2;

  return { rho1, rho2, sind1, cosd1, sind1d2, cosd1d2 };
}

/** Wraps `deg` into [-180, 180). JS's `%` keeps the dividend's sign
 * (unlike Python's, which always matches the divisor's), hence the extra
 * `+360, %360` rather than a direct port of the Python one-liner. */
function wrapLongitude(deg: number): number {
  const shifted = deg + 180;
  const wrapped = ((shifted % 360) + 360) % 360;
  return wrapped - 180;
}

interface LatLon {
  lat: number; // degrees
  lon: number; // degrees
}

/** Converts a fundamental-plane ksi/eta position to lat/lon, by
 * intersecting the shadow axis at that offset with the WGS84 ellipsoid.
 * Returns null when `ksi`/`eta` don't lie on the ellipsoid -- the
 * geometric equivalent of eclipse_calc's NaN result there (e.g. the
 * swept point falls outside Earth's visible disk, expected near the
 * edges of the event, not an error). Ported from
 * eclipse_calc.ellipsoid.ksieta_to_latlon (`terminator=False` path). */
function ksiEtaToLatLon(
  aux: Aux1Elements,
  dDeg: number,
  mu0Deg: number,
  ksi: number,
  eta: number,
): LatLon | null {
  const { rho1, rho2, sind1, cosd1, sind1d2, cosd1d2 } = aux;

  const eta1 = eta / rho1;
  const radical = 1 - ksi ** 2 - eta1 ** 2;
  // `!(radical >= 0)` rather than `radical < 0`: NaN compares false
  // either way, so `radical < 0` silently lets a NaN radical (ksi/eta
  // already NaN going in, e.g. from pointAt's iteration below having
  // dipped negative mid-loop) fall through into Math.sqrt(NaN), instead
  // of being caught here -- producing a non-null {lat: NaN, lon: NaN}
  // that corrupts the rendered polygon on whichever frame happens to
  // hit it (this was the actual cause of a reported flicker near the
  // terminator: intermittent, since which of the ~60 sample angles
  // triggers it shifts frame to frame as the geometry moves).
  if (!(radical >= 0)) return null;
  const zeta1 = Math.sqrt(radical);
  const zeta = rho2 * (zeta1 * cosd1d2 - eta1 * sind1d2);

  const phi1 = Math.asin(eta1 * cosd1 + zeta1 * sind1);
  const cosPhi1 = Math.cos(phi1);
  const sinTheta = ksi / cosPhi1;
  const cosTheta = (-eta1 * sind1 + zeta1 * cosd1) / cosPhi1;
  const theta = Math.atan2(sinTheta, cosTheta);

  const phi = Math.atan(Math.tan(phi1) / (1 - F));

  const thetaDeg = (theta * 180) / Math.PI;
  const latDeg = (phi * 180) / Math.PI;
  const lonDeg = wrapLongitude(thetaDeg - mu0Deg);

  return { lat: latDeg, lon: lonDeg };
}

/** Lat/lon of a point already known to sit exactly on the day/night
 * terminator (zeta = 0), skipping the ellipsoid-intersection sqrt
 * entirely -- the ksi/eta-plane analog of
 * eclipse_calc.ellipsoid.ksieta_to_latlon's `terminator=True` path.
 * Used only for the bisected crossing points below, where `radical` is
 * ~0 up to bisection tolerance and could occasionally land a hair
 * negative from floating point, which the regular sqrt path would
 * reject. */
function terminatorLatLon(aux: Aux1Elements, dDeg: number, mu0Deg: number, ksi: number, eta: number): LatLon {
  const { rho1, sind1, cosd1 } = aux;
  const eta1 = eta / rho1;

  const phi1 = Math.asin(eta1 * cosd1);
  const cosPhi1 = Math.cos(phi1);
  const sinTheta = ksi / cosPhi1;
  const cosTheta = (-eta1 * sind1) / cosPhi1;
  const theta = Math.atan2(sinTheta, cosTheta);

  const phi = Math.atan(Math.tan(phi1) / (1 - F));

  const thetaDeg = (theta * 180) / Math.PI;
  const latDeg = (phi * 180) / Math.PI;
  const lonDeg = wrapLongitude(thetaDeg - mu0Deg);

  return { lat: latDeg, lon: lonDeg };
}

export interface ShadowOutlinePoint extends LatLon {
  qDeg: number;
}

const TERMINATOR_ARC_SEGMENTS = 16;

/** Points strictly between `a` and `b` along the great-circle arc joining
 * them (endpoints excluded), evenly spaced by central angle. Used to
 * bridge a terminator-crossing pair: the day/night terminator itself is
 * (to excellent approximation) a great circle, so this is a much closer
 * stand-in for "the boundary between where the outline exits and
 * re-enters the visible disk" than the straight chord a plain polygon
 * would otherwise draw between the two crossing points. */
function greatCircleInterpolate(a: LatLon, b: LatLon, segments: number): LatLon[] {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const phi1 = a.lat * toRad,
    lam1 = a.lon * toRad;
  const phi2 = b.lat * toRad,
    lam2 = b.lon * toRad;
  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((phi2 - phi1) / 2) ** 2 +
          Math.cos(phi1) * Math.cos(phi2) * Math.sin((lam2 - lam1) / 2) ** 2,
      ),
    );
  if (d < 1e-9) return [];
  const points: LatLon[] = [];
  for (let i = 1; i < segments; i++) {
    const f = i / segments;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(phi1) * Math.cos(lam1) + B * Math.cos(phi2) * Math.cos(lam2);
    const y = A * Math.cos(phi1) * Math.sin(lam1) + B * Math.cos(phi2) * Math.sin(lam2);
    const z = A * Math.sin(phi1) + B * Math.sin(phi2);
    points.push({
      lat: Math.atan2(z, Math.sqrt(x * x + y * y)) * toDeg,
      lon: Math.atan2(y, x) * toDeg,
    });
  }
  return points;
}

/** The umbral or penumbral shadow footprint polygon at `tHoursFromT0`:
 * `points` evenly-spaced positions around the shadow-cone circle in the
 * fundamental plane (closed implicitly -- SVG `<polygon>` already joins
 * last back to first), plus, wherever the visible-disk boundary is
 * crossed, a bisected exit/entry point pair bridged by points along the
 * great-circle arc between them (`greatCircleInterpolate` -- a close
 * approximation of the day/night terminator itself, standing in for the
 * off-disk arc that was skipped) rather than a straight chord across
 * the gap. Ported from eclipse_calc.shadow.shadow_outlines -- `kind`
 * selects umbra=True (l2/tanf2, PLAN.md Sec4) vs umbra=False (l1/tanf1,
 * the penumbral cone, PLAN.md Sec8's Global map need); the rest of the
 * geometry (which only depends on the shadow axis's declination/hour
 * angle, not which cone) is identical either way. */
export function shadowOutlineAt(
  coefficients: BesselianCoefficients,
  tHoursFromT0: number,
  points = 60,
  kind: 'umbra' | 'penumbra' = 'umbra',
): ShadowOutlinePoint[] {
  const el = evaluateElements(coefficients, tHoursFromT0);
  const aux = aux1Elements(el.d);
  const L = kind === 'umbra' ? el.l2 : el.l1;
  const tanF = kind === 'umbra' ? el.tanf2 : el.tanf1;

  // The un-iterated (zeta=0) first-guess ksi/eta at angle q, and how far
  // it sits from the visible-disk boundary (>=0 inside, <0 outside).
  // Used both as the starting point for the fixed-point iteration in
  // `pointAt` and as a smooth, always-finite function of q to bisect --
  // the zeta-feedback correction to the shadow radius is small (a few
  // km), so right at a crossing (margin ~ 0) the un-iterated and
  // converged ksi/eta already agree; no need to run the iteration into
  // the invalid region where it would blow up to NaN. Mirrors
  // generate_shadow_frames.py's central-line terminator root-find, which
  // roots on the same kind of un-iterated margin.
  function marginAt(q: number): { ksi: number; eta: number; margin: number } {
    const ksi = el.x - L * Math.sin(q);
    const eta = el.y - L * Math.cos(q);
    const eta1 = eta / aux.rho1;
    return { ksi, eta, margin: 1 - ksi * ksi - eta1 * eta1 };
  }

  function pointAt(q: number): ShadowOutlinePoint | null {
    const sinQ = Math.sin(q);
    const cosQ = Math.cos(q);

    let ksi = el.x - L * sinQ;
    let eta = el.y - L * cosQ;
    let eta1 = eta / aux.rho1;
    let zeta1 = Math.sqrt(1 - ksi ** 2 - eta1 ** 2); // NaN off-ellipse, matching eclipse-calc
    let zeta = aux.rho2 * (zeta1 * aux.cosd1d2 - eta1 * aux.sind1d2);
    let shadowRadius = L - zeta * tanF;

    for (let iter = 0; iter < 10; iter++) {
      ksi = el.x - shadowRadius * sinQ;
      eta = el.y - shadowRadius * cosQ;
      eta1 = eta / aux.rho1;
      zeta1 = Math.sqrt(1 - ksi ** 2 - eta1 ** 2);
      // `marginAt`'s un-iterated (zeta=0) first guess can say a q is
      // "inside" while this iteration's own (slightly different, zeta-
      // corrected) shadow radius pushes it just past the ellipsoid edge
      // -- without this check, zeta1 goes NaN here, propagates silently
      // through the rest of the loop (the break condition below never
      // fires, since NaN comparisons are always false), and used to
      // reach ksiEtaToLatLon as NaN ksi/eta. Bailing out cleanly here
      // makes this q correctly count as invalid instead.
      if (!Number.isFinite(zeta1)) return null;

      const prevZeta = zeta;
      zeta = aux.rho2 * (zeta1 * aux.cosd1d2 - eta1 * aux.sind1d2);
      if (Math.abs(prevZeta - zeta) < 1e-8) break;
      shadowRadius = L - zeta * tanF;
    }

    const latlon = ksiEtaToLatLon(aux, el.d, el.mu0, ksi, eta);
    return latlon ? { ...latlon, qDeg: (q * 180) / Math.PI } : null;
  }

  // Exact terminator crossing between two angles known to straddle the
  // disk boundary (opposite-signed `marginAt`), by plain bisection --
  // cheap (fixed ~25 iterations) and robust, unlike Newton here since
  // margin(q) isn't smooth in a way that's easy to differentiate near
  // the boundary. Same spirit as generate_shadow_frames.py's brentq
  // root-finds for the central line/N-S limits' terminator endpoints,
  // just a 1D bisection over a parametric angle instead of over time.
  function terminatorCrossing(qLo: number, qHi: number): ShadowOutlinePoint {
    let lo = qLo;
    let hi = qHi;
    let marginLo = marginAt(lo).margin;
    for (let i = 0; i < 25; i++) {
      const mid = (lo + hi) / 2;
      const marginMid = marginAt(mid).margin;
      if (Math.sign(marginMid) === Math.sign(marginLo)) {
        lo = mid;
        marginLo = marginMid;
      } else {
        hi = mid;
      }
    }
    const q = (lo + hi) / 2;
    const { ksi, eta } = marginAt(q);
    const latlon = terminatorLatLon(aux, el.d, el.mu0, ksi, eta);
    return { ...latlon, qDeg: (q * 180) / Math.PI };
  }

  // Validity is decided by pointAt's own (fully-converged) result, not
  // marginAt's cheaper un-iterated approximation -- they usually agree,
  // but marginAt can say "inside" for a q where the converged iteration
  // still lands just outside the ellipsoid (see pointAt's own comment).
  // Using pointAt as the source of truth means that disagreement can
  // only ever *shrink* the visible arc (never produce a bad point), and
  // still correctly triggers a bisected terminator-crossing insertion
  // right where it actually happens, rather than silently leaving a gap
  // with no crossing point bridging it. marginAt is still what the
  // bisection itself roots on (terminatorCrossing, above) -- cheap and
  // fine for that, since it only needs to locate the boundary to
  // display precision, not decide per-sample validity.
  const step = (2 * Math.PI) / points;
  const baseSamples: { q: number; valid: boolean; point: ShadowOutlinePoint | null }[] = [];
  for (let i = 0; i < points; i++) {
    const q = i * step;
    const p = pointAt(q);
    baseSamples.push({ q, valid: p !== null, point: p });
  }

  if (baseSamples.every((s) => !s.valid)) return [];
  if (baseSamples.every((s) => s.valid)) {
    const ring = baseSamples.map((s) => s.point!);
    ring.push({ ...baseSamples[0].point!, qDeg: 360 });
    return ring;
  }

  // At least one crossing exists. Re-sweep starting right at the
  // beginning of an off-disk run (found on the samples above), letting q
  // climb monotonically past 2*pi instead of wrapping back to 0 --
  // pointAt/marginAt are periodic in q (plain sin/cos), so this is just
  // as valid as the original [0, 2pi) samples, but avoids ever having to
  // bisect across the awkward 2pi/0 seam (naive index-wrapping there
  // would average the two angles the WRONG way around the circle). The
  // first element is the last valid sample before the run (needed to
  // detect and bisect that first exit); the sweep then covers each of
  // the `points` original samples exactly once, in rotated order.
  const startIdx = baseSamples.findIndex(
    (s, i) => !s.valid && baseSamples[(i - 1 + points) % points].valid,
  );
  const startQ = baseSamples[startIdx].q;
  const sweep: { q: number; valid: boolean; point: ShadowOutlinePoint | null }[] = [];
  for (let k = -1; k < points; k++) {
    const q = startQ + k * step;
    const p = pointAt(q);
    sweep.push({ q, valid: p !== null, point: p });
  }

  const result: ShadowOutlinePoint[] = [];
  let pendingExit: ShadowOutlinePoint | null = null;
  for (let j = 1; j < sweep.length; j++) {
    const prev = sweep[j - 1];
    const s = sweep[j];
    if (s.valid !== prev.valid) {
      if (prev.valid) {
        const exit = terminatorCrossing(prev.q, s.q);
        result.push(exit);
        pendingExit = exit;
      } else {
        const entry = terminatorCrossing(s.q, prev.q);
        if (pendingExit) {
          for (const mid of greatCircleInterpolate(pendingExit, entry, TERMINATOR_ARC_SEGMENTS)) {
            result.push({ ...mid, qDeg: NaN });
          }
        }
        result.push(entry);
        pendingExit = null;
      }
    }
    if (s.valid) result.push(s.point!);
  }

  return result;
}
