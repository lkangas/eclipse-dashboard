// Panel fullscreen mode (direct request). null = the normal 2x2
// split-pane grid (App.svelte); any PanelId = that one panel fills the
// whole content area, with FullscreenBar.svelte's own tab row switching
// between the four. Deliberately just an id, not a boolean-per-panel
// set -- exactly one can be fullscreen at a time, which a single
// nullable value models directly instead of needing to enforce
// mutual exclusion elsewhere.
import { writable } from 'svelte/store';

export type PanelId = 'timetable' | 'countdown' | 'map' | 'sky';

export const fullscreenPanel = writable<PanelId | null>(null);

// GPS NMEA monitor (direct request): a standalone fullscreen overlay
// triggered from GpsRibbon, not one of the four main panels above -- it
// has no home slot in the 2x2 grid, so it gets its own boolean rather
// than forcing a PanelId-shaped hole into that union for a single
// non-grid panel. Independent of fullscreenPanel: either, both, or
// neither can be active (GpsMonitorPanel renders as a position:fixed
// overlay on top of everything, grid fullscreen or not).
export const gpsMonitorOpen = writable(false);

// Whether TopBar's second GPS ribbon (GpsRibbon.svelte -- Connect/
// Connected, baud, port, Freeze, the monitor button, status text) is
// expanded (direct request: "the GPS button should be a toggle for the
// second ribbon"). A plain shared boolean rather than component-local
// state because the toggle button (row 1, TopBar.svelte) and the ribbon
// it controls (row 2, GpsRibbon.svelte) are two separately-mounted
// pieces of markup -- row 2 has to be a sibling of row 1's whole
// container to span the full width below it, not a child of row 1's own
// flex group, so they can't share a single component's local state.
// Defaults closed: a session that never touches GPS shouldn't carry the
// extra row just because it exists.
export const gpsRibbonExpanded = writable(false);

// Whether the Sound Warnings config view (SoundConfigPanel.svelte) shows
// in place of ContactsPanel in the 'timetable' pane (direct request: "a
// config view that's togglable to be visible in the place of the
// timetable view"). Both panels stay mounted at all times -- same
// rationale as fullscreenPanel above (never resets internal state, here
// specifically an in-progress phrase-text edit) -- App.svelte just swaps
// which one is display:none. Defaults closed: this is a setup/rehearsal
// tool, not something that should occupy the Timetable's normal spot on
// every load.
export const soundConfigVisible = writable(false);
