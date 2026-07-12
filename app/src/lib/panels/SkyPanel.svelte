<script lang="ts">
  // All-sky (dome, PLAN.md §7): full hemisphere, alt-az, real Sun/Moon/
  // stars/planets from stores/skyView.ts. Mirrored left-right relative
  // to a normal ground map (direct request) -- a naked-eye "lying on
  // your back looking up" sky chart needs the OPPOSITE chirality from a
  // "looking down at a map" one: East has to land on the LEFT when North
  // is at top, not the right, for the dome to actually match the real
  // sky rather than just a flipped copy of it. See domePos() below.
  // Sun/Moon rendered filled, no stroke -- Sun #f6c445, Moon #000000,
  // same convention CountdownPanel already uses (direct request),
  // replacing the flat monochrome-outline treatment used here before.
  //
  // Wide view: a real alt-az tangent-plane projection centered on the
  // camera's own boresight, sized around the actual ASI294MC + 50mm lens
  // FOV (direct request) -- see the camera constants below. Shows the
  // Sun's real path from C1 down to sunset as a dashed line (C1/C2/C3
  // marked along it -- C4 excluded on purpose: for the default observer
  // it falls after sunset, i.e. already below the horizon, so it was
  // never going to land on a visible path anyway), the real horizon, and
  // any star/planet within the (slightly-wider-than-camera) view.
  // Framing margins are temporary $state + a slider panel (same pattern
  // as the Global map's earlier margin tuning, see git history) --
  // meant to be interactively picked once, then locked into plain
  // constants and the panel removed.
  import { skyView, sunAltAzAt, type AltAz } from '../../stores/skyView';
  import { localCircumstances } from '../../stores/localCircumstances';
  import { observer } from '../../stores/observer';

  let tab: 'wide' | 'allsky' = $state('wide');

  const PLANET_MAG_LIMIT = 3;

  function brightRadius(mag: number): number {
    return Math.max(0.4, 1.8 - mag * 0.5);
  }

  // ---------- All-sky (dome) ----------
  const allCx = 100,
    allCy = 100,
    allR = 88;

  // 90deg alt (zenith) -> center; 0deg (horizon) -> dome edge. Subtracts
  // (not adds) the sin term -- see the file-level comment above for why
  // this chirality, not the map-like one the dome used before, is the
  // one that matches the real naked-eye sky. Cardinal labels in the
  // template below are swapped E<->W position to match.
  function domePos(altitude: number, azimuth: number): [number, number] {
    const azRad = (azimuth * Math.PI) / 180;
    const objR = allR * (1 - altitude / 90);
    return [allCx - objR * Math.sin(azRad), allCy - objR * Math.cos(azRad)];
  }

  const allSun = $derived($skyView.sun);
  const allMoon = $derived($skyView.moon);
  const allSunXY = $derived(domePos(allSun.altitude, allSun.azimuth));
  const allMoonXY = $derived(domePos(allMoon.altitude, allMoon.azimuth));
  const allStars = $derived(
    $skyView.stars
      .filter((s) => s.altitude > 0)
      .map((s) => ({ ...s, xy: domePos(s.altitude, s.azimuth), r: brightRadius(s.mag) })),
  );
  const allPlanets = $derived(
    $skyView.planets
      .filter((p) => p.altitude > 0 && p.mag < PLANET_MAG_LIMIT)
      .map((p) => ({ ...p, xy: domePos(p.altitude, p.azimuth), r: brightRadius(p.mag) })),
  );

  // Traditional constellation lines (direct request), All-sky only --
  // split into contiguous above-horizon runs rather than one path per
  // constellation, so a line dipping below the horizon breaks cleanly
  // instead of jumping straight across the gap. Deliberately very dim
  // (see .constline below): a fair number of these points are fainter
  // than the mag<3 cutoff above and have no star dot of their own, so a
  // bold line would look like it's connecting to nothing.
  function aboveHorizonRuns(points: AltAz[]): [number, number][][] {
    const runs: [number, number][][] = [];
    let current: [number, number][] = [];
    for (const p of points) {
      if (p.altitude > 0) {
        current.push(domePos(p.altitude, p.azimuth));
      } else if (current.length > 0) {
        runs.push(current);
        current = [];
      }
    }
    if (current.length > 0) runs.push(current);
    return runs;
  }
  const allConstellationRuns = $derived(
    $skyView.constellationLines.flatMap((line) => aboveHorizonRuns(line.points)).filter((r) => r.length >= 2),
  );

  // ---------- Wide (camera framing) ----------

  // Real ASI294MC (Four Thirds, 4144x2822 active px, 4.63um pixels) +
  // 50mm lens FOV, portrait-mounted (direct request, confirmed against
  // the real C1->sunset Sun path for the default Calamocha observer:
  // landscape's ~14.9deg vertical FOV is shorter than the 16.3deg
  // altitude drop across that window; portrait's ~21.6deg vertical
  // comfortably fits it, and its ~14.9deg horizontal just fits the
  // 14.6deg azimuth drift).
  const ASI294MC_LONG_MM = 4144 * 0.00463;
  const ASI294MC_SHORT_MM = 2822 * 0.00463;
  const LENS_FOCAL_LENGTH_MM = 50;
  const CAMERA_FOV_H_DEG =
    2 * Math.atan(ASI294MC_SHORT_MM / 2 / LENS_FOCAL_LENGTH_MM) * (180 / Math.PI);
  const CAMERA_FOV_V_DEG =
    2 * Math.atan(ASI294MC_LONG_MM / 2 / LENS_FOCAL_LENGTH_MM) * (180 / Math.PI);

  // TEMPORARY TUNING STATE (direct request) -- extra margin beyond the
  // camera's own real FOV box, in degrees, on each side. "How much
  // horizon is visible" is mainly the BOTTOM margin (extra ground/sky
  // context below the real crop); side/top are mostly breathing room
  // around the dashed FOV-box overlay. Once final numbers are picked
  // these go back to plain constants and the slider panel comes out
  // (same pattern as the Global map's margin tuning, see git history).
  let wideSideMarginDeg = $state(3);
  let wideTopMarginDeg = $state(3);
  let wideBottomMarginDeg = $state(6);

  const WIDE_PX_PER_DEG = 10;
  const viewWDeg = $derived(CAMERA_FOV_H_DEG + 2 * wideSideMarginDeg);
  const viewHDeg = $derived(CAMERA_FOV_V_DEG + wideTopMarginDeg + wideBottomMarginDeg);
  const wideVW = $derived(viewWDeg * WIDE_PX_PER_DEG);
  const wideVH = $derived(viewHDeg * WIDE_PX_PER_DEG);
  // The boresight's own pixel position -- also the FOV box's center.
  const wideCx = $derived(wideVW / 2);
  const wideCy = $derived(
    wideTopMarginDeg * WIDE_PX_PER_DEG + (CAMERA_FOV_V_DEG * WIDE_PX_PER_DEG) / 2,
  );

  // Camera boresight: the midpoint (in az/alt) of the Sun's path from C1
  // to sunset for the CURRENT observer (reactive -- not locked to
  // Calamocha specifically, so dragging the observer marker elsewhere
  // re-aims the "camera" at that location's own descent). Falls back to
  // `max` at either end if C1/sunset aren't available (e.g. an observer
  // with no visible partial phase from this spot), rather than crashing.
  const boresight: AltAz = $derived.by(() => {
    const lc = $localCircumstances;
    const obs = $observer;
    const startDate = lc.c1 ?? lc.max;
    const endDate = lc.sunset ?? lc.max;
    const start = sunAltAzAt(startDate, obs.lat, obs.lon, obs.elevationM);
    const end = sunAltAzAt(endDate, obs.lat, obs.lon, obs.elevationM);
    let dAz = end.azimuth - start.azimuth;
    if (dAz > 180) dAz -= 360;
    if (dAz < -180) dAz += 360;
    return { altitude: (start.altitude + end.altitude) / 2, azimuth: start.azimuth + dAz / 2 };
  });

  // Tangent-plane offset from the boresight, in degrees -- azimuth
  // compressed by cos(altitude), the same convention CountdownPanel's
  // own schematic offset already uses (accurate enough at these
  // sub-25deg scales). Unlike the dome above, this is a first-person
  // "facing that direction" view, not a whole-sky map, so azimuth
  // increasing = further right is the CORRECT (non-mirrored) chirality
  // here -- turning your gaze clockwise really does move rightward.
  function widePos(altitude: number, azimuth: number): [number, number] {
    const boreAltRad = (boresight.altitude * Math.PI) / 180;
    let dAz = azimuth - boresight.azimuth;
    if (dAz > 180) dAz -= 360;
    if (dAz < -180) dAz += 360;
    const dxDeg = dAz * Math.cos(boreAltRad);
    const dyDeg = altitude - boresight.altitude;
    return [wideCx + dxDeg * WIDE_PX_PER_DEG, wideCy - dyDeg * WIDE_PX_PER_DEG];
  }

  // The real camera crop, centered on the boresight.
  const fovBoxX = $derived(wideCx - (CAMERA_FOV_H_DEG * WIDE_PX_PER_DEG) / 2);
  const fovBoxY = $derived(wideCy - (CAMERA_FOV_V_DEG * WIDE_PX_PER_DEG) / 2);
  const fovBoxW = $derived(CAMERA_FOV_H_DEG * WIDE_PX_PER_DEG);
  const fovBoxH = $derived(CAMERA_FOV_V_DEG * WIDE_PX_PER_DEG);

  // Horizon line: altitude=0 at the boresight's own azimuth. Technically
  // a small circle, not a straight line, in true alt-az terms -- but at
  // these sub-25deg scales the curvature is far below what this flat,
  // schematic view needs (same tangent-plane approximation as
  // everywhere else here).
  const horizonY = $derived(wideCy + boresight.altitude * WIDE_PX_PER_DEG);
  const GROUND_EXTENT = 1000;

  // The Sun's real path from C1 to sunset -- a STATIC reference path for
  // the whole event (like the map's precomputed central line), not a
  // "from now" live line, so it doesn't depend on effectiveTime at all.
  // Empty if either end is missing (no visible partial phase here).
  const SUN_PATH_SAMPLES = 40;
  const sunPathXY: [number, number][] = $derived.by(() => {
    const lc = $localCircumstances;
    const obs = $observer;
    if (!lc.c1 || !lc.sunset) return [];
    const t0 = lc.c1.getTime();
    const t1 = lc.sunset.getTime();
    const pts: [number, number][] = [];
    for (let i = 0; i <= SUN_PATH_SAMPLES; i++) {
      const t = t0 + ((t1 - t0) * i) / SUN_PATH_SAMPLES;
      const altAz = sunAltAzAt(new Date(t), obs.lat, obs.lon, obs.elevationM);
      pts.push(widePos(altAz.altitude, altAz.azimuth));
    }
    return pts;
  });

  const CONTACT_MARKERS = [
    { key: 'c1', label: 'C1' },
    { key: 'c2', label: 'C2' },
    { key: 'c3', label: 'C3' },
  ] as const;
  const contactMarks = $derived.by(() => {
    const lc = $localCircumstances;
    const obs = $observer;
    return CONTACT_MARKERS.map(({ key, label }) => {
      const date = lc[key];
      if (!date) return null;
      const altAz = sunAltAzAt(date, obs.lat, obs.lon, obs.elevationM);
      const [x, y] = widePos(altAz.altitude, altAz.azimuth);
      return { key, label, x, y };
    }).filter((m): m is { key: 'c1' | 'c2' | 'c3'; label: 'C1' | 'C2' | 'C3'; x: number; y: number } => m !== null);
  });

  // Sun/Moon at effectiveTime (live/sim clock) -- same skyView values
  // the other panels use, projected into this view's tangent plane
  // instead of the dome's polar one. Real angular size (via the same
  // deg-per-pixel scale as everything else), with a small readability
  // floor -- true size alone would be only 2-3px here, easy to miss.
  const wideSun = $derived($skyView.sun);
  const wideMoon = $derived($skyView.moon);
  const wideSunXY = $derived(widePos(wideSun.altitude, wideSun.azimuth));
  const wideMoonXY = $derived(widePos(wideMoon.altitude, wideMoon.azimuth));
  const SUN_MOON_MIN_R_PX = 2.5;
  const wideSunR = $derived(Math.max(SUN_MOON_MIN_R_PX, wideSun.angularRadiusDeg * WIDE_PX_PER_DEG));
  const wideMoonR = $derived(
    Math.max(SUN_MOON_MIN_R_PX, wideMoon.angularRadiusDeg * WIDE_PX_PER_DEG),
  );

  // Bright objects (stars + planets) anywhere within the (slightly-
  // wider-than-camera) view -- not just within the dashed FOV box itself
  // (direct request: "any bright objects visible within the view").
  function withinView(x: number, y: number): boolean {
    return x >= 0 && x <= wideVW && y >= 0 && y <= wideVH;
  }
  const wideStars = $derived(
    $skyView.stars
      .map((s) => ({ ...s, xy: widePos(s.altitude, s.azimuth) }))
      .filter((s) => withinView(s.xy[0], s.xy[1]))
      .map((s) => ({ ...s, r: brightRadius(s.mag) })),
  );
  const widePlanets = $derived(
    $skyView.planets
      .filter((p) => p.mag < PLANET_MAG_LIMIT)
      .map((p) => ({ ...p, xy: widePos(p.altitude, p.azimuth) }))
      .filter((p) => withinView(p.xy[0], p.xy[1]))
      .map((p) => ({ ...p, r: brightRadius(p.mag) })),
  );
</script>

<div class="skywrap">
  <div class="tabs">
    <button class:on={tab === 'wide'} onclick={() => (tab = 'wide')}>Wide</button>
    <button class:on={tab === 'allsky'} onclick={() => (tab = 'allsky')}>All-sky</button>
  </div>
  <div class="skyzone">
    <svg
      viewBox="0 0 {wideVW} {wideVH}"
      preserveAspectRatio="xMidYMid meet"
      style:display={tab === 'wide' ? 'block' : 'none'}
    >
      {#if sunPathXY.length > 1}
        <polyline class="sunpath" points={sunPathXY.map((p) => p.join(',')).join(' ')} />
      {/if}
      {#each contactMarks as m (m.key)}
        <circle class="contactmark" cx={m.x} cy={m.y} r="2" />
        <text class="contactlabel" x={m.x} y={m.y - 5}>{m.label}</text>
      {/each}
      {#each wideStars as star (star.proper ?? star.xy.join(','))}
        <circle class="skystar" cx={star.xy[0]} cy={star.xy[1]} r={star.r} />
      {/each}
      {#each widePlanets as p (p.name)}
        <circle class="planetmark" cx={p.xy[0]} cy={p.xy[1]} r={p.r} />
        <text class="planetlabel" x={p.xy[0]} y={p.xy[1] - p.r - 3}>{p.name.slice(0, 2)}</text>
      {/each}
      <circle class="moonfill" cx={wideMoonXY[0]} cy={wideMoonXY[1]} r={wideMoonR} />
      <circle class="sunfill" cx={wideSunXY[0]} cy={wideSunXY[1]} r={wideSunR} />
      <rect class="fovbox" x={fovBoxX} y={fovBoxY} width={fovBoxW} height={fovBoxH} />
      <!-- Ground painted over everything above (not behind it) -- same
           convention as CountdownPanel's ground rect, so anything below
           the horizon dims through rather than vanishing abruptly. -->
      <rect
        class="ground"
        x={-GROUND_EXTENT}
        y={horizonY}
        width={wideVW + 2 * GROUND_EXTENT}
        height={Math.max(0, wideVH - horizonY + GROUND_EXTENT)}
      />
      <line
        class="horizon"
        x1={-GROUND_EXTENT}
        y1={horizonY}
        x2={wideVW + GROUND_EXTENT}
        y2={horizonY}
      />
    </svg>
    <svg
      viewBox="0 0 200 200"
      preserveAspectRatio="xMidYMid meet"
      style:display={tab === 'allsky' ? 'block' : 'none'}
    >
      <circle class="domecircle" cx={allCx} cy={allCy} r={allR} />
      {#each allConstellationRuns as run, i (i)}
        <polyline class="constline" points={run.map((p) => p.join(',')).join(' ')} />
      {/each}
      {#each allStars as star (star.proper ?? star.xy.join(','))}
        <circle class="skystar" cx={star.xy[0]} cy={star.xy[1]} r={star.r} />
      {/each}
      {#each allPlanets as p (p.name)}
        <circle class="planetmark" cx={p.xy[0]} cy={p.xy[1]} r={p.r} />
        <text class="planetlabel" x={p.xy[0]} y={p.xy[1] - p.r - 3}>{p.name.slice(0, 2)}</text>
      {/each}
      {#if allMoon.altitude > 0}
        <circle class="moonfill" cx={allMoonXY[0]} cy={allMoonXY[1]} r="5.5" />
      {/if}
      {#if allSun.altitude > 0}
        <circle class="sunfill" cx={allSunXY[0]} cy={allSunXY[1]} r="5" />
      {/if}
      <text class="cardinal" x={allCx} y={allCy - allR - 8}>N</text>
      <text class="cardinal" x={allCx - allR - 8} y={allCy}>E</text>
      <text class="cardinal" x={allCx} y={allCy + allR + 8}>S</text>
      <text class="cardinal" x={allCx + allR + 8} y={allCy}>W</text>
    </svg>
    {#if tab === 'wide'}
      <!-- TEMPORARY TUNING PANEL -- delete along with the $state margin
           vars above once final numbers are picked (see comment there). -->
      <div class="tuning">
        <label>
          <span>Side margin <b>{wideSideMarginDeg}°</b></span>
          <input type="range" min="0" max="15" step="0.5" bind:value={wideSideMarginDeg} />
        </label>
        <label>
          <span>Top margin <b>{wideTopMarginDeg}°</b></span>
          <input type="range" min="0" max="15" step="0.5" bind:value={wideTopMarginDeg} />
        </label>
        <label>
          <span>Bottom margin <b>{wideBottomMarginDeg}°</b></span>
          <input type="range" min="0" max="25" step="0.5" bind:value={wideBottomMarginDeg} />
        </label>
      </div>
    {/if}
  </div>
</div>

<style>
  .skywrap {
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  .tabs {
    flex: 0 0 32px;
    display: flex;
    gap: 2px;
    padding: 8px 14px 0;
  }
  .tabs button {
    background: none;
    border: none;
    font-size: 13px;
    color: var(--muted);
    padding: 4px 8px;
    border-bottom: 2px solid transparent;
    cursor: pointer;
  }
  .tabs button.on {
    color: var(--ink);
    border-bottom-color: var(--accent);
  }
  /* Dark night-sky backdrop (was var(--zone), the app's plain light
     panel color) -- matches CountdownPanel's own background, since both
     now share the same filled-Sun/filled-Moon visual language and need
     a dark ground for it to read correctly. */
  .skyzone {
    flex: 1;
    background: #2b4d82;
    margin: 0 14px 14px;
    border-radius: 6px;
    position: relative;
    overflow: hidden;
  }
  .skyzone svg {
    display: block;
    width: 100%;
    height: 100%;
  }
  .horizon {
    stroke: #dce4f2;
    stroke-width: 1.5;
  }
  .ground {
    fill: #05070d;
    fill-opacity: 0.6;
  }
  .sunpath {
    fill: none;
    stroke: var(--muted);
    stroke-width: 1;
    stroke-dasharray: 3 3;
  }
  .contactmark {
    fill: #dce4f2;
    stroke: none;
  }
  .contactlabel {
    fill: #dce4f2;
    font-size: 8px;
    font-weight: 500;
    text-anchor: middle;
  }
  .fovbox {
    fill: none;
    stroke: #dce4f2;
    stroke-width: 1;
    stroke-dasharray: 4 3;
  }
  .sunfill {
    fill: #f6c445;
    stroke: none;
  }
  .moonfill {
    fill: #000000;
    stroke: none;
  }
  .skystar {
    fill: #dce4f2;
  }
  .planetmark {
    fill: var(--accent);
    stroke: none;
  }
  .planetlabel {
    fill: var(--accent);
    font-size: 7px;
    font-weight: 600;
    text-anchor: middle;
  }
  /* Very dim on purpose (direct request) -- a fair number of these
     lines connect through points fainter than the star catalog's mag<3
     cutoff, so they don't have their own visible dot; a bold line would
     read as pointing at nothing. */
  .constline {
    fill: none;
    stroke: #dce4f2;
    stroke-width: 0.4;
    stroke-opacity: 0.18;
  }
  .domecircle {
    fill: none;
    stroke: var(--line);
    stroke-width: 1;
  }
  .cardinal {
    fill: var(--muted);
    font-size: 10px;
    font-weight: 500;
    text-anchor: middle;
    dominant-baseline: middle;
  }
  /* TEMPORARY TUNING PANEL -- delete this rule along with the .tuning
     markup and the $state margin vars once final numbers are picked. */
  .tuning {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: rgba(255, 255, 255, 0.92);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 11px;
    color: var(--ink);
    pointer-events: auto;
  }
  .tuning label {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .tuning span {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    color: var(--muted);
  }
  .tuning b {
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .tuning input[type='range'] {
    width: 160px;
  }
</style>
