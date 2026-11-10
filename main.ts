import {
  defaults,
  analyze,
  state,
  pose,
  advance,
  clamp,
  duration,
  frame,
  type Point,
} from "./model";
const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const input = (id: string) => el<HTMLInputElement>(id);
let c = defaults(),
  analysis = analyze(c),
  t = 0,
  rate = 1,
  playing = false,
  last = 0,
  editor = 0;
const colors = ["#1477bf", "#c55d21"],
  fmt = (n: number) => n.toFixed(3);
const button = (parent: string, label: string, fn: () => void) => {
  const b = document.createElement("button");
  b.textContent = label;
  b.onclick = fn;
  el(parent).append(b);
  return b;
};
type Field = [string, string, number, number, number];
const body: Field[] = [
  ["x", "初期位置 m", -50, 50, 0.1],
  ["v", "初速度 m/s", 0, 20, 0.1],
  ["a", "加速度 m/s²", -10, 10, 0.1],
  ["cap", "最高速度 m/s", 0.1, 30, 0.1],
  ["pitch", "ピッチ 歩/s", 0.5, 8, 0.1],
  ["hip", "股関節振幅 °", 0, 85, 1],
  ["knee", "膝関節振幅 °", 0, 145, 1],
  ["shoulder", "肩関節振幅 °", 0, 90, 1],
  ["elbow", "肘屈曲 °", 0, 145, 1],
  ["legs", "左右脚位相差 °", 0, 360, 1],
  ["arms", "腕脚位相差 °", 0, 360, 1],
];
const reach: Field[] = [
  ["start", "伸展開始 s", 0, 10, 0.05],
  ["rise", "伸展所要 s", 0.05, 5, 0.05],
  ["hold", "保持 s", 0, 6, 0.05],
  ["extension", "伸展時の上腕角 °", -130, 130, 1],
];
const exchange: Field[] = [
  ["zone", "ゾーン開始 m", -50, 100, 0.1],
  ["end", "ゾーン終了 m", -50, 100, 0.1],
  ["length", "バトン長 m", 0.1, 0.6, 0.01],
  ["tolerance", "距離許容値 m", 0.01, 0.5, 0.01],
  ["handSpeedLimit", "先端・受け手の相対速度上限 m/s", 0, 15, 0.1],
  ["speedLimit", "走者相対速度上限 m/s", 0, 10, 0.1],
];
function fields(target: HTMLElement, obj: object, items: Field[]) {
  const grid = document.createElement("div");
  grid.className = "fields";
  target.append(grid);
  for (const [k, name, min, max, step] of items) {
    const label = document.createElement("label"),
      n = document.createElement("input");
    label.textContent = name;
    n.type = "number";
    Object.assign(n, { min, max, step, value: Reflect.get(obj, k) });
    label.append(n);
    grid.append(label);
    n.oninput = () => {
      if (n.value !== "" && n.validity.valid) {
        Reflect.set(obj, k, n.valueAsNumber);
        recompute();
      }
    };
    n.onblur = () => (n.value = Reflect.get(obj, k));
  }
}
function settings() {
  const r = c.runners[editor],
    box = el("runner");
  box.replaceChildren();
  const sel = document.createElement("select");
  sel.ariaLabel = "身体移動モデル";
  sel.innerHTML = "<option>一定速度</option><option>一定加速度</option>";
  sel.selectedIndex = +r.accelerated;
  sel.onchange = () => {
    r.accelerated = !!sel.selectedIndex;
    recompute();
  };
  box.append(sel);
  fields(box, r, body.slice(0, 5));
  const d = document.createElement("details");
  d.innerHTML = "<summary>四肢運動・位相</summary>";
  box.append(d);
  fields(d, r, body.slice(5));
  const ex = el("exchange");
  ex.replaceChildren();
  if (c.relay) {
    fields(ex, c, exchange);
    c.runners.forEach((r, i) => {
      const d = document.createElement("details");
      d.innerHTML =
        "<summary>Runner " +
        "AB"[i] +
        " · " +
        (i ? "後方" : "前方") +
        "伸展</summary>";
      ex.append(d);
      fields(d, r, reach);
    });
  }
  for (const [id, active] of [
    ["solo", !c.relay],
    ["relay", c.relay],
    ["editA", editor === 0],
    ["editB", editor === 1],
  ] as const)
    el(id).classList.toggle("active", active);
  el<HTMLButtonElement>("editB").disabled = !c.relay;
}
const metrics = [
  "位置 m",
  "速度 m/s",
  "加速度 m/s²",
  "移動距離 m",
  "走者間距離 m",
  "相対速度 B−A m/s",
  "バトン先端・受け手間距離 m",
  ...["左", "右"].flatMap((s) =>
    ["肩", "肘", "股", "膝", "足"].map((j) => s + j + "関節角 °"),
  ),
];
el("metric").innerHTML = metrics
  .map((m, i) => '<option value="' + i + '">' + m + "</option>")
  .join("");
type Snapshot = ReturnType<typeof state>;
function values(s: Snapshot, k: number) {
  if (k >= 4 && k <= 6)
    return [k === 4 ? Math.abs(s.gap) : k === 5 ? s.relative : s.handGap];
  return (c.relay ? [s.a, s.b] : [s.a]).map((r) =>
    k < 4
      ? [r.x, r.v, r.a, r.distance][k]
      : r.limbs[Math.floor((k - 7) / 5)].angles[(k - 7) % 5],
  );
}
let samples: Snapshot[] = [],
  lo = 0,
  hi = duration;
function recompute() {
  analysis = analyze(c);
  samples = Array.from({ length: 361 }, (_, i) =>
    state(c, i / 60, analysis.event),
  );
  const e = analysis.event;
  if (e) {
    lo = Math.max(0, e.t - 1);
    hi = Math.min(duration, e.t + 1);
  } else {
    input("ab").checked = false;
    lo = NaN;
    hi = NaN;
  }
  input("lo").value = e ? fmt(lo) : "";
  input("hi").value = e ? fmt(hi) : "";
  for (const b of jumpButtons) b.disabled = !e;
  const metric = el<HTMLSelectElement>("metric");
  for (let i = 4; i <= 6; i++) metric.options[i].disabled = !c.relay;
  if (metric.selectedOptions[0].disabled) metric.value = "0";
  draw();
}
function canvas(id: string) {
  const cv = el<HTMLCanvasElement>(id),
    w = cv.clientWidth,
    h = cv.clientHeight,
    d = devicePixelRatio;
  if (cv.width !== Math.round(w * d) || cv.height !== Math.round(h * d)) {
    cv.width = Math.round(w * d);
    cv.height = Math.round(h * d);
  }
  const g = cv.getContext("2d")!;
  g.setTransform(d, 0, 0, d, 0, 0);
  g.clearRect(0, 0, w, h);
  g.font = "12px Arial";
  return { g, w, h };
}
function scene(s: Snapshot) {
  const { g, w, h } = canvas("scene"),
    both = c.relay,
    follow = input("follow").checked;
  const end = samples.at(-1)!,
    positions = [
      samples[0].a.x,
      end.a.x,
      ...(both ? [samples[0].b.x, end.b.x] : []),
    ],
    low = Math.min(...positions) - 1,
    high = Math.max(...positions) + 1;
  const scale = follow
    ? Math.min(h / 2.75, w / Math.max(5, (both ? Math.abs(s.gap) : 0) + 2.3))
    : Math.min(h / 2.75, w / (high - low));
  const center = follow
      ? both
        ? (s.a.x + s.b.x) / 2
        : s.a.x
      : (low + high) / 2,
    ground = h - 33,
    X = (x: number) => w / 2 + (x - center) * scale,
    Y = (y: number) => ground - y * scale;
  const line = (a: Point, b: Point) => {
    g.beginPath();
    g.moveTo(X(a.x), Y(a.y));
    g.lineTo(X(b.x), Y(b.y));
    g.stroke();
  };
  if (both) {
    g.fillStyle = "#dcebcf";
    g.fillRect(X(c.zone), ground, X(c.end) - X(c.zone), 10);
  }
  const step = scale < 18 ? 5 : 1;
  for (
    let x = Math.ceil((center - w / 2 / scale) / step) * step;
    X(x) < w;
    x += step
  ) {
    g.strokeStyle = "#dbe4e4";
    g.lineWidth = 1;
    line({ x, y: 0 }, { x, y: h / scale });
    g.fillStyle = "#617579";
    g.fillText(x + " m", X(x) + 3, ground + 24);
  }
  g.strokeStyle = "#788f92";
  line({ x: center - w / scale, y: 0 }, { x: center + w / scale, y: 0 });
  (both ? [s.a, s.b] : [s.a]).forEach((r, i) => {
    g.strokeStyle = g.fillStyle = colors[i];
    g.lineCap = "round";
    const dot = (p: Point, radius: number) => {
      g.beginPath();
      g.arc(X(p.x), Y(p.y), radius, 0, Math.PI * 2);
      g.fill();
    };
    if (input("trail").checked) {
      g.globalAlpha = 0.35;
      g.lineWidth = 2;
      let prev = r.hip;
      for (let j = 1; j <= 40; j++) {
        const p = pose(c.runners[i], Math.max(0, t - j / 100), i, c.relay).hip;
        line(prev, p);
        prev = p;
      }
      g.globalAlpha = 1;
    }
    for (const side of [1, 0]) {
      const l = r.limbs[side];
      g.globalAlpha = side ? 0.42 : 1;
      g.lineWidth = Math.max(2, scale * 0.055);
      g.setLineDash(side ? [5, 3] : []);
      for (const chain of [
        [r.hip, l.knee, l.ankle, l.toe],
        [r.shoulder, l.elbow, l.hand],
      ])
        chain.forEach((p, j) => {
          if (j && input("bones").checked) line(chain[j - 1], p);
          if (input("joints").checked) dot(p, Math.max(2, scale * 0.036));
        });
    }
    g.setLineDash([]);
    g.globalAlpha = 1;
    g.lineWidth = scale * 0.095;
    if (input("bones").checked) line(r.hip, r.shoulder);
    dot(r.head, scale * 0.11);
    g.fillText(
      "RUNNER " + "AB"[i],
      clamp(X(r.head.x) - 26, 2, w - 67),
      Math.max(15, Y(r.head.y) - scale * 0.19),
    );
  });
  if (both) {
    g.lineWidth = Math.max(4, scale * 0.055);
    g.strokeStyle = "#edb400";
    line({ x: s.tip.x - c.length, y: s.tip.y }, s.tip);
  }
}
function graph() {
  const { g, w, h } = canvas("plot"),
    k = +input("metric").value,
    rows = samples.map((s) => values(s, k)),
    all = rows.flat(),
    min = Math.min(...all),
    max = Math.max(...all),
    span = Math.max(0.01, max - min),
    X = (v: number) => 48 + ((w - 62) * v) / duration,
    Y = (v: number) => h - 27 - ((h - 50) * (v - min)) / span;
  for (let i = 0; i < 4; i++) {
    const v = min + (span * i) / 3,
      y = Y(v);
    g.fillStyle = "#52696e";
    g.fillText(v.toFixed(2), 2, y + 3);
    g.strokeStyle = "#dce5e5";
    g.beginPath();
    g.moveTo(48, y);
    g.lineTo(w - 14, y);
    g.stroke();
  }
  rows[0].forEach((_, j) => {
    g.strokeStyle = colors[j];
    g.lineWidth = 2;
    g.beginPath();
    rows.forEach((r, i) =>
      i ? g.lineTo(X(i / 60), Y(r[j])) : g.moveTo(X(0), Y(r[j])),
    );
    g.stroke();
  });
  g.strokeStyle = "#243f44";
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(X(t), 8);
  g.lineTo(X(t), h - 24);
  g.stroke();
  for (let i = 0; i <= duration; i++) {
    g.fillText(i + "s", X(i) - 5, h - 6);
  }
  el("legend").textContent =
    metrics[k] +
    "　" +
    values(state(c, t, analysis.event), k)
      .map((v, i) => (k >= 4 && k <= 6 ? "" : "AB"[i] + " ") + fmt(v))
      .join("　·　");
}
function draw() {
  const s = state(c, t, analysis.event),
    e = analysis.event;
  scene(s);
  graph();
  el("clock").textContent = fmt(t) + " / 6.000 s";
  input("timeline").value = String(t);
  el("rate").textContent = rate + "×";
  el("play").textContent = playing ? "Ⅱ 一時停止" : "▶ 再生";
  el("stats").textContent = (c.relay ? [s.a, s.b] : [s.a])
    .map(
      (r, i) =>
        "Runner " +
        "AB"[i] +
        "　" +
        r.x.toFixed(2) +
        " m　" +
        r.v.toFixed(2) +
        " m/s　" +
        r.a.toFixed(2) +
        " m/s²　移動 " +
        r.distance.toFixed(2) +
        " m",
    )
    .join("　　 ");
  el("result").textContent = c.relay
    ? s.status +
      "　保持 " +
      s.owner +
      "　走者間 " +
      Math.abs(s.gap).toFixed(2) +
      " m　相対速度 " +
      s.relative.toFixed(2) +
      " m/s　手との距離 " +
      s.handGap.toFixed(3) +
      " m　" +
      (e ? "イベント " + fmt(e.t) + " s / " + fmt(e.x) + " m" : "") +
      "　成立可能区間 " +
      (analysis.windows.map((a) => a.map(fmt).join("–") + " s").join(", ") ||
        "なし")
    : "単独走行";
  el("marker").hidden = !e;
  if (e) {
    el("marker").style.left = (e.t / duration) * 100 + "%";
    el("marker").title = (e.success ? "成功" : "失敗") + " " + fmt(e.t) + " s";
  }
}
function seek(v: number) {
  playing = false;
  t = clamp(v, 0, duration);
  draw();
}
function tick(now: number) {
  if (playing) {
    const ab = input("ab").checked,
      loop = ab || input("loop").checked;
    t = advance(
      t,
      (now - last) / 1000,
      rate,
      true,
      ab ? lo : 0,
      ab ? hi : duration,
      loop,
    );
    if (!loop && t >= duration) playing = false;
    draw();
  }
  last = now;
  requestAnimationFrame(tick);
}
el("play").onclick = () => {
  if (!playing) {
    if (input("ab").checked && (t < lo || t >= hi)) t = lo;
    else if (t >= duration) t = 0;
    last = performance.now();
  }
  playing = !playing;
  draw();
};
el("stop").onclick = el("home").onclick = () => seek(0);
input("timeline").oninput = () => seek(+input("timeline").value);
function changeRate(v: number) {
  if (playing) {
    const now = performance.now(),
      ab = input("ab").checked;
    t = advance(
      t,
      (now - last) / 1000,
      rate,
      true,
      ab ? lo : 0,
      ab ? hi : duration,
      ab || input("loop").checked,
    );
    last = now;
  }
  rate = v;
  input("speed").value = String(v);
  for (const b of el("presets").children)
    b.classList.toggle("active", b.textContent === v + "×");
  draw();
}
for (const v of [0.1, 0.25, 0.5, 1, 1.5, 2, 3])
  button("presets", v + "×", () => changeRate(v));
input("speed").oninput = () => changeRate(+input("speed").value);
for (const [v, label] of [
  [-0.1, "−0.1 s"],
  [-frame, "−1 frame"],
  [frame, "+1 frame"],
  [0.1, "+0.1 s"],
] as const)
  button("steps", label, () => seek(t + v));
const jumpButtons = [-0.1, 0, 0.1].map((v, i) =>
  button("jumps", ["直前", "イベント時刻", "直後"][i], () => {
    if (analysis.event) seek(analysis.event.t + v);
  }),
);
el("jumps").insertAdjacentHTML(
  "beforeend",
  '<label><input id="ab" type="checkbox">A–B ループ</label><label>A <input class="small" id="lo" type="number" min="0" max="6" step="any"> s</label><label>B <input class="small" id="hi" type="number" min="0" max="6" step="any"> s</label>',
);
for (const id of ["lo", "hi", "ab"])
  input(id).onchange = () => {
    const a = input("lo").valueAsNumber,
      b = input("hi").valueAsNumber;
    if (a >= 0 && b <= duration && a < b) {
      lo = a;
      hi = b;
    } else {
      input("ab").checked = false;
    }
    if (input("ab").checked) t = clamp(t, lo, hi);
    draw();
  };
for (const id of ["follow", "trail", "bones", "joints", "metric"])
  el(id).onchange = draw;
for (const [i, id] of ["editA", "editB"].entries())
  el(id).onclick = () => {
    editor = i;
    settings();
  };
for (const id of ["solo", "relay"])
  el(id).onclick = () => {
    c.relay = id === "relay";
    editor = 0;
    settings();
    recompute();
  };
el("reset").onclick = () => {
  playing = false;
  t = 0;
  c = defaults();
  editor = 0;
  for (const id of ["loop", "trail"]) input(id).checked = false;
  for (const id of ["bones", "joints", "follow"]) input(id).checked = true;
  input("ab").checked = false;
  input("metric").value = "0";
  settings();
  recompute();
  changeRate(1);
};
function download(json: boolean) {
  const data = Array.from({ length: 721 }, (_, i) => {
    const time = i / 120,
      s = state(c, time, analysis.event),
      row: Record<string, string | number | boolean> = {
        time_s: time,
        mode: c.relay ? "relay" : "solo",
      };
    (c.relay ? [s.a, s.b] : [s.a]).forEach((r, j) => {
      const key = "AB"[j] + "_";
      for (const [k, v] of Object.entries(c.runners[j]))
        row[key + "config_" + k] = v;
      Object.assign(row, {
        [key + "x_m"]: r.x,
        [key + "v_m_s"]: r.v,
        [key + "a_m_s2"]: r.a,
        [key + "distance_m"]: r.distance,
      });
      for (const [p, l] of r.limbs.entries())
        l.angles.forEach(
          (v, k) =>
            (row[
              key +
                ["left", "right"][p] +
                "_" +
                ["shoulder", "elbow", "hip", "knee", "ankle"][k] +
                "_deg"
            ] = v),
        );
    });
    if (c.relay) {
      for (const [k, v] of Object.entries(c))
        if (typeof v === "number") row["config_" + k] = v;
      Object.assign(row, {
        gap_m: Math.abs(s.gap),
        relative_m_s: s.relative,
        hand_gap_m: s.handGap,
        tip_x_m: s.tip.x,
        tip_y_m: s.tip.y,
        owner: s.owner,
        status: s.status,
        event_s: analysis.event?.t ?? "",
        event_x_m: analysis.event?.x ?? "",
      });
    }
    return row;
  });
  const content = json
    ? JSON.stringify({ config: c, analysis, samples: data })
    : "\uFEFF" +
      [Object.keys(data[0]), ...data.map(Object.values)]
        .map((r) => r.join(","))
        .join("\r\n");
  const url = URL.createObjectURL(
      new Blob([content], {
        type: json ? "application/json" : "text/csv;charset=utf-8",
      }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = "relay-motion." + (json ? "json" : "csv");
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
el("json").onclick = () => download(true);
el("csv").onclick = () => download(false);
settings();
recompute();
changeRate(1);
window.addEventListener("resize", draw);
requestAnimationFrame(tick);


