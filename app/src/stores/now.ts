// A single shared 1s-ticking clock, so every component that needs "the
// current wall-clock instant" (topbar clocks, countdown, contacts table)
// shares one setInterval instead of each running its own. readable()'s
// start function only runs while at least one subscriber is active.
import { readable } from 'svelte/store';

export const now = readable(new Date(), (set) => {
  const id = setInterval(() => set(new Date()), 1000);
  return () => clearInterval(id);
});
