<script lang="ts">
  // Coastline is the real basemap.topojson, via d3-geo + topojson-client
  // (PLAN.md §2 stack decision). Central line + N/S limits are the real
  // path.ts output too, but precomputed at build time into
  // shadow-frames.json (scripts/generate-shadow-frames.ts) rather than
  // recomputed in every browser -- it's static geometry for the whole
  // event, not observer- or clock-dependent. The umbra *outline* (the
  // instantaneous shadow footprint, as opposed to the swept central
  // line/limits above) is the opposite case -- a function of "right now",
  // so it's computed client-side each tick from the tiny Besselian
  // coefficients, not precomputed (see eclipse/shadowOutline.ts).
  import { observer, setObserver } from '../../stores/observer';
  import { effectiveTime } from '../../stores/clock';
  import { feature } from 'topojson-client';
  import type { Topology, GeometryCollection } from 'topojson-specification';
  import { geoMercator, geoPath as geoPathGenerator } from 'd3-geo';
  import type { GeoProjection } from 'd3-geo';
  import basemapData from '../../data/basemap.topojson';
  import shadowFrames from '../../data/shadow-frames.json';
  import { coefficients, dateToTtHours } from '../../data/besselian-2026';
  import { shadowOutlineAt } from '../../eclipse/shadowOutline';

  let tab: 'spain' | 'global' = $state('spain');

  const SPAIN_VW = 280,
    SPAIN_VH = 200,
    SPAIN_PAD = 6;
  const topology = basemapData as unknown as Topology;
  const landFeature = feature(topology, topology.objects.land as GeometryCollection);
  const spainProjection: GeoProjection = geoMercator().fitExtent(
    [
      [SPAIN_PAD, SPAIN_PAD],
      [SPAIN_VW - SPAIN_PAD, SPAIN_VH - SPAIN_PAD],
    ],
    landFeature,
  );
  const landPathD = geoPathGenerator(spainProjection)(landFeature) ?? '';

  function project(lat: number, lon: number): [number, number] | null {
    return spainProjection([lon, lat]);
  }
  function projectPts(pairs: [number, number][]): string {
    return pairs
      .map(([lat, lon]) => project(lat, lon))
      .filter((p): p is [number, number] => p !== null)
      .map((p) => p[0] + ',' + p[1])
      .join(' ');
  }

  // Points where shadow_limits didn't converge when this was generated
  // (very near the sunset cusp) are simply absent from the regular grid
  // -- each line then gets ONE extra point snapped to the day/night
  // terminator itself (generate_shadow_frames.py), appended here so the
  // line visually reaches it. DIAGNOSTIC: rendered as points-and-lines
  // (like matplotlib's `.-` style), not a smooth curve, specifically so
  // gaps near the terminator are visible while judging whether finer
  // time steps are needed there (PLAN.md) -- not the final polish.
  function withTerminator(
    points: { lat: number; lon: number }[],
    terminator: { lat: number; lon: number } | null,
  ): [number, number][] {
    const pts = points.map((p): [number, number] => [p.lat, p.lon]);
    if (terminator) pts.push([terminator.lat, terminator.lon]);
    return pts;
  }
  const PATH_CENTER = withTerminator(shadowFrames.centralLine, shadowFrames.centralLineTerminator);
  const PATH_CENTER_MS: number[] = shadowFrames.centralLine
    .map((p) => p.utMs)
    .concat(shadowFrames.centralLineTerminator ? [shadowFrames.centralLineTerminator.utMs] : []);
  const PATH_NORTH = withTerminator(shadowFrames.northLimit, shadowFrames.northLimitTerminator);
  const PATH_SOUTH = withTerminator(shadowFrames.southLimit, shadowFrames.southLimitTerminator);
  const band = PATH_NORTH.concat(PATH_SOUTH.slice().reverse());
  const TERMINATOR_POINTS: { lat: number; lon: number }[] = [
    shadowFrames.centralLineTerminator,
    shadowFrames.northLimitTerminator,
    shadowFrames.southLimitTerminator,
  ]
    .filter((p) => p !== null)
    .map((p) => ({ lat: p.lat, lon: p.lon }));

  // The shadow marker's position is driven by effectiveTime (live "now",
  // or the sim clock -- PLAN.md §6), interpolated over the real central-
  // line samples above. Hidden outside the sampled window (before/after
  // the shadow transits Spain).
  function shadowPosAtMs(ms: number): [number, number] | null {
    if (ms < PATH_CENTER_MS[0] || ms > PATH_CENTER_MS[PATH_CENTER_MS.length - 1]) return null;
    let i = 0;
    while (i < PATH_CENTER_MS.length - 2 && ms > PATH_CENTER_MS[i + 1]) i++;
    const t0 = PATH_CENTER_MS[i],
      t1 = PATH_CENTER_MS[i + 1];
    const f = (ms - t0) / (t1 - t0);
    const [lat0, lon0] = PATH_CENTER[i],
      [lat1, lon1] = PATH_CENTER[i + 1];
    return [lat0 + (lat1 - lat0) * f, lon0 + (lon1 - lon0) * f];
  }
  const shadowPos = $derived(shadowPosAtMs($effectiveTime.getTime()));
  const shadowXY = $derived(shadowPos ? project(shadowPos[0], shadowPos[1]) : null);
  const obsXY = $derived(project($observer.lat, $observer.lon));

  // The umbra outline: the actual shape of the umbral shadow's footprint
  // on Earth at effectiveTime, as opposed to shadowXY above (just its
  // center). Recomputed every tick directly from the Besselian
  // coefficients (shadowOutlineAt is cheap -- ~60 trig-heavy points, no
  // precomputation needed). Empty outside the umbral window (the shadow
  // isn't touching the Earth at all, e.g. long before/after the event).
  const outlineLatLon = $derived.by((): [number, number][] => {
    const tHours = dateToTtHours($effectiveTime);
    return shadowOutlineAt(coefficients, tHours).map((p): [number, number] => [p.lat, p.lon]);
  });

  // Click-to-set and drag-to-fine-tune are the same gesture: a single
  // pointerdown+pointermove+pointerup sequence.
  let mapSvg: SVGSVGElement;
  function mapClientToLatLon(clientX: number, clientY: number): [number, number] | null {
    const pt = mapSvg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(mapSvg.getScreenCTM()!.inverse());
    const inv = spainProjection.invert?.([p.x, p.y]);
    return inv ? [inv[1], inv[0]] : null;
  }
  function onMapPointerDown(e: PointerEvent) {
    mapSvg.setPointerCapture(e.pointerId);
    const start = mapClientToLatLon(e.clientX, e.clientY);
    if (start) setObserver(start[0], start[1], 'map');
    function move(e: PointerEvent) {
      const p = mapClientToLatLon(e.clientX, e.clientY);
      if (p) setObserver(p[0], p[1], 'map');
    }
    function up() {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
    }
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  // --- Global (whole path) map, PLAN.md §8 #2 ---
  // Stereographic projection centered near the point of greatest eclipse
  // (off Iceland) -- a standard equirectangular/Mercator would badly
  // distort or clip a path that starts in Siberia and crosses the Arctic.
  // Coastline is a very rough Northern-Hemisphere sketch, much less detail
  // than the Spain tab needs.
  const GLOBAL_LAT0 = 65.22,
    GLOBAL_LON0 = -25.24;
  const GLOBAL_PXPERUNIT = 70,
    GLOBAL_CX = 100,
    GLOBAL_CY = 100;
  function stereo(lat: number, lon: number): [number, number] {
    const phi0 = (GLOBAL_LAT0 * Math.PI) / 180,
      lam0 = (GLOBAL_LON0 * Math.PI) / 180;
    const phi = (lat * Math.PI) / 180,
      lam = (lon * Math.PI) / 180;
    const dlam = lam - lam0;
    const cosc =
      Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * Math.cos(phi) * Math.cos(dlam);
    const k = 2 / (1 + cosc);
    const x = k * Math.cos(phi) * Math.sin(dlam);
    const y = k * (Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * Math.cos(phi) * Math.cos(dlam));
    return [GLOBAL_CX + x * GLOBAL_PXPERUNIT, GLOBAL_CY - y * GLOBAL_PXPERUNIT];
  }
  function stereoPts(pairs: [number, number][]) {
    return pairs.map(([lat, lon]) => stereo(lat, lon).join(',')).join(' ');
  }
  const GLOBAL_GREENLAND: [number, number][] = [
    [59.8, -43.9], [64, -51], [70, -53], [76, -68], [82, -55], [83.6, -30], [76, -18],
    [70, -22], [59.8, -43.9],
  ];
  const GLOBAL_ICELAND: [number, number][] = [
    [66.4, -22.7], [65.9, -14.3], [63.4, -19.1], [64.9, -24], [66.4, -22.7],
  ];
  const GLOBAL_EURASIA_COAST: [number, number][] = [
    [76, 105], [74, 55], [69, 33], [71.1, 25.8], [65, 12], [59, 10.7], [57, 10], [53, 6],
    [50, 2], [48.5, -4.5], [43.38, -1.79], [41.38, 2.18],
  ];
  const GLOBAL_CENTERLINE_PRE: [number, number][] = [
    [75.0783, 113.4433], [79.94, 114.155], [83.8717, 109.545], [87.2467, 82.2983],
    [87.465, 12.55], [85.4367, -15.0133], [83.2383, -22.9133], [81.14, -25.9783],
    [79.1517, -27.305], [77.26, -27.8367], [75.45, -27.945], [73.7083, -27.805],
    [72.025, -27.5067], [70.3883, -27.1], [68.7933, -26.61], [67.2333, -26.055],
    [65.7, -25.4433], [64.19, -24.78], [62.6983, -24.0667], [61.2217, -23.3017],
    [59.755, -22.4817], [58.2933, -21.6], [56.8317, -20.6483], [55.365, -19.6167],
    [53.8883, -18.49], [52.395, -17.245], [50.8717, -15.855], [49.31, -14.2783],
  ];
  const GREATEST_ECLIPSE: [number, number] = [65.2233, -25.24];
  const gePos = stereo(GREATEST_ECLIPSE[0], GREATEST_ECLIPSE[1]);
</script>

<div class="mapwrap">
  <div class="tabs">
    <button class:on={tab === 'spain'} onclick={() => (tab = 'spain')}>Spain</button>
    <button class:on={tab === 'global'} onclick={() => (tab = 'global')}>Global</button>
  </div>
  <div class="mapzone">
    <svg
      bind:this={mapSvg}
      viewBox="0 0 280 200"
      preserveAspectRatio="xMidYMid meet"
      style:display={tab === 'spain' ? 'block' : 'none'}
      onpointerdown={onMapPointerDown}
      role="application"
      aria-label="Eclipse path map -- click or drag to set the observer location"
    >
      <path class="coast" d={landPathD} />
      <polygon class="pathband" points={projectPts(band)} />
      <polyline class="limitline" points={projectPts(PATH_NORTH)} />
      <polyline class="limitline" points={projectPts(PATH_SOUTH)} />
      <polyline class="pathline" points={projectPts(PATH_CENTER)} />
      {#each PATH_CENTER as [lat, lon], i (i)}
        {@const p = project(lat, lon)}
        {#if p}<circle class="gridpoint centerpoint" cx={p[0]} cy={p[1]} r="0.9" />{/if}
      {/each}
      {#each PATH_NORTH as [lat, lon], i (i)}
        {@const p = project(lat, lon)}
        {#if p}<circle class="gridpoint" cx={p[0]} cy={p[1]} r="0.7" />{/if}
      {/each}
      {#each PATH_SOUTH as [lat, lon], i (i)}
        {@const p = project(lat, lon)}
        {#if p}<circle class="gridpoint" cx={p[0]} cy={p[1]} r="0.7" />{/if}
      {/each}
      {#each TERMINATOR_POINTS as tp (tp.lat + ',' + tp.lon)}
        {@const p = project(tp.lat, tp.lon)}
        {#if p}<circle class="terminatorpoint" cx={p[0]} cy={p[1]} r="1.6" />{/if}
      {/each}
      {#if outlineLatLon.length >= 3}
        <polygon class="umbraOutline" points={projectPts(outlineLatLon)} />
      {/if}
      <circle
        class="shadowmarker"
        r="4"
        cx={shadowXY ? shadowXY[0] : 0}
        cy={shadowXY ? shadowXY[1] : 0}
        opacity={shadowXY ? 1 : 0}
      />
      <circle class="obsmarker" r="3.5" cx={obsXY ? obsXY[0] : 0} cy={obsXY ? obsXY[1] : 0} />
    </svg>
    <svg
      viewBox="0 0 200 200"
      preserveAspectRatio="xMidYMid meet"
      style:display={tab === 'global' ? 'block' : 'none'}
    >
      <polygon class="coast" points={stereoPts(GLOBAL_GREENLAND)} />
      <polygon class="coast" points={stereoPts(GLOBAL_ICELAND)} />
      <polyline class="globalcoast" points={stereoPts(GLOBAL_EURASIA_COAST)} />
      <polyline class="globalpath" points={stereoPts(GLOBAL_CENTERLINE_PRE)} />
      <polyline class="pathline" points={stereoPts(PATH_CENTER)} />
      {#if outlineLatLon.length >= 3}
        <polygon class="umbraOutline" points={stereoPts(outlineLatLon)} />
      {/if}
      <circle class="gemarker" cx={gePos[0]} cy={gePos[1]} r="2.5" />
    </svg>
  </div>
</div>

<style>
  .mapwrap {
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
  .mapzone {
    flex: 1;
    background: var(--zone);
    position: relative;
    overflow: hidden;
  }
  .mapzone svg {
    display: block;
    width: 100%;
    height: 100%;
    cursor: crosshair;
    touch-action: none;
  }
  .coast {
    fill: var(--screen);
    stroke: var(--line);
    stroke-width: 1;
  }
  .pathband {
    fill: var(--accent-bg);
    stroke: var(--accent);
    stroke-width: 0.75;
    stroke-opacity: 0.5;
  }
  .pathline {
    fill: none;
    stroke: var(--cline);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .limitline {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  /* DIAGNOSTIC (PLAN.md): raw sample points, matplotlib `.-`-style, so
     gaps near the terminator are visible while judging whether finer
     time steps are needed there -- not final polish. */
  .gridpoint {
    fill: var(--accent);
    stroke: none;
  }
  .gridpoint.centerpoint {
    fill: var(--cline);
  }
  .terminatorpoint {
    fill: #c22;
    stroke: var(--screen);
    stroke-width: 0.3;
  }
  /* The umbral shadow's actual instantaneous footprint (as opposed to
     .shadowmarker below, just its center point) -- a dark, semi-
     transparent shape with a crisper outline stroke, matching the
     convention real eclipse-tracking maps use for "this is the shadow
     right now". */
  .umbraOutline {
    fill: var(--ink);
    fill-opacity: 0.22;
    stroke: var(--ink);
    stroke-opacity: 0.55;
    stroke-width: 1;
    stroke-linejoin: round;
  }
  .shadowmarker {
    fill: #c22;
    fill-opacity: 0.8;
    stroke: none;
  }
  .obsmarker {
    fill: var(--screen);
    stroke: var(--ink);
    stroke-width: 2;
  }
  .globalcoast {
    fill: none;
    stroke: var(--line);
    stroke-width: 1;
  }
  .globalpath {
    fill: none;
    stroke: var(--muted);
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .gemarker {
    fill: var(--accent);
    stroke: none;
  }
</style>
