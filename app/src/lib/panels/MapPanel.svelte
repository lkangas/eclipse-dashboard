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
  import { destinationPoint } from '../../eclipse/horizon';
  import { sunAltAzAt, moonAltAzAt } from '../../stores/skyView';

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
  // rendered polyline visually extends all the way to it rather than
  // stopping short at the last point the solver actually converged on.
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
  // pick the wrong one). History: was 4 (25% of the height); "at least
  // 3x more" zoom requested -> 4/3 (~75% of the height); then "20% more
  // zoom, upper/lower edges closer" -> dividing by another 1.2 gives
  // 10/9 (~90% of the height). Scaling this one constant is enough on
  // its own: the right-edge anchor (spainTranslateX) and the
  // central-line vertical centering (spainCenterYMid) below are both
  // derived from spainScale, not hardcoded, so they automatically
  // re-anchor/re-center at whatever zoom this knob picks.
  const SPAIN_BAND_TO_HEIGHT = 4 / 3 / 1.2; // = 10/9, ~90% of height
  const bandFeature = { type: 'Feature' as const, properties: {}, geometry: llPolygon(band) };
  const spainFitToHeight = geoMercator().angle(SPAIN_ROTATION_DEG).fitHeight(SPAIN_VH, bandFeature);
  const spainScale = spainFitToHeight.scale() / SPAIN_BAND_TO_HEIGHT;
  // Horizontal translate is chosen (not fit) so the band's rightmost
  // point -- the Balearics end, later/lower-sun and closer to the
  // sunset cusp -- sits just inside the right edge. Combined with the
  // Spain <svg>'s xMaxYMid preserveAspectRatio below, this means a
  // shorter (vertically-resized) panel only ever grows/shrinks the empty
  // margin on the LEFT -- the right-anchored content, and therefore
  // Spain itself, stays fully in view at any panel height.
  const spainMeasure = geoMercator().angle(SPAIN_ROTATION_DEG).scale(spainScale).translate([0, 0]);
  const spainBandBounds = geoPathGenerator(spainMeasure).bounds(bandFeature);
  const spainTranslateX = SPAIN_VW - SPAIN_RIGHT_MARGIN - spainBandBounds[1][0];
  // Vertical translate centers the CENTRAL LINE, not the swept band --
  // and only the slice of it that will actually be visible in this
  // right-anchored, zoomed-in view, not its extent over the whole
  // event. The band's north/south limits flare out hugely (and
  // asymmetrically) near the sunset-cusp ends of the path, well outside
  // this crop, so centering on the *band's* full bounding box (the
  // previous approach) balanced against those off-screen flares instead
  // of what's on screen -- the visible slice of the central line ended
  // up sitting well below panel-center, not "not centered" by a small
  // margin but by a lot. Falls back to the band's own bounds if
  // (shouldn't happen at any real scale) no central-line point lands in
  // the visible window.
  const spainVisibleXMin = -spainTranslateX,
    spainVisibleXMax = SPAIN_VW - spainTranslateX;
  const visibleCenterYs = PATH_CENTER.map(([lat, lon]) => spainMeasure([lon, lat]))
    .filter((p): p is [number, number] => p !== null)
    .filter(([x]) => x >= spainVisibleXMin && x <= spainVisibleXMax)
    .map(([, y]) => y);
  const spainCenterYMid =
    visibleCenterYs.length > 0
      ? (Math.min(...visibleCenterYs) + Math.max(...visibleCenterYs)) / 2
      : (spainBandBounds[0][1] + spainBandBounds[1][1]) / 2;
  const spainProjection: GeoProjection = geoMercator()
    .angle(SPAIN_ROTATION_DEG)
    .scale(spainScale)
    .translate([spainTranslateX, SPAIN_VH / 2 - spainCenterYMid]);
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

  // Short (~200km) directional indicators for the Sun's and Moon's current
  // azimuth from the observer, drawn on both tabs -- reuses horizon.ts's
  // destinationPoint (bearing+distance -> lat/lon) and skyView.ts's
  // sunAltAzAt/moonAltAzAt (this instant's real azimuth) rather than
  // reimplementing either. The lat/lon destination point itself doesn't
  // depend on either tab's projection, so it's computed once here; each
  // tab below projects it through its own projection.
  const AZ_LINE_DISTANCE_M = 200_000;
  const sunAzPoint = $derived.by(() => {
    const az = sunAltAzAt(
      $effectiveTime,
      $observer.lat,
      $observer.lon,
      $observer.elevationM,
    ).azimuth;
    return destinationPoint($observer.lat, $observer.lon, az, AZ_LINE_DISTANCE_M);
  });
  const moonAzPoint = $derived.by(() => {
    const az = moonAltAzAt(
      $effectiveTime,
      $observer.lat,
      $observer.lon,
      $observer.elevationM,
    ).azimuth;
    return destinationPoint($observer.lat, $observer.lon, az, AZ_LINE_DISTANCE_M);
  });
  const sunAzSpainXY = $derived(project(sunAzPoint.lat, sunAzPoint.lon));
  const moonAzSpainXY = $derived(project(moonAzPoint.lat, moonAzPoint.lon));

  // Faint dashed lat/lon crosshair through the observer's current position,
  // Spain tab only. spainProjection is a ROTATED Mercator
  // (SPAIN_ROTATION_DEG), so a line of constant latitude/longitude isn't a
  // straight screen line once projected -- both are real sampled-and-
  // projected polylines (the same projectPts()-style technique PATH_CENTER
  // etc. already use), not a naive <line>. +-8 degrees is comfortably wider
  // than the visible viewport at this tab's fixed zoom -- the .mapzone's
  // own overflow:hidden handles the overrun -- and ~0.2deg steps keep each
  // line's point count modest (~80 points).
  const CROSSHAIR_SPAN_DEG = 8;
  const CROSSHAIR_STEP_DEG = 0.2;
  function crosshairRange(center: number): number[] {
    const n = Math.round((2 * CROSSHAIR_SPAN_DEG) / CROSSHAIR_STEP_DEG);
    return Array.from(
      { length: n + 1 },
      (_, i) => center - CROSSHAIR_SPAN_DEG + i * CROSSHAIR_STEP_DEG,
    );
  }
  const obsParallel = $derived(
    crosshairRange($observer.lon).map((lon): [number, number] => [$observer.lat, lon]),
  );
  const obsMeridian = $derived(
    crosshairRange($observer.lat).map((lat): [number, number] => [lat, $observer.lon]),
  );

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
  // much larger partial-eclipse-visibility cone. Shown stroke-only (no
  // fill) on the Spain tab, since at that tab's zoom it's bigger than the
  // whole map for most of the event and a fill would just be visual
  // noise there.
  //
  // 240 points, not the umbral outline's 60: the Spain tab is zoomed in
  // ~3x relative to Global, so only a small arc of this much-larger
  // circle crosses the visible viewport there -- 60 points around the
  // *whole* circle left that visible arc looking faceted/coarse (reported
  // directly). Still cheap (shadowOutlineAt's per-point cost is a handful
  // of trig ops), so bumping it also just makes the Global tab's copy
  // smoother for free rather than needing two different point counts.
  const outlinePenumbraLatLon = $derived.by((): [number, number][] => {
    const tHours = dateToTtHours($effectiveTime);
    return shadowOutlineAt(coefficients, tHours, 240, 'penumbra').map(
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
  // Draggable/clickable only in Manual (map) mode (direct request,
  // TopBar's location-mode toggle group) -- GPS/browser/preset modes are
  // driven by their own source, not the map.
  const mapInteractive = $derived($observer.source === 'manual');
  function onMapPointerDown(e: PointerEvent) {
    if (!mapInteractive) return;
    mapSvg.setPointerCapture(e.pointerId);
    const start = mapClientToLatLon(e.clientX, e.clientY);
    if (start) setObserver(start[0], start[1], 'manual');
    function move(e: PointerEvent) {
      const p = mapClientToLatLon(e.clientX, e.clientY);
      if (p) setObserver(p[0], p[1], 'manual');
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
  // (already redundant with it) to the Spain tab.
  //
  // Zoomed-in and zoomed-out each get their own independent top/bottom
  // margin (zoom-out used to just be a flat 2x-smaller scale on the
  // zoomed-in fit, with no margins of its own).
  //
  // Zoomed-in numbers were first picked via a live slider (git history),
  // dragging top and bottom as if independent -- they aren't: both feed
  // the same scale formula below, so nudging one re-anchors and rescales
  // everything else, and by-eye dragging never converged. Replaced by
  // solving directly against a reference crop: GE should sit near the
  // *bottom* of the frame (~81% down), with the freed space above going
  // to Arctic context instead of a near-even top/bottom split.
  const ZOOM_IN_TOP_MARGIN = 58,
    ZOOM_IN_BOTTOM_MARGIN = 39;
  const ZOOM_OUT_TOP_MARGIN = 40,
    ZOOM_OUT_BOTTOM_MARGIN = 114;
  let globalZoomedOut = $state(false);
  const globalTopMargin = $derived(globalZoomedOut ? ZOOM_OUT_TOP_MARGIN : ZOOM_IN_TOP_MARGIN);
  const globalBottomMargin = $derived(
    globalZoomedOut ? ZOOM_OUT_BOTTOM_MARGIN : ZOOM_IN_BOTTOM_MARGIN,
  );
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
  const globalScale = $derived(
    (GLOBAL_VH - globalTopMargin - globalBottomMargin) / (geRawXY[1] - topRawY),
  );
  const globalProjection: GeoProjection = $derived(
    geoProjection(stereographicRaw)
      .rotate([-GLOBAL_LON0, -GLOBAL_LAT0])
      .angle(GLOBAL_ROTATION_DEG)
      .clipAngle(89.9)
      .scale(globalScale)
      .translate([
        GLOBAL_VW / 2 - globalScale * geRawXY[0],
        globalTopMargin - globalScale * topRawY,
      ]),
  );
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
  const globalLandPathD = $derived(geoPathGenerator(globalProjection)(globalLandFeature) ?? '');
  const gePos = $derived(stereo(GREATEST_ECLIPSE[0], GREATEST_ECLIPSE[1]));

  // Global tab's own observer marker + Sun/Moon azimuth indicators --
  // stereo() always returns a real point (falls back to the viewport
  // center), unlike Spain's project() above, so no null-check is needed.
  const obsGlobalXY = $derived(stereo($observer.lat, $observer.lon));
  const sunAzGlobalXY = $derived(stereo(sunAzPoint.lat, sunAzPoint.lon));
  const moonAzGlobalXY = $derived(stereo(moonAzPoint.lat, moonAzPoint.lon));
</script>

<div class="mapwrap">
  <div class="tabs">
    <button class:on={tab === 'spain'} onclick={() => (tab = 'spain')}>Spain</button>
    <button class:on={tab === 'global'} onclick={() => (tab = 'global')}>Global</button>
    {#if tab === 'global'}
      <button
        class="zoomtoggle"
        class:on={globalZoomedOut}
        onclick={() => (globalZoomedOut = !globalZoomedOut)}
      >
        {globalZoomedOut ? 'Zoom in' : 'Zoom out'}
      </button>
    {/if}
  </div>
  <div class="mapzone">
    <svg
      bind:this={mapSvg}
      viewBox="0 0 280 200"
      preserveAspectRatio="xMaxYMid meet"
      style:display={tab === 'spain' ? 'block' : 'none'}
      onpointerdown={onMapPointerDown}
      class:interactive={mapInteractive}
      role="application"
      aria-label={mapInteractive
        ? 'Eclipse path map -- click or drag to set the observer location'
        : 'Eclipse path map -- switch to Manual (map) mode to set the observer location'}
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
      {#if outlinePenumbraLatLon.length >= 3}
        <polygon class="penumbraOutlineSpain" points={projectPts(outlinePenumbraLatLon)} />
      {/if}
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
      <polyline class="crosshair" points={projectPts(obsParallel)} />
      <polyline class="crosshair" points={projectPts(obsMeridian)} />
      {#if obsXY && sunAzSpainXY}
        <line
          class="sunazline"
          x1={obsXY[0]}
          y1={obsXY[1]}
          x2={sunAzSpainXY[0]}
          y2={sunAzSpainXY[1]}
        />
      {/if}
      {#if obsXY && moonAzSpainXY}
        <line
          class="moonazline"
          x1={obsXY[0]}
          y1={obsXY[1]}
          x2={moonAzSpainXY[0]}
          y2={moonAzSpainXY[1]}
        />
      {/if}
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
      <line
        class="sunazline"
        x1={obsGlobalXY[0]}
        y1={obsGlobalXY[1]}
        x2={sunAzGlobalXY[0]}
        y2={sunAzGlobalXY[1]}
      />
      <line
        class="moonazline"
        x1={obsGlobalXY[0]}
        y1={obsGlobalXY[1]}
        x2={moonAzGlobalXY[0]}
        y2={moonAzGlobalXY[1]}
      />
      <circle class="obsmarker" r="2.5" cx={obsGlobalXY[0]} cy={obsGlobalXY[1]} />
    </svg>
  </div>
</div>

<style>
  .mapwrap {
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  /* Right padding wider than the other panels' own tab rows: this
     pane's App.svelte-level fullscreen button (.fsbtn, ~40px inset)
     floats in the same top-right corner the Global tab's zoom-toggle
     is pinned to below -- without the extra room they'd overlap. */
  .tabs {
    flex: 0 0 32px;
    display: flex;
    gap: 2px;
    padding: 8px 40px 0 14px;
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
  /* A toggle, not a tab -- pill-styled like ContactsPanel's .globaltoggle
     rather than the plain underline the Spain/Global tab buttons use, so
     it doesn't read as a third tab. Pinned to the right via
     margin-left: auto. */
  .zoomtoggle {
    margin-left: auto;
    align-self: center;
    background: none;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 3px 8px;
    font-size: 11px;
    font-weight: 500;
    color: var(--muted);
    cursor: pointer;
  }
  .zoomtoggle.on {
    border-color: var(--accent);
    background: var(--accent-bg);
    color: var(--accent-ink);
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
    touch-action: none;
  }
  /* Only the Spain map's own svg ever gets this class, and only in
     Manual (map) mode (direct request) -- the Global tab was never
     click-to-set in the first place, and Spain itself isn't either
     outside Manual mode now. */
  .mapzone svg.interactive {
    cursor: crosshair;
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
  /* The umbral shadow's actual instantaneous footprint (as opposed to
     .shadowmarker below, just its center point) -- a dark, semi-
     transparent shape with a crisper outline stroke, matching the
     convention real eclipse-tracking maps use for "this is the shadow
     right now". */
  .umbraOutline {
    fill: var(--ink);
    fill-opacity: 0.22;
    stroke: var(--ink);
    stroke-opacity: 0.75;
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
    stroke-opacity: 0.4;
    stroke-width: 0.75;
    stroke-linejoin: round;
  }
  /* Spain tab's own penumbra outline -- same stroke as .penumbraOutline
     above, but no fill: near totality the penumbra is far bigger than
     the whole map, so a fill would wash the panel rather than just
     tracing its edge. */
  .penumbraOutlineSpain {
    fill: none;
    stroke: var(--ink);
    stroke-opacity: 0.4;
    stroke-width: 0.75;
    stroke-linejoin: round;
  }
  .shadowmarker {
    fill: #c22;
    fill-opacity: 0.8;
    stroke: none;
  }
  /* Faint dashed lat/lon crosshair through the observer's current position
     (Spain tab only) -- deliberately understated so it reads as a
     reference guide, not a drawn feature competing with the path/limit
     lines. */
  .crosshair {
    fill: none;
    stroke: var(--muted);
    stroke-width: 0.5;
    stroke-opacity: 0.4;
    stroke-dasharray: 2 2;
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
  /* Short direction-indicator lines from the observer toward the Sun/Moon's
     current azimuth (both tabs) -- thin strokes, not filled shapes, so
     they read as pointers rather than bold arrows. Sun reuses SkyPanel's
     own #f6c445 gold (.sunfill); Moon uses var(--muted) rather than
     SkyPanel's pure-black .moonfill, since a thin black line here would be
     too easily confused with .coast's own black stroke. */
  .sunazline {
    stroke: #f6c445;
    stroke-width: 1.25;
    stroke-linecap: round;
  }
  .moonazline {
    stroke: var(--muted);
    stroke-width: 1.25;
    stroke-linecap: round;
  }
  /* Global tab only: filled shapes, stroke off by default (band/umbra
     stay stroke-free by design -- at this small scale a 1px edge reads
     as visual noise, and there's no centerline/limit-line to draw here
     in the first place). Declared last so it wins over
     .umbraOutline/.penumbraOutline's own stroke for elements carrying
     both classes, regardless of source order up there; the two-class
     override below then wins back over this for the penumbra alone. */
  .globalBand {
    fill: var(--accent-bg);
    fill-opacity: 0.5;
  }
  .globalFill {
    stroke: none;
  }
  /* Umbra "darker" (direct request, twice now -- 0.22 base -> 0.45 ->
     0.6) has to mean fill-opacity here, not stroke-opacity: .globalFill
     above forces stroke: none for it (by design, per direct request -- a
     1px edge reads as noise at this scale). Two class selectors (0,2,0)
     beat the single-class base rules (0,1,0) above, so this applies only
     where both classes are present -- i.e. only the Global-tab instance. */
  .globalFill.umbraOutline {
    fill-opacity: 0.6;
  }
  /* Penumbra gets its stroke back on the Global tab (direct request --
     unlike the band/umbra above, its edge was reported not visible and
     needs one), on top of the same darkened fill-opacity bump. */
  .globalFill.penumbraOutline {
    fill-opacity: 0.15;
    stroke: var(--ink);
    stroke-opacity: 0.4;
    stroke-width: 0.5;
  }
</style>
