// Shared display formatting for contact-time offsets and clock strings.

// Standard countdown-clock convention: an upcoming event counts down as
// T-minus ('−' prefix, shrinking toward zero); a past event counts up as
// T-plus ('+' prefix). secondsUntilEvent > 0 means the event is still
// ahead of `now`.
export function formatCountdown(secondsUntilEvent: number): string {
  const sign = secondsUntilEvent > 0 ? '−' : '+';
  let s = Math.abs(secondsUntilEvent);
  const days = Math.floor(s / 86400);
  s -= days * 86400;
  const hours = Math.floor(s / 3600);
  s -= hours * 3600;
  const minutes = Math.floor(s / 60);
  s -= minutes * 60;
  const seconds = s;

  if (days > 0) {
    return `${sign}${days}d ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }
  if (hours > 0) {
    return `${sign}${hours}:${String(minutes).padStart(2, '0')}:${String(Math.floor(seconds)).padStart(2, '0')}`;
  }
  const secText =
    Math.abs(secondsUntilEvent) < 120
      ? seconds.toFixed(1).padStart(4, '0')
      : String(Math.floor(seconds)).padStart(2, '0');
  return `${sign}${String(minutes).padStart(2, '0')}:${secText}`;
}

export function formatDurationSeconds(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.round(totalSeconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

const cestClockFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Madrid',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});
export function formatCest(date: Date): string {
  return cestClockFmt.format(date);
}

/** ISO 8601 UTC timestamp with one decimal of sub-second precision, e.g.
 * "2024-04-08T17:22:44.8Z" -- the format third-party eclipse-photography
 * tooling expects (see lib/exportTimes.ts), not this app's own 3-decimal
 * Date#toISOString() default. */
export function formatIsoTenths(date: Date): string {
  const ms = date.getUTCMilliseconds();
  const tenths = Math.round(ms / 100);
  if (tenths === 10) {
    // Rounds up into the next second -- recurse on the bumped instant
    // rather than hand-rolling second/minute/hour/day/month/year carry.
    return formatIsoTenths(new Date(date.getTime() + (1000 - ms)));
  }
  return `${date.toISOString().slice(0, 19)}.${tenths}Z`;
}
