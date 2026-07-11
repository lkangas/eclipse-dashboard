<script lang="ts">
  // STUB path/coastline data, ported verbatim from
  // design/layout-v3-fullscreen.html. Real basemap.topojson + path.ts
  // (already computed and tested, see app/src/data + app/src/eclipse) are
  // wired in as a follow-up slice -- this one is a mechanical structural
  // port only.
  import { observer, setObserver } from '../../stores/observer';
  import { clock } from '../../stores/clock';

  let tab: 'spain' | 'global' = $state('spain');

  const MAP_LON_MIN = -10,
    MAP_LAT_MIN = 35.5,
    MAP_LAT_MAX = 44.5;
  const MAP_VH = 200;
  const MAP_K = MAP_VH / (MAP_LAT_MAX - MAP_LAT_MIN);
  const MAP_COS = Math.cos((40 * Math.PI) / 180);
  function mapX(lon: number) {
    return (lon - MAP_LON_MIN) * MAP_COS * MAP_K;
  }
  function mapY(lat: number) {
    return (MAP_LAT_MAX - lat) * MAP_K;
  }
  function mapPts(pairs: [number, number][]) {
    return pairs.map(([lat, lon]) => mapX(lon) + ',' + mapY(lat)).join(' ');
  }

  const COAST_IBERIA: [number, number][] = [
    [42.88, -9.27], [43.37, -8.4], [43.54, -7.04], [43.53, -5.66], [43.46, -3.8],
    [43.42, -2.92], [43.38, -1.79], [44.5, -1.5], [44.5, 3.0], [42.32, 3.32],
    [41.38, 2.18], [41.12, 1.25], [40.36, 0.4], [39.47, -0.38], [38.35, -0.48],
    [37.63, -0.68], [36.84, -2.47], [36.72, -4.42], [36.0, -5.6], [36.53, -6.3],
    [37.26, -6.95], [37.02, -7.93], [37.02, -8.93], [38.72, -9.14], [39.6, -9.07],
    [41.15, -8.71], [41.69, -8.83], [42.23, -8.72],
  ];
  const BALEARICS = [
    { c: [39.6, 2.9] as [number, number], rx: 10, ry: 7 }, // Mallorca
    { c: [40.0, 4.1] as [number, number], rx: 5, ry: 3 }, // Menorca
    { c: [38.95, 1.43] as [number, number], rx: 4, ry: 5 }, // Ibiza
  ];

  // Northern limit, southern limit, central line -- decimal degrees,
  // [lat, lon], 18:18-18:33 UT plus the path's terminal "Limit" point (sun
  // alt 0°, near the Balearics), from ytliu's independent eclipse
  // calculator (JPL DE441, dT=69.2s). PATH_NORTH_END bridges 18:30 to the
  // Limit row's true final north-limit fix with one straight segment (the
  // real curve there is unknown, but leaving it off entirely made the band
  // stop short of the centerline/shadow marker's actual end).
  const PATH_NORTH: [number, number][] = [
    [49.3533, -11.5883], [48.7983, -10.97], [48.2333, -10.3133], [47.6567, -9.61],
    [47.065, -8.8517], [46.4583, -8.0317], [45.83, -7.135], [45.1767, -6.1417],
    [44.4883, -5.0217], [43.7533, -3.7317], [42.9467, -2.1833], [42.0167, -0.18],
    [40.7483, 3.04],
  ];
  const PATH_NORTH_END: [number, number] = [39.7067, 6.3283];
  const PATH_SOUTH: [number, number][] = [
    [49.205, -16.8017], [48.69, -16.2517], [48.17, -15.6767], [47.6417, -15.0733],
    [47.1067, -14.4383], [46.5633, -13.7667], [46.0083, -13.0533], [45.44, -12.29],
    [44.8583, -11.4717], [44.2583, -10.5833], [43.635, -9.61], [42.985, -8.53],
    [42.295, -7.3083],
    [41.5517, -5.885], [40.7233, -4.1417], [39.7283, -1.7783], [37.69, 4.5283],
  ];
  const PATH_CENTER: [number, number][] = [
    [49.31, -14.2783], [48.7767, -13.7], [48.235, -13.09], [47.6867, -12.445],
    [47.1267, -11.76], [46.555, -11.0283], [45.97, -10.2417], [45.3667, -9.3883],
    [44.7417, -8.4567], [44.0917, -7.4233], [43.405, -6.2583], [42.6683, -4.9117],
    [41.8567, -3.2833], [40.905, -1.1433], [39.515, 2.6067], [38.68, 5.4017],
  ];
  // UT seconds-since-midnight for each PATH_CENTER point above (18:18-18:32:12).
  const PATH_CENTER_UT = [
    65880, 65940, 66000, 66060, 66120, 66180, 66240, 66300, 66360, 66420, 66480,
    66540, 66600, 66660, 66720, 66732,
  ];
  const band = PATH_NORTH.concat([PATH_NORTH_END]).concat(PATH_SOUTH.slice().reverse());

  // clock.simTimeSec is local (CEST); the path table above is UT.
  // CEST = UT+2, so UT = simTime - 7200. Marker is hidden outside the
  // table's covered window (before/after the shadow transits Spain).
  function shadowPosAtUT(ut: number): [number, number] | null {
    if (ut < PATH_CENTER_UT[0] || ut > PATH_CENTER_UT[PATH_CENTER_UT.length - 1]) return null;
    let i = 0;
    while (i < PATH_CENTER_UT.length - 2 && ut > PATH_CENTER_UT[i + 1]) i++;
    const t0 = PATH_CENTER_UT[i],
      t1 = PATH_CENTER_UT[i + 1];
    const f = (ut - t0) / (t1 - t0);
    const [lat0, lon0] = PATH_CENTER[i],
      [lat1, lon1] = PATH_CENTER[i + 1];
    return [lat0 + (lat1 - lat0) * f, lon0 + (lon1 - lon0) * f];
  }
  const shadowPos = $derived(shadowPosAtUT($clock.simTimeSec - 7200));

  // Click-to-set and drag-to-fine-tune are the same gesture: a single
  // pointerdown+pointermove+pointerup sequence.
  let mapSvg: SVGSVGElement;
  function mapClientToLatLon(clientX: number, clientY: number): [number, number] {
    const pt = mapSvg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(mapSvg.getScreenCTM()!.inverse());
    return [MAP_LAT_MAX - p.y / MAP_K, p.x / (MAP_COS * MAP_K) + MAP_LON_MIN];
  }
  function onMapPointerDown(e: PointerEvent) {
    mapSvg.setPointerCapture(e.pointerId);
    const [lat, lon] = mapClientToLatLon(e.clientX, e.clientY);
    setObserver(lat, lon, 'map');
    function move(e: PointerEvent) {
      const [lat, lon] = mapClientToLatLon(e.clientX, e.clientY);
      setObserver(lat, lon, 'map');
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
      <polygon class="coast" points={mapPts(COAST_IBERIA)} />
      {#each BALEARICS as isl (isl.c.join(','))}
        <ellipse class="coast" cx={mapX(isl.c[1])} cy={mapY(isl.c[0])} rx={isl.rx} ry={isl.ry} />
      {/each}
      <polygon class="pathband" points={mapPts(band)} />
      <polyline class="pathline" points={mapPts(PATH_CENTER)} />
      <circle
        class="shadowmarker"
        r="4"
        cx={shadowPos ? mapX(shadowPos[1]) : 0}
        cy={shadowPos ? mapY(shadowPos[0]) : 0}
        opacity={shadowPos ? 1 : 0}
      />
      <circle class="obsmarker" r="3.5" cx={mapX($observer.lon)} cy={mapY($observer.lat)} />
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
