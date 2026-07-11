// PLAN.md §5: one observer store, fed by manual entry, map click/drag,
// device geolocation, or serial GPS.
import { writable } from 'svelte/store';
import { elevationAt } from '../data/elevation';

export type ObserverSource = 'manual' | 'map' | 'geolocation' | 'serial';

export interface Observer {
  lat: number;
  lon: number;
  elevationM: number;
  source: ObserverSource;
}

// Calamocha — this project's fixed default reference site. Elevation
// comes from the same bundled DEM lookup every other location uses
// (not a separate hardcoded constant), so it can't drift from the grid.
const CALAMOCHA: Observer = {
  lat: 40.92,
  lon: -1.3,
  elevationM: elevationAt(40.92, -1.3),
  source: 'manual',
};

export const observer = writable<Observer>(CALAMOCHA);

// Elevation is always looked up from lat/lon here -- the single choke
// point both manual entry (TopBar) and map click/drag (MapPanel) call
// through -- rather than passed in, so every caller gets a real
// ground-level elevation for free instead of the previous hardcoded 0.
// Device GPS (not yet wired up) will eventually be able to override
// this with a direct reading when one's available; until then this
// offline DEM lookup is the best available estimate everywhere.
export function setObserver(lat: number, lon: number, source: ObserverSource = 'manual'): void {
  observer.update((o) => ({ ...o, lat, lon, source, elevationM: elevationAt(lat, lon) }));
}
