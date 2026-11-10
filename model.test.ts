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

import { pose, runner, delta, duty, wrap } from "./model";
import {
  contacts,
  points,
  trail,
  observation,
  centers,
  exportRows,
} from "./research";
test("analytic pelvis and rigid legs remain continuous across all contact transitions", () => {
  const c = defaults(),
    r = c.runners[0],
    h = 1e-6;
  for (const e of contacts(c).filter(
    (e) => e.runner === 0 && e.t > 0 && e.t < 6,
  )) {
    const [a, b, d] = [-h, 0, h].map((dt) => pose(r, e.t + dt, 0, false));
    expect((d.hip.y - a.hip.y) / (2 * h)).toBeCloseTo(b.vy, 6);
    for (const j of [0, 1])
      for (const k of ["knee", "ankle", "toe"] as const)
        expect(
          Math.hypot(
            d.limbs[j][k].x - a.limbs[j][k].x,
            d.limbs[j][k].y - a.limbs[j][k].y,
          ),
        ).toBeLessThan(0.0001);
  }
  for (const bounce of [0, 0.05]) {
    r.bounce = bounce;
    for (let n = 0; n <= 720; n++) {
      const s = pose(r, n / 120, 0, false);
      if (!bounce) expect(Math.abs(s.vy)).toBe(0);
      for (const l of s.limbs) {
        expect(l.toe.y).toBeGreaterThan(-1e-12);
        expect(
          Math.hypot(l.knee.x - l.ankle.x, l.knee.y - l.ankle.y),
        ).toBeCloseTo(0.45, 9);
      }
    }
  }
});
test("trajectory endpoints and world versus pelvis frames", () => {
  const r = defaults().runners[0],
    a = pose(r, 0.3, 0, false),
    b = pose(r, 0.4, 0, false);
  expect(points(a)).toEqual([
    a.hip,
    a.limbs[0].hand,
    a.limbs[1].hand,
    a.limbs[0].toe,
    a.limbs[1].toe,
  ]);
  for (const p of points(a)) {
    expect(trail(p, a.hip, b.hip, false)).toEqual(p);
    expect(trail(p, a.hip, b.hip, true).x - b.hip.x).toBeCloseTo(p.x - a.hip.x);
  }
});
test("receiver grip lies on a continuous fixed-length forward baton", () => {
  const c = defaults(),
    e = analyze(c).event!;
  for (const dt of [0, 0.000001, 0.03, 0.24, 1]) {
    const s = state(c, e.t + dt, e),
      v = { x: s.tip.x - s.base.x, y: s.tip.y - s.base.y },
      h = { x: s.b.hand.x - s.base.x, y: s.b.hand.y - s.base.y };
    expect(h.x * v.y - h.y * v.x).toBeCloseTo(0, 9);
    expect(h.x).toBeGreaterThanOrEqual(0);
    expect(s.tip.x).toBeGreaterThan(s.b.hand.x);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(c.length, 10);
  }
  const a = state(c, e.t - 1e-7, e),
    b = state(c, e.t + 1e-7, e);
  expect(Math.abs(b.base.x - a.base.x)).toBeLessThan(0.00001);
  c.baton = false;
  expect(analyze(c).event).toBeNull();
  expect(state(c, 2, null).b).toEqual(pose(c.runners[1], 2, 1, false));
});
test("circular phase, period drift and explicit phase locking", () => {
  const c = defaults(),
    phase = (i: number, t: number) =>
      pose(runner(c, i), t, i, false).limbs[0].legPhase;
  for (const angle of [0, 90, 180, 270]) {
    c.runners[0].legs = angle;
    const s = pose(c.runners[0], 0.2, 0, false);
    expect(wrap(s.limbs[1].legPhase - s.limbs[0].legPhase)).toBeCloseTo(angle);
  }
  c.runners[1].pitch = 3;
  expect(delta(phase(0, 0.5), phase(1, 0.5))).toBe(-90);
  c.sync = true;
  expect(phase(0, 0.5)).toBe(phase(1, 0.5));
  c.sync = false;
  c.lock = true;
  c.offset = 90;
  for (const t of [0.03, 1, 4])
    expect(delta(phase(0, t), phase(1, t))).toBeCloseTo(90);
  expect(delta(359, 1)).toBe(2);
});
test("exported phase and hand position agree with direct evaluation after seeking", () => {
  const c = defaults(),
    e = analyze(c).event,
    rows = exportRows(c, e),
    t = 2,
    s = state(c, t, e),
    o = observation(c, t, 0, centers(c)[0]);
  expect(rows[240].A_left_hand_x_m).toBe(s.a.hand.x);
  expect(rows[240]["A_左腕_estimated_deg"]).toBe(o.estimated[2]);
  expect(rows[240].owner).toBe("B");
});
