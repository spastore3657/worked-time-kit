// Core worked-time calculations. Pure functions, no I/O, no clock access.
//
// Rounding model: each shift's paid minutes are rounded to the nearest multiple
// of `roundToMinutes`. We round per-shift rather than on the grand total because
// payroll systems bill each shift separately, and rounding the sum would let two
// short shifts cancel into a full one. Rounding is "round half up" on positive
// values, which matches how timesheets are conventionally settled.

/**
 * @typedef {Object} Shift
 * @property {string} start  ISO-8601 local time, e.g. "2024-03-04T09:00"
 * @property {string} end    ISO-8601 local time, same day or later
 * @property {number} [unpaidBreakMinutes]  break deducted before rounding
 */

/**
 * Parse an ISO-8601 local datetime into epoch milliseconds.
 *
 * We deliberately reject strings carrying an explicit offset or trailing "Z".
 * A shift is a wall-clock span at a single workplace; mixing zones would make
 * the arithmetic depend on the machine's timezone, which is exactly the kind of
 * nondeterminism this library exists to avoid.
 *
 * @param {string} value
 * @returns {number}
 */
export function parseLocalDateTime(value) {
  if (typeof value !== "string") {
    throw new TypeError("datetime must be a string");
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) {
    throw new RangeError(`not an ISO-8601 local datetime: ${value}`);
  }
  const [, y, mo, d, h, mi, s] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = s === undefined ? 0 : Number(s);

  if (month < 1 || month > 12) throw new RangeError(`month out of range: ${value}`);
  if (day < 1 || day > 31) throw new RangeError(`day out of range: ${value}`);
  if (hour > 23) throw new RangeError(`hour out of range: ${value}`);
  if (minute > 59) throw new RangeError(`minute out of range: ${value}`);
  if (second > 59) throw new RangeError(`second out of range: ${value}`);

  // Date.UTC gives a wall-clock-consistent epoch for the fields we parsed; we
  // never read the local timezone back out, so this is just a stable encoding.
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(ms);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new RangeError(`invalid calendar date: ${value}`);
  }
  return ms;
}

/**
 * Round a non-negative number of minutes to the nearest multiple.
 * Half values round up, so 7.5 minutes at a 5-minute interval becomes 10.
 *
 * @param {number} minutes
 * @param {number} interval
 * @returns {number}
 */
export function roundMinutes(minutes, interval) {
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new RangeError("minutes must be a finite non-negative number");
  }
  if (!Number.isInteger(interval) || interval <= 0) {
    throw new RangeError("interval must be a positive integer");
  }
  return Math.round(minutes / interval) * interval;
}

/**
 * Compute the raw (unrounded) worked minutes for a single shift.
 *
 * @param {Shift} shift
 * @returns {number}
 */
export function shiftRawMinutes(shift) {
  if (shift === null || typeof shift !== "object") {
    throw new TypeError("shift must be an object");
  }
  const start = parseLocalDateTime(shift.start);
  const end = parseLocalDateTime(shift.end);
  if (end < start) {
    throw new RangeError(`shift ends before it starts: ${shift.start} -> ${shift.end}`);
  }
  const breakMinutes = shift.unpaidBreakMinutes === undefined ? 0 : shift.unpaidBreakMinutes;
  if (!Number.isFinite(breakMinutes) || breakMinutes < 0) {
    throw new RangeError("unpaidBreakMinutes must be a finite non-negative number");
  }
  const total = (end - start) / 60000;
  if (breakMinutes > total) {
    throw new RangeError("unpaid break exceeds shift length");
  }
  return total - breakMinutes;
}

/**
 * Compute the rounded paid minutes for a single shift.
 *
 * @param {Shift} shift
 * @param {number} roundToMinutes
 * @returns {number}
 */
export function shiftPaidMinutes(shift, roundToMinutes) {
  return roundMinutes(shiftRawMinutes(shift), roundToMinutes);
}

/**
 * @typedef {Object} WorkedTimeOptions
 * @property {number} [roundToMinutes]  default 1 (no rounding)
 * @property {number} [overtimeAfterMinutes]  per-day threshold; 0 disables overtime
 */

/**
 * @typedef {Object} WorkedTimeResult
 * @property {number} totalMinutes        rounded paid minutes across all shifts
 * @property {number} overtimeMinutes     rounded paid minutes beyond the daily threshold
 * @property {number} regularMinutes      totalMinutes - overtimeMinutes
 * @property {number[]} perShiftMinutes   rounded paid minutes per shift, in input order
 */

/**
 * Sum worked time across shifts, deducting unpaid breaks and rounding per shift.
 *
 * Overtime is evaluated per shift against `overtimeAfterMinutes`; a shift of
 * 600 minutes with a 480-minute threshold yields 120 overtime minutes. When
 * overtime is disabled (threshold 0) every minute is regular time.
 *
 * @param {Shift[]} shifts
 * @param {WorkedTimeOptions} [options]
 * @returns {WorkedTimeResult}
 */
export function calculateWorkedTime(shifts, options = {}) {
  if (!Array.isArray(shifts)) {
    throw new TypeError("shifts must be an array");
  }
  const roundToMinutes = options.roundToMinutes === undefined ? 1 : options.roundToMinutes;
  const overtimeAfterMinutes =
    options.overtimeAfterMinutes === undefined ? 0 : options.overtimeAfterMinutes;

  if (!Number.isInteger(roundToMinutes) || roundToMinutes <= 0) {
    throw new RangeError("roundToMinutes must be a positive integer");
  }
  if (!Number.isInteger(overtimeAfterMinutes) || overtimeAfterMinutes < 0) {
    throw new RangeError("overtimeAfterMinutes must be a non-negative integer");
  }

  const perShiftMinutes = [];
  let totalMinutes = 0;
  let overtimeMinutes = 0;

  for (const shift of shifts) {
    const paid = shiftPaidMinutes(shift, roundToMinutes);
    perShiftMinutes.push(paid);
    totalMinutes += paid;
    if (overtimeAfterMinutes > 0 && paid > overtimeAfterMinutes) {
      overtimeMinutes += paid - overtimeAfterMinutes;
    }
  }

  return {
    totalMinutes,
    overtimeMinutes,
    regularMinutes: totalMinutes - overtimeMinutes,
    perShiftMinutes,
  };
}

/**
 * Format a minute count as "H:MM", e.g. 495 -> "8:15".
 * Negative inputs are rejected; a negative duration has no sensible rendering.
 *
 * @param {number} minutes
 * @returns {string}
 */
export function formatMinutes(minutes) {
  if (!Number.isInteger(minutes) || minutes < 0) {
    throw new RangeError("minutes must be a non-negative integer");
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}:${String(rest).padStart(2, "0")}`;
}
