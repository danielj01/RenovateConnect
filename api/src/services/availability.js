// Availability helpers for appointment booking against a contractor's weekly
// business hours.
//
// Hours rows store open/close as minutes from midnight. A requested appointment
// must fall entirely within the open window for its weekday — the whole
// [start, start + duration] interval has to fit inside [openMinute, closeMinute].
//
// The requested datetime is interpreted using its UTC wall-clock components.
// There is no per-business timezone yet, so callers should treat hours as a
// soft, best-effort guard rather than a hard scheduling guarantee.

// Minutes from midnight (UTC) for a Date.
function minutesOfDay(date) {
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

// Day of week (0 = Sunday … 6 = Saturday, UTC) for a Date.
function dayOfWeek(date) {
  return date.getUTCDay();
}

// Decide whether a requested slot is bookable given a business's hours rows.
//
//   hoursRows  – [{ dayOfWeek, openMinute, closeMinute, closed }]
//   scheduledAt – Date
//   durationMin – number (defaults to 60)
//
// Returns { ok: true } when allowed, or { ok: false, reason } where reason is
// 'closed' (no hours / explicitly closed that day) or 'outside-hours' (the slot
// spills outside the open window). An empty/missing hours list means the
// business hasn't configured hours, so anything is allowed.
function checkAvailability(hoursRows, scheduledAt, durationMin = 60) {
  if (!Array.isArray(hoursRows) || hoursRows.length === 0) return { ok: true };

  const day = dayOfWeek(scheduledAt);
  const row = hoursRows.find((h) => h.dayOfWeek === day);
  if (!row || row.closed) return { ok: false, reason: 'closed' };

  const start = minutesOfDay(scheduledAt);
  const end = start + (durationMin || 60);
  if (start < row.openMinute || end > row.closeMinute) {
    return { ok: false, reason: 'outside-hours' };
  }
  return { ok: true };
}

// Human-readable rejection message for an API response.
function availabilityMessage(reason) {
  return reason === 'closed'
    ? 'The contractor is not open on that day.'
    : "That time is outside the contractor's business hours.";
}

module.exports = { checkAvailability, availabilityMessage, minutesOfDay, dayOfWeek };
