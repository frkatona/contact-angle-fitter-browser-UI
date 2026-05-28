const canvas = document.querySelector("#canvas");
const ctx = canvas.getContext("2d");
const imageInput = document.querySelector("#imageInput");
const emptyState = document.querySelector("#emptyState");
const fitBtn = document.querySelector("#fitBtn");
const saveBtn = document.querySelector("#saveBtn");
const newTraceBtn = document.querySelector("#newTraceBtn");
const undoBtn = document.querySelector("#undoBtn");
const clearBtn = document.querySelector("#clearBtn");
const exportBtn = document.querySelector("#exportBtn");
const runLabel = document.querySelector("#runLabel");
const spacing = document.querySelector("#spacing");
const fitSummary = document.querySelector("#fitSummary");
const runsBody = document.querySelector("#runsBody");

let mode = "trace";
let img = null;
let imageName = "image";
let trace = [];
let baseline = [];
let runs = [];
let currentFit = null;
let isDrawing = false;
let lastPoint = null;
let view = { scale: 1, ox: 0, oy: 0, width: 1, height: 1 };

function setMode(nextMode) {
  mode = nextMode;
  document.querySelectorAll(".mode").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
}

document.querySelectorAll(".mode").forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
});

function resizeCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();

imageInput.addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;
  imageName = file.name;
  const reader = new FileReader();
  reader.onload = () => {
    img = new Image();
    img.onload = () => {
      emptyState.style.display = "none";
      trace = [];
      baseline = [];
      currentFit = null;
      draw();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});

function computeView() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!img) {
    view = { scale: 1, ox: 0, oy: 0, width, height };
    return;
  }
  const scale = Math.min(width / img.width, height / img.height) * 0.96;
  const drawWidth = img.width * scale;
  const drawHeight = img.height * scale;
  view = {
    scale,
    ox: (width - drawWidth) / 2,
    oy: (height - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight,
  };
}

function screenToImage(event) {
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left - view.ox) / view.scale;
  const y = (event.clientY - rect.top - view.oy) / view.scale;
  return {
    x: Math.max(0, Math.min(img?.width || 0, x)),
    y: Math.max(0, Math.min(img?.height || 0, y)),
  };
}

function imageToScreen(point) {
  return {
    x: view.ox + point.x * view.scale,
    y: view.oy + point.y * view.scale,
  };
}

function addTracePoint(point) {
  const minSpacing = Number(spacing.value);
  if (!lastPoint || Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) >= minSpacing) {
    trace.push(point);
    lastPoint = point;
    currentFit = null;
    saveBtn.disabled = true;
    draw();
  }
}

canvas.addEventListener("pointerdown", (event) => {
  if (!img) return;
  canvas.setPointerCapture(event.pointerId);
  const point = screenToImage(event);
  if (mode === "baseline") {
    if (baseline.length >= 2) baseline = [];
    baseline.push(point);
    currentFit = null;
    saveBtn.disabled = true;
    draw();
    return;
  }
  isDrawing = true;
  lastPoint = null;
  addTracePoint(point);
});

canvas.addEventListener("pointermove", (event) => {
  if (!isDrawing || mode !== "trace" || !img) return;
  addTracePoint(screenToImage(event));
});

canvas.addEventListener("pointerup", () => {
  isDrawing = false;
  lastPoint = null;
});

function drawPolyline(points, color, width = 2) {
  if (points.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  points.forEach((point, index) => {
    const p = imageToScreen(point);
    if (index === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.stroke();
}

function drawPoints(points, color, radius = 3) {
  ctx.fillStyle = color;
  points.forEach((point) => {
    const p = imageToScreen(point);
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
  });
}

function localToScreen(x, y) {
  const [a, b] = baseline;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  const ux = { x: dx / length, y: dy / length };
  const n1 = { x: -ux.y, y: ux.x };
  const median = trace.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  median.x = median.x / Math.max(trace.length, 1) - a.x;
  median.y = median.y / Math.max(trace.length, 1) - a.y;
  const sign = median.x * n1.x + median.y * n1.y >= 0 ? 1 : -1;
  const normal = { x: n1.x * sign, y: n1.y * sign };
  return imageToScreen({ x: a.x + x * ux.x + y * normal.x, y: a.y + x * ux.y + y * normal.y });
}

function drawFitOverlay() {
  if (!currentFit || baseline.length !== 2) return;
  const fit = currentFit.fit === "ellipse" && currentFit.ellipse ? currentFit.ellipse : currentFit.circle;
  ctx.strokeStyle = "rgba(31, 122, 101, 0.95)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (fit.kind === "circle") {
    for (let i = 0; i <= 160; i += 1) {
      const t = (Math.PI * 2 * i) / 160;
      const p = localToScreen(fit.cx + fit.radius * Math.cos(t), fit.cy + fit.radius * Math.sin(t));
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
  } else {
    for (let i = 0; i <= 180; i += 1) {
      const t = (Math.PI * 2 * i) / 180;
      const xp = fit.a * Math.cos(t);
      const yp = fit.b * Math.sin(t);
      const x = fit.cx + xp * Math.cos(fit.phi) - yp * Math.sin(fit.phi);
      const y = fit.cy + xp * Math.sin(fit.phi) + yp * Math.cos(fit.phi);
      const p = localToScreen(x, y);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
  }
  ctx.stroke();

  const left = localToScreen(fit.contact_left, 0);
  const right = localToScreen(fit.contact_right, 0);
  ctx.fillStyle = "#b24f34";
  [left, right].forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fill();
  });
}

function draw() {
  computeView();
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  if (!img) return;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, view.ox, view.oy, view.width, view.height);
  ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
  ctx.fillRect(view.ox, view.oy, view.width, view.height);
  drawPolyline(trace, "#f1c84b", 2.5);
  drawPoints(trace.filter((_, i) => i % 8 === 0), "#fff1a6", 2.5);
  drawPolyline(baseline, "#2580c3", 3);
  drawPoints(baseline, "#d8efff", 5);
  drawFitOverlay();
}

function format(value, places = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return Number(value).toFixed(places);
}

function renderFit(result) {
  fitSummary.classList.remove("muted");
  const ellipse = result.ellipse;
  const circle = result.circle;
  fitSummary.innerHTML = `
    <div class="metric"><span>Selected model</span><b>${result.fit}</b></div>
    <div class="metric"><span>Mean angle</span><b>${format(result.theta_mean)}°</b></div>
    <div class="metric"><span>Left / right</span><b>${format(result.theta_left)}° / ${format(result.theta_right)}°</b></div>
    <div class="metric"><span>Contact width</span><b>${format(result.contact_width_px)} px</b></div>
    <div class="metric"><span>Circle residual</span><b>${format(circle.residual_stdev, 3)}</b></div>
    <div class="metric"><span>Ellipse residual</span><b>${ellipse ? format(ellipse.residual_stdev, 3) : "n/a"}</b></div>
  `;
}

fitBtn.addEventListener("click", async () => {
  if (!img) return;
  const payload = {
    imageName,
    label: runLabel.value || `Run ${runs.length + 1}`,
    baseline: baseline.map((p) => [p.x, p.y]),
    points: trace.map((p) => [p.x, p.y]),
  };
  fitBtn.disabled = true;
  try {
    const response = await fetch("/api/fit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Fit failed.");
    currentFit = result;
    renderFit(result);
    saveBtn.disabled = false;
    draw();
  } catch (error) {
    fitSummary.classList.add("muted");
    fitSummary.textContent = error.message;
  } finally {
    fitBtn.disabled = false;
  }
});

saveBtn.addEventListener("click", () => {
  if (!currentFit) return;
  runs.push({ ...currentFit, label: runLabel.value || currentFit.label });
  renderRuns();
  runLabel.value = `Run ${runs.length + 1}`;
  saveBtn.disabled = true;
});

function renderRuns() {
  runsBody.innerHTML = runs.map((run) => `
    <tr>
      <td>${run.label}</td>
      <td>${run.fit}</td>
      <td>${format(run.theta_left)}</td>
      <td>${format(run.theta_right)}</td>
      <td>${format(run.theta_mean)}</td>
      <td>${run.point_count}</td>
    </tr>
  `).join("");
}

newTraceBtn.addEventListener("click", () => {
  trace = [];
  currentFit = null;
  saveBtn.disabled = true;
  fitSummary.classList.add("muted");
  fitSummary.textContent = "No fit yet.";
  draw();
});

undoBtn.addEventListener("click", () => {
  if (mode === "baseline" && baseline.length) baseline.pop();
  else trace.pop();
  currentFit = null;
  saveBtn.disabled = true;
  draw();
});

clearBtn.addEventListener("click", () => {
  trace = [];
  baseline = [];
  currentFit = null;
  saveBtn.disabled = true;
  draw();
});

exportBtn.addEventListener("click", () => {
  if (!runs.length) return;
  const headers = [
    "image_name", "label", "fit", "theta_left", "theta_right", "theta_mean",
    "contact_width_px", "baseline_length_px", "point_count",
    "circle_radius", "circle_residual_stdev", "ellipse_a", "ellipse_b",
    "ellipse_eccentricity", "ellipse_residual_stdev"
  ];
  const rows = runs.map((run) => {
    const ellipse = run.ellipse || {};
    return [
      run.image_name, run.label, run.fit, run.theta_left, run.theta_right, run.theta_mean,
      run.contact_width_px, run.baseline_length_px, run.point_count,
      run.circle.radius, run.circle.residual_stdev, ellipse.a, ellipse.b,
      ellipse.eccentricity, ellipse.residual_stdev
    ];
  });
  const csv = [headers, ...rows].map((row) => row.map((cell) => {
    const value = cell ?? "";
    return `"${String(value).replaceAll('"', '""')}"`;
  }).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "contact-angle-runs.csv";
  link.click();
  URL.revokeObjectURL(link.href);
});
