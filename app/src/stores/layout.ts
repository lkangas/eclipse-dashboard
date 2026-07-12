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
