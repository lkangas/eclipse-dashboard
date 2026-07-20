# Status — Eclipse Dashboard

**Updated:** 2026-07-20 · **T−23 days** to the eclipse (2026-08-12, ~18:26–18:33 UT,
Spain) · `main` @ current HEAD · `npm run test`: 258/258 · `npm run check`: 0 errors

Markers: ✅ done · 🟡 partial · ⬜ not started. Update this file when a
feature's state actually changes, not per-commit — `git log` is the
changelog. See `docs/PLAN.md` §1–§12/§14–§15 for the frozen spec/architecture
(still accurate); its §13 is a historical worklog, not current status.

## Core computation & rendering

- ✅ Besselian element math, oracle-validated against an independent Python
  implementation to sub-millisecond contact-time agreement.
- ✅ Contacts/Countdown panels, Map (Spain + Global tabs), Sky (Wide +
  All-sky) — all real computation, no stub data anywhere.
- ✅ Zero runtime network requests — verified this session directly against
  the production build's network log (3 requests total: HTML + one JS
  bundle + inlined CSS), not just asserted.

## Observer location (all four sources now real)

- ✅ Manual entry (typed coordinates + map click/drag), preset sites (11
  fixed Spain locations).
- ✅ Browser/device geolocation.
- ✅ USB serial NMEA GPS — connect/disconnect/reconnect (no repeated native
  device picker once granted), baud selection, a port picker for switching
  between multiple granted devices, Freeze/Unfreeze, GPS-disciplined clock
  (GPS Δ badge), elevation out-of-bounds handling, 2D/3D fix type (GSA), an
  Hz rate indicator with staleness detection, and a fullscreen raw-NMEA
  stream monitor. Two real connection-lifecycle bugs found and fixed this
  session (port left open on source switch; "port already open" on a fast
  Connect→Disconnect→Connect).
- 🟡 GPS NMEA monitor is a deliberate "few fields" first pass (fix
  quality/type, UTC, lat/lon, altitude, sats, HDOP, raw stream, Hz). A full
  expansion plan exists (`docs/GPS-MONITOR-PLAN.md`) for a
  GSV/full-GSA/VTG/GLL/GNS satellite sky-plot + SNR bars, phased — not yet
  implemented.

## Field deployment

- ✅ Localhost-server path chosen and tested: `app/serve-field.cmd`
  (double-click, opens the browser, serves the production build via `vite
  preview`) plus direct `file://` access (both fixed this session — the
  build now emits relative asset paths and a classic/deferred script
  instead of an ES module, since Chrome refuses module scripts from a
  `file://` origin entirely).
- ⬜ **Tauri "no-admin `.exe`" spike — formally not pursued.** Explicit
  decision this session to commit to the localhost-server path instead
  (matching PLAN.md's own "run it early or kill it" framing) rather than
  take on an unverified Rust/MSVC-vs-GNU toolchain install this close to
  the event.
- ⬜ Full field rehearsal (off OneDrive, airplane mode, cold boot →
  simulated C4) — not yet done.

## Known gaps (unchanged from the 2026-07-13 review, still accurate)

- ⬜ **Sound warnings** — zero code. The single largest remaining gap for
  actual field use; nobody's reading a screen during totality.
- ✅ **Horizon obstruction check** (`docs/HORIZON-PLAN.md`) — all 3 phases
  done: real terrain-horizon profile cross-referenced against each
  contact's actual Sun position, SkyPanel's Wide-view horizon follows the
  real silhouette (toggleable; the flat 0° reference always shows too),
  ContactsPanel flags any predicted-obstructed contact (Sunset itself
  excluded — it trips almost everywhere and isn't an actionable signal).
  The bundled DEM is now Copernicus GLO-30 at 250m (up from ETOPO's
  ~1.4-1.9km) specifically for this feature, loaded async/lazily
  (`data/elevationFine.ts`) so it doesn't sit on the app's startup path —
  the location picker's own elevation display stays on the small,
  always-instant ETOPO grid. Real-world startup cost of embedding the
  250m grid: ~5s (measured on real hardware; left as-is, a `fetch()`-based
  hybrid was scoped but not built — see the plan doc's own notes). Still
  true regardless of DEM tier: no DEM sees close-in obstructions like
  trees or buildings — always needs on-site verification, and the UI says
  so.
- 🟡 **Licensing** — `constellation-lines.json` (Stellarium/HYG-derived)
  still has no `NOTICE.md` entry, no in-app credits screen exists, and the
  root `README.md` license line is still "TBD."
- ⬜ Sunset-filtering/"next observable event" logic is still triplicated
  across `ContactsPanel`/`CountdownPanel`/`TimeBar` with no shared tested
  function; no test pins the ΔT-override installation either.
- ✅ `eclipse-times.json`'s ΔT (69.2s, its ytliu cross-check source) vs. the
  app's own locked 69.1s — accepted as-is (user decision, 2026-07-17); the
  69.1s lock is independently corroborated (real IERS data: 69.17s), so this
  is a validation-tolerance footnote, not a bug to reconcile further.
- ⬜ No CI.

## Housekeeping

- ✅ Empty stray `app/.cache_test/` removed.
- ✅ The orphaned worktree (`.claude/worktrees/agent-a861cfdb1a408d777`) and
  its fully-merged branch, flagged above as safe-but-blocked, are removed
  (2026-07-17).
