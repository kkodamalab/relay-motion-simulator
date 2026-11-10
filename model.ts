export const duration = 6,
  frame = 1 / 120,
  rad = Math.PI / 180;
export const clamp = (x: number, l: number, h: number) =>
  Math.min(h, Math.max(l, x));
export function defaults() {
  return {
    relay: true,
    runners: [0, 1].map((i) => ({
      x: i ? 3 : 0,
      v: i ? 7 : 8,
      a: 0,
      accelerated: false,
      cap: 12,
      pitch: 4,
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
export function pose(r: Runner, t: number, role: number, relay: boolean) {
  const m = motion(r, t),
    phase = t * r.pitch * Math.PI,
    hip = { x: m.x, y: 0.93 + 0.045 * Math.cos(2 * phase) },
    shoulder = { x: m.x + 0.09, y: hip.y + 0.5 };
  const smooth = (v: number) => {
    const s = clamp(v, 0, 1);
    return s * s * (3 - 2 * s);
  };
  const reach = relay
    ? smooth((t - r.start) / r.rise) *
      (1 - smooth((t - r.start - r.rise - r.hold) / r.rise))
    : 0;
  const limbs = [0, 1].map((side) => {
    const p = phase + side * r.legs * rad,
      swing = Math.sin(p),
      bend = r.knee * (0.13 + 0.87 * ((1 + Math.cos(p)) / 2) ** 1.5);
    let thigh = r.hip * swing;
    // During stance, aim the ankle at its mid-stance world coordinate.
    // Invert the horizontal component of the two-link leg with prescribed knee flexion.
    const stancePhase = Math.atan2(
      Math.sin(p - Math.PI),
      Math.cos(p - Math.PI),
    );
    const weight = Math.max(0, 1 - (Math.abs(stancePhase) / 0.82) ** 4);
    if (weight > 0) {
      const middle = t - stancePhase / (r.pitch * Math.PI);
      const offset = motion(r, Math.max(0, middle)).x - m.x;
      const reach = 0.9 * Math.cos((bend * rad) / 2);
      const planted =
        bend / 2 + Math.asin(clamp(offset / reach, -0.98, 0.98)) / rad;
      thigh += (clamp(planted, -r.hip, r.hip) - thigh) * weight;
    }
    const knee = end(hip, 0.45, thigh),
      ankle = end(knee, 0.45, thigh - bend);
    const mix = side === role ? reach : 0;
    const arm =
      r.shoulder * Math.sin(p + r.arms * rad) * (1 - mix) + r.extension * mix;
    const elbowAngle = r.elbow * (1 - mix) + 10 * mix,
      elbow = end(shoulder, 0.29, arm),
      hand = end(elbow, 0.27, arm + elbowAngle);
    const footAngle = 85 + 14 * swing;
    return {
      knee,
      ankle,
      toe: end(ankle, 0.19, footAngle),
      elbow,
      hand,
      angles: [arm, elbowAngle, thigh, bend, footAngle - (thigh - bend)],
    };
  });
  // Align the lowest sole with the track during stance, with a short flight phase.
  const lift = 0.065 * Math.max(0, -Math.cos(2 * phase)),
    dy = lift - Math.min(...limbs.flatMap((s) => [s.ankle.y, s.toe.y]));
  for (const p of [
    hip,
    shoulder,
    ...limbs.flatMap((s) => [s.knee, s.ankle, s.toe, s.elbow, s.hand]),
  ])
    p.y += dy;
  return {
    ...m,
    hip,
    shoulder,
    head: { x: shoulder.x + 0.045, y: shoulder.y + 0.2 },
    limbs,
    hand: limbs[role].hand,
  };
}
export function sample(c: Config, t: number) {
  const [a, b] = c.runners.map((r, i) => pose(r, t, i, c.relay)),
    tip = { x: a.hand.x + c.length, y: a.hand.y };
  return {
    a,
    b,
    tip,
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
};
export function analyze(c: Config) {
  let event: Event | null = null;
  const windows: number[][] = [];
  if (!c.relay) return { event, windows };
  const start = Math.max(...c.runners.map((r) => r.start)),
    finish = Math.min(...c.runners.map((r) => r.start + r.rise + r.hold));
  let inside = false;
  for (let i = 0; i <= duration * 120; i++) {
    const t = i / 120,
      s = sample(c, t),
      ok =
        t >= start &&
        t <= finish &&
        s.tip.x >= c.zone &&
        s.tip.x <= c.end &&
        Math.abs(s.relative) <= c.speedLimit &&
        s.handGap <= c.tolerance;
    if (ok) {
      if (!inside) windows.push([t, t]);
      windows[windows.length - 1][1] = t;
      event ??= {
        t,
        x: s.tip.x,
        success: true,
        dx: s.tip.x - s.b.hand.x,
        dy: s.tip.y - s.b.hand.y,
      };
    }
    inside = ok;
  }
  if (
    !event &&
    finish >= 0 &&
    finish <= duration &&
    c.runners.every((r) => r.start <= duration)
  ) {
    const t = Math.max(0, finish);
    event = { t, x: sample(c, t).tip.x, success: false, dx: 0, dy: 0 };
  }
  return { event, windows };
}
export function state(c: Config, t: number, event: Event | null) {
  const s = sample(c, t),
    passed = !!event && event.success && t >= event.t;
  const tip =
    passed && event
      ? { x: s.b.hand.x + event.dx, y: s.b.hand.y + event.dy }
      : s.tip;
  return {
    ...s,
    tip,
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
