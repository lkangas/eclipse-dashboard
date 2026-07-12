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
  import { geoMercator, geoPath as geoPathGenerator, geoProjection } from 'd3-geo';
  import type { GeoProjection } from 'd3-geo';
  import basemapData from '../../data/basemap.topojson';
  import basemapGlobalData from '../../data/basemap-global.topojson';
  import roadsData from '../../data/roads.topojson';
  import roadsMinorData from '../../data/roads-minor.topojson';
  import citiesData from '../../data/cities.json';
  import shadowFrames from '../../data/shadow-frames.json';
  import shadowFramesGlobal from '../../data/shadow-frames-global.json';
  import { coefficients, dateToTtHours } from '../../data/besselian-2026';
  import { shadowOutlineAt } from '../../eclipse/shadowOutline';

  let tab: 'spain' | 'global' = $state('spain');

  // Turns an array of [lat, lon] points into a closed GeoJSON Polygon
  // ([lon, lat] order, ring auto-closed) -- shared by the Spain band fit
  // below and the Global band fit further down, both of which need a
  // real geometry object to hand to d3-geo's bounds()/fitHeight()/
  // fitExtent(), not just a bag of points.
  function llPolygon(pts: [number, number][]) {
    const ring = pts.map(([lat, lon]): [number, number] => [lon, lat]);
    const first = ring[0],
      last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
    return { type: 'Polygon' as const, coordinates: [ring] };
  }

  const topology = basemapData as unknown as Topology;
  const landFeature = feature(topology, topology.objects.land as GeometryCollection);

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

  const SPAIN_VW = 280,
    SPAIN_VH = 200,
    SPAIN_RIGHT_MARGIN = 8;
  // Locked counterclockwise tilt so the central line runs more toward
  // horizontal, letting more of the umbra band fit the panel's
  // horizontal-rectangle aspect ratio -- a single fixed value (not
  // fully leveled, not live-recomputed) is enough. Set via .angle()
  // *before* measuring anything below so the fit accounts for the
  // tilted content.
  const SPAIN_ROTATION_DEG = 30;
  // Zoomed to the umbra band itself, not the whole basemap bbox: the
  // viewport height should be about SPAIN_BAND_TO_HEIGHT times the
  // band's own (rotated) north-south width. d3's fitHeight() gives the
  // scale that makes the band fill the FULL viewport height; dividing
  // by SPAIN_BAND_TO_HEIGHT scales that back down to "fills 1/N of it"
  // directly, in one step, without an intermediate fitExtent that could
  // be width- rather than height-limited (the band's east-west length
  // is much greater than its width, so fitting *both* dimensions would
  // pick the wrong one). Was 4 (25% of the height); reported back as
  // needing "at least 3x more" zoom, i.e. the band filling a much
  // bigger share of the panel -- 4/3 (the band now fills ~75% of the
  // height) is exactly that 3x, not a rounder-but-different number, per
  // the specific multiplier requested.
  const SPAIN_BAND_TO_HEIGHT = 4 / 3;
  const bandFeature = { type: 'Feature' as const, properties: {}, geometry: llPolygon(band) };
  const spainFitToHeight = geoMercator().angle(SPAIN_ROTATION_DEG).fitHeight(SPAIN_VH, bandFeature);
  const spainScale = spainFitToHeight.scale() / SPAIN_BAND_TO_HEIGHT;
  // Translate is chosen (not fit) so the band's rightmost point -- the
  // Balearics end, later/lower-sun and closer to the sunset cusp -- sits
  // just inside the right edge, band centered vertically. Combined with
  // the Spain <svg>'s xMaxYMid preserveAspectRatio below, this means a
  // shorter (vertically-resized) panel only ever grows/shrinks the empty
  // margin on the LEFT -- the right-anchored content, and therefore
  // Spain itself, stays fully in view at any panel height.
  const spainMeasure = geoMercator().angle(SPAIN_ROTATION_DEG).scale(spainScale).translate([0, 0]);
  const spainBandBounds = geoPathGenerator(spainMeasure).bounds(bandFeature);
  const spainProjection: GeoProjection = geoMercator()
    .angle(SPAIN_ROTATION_DEG)
    .scale(spainScale)
    .translate([
      SPAIN_VW - SPAIN_RIGHT_MARGIN - spainBandBounds[1][0],
      SPAIN_VH / 2 - (spainBandBounds[0][1] + spainBandBounds[1][1]) / 2,
    ]);
  const landPathD = geoPathGenerator(spainProjection)(landFeature) ?? '';

  // Major + secondary highways, and cities (PLAN.md §8, "map detail"
  // follow-up), same fixed projection as the coastline above -- all
  // static reference detail, not observer- or clock-dependent, so
  // computed once rather than as $derived. No labels yet (direct
  // request, "at least not yet") -- cities are plain dots for now.
  const roadsTopology = roadsData as unknown as Topology;
  const roadsFeature = feature(
    roadsTopology,
    roadsTopology.objects.ne_10m_roads as GeometryCollection,
  );
  const roadsPathD = geoPathGenerator(spainProjection)(roadsFeature) ?? '';
  // One tier down ("Secondary Highway") -- same stroke-width as the
  // major layer, just dimmer (.roads-minor's lower stroke-opacity) so it
  // reads as background context rather than competing with it.
  const roadsMinorTopology = roadsMinorData as unknown as Topology;
  const roadsMinorFeature = feature(
    roadsMinorTopology,
    roadsMinorTopology.objects.ne_10m_roads as GeometryCollection,
  );
  const roadsMinorPathD = geoPathGenerator(spainProjection)(roadsMinorFeature) ?? '';
  const cityPoints = citiesData.cities
    .map((c) => ({ name: c.name, xy: spainProjection([c.lon, c.lat]) }))
    .filter((c): c is { name: string; xy: [number, number] } => c.xy !== null);

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

  // Global tab's own whole-event N/S umbral limits (shadow-frames-
  // global.json -- coarser, but spans the entire path from Arctic Russia
  // through Iceland to Spain, unlike shadowFrames above which only
  // covers the Spain transit slice), swept into the filled `GLOBAL_BAND`
  // below rather than drawn as its own lines (no centerline/limit-line
  // strokes on this tab, per direct request). Terminator points can fall
  // at *either* end here (the window starts right where the umbra first
  // touches the globe at all, not safely mid-visible-disk like the Spain
  // slice does), hence prepending as well as appending.
  function withTerminatorBoth(
    points: { lat: number; lon: number }[],
    start: { lat: number; lon: number } | null,
    end: { lat: number; lon: number } | null,
  ): [number, number][] {
    const pts = points.map((p): [number, number] => [p.lat, p.lon]);
    if (start) pts.unshift([start.lat, start.lon]);
    if (end) pts.push([end.lat, end.lon]);
    return pts;
  }
  const GLOBAL_PATH_NORTH = withTerminatorBoth(
    shadowFramesGlobal.northLimit,
    shadowFramesGlobal.northLimitTerminatorStart,
    shadowFramesGlobal.northLimitTerminatorEnd,
  );
  const GLOBAL_PATH_SOUTH = withTerminatorBoth(
    shadowFramesGlobal.southLimit,
    shadowFramesGlobal.southLimitTerminatorStart,
    shadowFramesGlobal.southLimitTerminatorEnd,
  );
  const GLOBAL_BAND = GLOBAL_PATH_NORTH.concat(GLOBAL_PATH_SOUTH.slice().reverse());
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

  // Penumbral footprint -- same idea as the umbral outline above, but the
  // much larger partial-eclipse-visibility cone (Global tab only; on the
  // Spain tab it's bigger than the whole map for most of the event and
  // would just be visual noise).
  const outlinePenumbraLatLon = $derived.by((): [number, number][] => {
    const tHours = dateToTtHours($effectiveTime);
    return shadowOutlineAt(coefficients, tHours, 60, 'penumbra').map(
      (p): [number, number] => [p.lat, p.lon],
    );
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
  // Custom raw projection (d3-geo's core geoProjection wrapper, not the
  // separate d3-geo-projection package this repo doesn't depend on) --
  // the standard oblique-stereographic raw formula, composed with d3's
  // own rotate/scale/translate so it can drive geoPath over real
  // coastline data (basemap-global.topojson) the same way spainProjection
  // does, instead of hand-computing screen coordinates per point.
  const GLOBAL_LAT0 = 65.22,
    GLOBAL_LON0 = -25.24;
  const GREATEST_ECLIPSE: [number, number] = [65.2233, -25.24];
  const GLOBAL_VW = 200,
    GLOBAL_VH = 200;
  // Levels the central line at greatest eclipse (a local condition --
  // the path curves everywhere else, so no single angle levels all of
  // it). Computed once from the real central-line samples bracketing GE
  // (the true local bearing there is ~169.5 deg clockwise from north,
  // which an azimuthal projection centered on GE preserves exactly as a
  // screen angle -- see PLAN.md), then rounded to a clean value rather
  // than kept at full precision, same convention as SPAIN_ROTATION_DEG.
  const GLOBAL_ROTATION_DEG = 80;
  function stereographicRaw(x: number, y: number): [number, number] {
    const cosy = Math.cos(y),
      k = 1 + Math.cos(x) * cosy;
    return [(cosy * Math.sin(x)) / k, Math.sin(y) / k];
  }
  // A custom geoProjection() has no default clip circle (unlike d3's own
  // built-in azimuthal projections) -- without one, geoPath chokes on
  // coastline rings that pass near/beyond the antipodal point, producing
  // broken/self-intersecting-looking paths. 89.9, not a full 90, keeps
  // the exact antipodal edge case away from the clip boundary.
  //
  // Framing is deliberately NOT "fit the whole swept band" anymore: with
  // GLOBAL_ROTATION_DEG applied, greatest eclipse (GE) turns out to be
  // very close to the LOWEST on-screen point of the entire central line
  // -- both the Arctic start and the Spain end curve back up above it
  // (verified directly against the real centralLine samples, not
  // assumed). That makes GE a natural bottom anchor and the event's
  // start (northLimitTerminatorStart/southLimitTerminatorStart -- where
  // the umbra first grazes the day/night terminator) a natural top
  // anchor, framing "Arctic terminator down to greatest eclipse" -- the
  // dramatic overview this tab is for, leaving the Spain-specific detail
  // (already redundant with it) to the Spain tab. GLOBAL_TOP_MARGIN is
  // modest (the terminator points sit close to the top edge);
  // GLOBAL_BOTTOM_MARGIN is large (GE gets real breathing room below the
  // umbra line, not just a margin equal to the top one). Both bumped up
  // a bit from their first-pass values (16/56) -- reported back as
  // slightly too zoomed in -- which shrinks the fitted span between the
  // two anchors and therefore the whole view, without changing what
  // those anchors *are*.
  const GLOBAL_TOP_MARGIN = 20,
    GLOBAL_BOTTOM_MARGIN = 68;
  const globalMeasure = geoProjection(stereographicRaw)
    .rotate([-GLOBAL_LON0, -GLOBAL_LAT0])
    .angle(GLOBAL_ROTATION_DEG)
    .scale(1)
    .translate([0, 0]);
  function measureXY(lat: number, lon: number): [number, number] {
    return globalMeasure([lon, lat]) ?? [0, 0];
  }
  const geRawXY = measureXY(GREATEST_ECLIPSE[0], GREATEST_ECLIPSE[1]);
  const topRawY = Math.min(
    measureXY(
      shadowFramesGlobal.northLimitTerminatorStart.lat,
      shadowFramesGlobal.northLimitTerminatorStart.lon,
    )[1],
    measureXY(
      shadowFramesGlobal.southLimitTerminatorStart.lat,
      shadowFramesGlobal.southLimitTerminatorStart.lon,
    )[1],
  );
  const globalScale =
    (GLOBAL_VH - GLOBAL_TOP_MARGIN - GLOBAL_BOTTOM_MARGIN) / (geRawXY[1] - topRawY);
  const globalProjection: GeoProjection = geoProjection(stereographicRaw)
    .rotate([-GLOBAL_LON0, -GLOBAL_LAT0])
    .angle(GLOBAL_ROTATION_DEG)
    .clipAngle(89.9)
    .scale(globalScale)
    .translate([GLOBAL_VW / 2 - globalScale * geRawXY[0], GLOBAL_TOP_MARGIN - globalScale * topRawY]);
  function stereo(lat: number, lon: number): [number, number] {
    return globalProjection([lon, lat]) ?? [GLOBAL_VW / 2, GLOBAL_VH / 2];
  }
  function stereoPts(pairs: [number, number][]) {
    return pairs.map(([lat, lon]) => stereo(lat, lon).join(',')).join(' ');
  }
  const globalTopology = basemapGlobalData as unknown as Topology;
  const globalLandFeature = feature(
    globalTopology,
    globalTopology.objects.land as GeometryCollection,
  );
  const globalLandPathD = geoPathGenerator(globalProjection)(globalLandFeature) ?? '';
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
      preserveAspectRatio="xMaxYMid meet"
      style:display={tab === 'spain' ? 'block' : 'none'}
      onpointerdown={onMapPointerDown}
      role="application"
      aria-label="Eclipse path map -- click or drag to set the observer location"
    >
      <path class="coast" d={landPathD} />
      <path class="roads-minor" d={roadsMinorPathD} />
      <path class="roads" d={roadsPathD} />
      {#each cityPoints as c (c.name)}
        <circle class="citydot" cx={c.xy[0]} cy={c.xy[1]} r="0.9" />
      {/each}
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
      <path class="coast" d={globalLandPathD} />
      <polygon class="globalFill globalBand" points={stereoPts(GLOBAL_BAND)} />
      {#if outlinePenumbraLatLon.length >= 3}
        <polygon class="globalFill penumbraOutline" points={stereoPts(outlinePenumbraLatLon)} />
      {/if}
      {#if outlineLatLon.length >= 3}
        <polygon class="globalFill umbraOutline" points={stereoPts(outlineLatLon)} />
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
    background: var(--ocean);
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
    stroke: #000;
    stroke-width: 0.5;
  }
  /* Reference detail (PLAN.md §8) -- deliberately understated relative
     to the coastline/eclipse-path layers above and below it, since
     they're context, not the point of this map. No labels yet. */
  .roads {
    fill: none;
    stroke: var(--muted);
    stroke-width: 0.3;
    stroke-opacity: 0.8;
  }
  /* One tier down ("Secondary Highway") -- same stroke-width as .roads,
     just dimmer, so it reads as background context under the major
     roads rather than competing with them. Drawn before .roads in the
     template so the major layer stays crisp on top of any overlap. */
  .roads-minor {
    fill: none;
    stroke: var(--muted);
    stroke-width: 0.3;
    stroke-opacity: 0.35;
  }
  .citydot {
    fill: var(--muted);
    stroke: none;
  }
  .pathband {
    fill: var(--accent-bg);
    fill-opacity: 0.5;
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
  /* Penumbral (partial-visibility) footprint -- same convention as
     .umbraOutline but much lighter, since it's a far larger area and
     sits underneath the umbra outline rather than replacing it. */
  .penumbraOutline {
    fill: var(--ink);
    fill-opacity: 0.06;
    stroke: var(--ink);
    stroke-opacity: 0.25;
    stroke-width: 0.75;
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
  .gemarker {
    fill: var(--accent);
    stroke: none;
  }
  /* Global tab only: filled shapes with no stroke at all (per direct
     request -- at this small scale a 1px edge reads as visual noise, and
     there's no centerline/limit-line to draw here in the first place).
     Declared last so it wins over .umbraOutline/.penumbraOutline's own
     stroke for elements carrying both classes, regardless of source
     order up there. */
  .globalBand {
    fill: var(--accent-bg);
    fill-opacity: 0.5;
  }
  .globalFill {
    stroke: none;
  }
</style>
