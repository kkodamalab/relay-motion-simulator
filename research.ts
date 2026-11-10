import {
  type Config,
  type Point,
  type Event,
  runner,
  pose,
  state,
  delta,
  wrap,
  rad,
  duty,
  duration,
  frame,
} from "./model";
export const names = ["左脚", "右脚", "左腕", "右腕"];
export const pairs = [
  [0, 1],
  [2, 3],
  [2, 0],
  [3, 1],
  [2, 1],
  [3, 0],
];
export const cross = [
  [0, 0],
  [1, 1],
  [2, 3],
];
export const pointNames = ["骨盤", "左手", "右手", "左足", "右足"];
type Pose = ReturnType<typeof pose>;
export const points = (r: Pose) => [
  r.hip,
  r.limbs[0].hand,
  r.limbs[1].hand,
  r.limbs[0].toe,
  r.limbs[1].toe,
];
export function trail(p: Point, hip: Point, origin: Point, relative: boolean) {
  return relative
    ? { x: p.x - hip.x + origin.x, y: p.y - hip.y + origin.y }
    : p;
}
export function contacts(c: Config) {
  const result: { runner: number; side: number; t: number; on: boolean }[] = [];
  for (let i = 0; i < (c.relay ? 2 : 1); i++) {
    const r = runner(c, i),
      hz = r.pitch / 2;
    for (const side of [0, 1])
      for (const on of [true, false]) {
        const offset = (r.initial + side * r.legs) / 360 - (on ? 0 : duty);
        for (let n = Math.ceil(offset); (n - offset) / hz <= duration; n++)
          result.push({ runner: i, side, t: (n - offset) / hz, on });
      }
  }
  return result.sort((a, b) => a.t - b.t);
}
export function observed(c: Config, t: number, i: number) {
  const r = runner(c, i),
    active = c.relay && c.baton,
    s = pose(r, t, i, active),
    dt = 0.0001;
  const lo = Math.max(0, t - dt),
    hi = t + dt,
    left = pose(r, lo, i, active),
    right = pose(r, hi, i, active);
  const speeds = s.limbs.map((l, j) =>
    l.angles.map(
      (_, k) =>
        (right.limbs[j].angles[k] - left.limbs[j].angles[k]) / (hi - lo),
    ),
  );
  const angles = [
    s.limbs[0].angles[2],
    s.limbs[1].angles[2],
    s.limbs[0].angles[0],
    s.limbs[1].angles[0],
  ];
  const velocity = [speeds[0][2], speeds[1][2], speeds[0][0], speeds[1][0]];
  const phases = [
    ...s.limbs.map((l) => l.legPhase),
    ...s.limbs.map((l) => l.armPhase),
  ];
  return { angles, velocity, speeds, phases };
}
export function centers(c: Config) {
  return [0, 1].map((i) => {
    const rows = Array.from(
      { length: 361 },
      (_, j) => observed(c, j / 60, i).angles,
    );
    return names.map((_, k) => {
      const v = rows.map((row) => row[k]);
      return (Math.min(...v) + Math.max(...v)) / 2;
    });
  });
}
export function observation(c: Config, t: number, i: number, center: number[]) {
  const o = observed(c, t, i),
    r = runner(c, i);
  const estimated = o.angles.map((v, k) => {
    const omega = 2 * Math.PI * (k < 2 || r.armLock ? r.pitch / 2 : r.armHz),
      x = o.velocity[k] / omega,
      y = v - center[k];
    return Math.hypot(x, y) < 1e-7 ? NaN : wrap(Math.atan2(y, x) / rad);
  });
  return { ...o, estimated };
}
export function exportRows(c: Config, event: Event | null) {
  const center = centers(c),
    events = contacts(c);
  return Array.from({ length: 721 }, (_, n) => {
    const t = n * frame,
      s = state(c, t, event),
      row: Record<string, string | boolean | number> = {
        time_s: t,
        model: "2.0",
        coordinates: "world_m_right_up",
        phase_definition: "touchdown_zero_second_minus_first_deg",
        waveform_definition: "atan2(centered_angle;angular_velocity/omega)_deg",
        angle_units: "deg",
        angular_velocity_units: "deg/s",
        mode: c.relay ? (c.baton ? "relay" : "two") : "solo",
      };
    const obs = [0, 1].map((i) => observation(c, t, i, center[i]));
    for (const [k, v] of Object.entries(c))
      if (typeof v !== "object") row["config_" + k] = v;
    for (let i = 0; i < (c.relay ? 2 : 1); i++) {
      const key = "AB"[i] + "_",
        r = i ? s.b : s.a,
        o = obs[i],
        eff = runner(c, i);
      for (const [k, v] of Object.entries(c.runners[i]))
        row[key + "config_" + k] = v;
      Object.assign(row, {
        [key + "x_m"]: r.x,
        [key + "v_m_s"]: r.v,
        [key + "a_m_s2"]: r.a,
        [key + "distance_m"]: r.distance,
        [key + "pelvis_vy_m_s"]: r.vy,
        [key + "stride_period_s"]: 2 / eff.pitch,
      });
      points(r).forEach((p, j) => {
        const k =
          key +
          ["pelvis", "left_hand", "right_hand", "left_toe", "right_toe"][j];
        row[k + "_x_m"] = p.x;
        row[k + "_y_m"] = p.y;
      });
      r.limbs.forEach((l, j) => {
        const k = key + ["left", "right"][j] + "_";
        row[k + "stance"] = l.contact;
        for (const on of [true, false])
          row[k + (on ? "touchdown" : "liftoff") + "_s"] =
            events.find(
              (e) =>
                e.runner === i &&
                e.side === j &&
                e.on === on &&
                e.t <= t + 1e-10 &&
                e.t > t - frame + 1e-10,
            )?.t ?? "";
        l.angles.forEach((v, h) => {
          const joint = k + ["shoulder", "elbow", "hip", "knee", "ankle"][h];
          row[joint + "_deg"] = v;
          row[joint + "_deg_s"] = o.speeds[j][h];
        });
      });
      names.forEach((_, j) => {
        row[key + names[j] + "_phase_deg"] = o.phases[j];
        row[key + names[j] + "_estimated_deg"] = Number.isFinite(o.estimated[j])
          ? o.estimated[j]
          : "";
      });
      for (const [j, k] of pairs)
        for (const source of ["phases", "estimated"] as const) {
          const d = delta(o[source][j], o[source][k]);
          row[key + names[k] + "-" + names[j] + "_" + source + "_deg"] =
            Number.isFinite(d) ? d : "";
        }
    }
    if (c.relay) {
      row.gap_m = Math.abs(s.gap);
      row.signed_gap_m = s.gap;
      row.relative_m_s = s.relative;
      for (const [j, k] of cross)
        for (const source of ["phases", "estimated"] as const) {
          const d = delta(obs[0][source][j], obs[1][source][k]);
          row["B" + names[k] + "-A" + names[j] + "_" + source + "_deg"] =
            Number.isFinite(d) ? d : "";
        }
      if (c.baton)
        Object.assign(row, {
          owner: s.owner,
          status: s.status,
          tip_x_m: s.tip.x,
          tip_y_m: s.tip.y,
          base_x_m: s.base.x,
          base_y_m: s.base.y,
          angle_deg: s.angle / rad,
          hand_gap_m: s.handGap,
          event_s: event?.t ?? "",
          event_x_m: event?.x ?? "",
          event_hand_speed_m_s: event?.success ? event.approach : "",
          event_tip_distance_m: event?.success
            ? Math.hypot(event.dx, event.dy)
            : "",
          event_grip_from_base_m: event?.success ? event.grip : "",
          event_status: event
            ? event.success
              ? "success"
              : "failure"
            : "pending",
        });
    }
    return row;
  });
}
