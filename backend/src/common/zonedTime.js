/*
 * Instants and wall-clock times in a time zone (the platform time zone, or the one stored with a
 * schedule version). Dates are 'YYYY-MM-DD', times minutes after midnight.
 */

const parts = (instant, timeZone) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(instant)
      .map((x) => [x.type, x.value]),
  );

/** 00:00 of a local date in a time zone, as an instant (no daylight-saving gap at midnight in the platform zones). */
export function zonedMidnight(date, timeZone) {
  const guess = new Date(`${date}T00:00:00Z`);
  const p = parts(guess, timeZone);
  const shown = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);
  return new Date(guess.getTime() - (shown - guess.getTime()));
}

/** A local date and time (minutes after midnight, 0–1439) in a time zone, as an instant. */
export const zonedInstant = (date, minutes, timeZone) => new Date(zonedMidnight(date, timeZone).getTime() + (minutes ?? 0) * 60_000);

/** The local date, 'HH:MM' and minutes after midnight of an instant in a time zone. */
export function localDateTime(instant, timeZone) {
  const p = parts(instant, timeZone);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
