import {
  names,
  pairs,
  cross,
  pointNames,
  points,
  trail,
  contacts,
  centers,
  observation,
  exportRows,
} from "./research";
import { runner, duty, delta } from "./model";
import {
  defaults,
  analyze,
  state,
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
  ["hip", "脚の前後振幅設定 °", 0, 85, 1],
  ["knee", "遊脚の屈曲設定 °", 0, 145, 1],
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
let settingTab = 0,
  analysisTab = 0;
function toggle(box: HTMLElement, name: string, obj: object, key: string) {
  const label = document.createElement("label"),
    n = document.createElement("input");
  n.type = "checkbox";
  n.checked = Reflect.get(obj, key);
  n.onchange = () => {
    Reflect.set(obj, key, n.checked);
    settings();
    recompute();
  };
  label.append(n, name);
  box.append(label);
}
function settings() {
  const r = c.runners[editor],
    box = el("runner");
  box.replaceChildren();
  el("editA").hidden = el("editB").hidden = settingTab >= 2;
  const sel = document.createElement("select");
  sel.ariaLabel = "身体移動モデル";
  sel.innerHTML = "<option>一定速度</option><option>一定加速度</option>";
  sel.selectedIndex = +r.accelerated;
  sel.onchange = () => {
    r.accelerated = !!sel.selectedIndex;
    recompute();
  };
  if (settingTab === 0) {
    box.append(sel);
    fields(box, r, body.slice(0, 5));
    fields(box, r, [["bounce", "骨盤上下動振幅 m", 0, 0.05, 0.001]]);
  } else if (settingTab === 1) {
    fields(box, r, [
      ...body.slice(5),
      ["initial", "左脚の初期位相 °", 0, 360, 1],
      ["armSides", "左右腕位相差 °", 0, 360, 1],
    ]);
    toggle(box, "腕周期を脚周期に固定", r, "armLock");
    if (!r.armLock)
      fields(box, r, [["armHz", "腕振り周波数 Hz", 0.25, 5, 0.05]]);
    for (const [v, name] of [
      [0, "同側同相"],
      [180, "対側同相"],
    ] as const) {
      const b = document.createElement("button");
      b.textContent = name;
      b.onclick = () => {
        r.legs = r.armSides = 180;
        r.arms = v;
        r.armLock = true;
        settings();
        recompute();
      };
      box.append(b);
    }
  } else if (settingTab === 2) {
    toggle(box, "Bの脚周期をAに同期", c, "sync");
    toggle(box, "Bの脚位相差を固定（周期も同期）", c, "lock");
    fields(box, c, [["offset", "左脚の固定位相差 B−A °", 0, 360, 1]]);
    box.append("同期はモデル上の拘束条件です。");
  }
  const active = c.relay && c.baton;
  el("exchangePanel").hidden = settingTab !== 3 || !active;
  box.parentElement!.hidden = settingTab === 3;
  input("baton").checked = c.baton;
  el("batonLabel").hidden = !c.relay;
  el("trails").children[1].toggleAttribute("hidden", !c.relay);
  Array.from(el("settingsTabs").children).forEach((b, j) => {
    (b as HTMLButtonElement).disabled =
      (j === 3 && !active) || (j === 2 && !c.relay);
    b.classList.toggle("active", j === settingTab);
  });
  const ex = el("exchange");
  ex.replaceChildren();
  if (active) {
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
for (const [i, label] of [
  "RUNNING",
  "LIMB COORDINATION",
  "INTERPERSONAL COORDINATION",
  "BATON EXCHANGE",
].entries())
  button("settingsTabs", label, () => {
    settingTab = i;
    settings();
  });
for (const i of [0, 1]) {
  const group = document.createElement("div");
  group.className = "bar";
  group.append("Runner " + "AB"[i]);
  for (const [j, n] of pointNames.entries()) {
    const l = document.createElement("label");
    l.innerHTML = '<input type="checkbox" id="trace' + i + j + '">' + n;
    l.onchange = () => draw();
    group.append(l);
  }
  el("trails").append(group);
}
input("baton").onchange = () => {
  c.baton = input("baton").checked;
  if (!c.baton && settingTab === 3) settingTab = 0;
  if (!c.baton && analysisTab === 3) analysisTab = 0;
  settings();
  recompute();
};
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
  "骨盤高 m",
  "骨盤鉛直速度 m/s",
  "走行周期差 B−A s",
  "相対位置 B−A m",
];
el("metric").innerHTML = metrics
  .map((m, i) => '<option value="' + i + '">' + m + "</option>")
  .join("");
type Snapshot = ReturnType<typeof state>;
function values(s: Snapshot, k: number) {
  if (k === 19) return [2 / runner(c, 1).pitch - 2 / runner(c, 0).pitch];
  if (k === 20) return [s.gap];
  if (k === 17 || k === 18)
    return (c.relay ? [s.a, s.b] : [s.a]).map((r) =>
      k === 17 ? r.hip.y : r.vy,
    );
  if (k >= 4 && k <= 6)
    return [k === 4 ? Math.abs(s.gap) : k === 5 ? s.relative : s.handGap];
  return (c.relay ? [s.a, s.b] : [s.a]).map((r) =>
    k < 4
      ? [r.x, r.v, r.a, r.distance][k]
      : r.limbs[Math.floor((k - 7) / 5)].angles[(k - 7) % 5],
  );
}
let center: number[][] = [],
  events: ReturnType<typeof contacts> = [],
  observations: ReturnType<typeof observation>[][] = [];
let samples: Snapshot[] = [],
  lo = 0,
  hi = duration;
function recompute() {
  analysis = analyze(c);
  center = centers(c);
  events = contacts(c);
  observations = Array.from({ length: 361 }, (_, j) =>
    [0, 1].map((i) => observation(c, j / 60, i, center[i])),
  );
  configureAnalysis();
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
  for (const b of jumpButtons) {
    b.disabled = !e;
    b.hidden = !c.relay || !c.baton;
  }
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
  if (both && c.baton) {
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
    const visible = points(r),
      relative = input("space").value === "BODY RELATIVE";
    visible.forEach((p, k) => {
      if (!input("trace" + i + k).checked) return;
      g.strokeStyle = g.fillStyle = (
        i
          ? ["#9c470b", "#b24a06", "#b24a06", "#88435e", "#88435e"]
          : ["#165a83", "#146aaf", "#146aaf", "#007f79", "#007f79"]
      )[k];
      g.lineWidth = 1.8;
      g.setLineDash(k === 2 || k === 4 ? [4, 3] : []);
      g.beginPath();
      let start = true;
      for (
        let j = Math.max(
          0,
          Math.ceil((t - Number(input("length").value)) * 60),
        );
        j <= Math.floor(t * 60);
        j++
      ) {
        const past = i ? samples[j].b : samples[j].a,
          q = trail(points(past)[k], past.hip, r.hip, relative);
        if (start) g.moveTo(X(q.x), Y(q.y));
        else g.lineTo(X(q.x), Y(q.y));
        start = false;
      }
      if (!start) g.lineTo(X(p.x), Y(p.y));
      g.stroke();
      dot(p, 4);
    });
    g.strokeStyle = g.fillStyle = colors[i];
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
  if (both && c.baton) {
    g.lineWidth = Math.max(4, scale * 0.055);
    g.strokeStyle = "#edb400";
    g.beginPath();
    for (
      let j = Math.max(0, Math.ceil((t - 0.5) * 60));
      j <= Math.floor(t * 60);
      j++
    ) {
      const p = samples[j].tip;
      g.lineTo(X(p.x), Y(p.y));
    }
    g.lineWidth = 1;
    g.stroke();
    g.lineWidth = Math.max(4, scale * 0.055);
    line(s.base, s.tip);
  }
}
function marks(
  g: CanvasRenderingContext2D,
  X: (n: number) => number,
  h: number,
) {
  for (const e of events) {
    if (!e.on) continue;
    g.fillStyle = e.side ? "#c14788" : "#007f77";
    g.fillRect(X(e.t), h - 32 - e.runner * 5, 2, 5);
  }
  if (analysis.event?.success) {
    g.strokeStyle = "#ba8711";
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(X(analysis.event.t), 10);
    g.lineTo(X(analysis.event.t), h - 25);
    g.stroke();
    g.setLineDash([]);
  }
}
function select(id: string, labels: string[]) {
  const n = document.createElement("select");
  n.id = id;
  n.ariaLabel = id;
  labels.forEach((label, i) => n.add(new Option(label, String(i))));
  n.onchange = () => {
    configureAnalysis();
    draw();
  };
  el("phaseControls").append(n);
  return n;
}
const scope = select("phaseScope", ["Runner A", "Runner B", "二者間 A→B"]),
  chart = select("phaseChart", [
    "関節角度",
    "位相角",
    "相対位相",
    "位相平面",
    "角度–角度",
  ]),
  source = select("phaseSource", ["設定位相", "波形推定位相"]),
  pair = select("phasePair", []);
for (const [i, label] of [
  "KINEMATICS",
  "PHASE",
  "RELATIVE MOTION",
  "BATON EVENTS",
].entries())
  button("analysisTabs", label, () => {
    analysisTab = i;
    configureAnalysis();
    draw();
  });
function configureAnalysis() {
  el("slowLabel").hidden = !c.relay || !c.baton;
  Array.from(el("analysisTabs").children).forEach((b, i) => {
    (b as HTMLButtonElement).disabled =
      (i === 2 && !c.relay) || (i === 3 && !(c.relay && c.baton));
    b.classList.toggle("active", i === analysisTab);
  });
  el("phaseControls").hidden = analysisTab !== 1;
  el("metric").hidden = analysisTab === 1;
  const m = el<HTMLSelectElement>("metric");
  for (const o of m.options) {
    const k = +o.value;
    o.hidden =
      analysisTab === 2
        ? ![4, 5, 19, 20].includes(k)
        : analysisTab === 3
          ? k !== 6
          : [4, 5, 6, 19, 20].includes(k);
  }
  if (m.selectedOptions[0]?.hidden)
    m.value = analysisTab === 2 ? "4" : analysisTab === 3 ? "6" : "0";
  scope.options[1].disabled = scope.options[2].disabled = !c.relay;
  if (!c.relay) scope.value = "0";
  const inter = scope.value === "2",
    list = inter ? cross : pairs,
    key = inter ? "cross" : "within";
  if (pair.dataset.mode !== key) {
    pair.replaceChildren();
    list.forEach(([a, b], i) =>
      pair.add(
        new Option(
          (inter ? "A" : "") + names[a] + " → " + (inter ? "B" : "") + names[b],
          String(i),
        ),
      ),
    );
    pair.dataset.mode = key;
  }
  el("definition").textContent =
    "接地印：左＝緑、右＝紫（上段 B・下段 A）。接地は運動学的に規定。黄破線＝パス成立。" +
    (analysisTab === 1
      ? " 脚位相は接地から次の同脚接地まで0–360°。腕は独立または脚に固定した振動子。差は後者−前者、正は後者の進み（−180°以上180°未満）。波形位相は股・肩角の試技内中点と角速度から推定し、非正弦波では設定位相と異なります。"
      : "");
}
function phaseGraph() {
  const { g, w, h } = canvas("plot"),
    inter = scope.value === "2",
    i = scope.value === "1" ? 1 : 0,
    j = inter ? 1 : i,
    [a, b] = (inter ? cross : pairs)[+pair.value],
    mode = +chart.value,
    src = source.value === "1" ? "estimated" : "phases";
  function xy(o: (typeof observations)[number], time: number) {
    const first = o[i],
      second = o[j];
    switch (mode) {
      case 0:
        return [time, first.angles[a], second.angles[b]];
      case 1:
        return [time, first[src][a], second[src][b]];
      case 2:
        return [time, delta(first[src][a], second[src][b])];
      case 3:
        return [first.angles[a], first.velocity[a]];
      default:
        return [first.angles[a], second.angles[b]];
    }
  }
  const rows = observations.map((o, k) => xy(o, k / 60)),
    xs = rows.map((r) => r[0]),
    ys = rows.flatMap((r) => r.slice(1)).filter(Number.isFinite);
  const xmin = mode < 3 ? 0 : Math.min(...xs),
    xmax = mode < 3 ? duration : Math.max(...xs),
    min = mode === 1 ? 0 : mode === 2 ? -180 : ys.length ? Math.min(...ys) : 0,
    max = mode === 1 ? 360 : mode === 2 ? 180 : ys.length ? Math.max(...ys) : 1;
  const X = (x: number) =>
      45 + ((w - 68) * (x - xmin)) / Math.max(0.01, xmax - xmin),
    Y = (y: number) =>
      h - 28 - ((h - 52) * (y - min)) / Math.max(0.01, max - min);
  for (let k = 0; k <= 4; k++) {
    const y = min + ((max - min) * k) / 4;
    g.fillStyle = "#567";
    g.fillText(y.toFixed(0), 2, Y(y));
    g.strokeStyle = "#dbe4e4";
    g.beginPath();
    g.moveTo(45, Y(y));
    g.lineTo(w - 18, Y(y));
    g.stroke();
    const x = xmin + ((xmax - xmin) * k) / 4;
    g.fillText(x.toFixed(1) + (mode < 3 ? "s" : "°"), X(x) - 8, h - 6);
  }
  if (mode < 3) {
    marks(g, X, h);
    g.fillRect(X(t), 8, 1, h - 35);
  }
  const current = xy(
    [0, 1].map((i) => observation(c, t, i, center[i])),
    t,
  );
  for (let k = 1; k < rows[0].length; k++) {
    g.strokeStyle = g.fillStyle = colors[k - 1];
    g.beginPath();
    let prev = NaN;
    for (const row of rows) {
      const y = row[k];
      if (Number.isFinite(y)) {
        if (
          !Number.isFinite(prev) ||
          ((mode === 1 || mode === 2) && Math.abs(y - prev) > 180)
        )
          g.moveTo(X(row[0]), Y(y));
        else g.lineTo(X(row[0]), Y(y));
      }
      prev = y;
    }
    g.stroke();
    if (Number.isFinite(current[k])) {
      g.beginPath();
      g.arc(X(current[0]), Y(current[k]), 4, 0, Math.PI * 2);
      g.fill();
    }
  }
  el("legend").textContent =
    (mode < 2 ? "青＝前者、橙＝後者　" : "") +
    pair.selectedOptions[0].text +
    "　" +
    chart.selectedOptions[0].text +
    "　" +
    (mode === 3
      ? "横：角度 °　縦：角速度 °/s"
      : mode === 4
        ? "横：前者 °　縦：後者 °"
        : "縦：角度 °") +
    "　" +
    current
      .slice(1)
      .map((v) => (Number.isFinite(v) ? fmt(v) : "未定義"))
      .join(" / ");
}
function graph() {
  if (analysisTab === 1) {
    phaseGraph();
    return;
  }
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
  marks(g, X, h);
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
  el("rate").textContent = effectiveRate() + "×";
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
  if (c.relay && !c.baton)
    el("result").textContent =
      "相対位置 B−A " + fmt(s.gap) + " m　相対速度 " + fmt(s.relative) + " m/s";
  const rs = c.relay ? [s.a, s.b] : [s.a];
  el("stats").textContent +=
    "　" +
    rs
      .map((r, i) => {
        const period = 2 / runner(c, i).pitch;
        return (
          "AB"[i] +
          " " +
          r.limbs
            .map((l, j) => ["左", "右"][j] + (l.contact ? "接地" : "遊脚"))
            .join(" / ") +
          "　周期 " +
          fmt(period) +
          " s · 平均ステップ " +
          fmt(period / 2) +
          " s · 接地 " +
          fmt(period * duty) +
          " s · 遊脚 " +
          fmt(period * (1 - duty)) +
          " s"
        );
      })
      .join("　");
  el("coordinates").textContent = input("coords").checked
    ? rs
        .map(
          (r, i) =>
            "AB"[i] +
            " " +
            points(r)
              .slice(1)
              .map(
                (p, j) =>
                  pointNames[j + 1] + " (" + fmt(p.x) + ", " + fmt(p.y) + ") m",
              )
              .join("　"),
        )
        .join("　")
    : "";
  if (e?.success && c.relay && c.baton) {
    const a = observation(c, e.t, 0, center[0]),
      b = observation(c, e.t, 1, center[1]);
    el("result").textContent +=
      "　成立時の設定位相差 " +
      cross
        .map(
          ([j, k]) =>
            "B" +
            names[k] +
            "−A" +
            names[j] +
            " " +
            delta(a.phases[j], b.phases[k]).toFixed(1) +
            "°",
        )
        .join(" / ");
  }
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
function effectiveRate() {
  const e = analysis.event;
  return input("slow").checked &&
    e?.success &&
    t >= e.t - 0.4 &&
    t <= e.t + 0.15
    ? Math.min(rate, 0.25)
    : rate;
}
function tick(now: number) {
  if (playing) {
    const ab = input("ab").checked,
      loop = ab || input("loop").checked;
    t = advance(
      t,
      (now - last) / 1000,
      effectiveRate(),
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
      effectiveRate(),
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
el("jumps").insertAdjacentHTML(
  "beforeend",
  '<label id="slowLabel"><input type="checkbox" id="slow">パス直前に自動スロー</label>',
);
for (const id of [
  "follow",
  "length",
  "space",
  "coords",
  "slow",
  "bones",
  "joints",
  "metric",
])
  el(id).onchange = draw;
for (const [i, id] of ["editA", "editB"].entries())
  el(id).onclick = () => {
    editor = i;
    settings();
  };
for (const id of ["solo", "relay"])
  el(id).onclick = () => {
    c.relay = id === "relay";
    settingTab = 0;
    analysisTab = 0;
    editor = 0;
    settings();
    recompute();
  };
el("reset").onclick = () => {
  playing = false;
  t = 0;
  c = defaults();
  settingTab = analysisTab = 0;
  for (const n of el("trails").querySelectorAll("input")) n.checked = false;
  el<HTMLSelectElement>("space").selectedIndex = 0;
  el<HTMLSelectElement>("length").selectedIndex = 0;
  editor = 0;
  scope.value = chart.value = source.value = "0";
  pair.dataset.mode = "";
  for (const id of ["loop", "coords", "slow"]) input(id).checked = false;
  for (const id of ["bones", "joints", "follow"]) input(id).checked = true;
  input("ab").checked = false;
  input("metric").value = "0";
  settings();
  recompute();
  changeRate(1);
};
function download(json: boolean) {
  const data = exportRows(c, analysis.event);
  const content = json
    ? JSON.stringify({
        modelVersion: "2.0",
        coordinates: "world: metres, right/up",
        phaseDefinition:
          "touchdown=0; relative=second-first [-180,180); waveform=atan2(centered angle, velocity/omega)",
        config: c,
        analysis,
        contacts: events,
        samples: data,
      })
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
