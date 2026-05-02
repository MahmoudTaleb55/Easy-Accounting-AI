import { describe, expect, test } from "vitest";

import {
  findNearestPostingOutsidePeriod,
  periodHasAnyPosting,
} from "../use-period-emptiness";

describe("periodHasAnyPosting", () => {
  const start = new Date("2026-04-01T00:00:00Z");
  const end = new Date("2026-04-30T23:59:59Z");

  test("returns true when at least one timestamp falls inside the window", () => {
    const ms = [
      new Date("2026-01-15T12:00:00Z").getTime(),
      new Date("2026-04-10T12:00:00Z").getTime(),
      new Date("2026-07-04T12:00:00Z").getTime(),
    ];
    expect(periodHasAnyPosting(ms, start, end)).toBe(true);
  });

  test("returns false when every timestamp falls outside the window", () => {
    const ms = [
      new Date("2026-03-31T23:59:58Z").getTime(),
      new Date("2026-05-01T00:00:00Z").getTime(),
    ];
    expect(periodHasAnyPosting(ms, start, end)).toBe(false);
  });

  test("returns false on an empty input", () => {
    expect(periodHasAnyPosting([], start, end)).toBe(false);
  });

  test("treats both boundaries as inclusive", () => {
    expect(periodHasAnyPosting([start.getTime()], start, end)).toBe(true);
    expect(periodHasAnyPosting([end.getTime()], start, end)).toBe(true);
  });
});

describe("findNearestPostingOutsidePeriod", () => {
  const start = new Date("2026-04-01T00:00:00Z");
  const end = new Date("2026-04-30T23:59:59Z");

  test("returns null when there are no postings at all", () => {
    expect(findNearestPostingOutsidePeriod([], start, end)).toBeNull();
  });

  test("returns null when every posting falls inside the window", () => {
    const ms = [
      new Date("2026-04-10T12:00:00Z").getTime(),
      new Date("2026-04-25T12:00:00Z").getTime(),
    ];
    expect(findNearestPostingOutsidePeriod(ms, start, end)).toBeNull();
  });

  test("picks the nearest past posting when only past history exists", () => {
    const ms = [
      new Date("2025-06-15T12:00:00Z").getTime(),
      new Date("2026-03-25T12:00:00Z").getTime(),
      new Date("2026-01-01T12:00:00Z").getTime(),
    ];
    const got = findNearestPostingOutsidePeriod(ms, start, end);
    expect(got).not.toBeNull();
    expect(got!.side).toBe("past");
    expect(got!.date.toISOString()).toBe("2026-03-25T12:00:00.000Z");
  });

  test("picks the nearest future posting when only future history exists", () => {
    const ms = [
      new Date("2026-12-31T12:00:00Z").getTime(),
      new Date("2026-05-05T12:00:00Z").getTime(),
      new Date("2027-08-15T12:00:00Z").getTime(),
    ];
    const got = findNearestPostingOutsidePeriod(ms, start, end);
    expect(got).not.toBeNull();
    expect(got!.side).toBe("future");
    expect(got!.date.toISOString()).toBe("2026-05-05T12:00:00.000Z");
  });

  test("compares past and future on equal footing — pick whichever is closer in absolute ms", () => {
    const past = new Date("2026-03-29T00:00:00Z").getTime();
    const future = new Date("2026-05-02T00:00:00Z").getTime();
    const got = findNearestPostingOutsidePeriod([past, future], start, end);
    expect(got).not.toBeNull();
    expect(got!.side).toBe("future");
    expect(got!.date.toISOString()).toBe("2026-05-02T00:00:00.000Z");
  });

  test("postings at the exact boundary are inside the window — never the 'nearest outside' answer", () => {
    const inside = end.getTime();
    const outside = new Date("2026-05-10T12:00:00Z").getTime();
    const got = findNearestPostingOutsidePeriod([inside, outside], start, end);
    expect(got).not.toBeNull();
    expect(got!.date.toISOString()).toBe("2026-05-10T12:00:00.000Z");
  });

  test("first match wins on a strict equal-distance tie", () => {
    // The helper uses `<`, not `<=`, so the first scanned candidate wins.
    // Stable picks matter because the result drives a button label.
    const past = new Date("2026-03-29T00:00:00Z").getTime();
    const future = new Date("2026-05-03T23:59:59Z").getTime();
    const got = findNearestPostingOutsidePeriod([past, future], start, end);
    expect(got).not.toBeNull();
    expect(got!.side).toBe("past");
    expect(got!.date.toISOString()).toBe("2026-03-29T00:00:00.000Z");
  });
});
