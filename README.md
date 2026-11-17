# worked-time-kit

Computes total worked hours and overtime from a list of shift entries, subtracting unpaid breaks and rounding to configurable intervals.

```js
import { calculateWorkedTime, formatMinutes } from "./src/index.js";

const result = calculateWorkedTime(
  [
    { start: "2024-03-04T09:00", end: "2024-03-04T17:30", unpaidBreakMinutes: 30 },
    { start: "2024-03-05T09:00", end: "2024-03-05T09:07" },
  ],
  { roundToMinutes: 15, overtimeAfterMinutes: 480 },
);

console.log(result.totalMinutes);      // 495
console.log(result.overtimeMinutes);   // 0
console.log(result.perShiftMinutes);   // [480, 15]
console.log(formatMinutes(result.totalMinutes)); // "8:15"
```

## Why this exists

Timesheet arithmetic looks trivial until breaks and rounding enter the picture. The two decisions that cause real disputes are *where* rounding is applied and *how* breaks interact with it. This library rounds each shift independently, after the unpaid break is deducted, rather than rounding the sum of all shifts. Rounding the total would let two shifts that each fall just under an interval combine into an extra paid interval, which is not how payroll is normally settled. The trade-off is that a single shift split across midnight is treated as two entries; callers who need to merge them should do so before calling in.

## Edge cases you will hit

Datetimes are parsed as local wall-clock strings with no timezone offset; `"2024-03-04T09:00Z"` and `"2024-03-04T09:00+01:00"` are rejected on purpose. A shift whose end precedes its start is an error rather than a negative duration, and an unpaid break longer than the shift is rejected. Overtime is evaluated per shift against `overtimeAfterMinutes`; setting it to `0` (the default) disables overtime entirely. All rounding is half-up on non-negative minute counts.

## API

- `parseLocalDateTime(value)` — parse an ISO-8601 local datetime to epoch milliseconds.
- `roundMinutes(minutes, interval)` — round to the nearest multiple, half up.
- `shiftRawMinutes(shift)` — worked minutes before rounding.
- `shiftPaidMinutes(shift, roundToMinutes)` — worked minutes after rounding.
- `calculateWorkedTime(shifts, options)` — returns `{ totalMinutes, overtimeMinutes, regularMinutes, perShiftMinutes }`.
- `formatMinutes(minutes)` — render an integer minute count as `H:MM`.

Options for `calculateWorkedTime`: `roundToMinutes` (positive integer, default `1`) and `overtimeAfterMinutes` (non-negative integer, default `0`, meaning disabled).

## Performance

The window keeps a bounded buffer, so `push` is constant time and memory does not
grow with the length of the stream. `peak` and `trough` are linear in the window
size, which is the trade that keeps `push` cheap.

