/**
 * getMatchTimeLabel — compact label for card start-time display.
 *
 * Rules:
 *   "Live"          — event has already started (diff ≤ 0)
 *   "Starting soon" — starts within 60 minutes
 *   "In Xh"         — starts within 24 hours
 *   "Mar 20"        — starts in more than 24 hours (UTC date)
 *   "TBD"           — null / un-parseable
 *
 * Timezone safety: strings without a TZ suffix are assumed UTC.
 */
export function getMatchTimeLabel(rawStartsAt: string | null | undefined): string {
  if (!rawStartsAt) return "TBD";

  const hasOffset = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(rawStartsAt);
  const normalized = hasOffset ? rawStartsAt : rawStartsAt + "Z";

  const d = new Date(normalized);
  if (isNaN(d.getTime())) return "TBD";

  const diff = d.getTime() - Date.now();
  if (diff <= 0) return "Live";

  const totalMins = Math.floor(diff / 60_000);
  if (totalMins < 60) return "Starting soon";

  const hrs = Math.floor(totalMins / 60);
  if (hrs < 24) return `In ${hrs}h`;

  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * getUpcomingTimeLabel — converts an event's startsAt timestamp into a
 * human-readable countdown string shown in the Upcoming panel.
 *
 * Timezone safety:
 *   Dates without a timezone suffix (e.g. "2026-03-17T20:00:00") are
 *   treated as UTC by appending "Z". This prevents browsers from
 *   interpreting them as local time, which would shift the timestamp and
 *   incorrectly show future events as "Starting now".
 *
 * Examples:
 *   "Starts in 8m"     — less than one hour
 *   "Starts in 2h 15m" — less than one day
 *   "Starts in 1d 3h"  — one day or more
 *   "Starting now"     — diff ≤ 0
 *   "Schedule TBD"     — null, empty, or un-parseable date
 */
export function getUpcomingTimeLabel(rawStartsAt: string | null | undefined): string {
  if (!rawStartsAt) return "Schedule TBD";

  const hasOffset = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(rawStartsAt);
  const normalized = hasOffset ? rawStartsAt : rawStartsAt + "Z";

  const d = new Date(normalized);
  if (isNaN(d.getTime())) return "Schedule TBD";

  const diff = d.getTime() - Date.now();
  if (diff <= 0) return "Starting now";

  const totalMins = Math.floor(diff / 60_000);

  if (totalMins < 60) {
    return `Starts in ${totalMins}m`;
  }

  const hrs  = Math.floor(totalMins / 60);
  const mins = totalMins % 60;

  if (hrs < 24) {
    return mins > 0 ? `Starts in ${hrs}h ${mins}m` : `Starts in ${hrs}h`;
  }

  const days   = Math.floor(hrs / 24);
  const remHrs = hrs % 24;
  return remHrs > 0 ? `Starts in ${days}d ${remHrs}h` : `Starts in ${days}d`;
}
