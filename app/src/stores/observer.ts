// PLAN.md §5: one observer store, fed by manual entry, map click/drag,
// device geolocation, or serial GPS.
import { writable } from 'svelte/store';

export type ObserverSource = 'manual' | 'map' | 'geolocation' | 'serial';

export interface Observer {
  lat: number;
  lon: number;
  elevationM: number;
  source: ObserverSource;
}

// Calamocha — this project's fixed default reference site.
const CALAMOCHA: Observer = { lat: 40.92, lon: -1.3, elevationM: 0, source: 'manual' };

export const observer = writable<Observer>(CALAMOCHA);

export function setObserver(lat: number, lon: number, source: ObserverSource = 'manual'): void {
  observer.update((o) => ({ ...o, lat, lon, source }));
}
