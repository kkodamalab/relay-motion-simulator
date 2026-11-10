import { test, expect } from "vitest";
import { defaults, state, advance, frame, analyze, motion } from "./model";
test("playback rate changes only wall time", () => {
  const c = defaults(),
    e = analyze(c).event;
  for (const rate of [0.1, 3]) {
    const t = advance(0, 1.5 / rate, rate, true, 0, 6, false);
    expect(state(c, t, e)).toEqual(state(c, 1.5, e));
    expect(state(c, t, e).a.v).toBe(8);
  }
});
test("pause and exact frame steps", () => {
  expect(advance(1, 2, 3, false, 0, 6, false)).toBe(1);
  expect(advance(0, frame, 1, true, 0, 6, false)).toBe(frame);
  expect(advance(frame, -frame, 1, true, 0, 6, false)).toBe(0);
});
test("long frames stay inside AB loop", () => {
  for (const dt of [0.001, 1, 1000]) {
    const t = advance(2, dt, 3, true, 1, 2, true);
    expect(t).toBeGreaterThanOrEqual(1);
    expect(t).toBeLessThan(2);
  }
});
test("repeated seek around transfer and conserved baton endpoints", () => {
  const c = defaults(),
    e = analyze(c).event!;
  expect(e.success).toBe(true);
  for (let i = 0; i < 3; i++) {
    expect(state(c, e.t - frame, e).owner).toBe("A");
    expect(state(c, e.t, e).owner).toBe("B");
    expect(state(c, e.t, e).tip).toEqual(state(c, e.t, null).tip);
  }
});
test("failed, pending and solo", () => {
  const c = defaults();
  c.zone = 80;
  const e = analyze(c).event;
  expect(state(c, 0, e).status).toBe("未成立");
  expect(state(c, 6, e).status).toBe("失敗");
  c.runners[0].start = 8;
  expect(analyze(c).event).toBeNull();
  c.relay = false;
  expect(analyze(c).event).toBeNull();
});
test("independent runners and capped acceleration", () => {
  const c = defaults(),
    b = state(c, 2, null).b;
  Object.assign(c.runners[0], {
    v: 2,
    a: 2,
    cap: 4,
    accelerated: true,
    pitch: 3,
  });
  expect(motion(c.runners[0], 2)).toMatchObject({ v: 4, x: 7, a: 0 });
  expect(state(c, 2, null).b).toEqual(b);
});

test("hand approach velocity gates exchange independently", () => {
  const c = defaults();
  c.handSpeedLimit = 0;
  expect(analyze(c).event?.success).toBe(false);
});
