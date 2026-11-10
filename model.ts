export const duration = 6,
  frame = 1 / 120,
  rad = Math.PI / 180;
export const clamp = (x: number, l: number, h: number) =>
  Math.min(h, Math.max(l, x));
export function defaults() {
  return {
    relay: true,
    baton: true,
    sync: false,
    lock: false,
    offset: 0,
    runners: [0, 1].map((i) => ({
      x: i ? 3 : 0,
      v: i ? 7 : 8,
      a: 0,
      accelerated: false,
      cap: 12,
      pitch: 4,
      bounce: 0.032,
      initial: 0,
      armLock: true,
      armHz: 2,
      armSides: 180,
      hip: 48,
      knee: 105,
      shoulder: 38,
      elbow: 83,
      legs: 180,
      arms: 180,
      start: 1.2,
      rise: 0.4,
      hold: 1.4,
      extension: i ? -85 : 76,
    })),
    zone: 5,
    end: 30,
    tolerance: 0.09,
    speedLimit: 2,
    handSpeedLimit: 3,
    length: 0.3,
  };
}
export type Config = ReturnType<typeof defaults>;
export type Runner = Config["runners"][number];
export type Point = { x: number; y: number };
export function motion(r: Runner, t: number) {
  const a = r.accelerated ? r.a : 0,
    v = Math.min(r.cap, r.v),
    limit = a > 0 ? (r.cap - v) / a : a < 0 ? -v / a : Infinity;
  const u = Math.min(t, limit),
    speed = v + a * u,
    distance = v * u + (a * u * u) / 2 + speed * (t - u);
  return { x: r.x + distance, v: speed, a: t < limit ? a : 0, distance };
}
function end(p: Point, length: number, angle: number) {
  return {
    x: p.x + length * Math.sin(angle * rad),
    y: p.y - length * Math.cos(angle * rad),
  };
}
export const wrap = (v: number) => ((v % 360) + 360) % 360;
export const delta = (a: number, b: number) => wrap(b - a + 180) - 180;
export const duty = 0.3;
export const smooth = (x: number) => {
  const u = clamp(x, 0, 1);
  return u * u * (3 - 2 * u);
};
export function runner(c: Config, i: number) {
  const r = c.runners[i];
  if (!i || !c.relay) return r;
  return {
    ...r,
    pitch: c.sync || c.lock ? c.runners[0].pitch : r.pitch,
    initial: c.lock ? c.runners[0].initial + c.offset : r.initial,
  };
}
export function pose(r: Runner, t: number, role: number, exchange: boolean) {
  const m = motion(r, t),
    hz = r.pitch / 2,
    phase = t * hz * 360 + r.initial,
    armHz = r.armLock ? hz : r.armHz;
  const vertical = (phase / 360 - duty / 2) * 4 * Math.PI;
  const hip = { x: m.x, y: 0.765 - r.bounce * Math.cos(vertical) },
    vy = r.bounce * 4 * Math.PI * hz * Math.sin(vertical);
  const shoulder = { x: m.x + 0.09, y: hip.y + 0.5 };
  const reach = exchange
    ? smooth((t - r.start) / r.rise) *
      (1 - smooth((t - r.start - r.rise - r.hold) / r.rise))
    : 0;
  const limbs = [0, 1].map((side) => {
    const legPhase = wrap(phase + side * r.legs),
      armPhase = wrap(t * armHz * 360 + r.initial + r.arms + side * r.armSides);
    const u = legPhase / 360,
      contact = u < duty;
    const mid = t + (duty / 2 - u) / hz;
    const stanceOffset = (time: number) => motion(r, Math.max(0, time)).x - m.x;
    const span = 0.015 + 0.36 * Math.sin(r.hip * rad);
    let dx = stanceOffset(mid),
      lift = 0,
      foot = 90;
    if (!contact) {
      const z = (u - duty) / (1 - duty),
        s = smooth(z);
      dx = (1 - s) * stanceOffset(mid) + s * stanceOffset(mid + 1 / hz);
      const arch = Math.sin(Math.PI * z) ** 2;
      lift = (0.06 + (0.43 * r.knee) / 145) * arch;
      foot = 90 + 18 * arch;
    }
    // Keep the stance anchor exactly planted inside the reachable central interval.
    const core = 0.65 * span,
      margin = span - core;
    if (Math.abs(dx) > core)
      dx =
        Math.sign(dx) *
        (core + margin * Math.tanh((Math.abs(dx) - core) / margin));
    const ankle = { x: hip.x + dx, y: lift },
      down = hip.y - lift;
    const bend =
      (2 * Math.acos(clamp(Math.hypot(dx, down) / 0.9, -1, 1))) / rad;
    const thigh = Math.atan2(dx, down) / rad + bend / 2,
      knee = end(hip, 0.45, thigh);
    const mix = side === role ? reach : 0,
      arm =
        r.shoulder * Math.sin(armPhase * rad) * (1 - mix) + r.extension * mix;
    const elbowAngle = r.elbow * (1 - mix) + 10 * mix,
      elbow = end(shoulder, 0.29, arm),
      hand = end(elbow, 0.27, arm + elbowAngle);
    return {
      knee,
      ankle,
      toe: end(ankle, 0.19, foot),
      elbow,
      hand,
      contact,
      legPhase,
      armPhase,
      angles: [arm, elbowAngle, thigh, bend, foot - (thigh - bend)],
    };
  });
  return {
    ...m,
    hip,
    vy,
    shoulder,
    head: { x: shoulder.x + 0.045, y: shoulder.y + 0.2 },
    limbs,
    hand: limbs[role].hand,
  };
}
export function sample(c: Config, t: number) {
  const [a, b] = [0, 1].map((i) =>
    pose(runner(c, i), t, i, c.relay && c.baton),
  );
  const dx = b.hand.x - a.hand.x,
    dy = b.hand.y - a.hand.y;
  const near = Math.hypot(dx, dy),
    forward = dx > 0 ? dx / Math.max(near, 1e-12) : 0;
  const angle =
    Math.atan2(dy, dx) *
    smooth(forward / 0.3) *
    smooth((c.length + 0.35 - near) / 0.2);
  const tip = {
    x: a.hand.x + c.length * Math.cos(angle),
    y: a.hand.y + c.length * Math.sin(angle),
  };
  return {
    a,
    b,
    base: a.hand,
    tip,
    angle,
    gap: b.x - a.x,
    relative: b.v - a.v,
    handGap: Math.hypot(tip.x - b.hand.x, tip.y - b.hand.y),
  };
}
export type Event = {
  t: number;
  x: number;
  success: boolean;
  dx: number;
  dy: number;
  angle: number;
  grip: number;
  approach: number;
};
export function analyze(c: Config) {
  let event: Event | null = null;
  const windows: number[][] = [];
  if (!c.relay || !c.baton) return { event, windows };
  const start = Math.max(...c.runners.map((r) => r.start)),
    finish = Math.min(...c.runners.map((r) => r.start + r.rise + r.hold));
  const first = sample(c, 0);
  let previous = {
    x: first.tip.x - first.b.hand.x,
    y: first.tip.y - first.b.hand.y,
  };
  let inside = false;
  for (let i = 0; i <= duration * 120; i++) {
    const t = i / 120,
      s = sample(c, t),
      offset = { x: s.tip.x - s.b.hand.x, y: s.tip.y - s.b.hand.y },
      handSpeed =
        Math.hypot(offset.x - previous.x, offset.y - previous.y) / frame,
      ok =
        t >= start &&
        t <= finish &&
        s.tip.x >= c.zone &&
        s.tip.x <= c.end &&
        Math.abs(s.relative) <= c.speedLimit &&
        handSpeed <= c.handSpeedLimit &&
        s.handGap <= c.tolerance &&
        Math.abs(
          (s.b.hand.x - s.base.x) * Math.sin(s.angle) -
            (s.b.hand.y - s.base.y) * Math.cos(s.angle),
        ) < 1e-8 &&
        s.b.hand.x >= s.base.x &&
        Math.hypot(s.b.hand.x - s.base.x, s.b.hand.y - s.base.y) <= c.length;
    if (ok) {
      if (!inside) windows.push([t, t]);
      windows[windows.length - 1][1] = t;
      event ??= {
        t,
        x: s.b.hand.x,
        success: true,
        angle: s.angle,
        grip: Math.hypot(s.b.hand.x - s.base.x, s.b.hand.y - s.base.y),
        approach: handSpeed,
        dx: s.tip.x - s.b.hand.x,
        dy: s.tip.y - s.b.hand.y,
      };
    }
    previous = offset;
    inside = ok;
  }
  if (
    !event &&
    finish >= 0 &&
    finish <= duration &&
    c.runners.every((r) => r.start <= duration)
  ) {
    const t = Math.max(0, finish);
    event = {
      t,
      x: sample(c, t).tip.x,
      success: false,
      angle: 0,
      grip: 0,
      approach: 0,
      dx: 0,
      dy: 0,
    };
  }
  return { event, windows };
}
export function state(c: Config, t: number, event: Event | null) {
  const s = sample(c, t),
    passed = !!event && event.success && t >= event.t;
  let { base, tip, angle } = s;
  if (passed && event) {
    const blend = smooth((t - event.t) / 0.24);
    angle =
      event.angle * (1 - blend) +
      blend * 0.32 * Math.sin(s.b.limbs[1].angles[0] * rad);
    const grip = event.grip * (1 - blend) + 0.08 * c.length * blend;
    if (t !== event.t) {
      base = {
        x: s.b.hand.x - grip * Math.cos(angle),
        y: s.b.hand.y - grip * Math.sin(angle),
      };
      tip = {
        x: base.x + c.length * Math.cos(angle),
        y: base.y + c.length * Math.sin(angle),
      };
    }
  }
  return {
    ...s,
    base,
    tip,
    angle,
    handGap: Math.hypot(tip.x - s.b.hand.x, tip.y - s.b.hand.y),
    owner: passed ? "B" : "A",
    status: !event || t < event.t ? "未成立" : passed ? "成功" : "失敗",
  };
}
export function advance(
  t: number,
  dt: number,
  rate: number,
  playing: boolean,
  lo: number,
  hi: number,
  loop: boolean,
) {
  if (!playing) return t;
  const n = t + dt * rate;
  return loop && hi > lo
    ? lo + ((((n - lo) % (hi - lo)) + (hi - lo)) % (hi - lo))
    : clamp(n, lo, hi);
}
