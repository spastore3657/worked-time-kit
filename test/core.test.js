import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseLocalDateTime,
  roundMinutes,
  shiftRawMinutes,
  shiftPaidMinutes,
  calculateWorkedTime,
  formatMinutes,
} from "../src/index.js";

test("parseLocalDateTime encodes fields deterministically", () => {
  const a = parseLocalDateTime("2024-03-04T09:00");
  const b = parseLocalDateTime("2024-03-04T09:00:00");
  assert.equal(a, b);
  assert.equal(a, Date.UTC(2024, 2, 4, 9, 0, 0));
});

test("parseLocalDateTime rejects offsets and malformed input", () => {
  assert.throws(() => parseLocalDateTime("2024-03-04T09:00Z"), RangeError);
  assert.throws(() => parseLocalDateTime("2024-03-04T09:00+01:00"), RangeError);
  assert.throws(() => parseLocalDateTime("2024-13-01T09:00"), RangeError);
  assert.throws(() => parseLocalDateTime("2024-02-30T09:00"), RangeError);
  assert.throws(() => parseLocalDateTime(1234), TypeError);
});

test("roundMinutes rounds half up to the interval", () => {
  assert.equal(roundMinutes(7, 5), 5);
  assert.equal(roundMinutes(7.5, 5), 10);
  assert.equal(roundMinutes(0, 15), 0);
  assert.equal(roundMinutes(8, 1), 8);
  assert.throws(() => roundMinutes(-1, 5), RangeError);
  assert.throws(() => roundMinutes(5, 0), RangeError);
});

test("shiftRawMinutes deducts an unpaid break", () => {
  const raw = shiftRawMinutes({
    start: "2024-03-04T09:00",
    end: "2024-03-04T17:30",
    unpaidBreakMinutes: 30,
  });
  assert.equal(raw, 480);
});

test("shiftRawMinutes treats a missing break as zero", () => {
  const raw = shiftRawMinutes({ start: "2024-03-04T09:00", end: "2024-03-04T10:00" });
  assert.equal(raw, 60);
});

test("shiftRawMinutes rejects inverted and over-long breaks", () => {
  assert.throws(
    () => shiftRawMinutes({ start: "2024-03-04T17:00", end: "2024-03-04T09:00" }),
    RangeError,
  );
  assert.throws(
    () =>
      shiftRawMinutes({
        start: "2024-03-04T09:00",
        end: "2024-03-04T10:00",
        unpaidBreakMinutes: 90,
      }),
    RangeError,
  );
});

test("shiftPaidMinutes rounds after deducting the break", () => {
  const paid = shiftPaidMinutes(
    { start: "2024-03-04T09:00", end: "2024-03-04T09:07", unpaidBreakMinutes: 2 },
    5,
  );
  assert.equal(paid, 5);
});

test("calculateWorkedTime sums rounded per-shift minutes", () => {
  const result = calculateWorkedTime(
    [
      { start: "2024-03-04T09:00", end: "2024-03-04T12:00" },
      { start: "2024-03-05T09:00", end: "2024-03-05T09:07" },
    ],
    { roundToMinutes: 15 },
  );
  assert.equal(result.totalMinutes, 180);
  assert.deepEqual(result.perShiftMinutes, [180, 0]);
  assert.equal(result.overtimeMinutes, 0);
  assert.equal(result.regularMinutes, 180);
});

test("calculateWorkedTime splits overtime per shift", () => {
  const result = calculateWorkedTime(
    [
      { start: "2024-03-04T08:00", end: "2024-03-04T18:00", unpaidBreakMinutes: 60 },
      { start: "2024-03-05T08:00", end: "2024-03-05T12:00" },
    ],
    { roundToMinutes: 15, overtimeAfterMinutes: 480 },
  );
  assert.equal(result.totalMinutes, 780);
  assert.equal(result.overtimeMinutes, 60);
  assert.equal(result.regularMinutes, 720);
  assert.deepEqual(result.perShiftMinutes, [540, 240]);
});

test("calculateWorkedTime with an empty list returns zeros", () => {
  const result = calculateWorkedTime([], { roundToMinutes: 5, overtimeAfterMinutes: 480 });
  assert.deepEqual(result, {
    totalMinutes: 0,
    overtimeMinutes: 0,
    regularMinutes: 0,
    perShiftMinutes: [],
  });
});

test("calculateWorkedTime validates its options", () => {
  assert.throws(() => calculateWorkedTime("nope"), TypeError);
  assert.throws(() => calculateWorkedTime([], { roundToMinutes: 0 }), RangeError);
  assert.throws(() => calculateWorkedTime([], { overtimeAfterMinutes: -1 }), RangeError);
});

test("formatMinutes renders H:MM with zero padding", () => {
  assert.equal(formatMinutes(0), "0:00");
  assert.equal(formatMinutes(5), "0:05");
  assert.equal(formatMinutes(495), "8:15");
  assert.throws(() => formatMinutes(-1), RangeError);
  assert.throws(() => formatMinutes(1.5), RangeError);
});
