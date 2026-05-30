const canvas = document.querySelector("#canvas");
const ctx = canvas.getContext("2d");
const app = document.querySelector(".app");
const imageInput = document.querySelector("#imageInput");
const imageNameDisplay = document.querySelector("#imageNameDisplay");
const emptyState = document.querySelector("#emptyState");
const fitBtn = document.querySelector("#fitBtn");
const undoBtn = document.querySelector("#undoBtn");
const clearBtn = document.querySelector("#clearBtn");
const exportBtn = document.querySelector("#exportBtn");
const exportTableBtn = document.querySelector("#exportTableBtn");
const runLabel = document.querySelector("#runLabel");
const spacing = document.querySelector("#spacing");
const spacingBubble = document.querySelector("#spacingBubble");
const thresholdInput = document.querySelector("#thresholdInput");
const thresholdToggleBtn = document.querySelector("#thresholdToggleBtn");
const thresholdControl = document.querySelector("#thresholdControl");
const fitSummary = document.querySelector("#fitSummary");
const runsBody = document.querySelector("#runsBody");
const outputTable = document.querySelector(".output-table");
const imageList = document.querySelector("#imageList");
const activeResultsLabel = document.querySelector("#activeResultsLabel");
const zoomOutBtn = document.querySelector("#zoomOutBtn");
const zoomResetBtn = document.querySelector("#zoomResetBtn");
const zoomInBtn = document.querySelector("#zoomInBtn");
const zoomLevel = document.querySelector("#zoomLevel");
const dropOverlay = document.querySelector("#dropOverlay");
const resizeHandles = document.querySelectorAll("[data-resize-panel]");

let mode = "trace";
let images = [];
let activeImageId = null;
let imageSerial = 0;
let img = null;
let imageName = "image";
let trace = [];
let baseline = [];
let runs = [];
let currentFit = null;
let selectedMode = "trace";
let undoStack = [];
let redoStack = [];
let thresholdEnabled = false;
let thresholdValue = 128;
let isDrawing = false;
let isPanning = false;
let lastPoint = null;
let panStart = null;
let view = { scale: 1, fitScale: 1, ox: 0, oy: 0, width: 1, height: 1 };
let viewport = { zoom: 1, panX: 0, panY: 0 };
let heldMode = null;
let heldModeReturn = null;
let panelResize = null;
let hoveredRunIndex = null;
let protractorCursorEnabled = false;
let protractorCursorPoint = null;
let columnResize = null;

const TABLE_COLUMN_WIDTHS_KEY = "contactAngleOutputColumnWidthsV3";
const DEFAULT_OUTPUT_COLUMN_WIDTHS = [150, 88, 88, 76, 104, 108, 96, 112, 116, 104, 52, 36];
const MIN_OUTPUT_COLUMN_WIDTHS = [120, 72, 72, 64, 84, 88, 76, 92, 96, 84, 44, 34];
const MAX_OUTPUT_COLUMN_WIDTH = 1200;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function applyStoredPanelSizes() {
  const railWidth = Number(localStorage.getItem("contactAngleRailWidth"));
  const panelWidth = Number(localStorage.getItem("contactAnglePanelWidth"));
  if (Number.isFinite(railWidth) && railWidth > 0) {
    app.style.setProperty("--rail-width", `${clamp(railWidth, 210, 420)}px`);
  }
  if (Number.isFinite(panelWidth) && panelWidth > 0) {
    app.style.setProperty("--panel-width", `${clamp(panelWidth, 300, 620)}px`);
  }
}

function readStoredColumnWidths() {
  try {
    const stored = JSON.parse(localStorage.getItem(TABLE_COLUMN_WIDTHS_KEY) || "[]");
    if (!Array.isArray(stored)) return DEFAULT_OUTPUT_COLUMN_WIDTHS;
    return DEFAULT_OUTPUT_COLUMN_WIDTHS.map((defaultWidth, index) => {
      const width = Number(stored[index]);
      return Number.isFinite(width) && width > 0
        ? clamp(width, MIN_OUTPUT_COLUMN_WIDTHS[index], MAX_OUTPUT_COLUMN_WIDTH)
        : defaultWidth;
    });
  } catch {
    return DEFAULT_OUTPUT_COLUMN_WIDTHS;
  }
}

function currentColumnWidths() {
  return Array.from(outputTable.querySelectorAll("col")).map((col, index) => (
    Number.parseFloat(col.style.width) || DEFAULT_OUTPUT_COLUMN_WIDTHS[index]
  ));
}

function applyOutputColumnWidths(widths = readStoredColumnWidths()) {
  outputTable.querySelectorAll("col").forEach((col, index) => {
    const width = clamp(Number(widths[index]) || DEFAULT_OUTPUT_COLUMN_WIDTHS[index], MIN_OUTPUT_COLUMN_WIDTHS[index], MAX_OUTPUT_COLUMN_WIDTH);
    col.style.width = `${width}px`;
  });
}

function setupOutputTableColumnResize() {
  applyOutputColumnWidths();
  outputTable.querySelectorAll("thead th").forEach((th, index) => {
    th.dataset.columnIndex = String(index);
    if (index === outputTable.querySelectorAll("thead th").length - 1) return;
    const handle = document.createElement("span");
    handle.className = "column-resize-handle";
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", "vertical");
    handle.setAttribute("aria-label", `Resize ${th.textContent.trim()} column`);
    th.appendChild(handle);
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      columnResize = {
        index,
        startX: event.clientX,
        startWidth: currentColumnWidths()[index],
        handle,
      };
      handle.setPointerCapture(event.pointerId);
      handle.classList.add("active");
      document.body.classList.add("resizing-table-column");
    });
  });
}

function setMode(nextMode, options = {}) {
  mode = nextMode;
  if (!options.temporary) selectedMode = nextMode;
  canvas.dataset.mode = mode;
  document.querySelectorAll(".mode").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
}

function beginHeldMode(nextMode) {
  if (heldMode || mode === nextMode) return;
  heldMode = nextMode;
  heldModeReturn = mode;
  setMode(nextMode, { temporary: true });
}

function endHeldMode(nextMode) {
  if (heldMode !== nextMode) return;
  setMode(heldModeReturn || selectedMode || "trace", { temporary: true });
  heldMode = null;
  heldModeReturn = null;
}

function isFormControl(target) {
  return Boolean(target?.closest?.("input, textarea, select, button, a, [contenteditable='true']"));
}

function activeRecord() {
  return images.find((record) => record.id === activeImageId) || null;
}

function syncActiveRecord() {
  const record = activeRecord();
  if (!record) return;
  record.trace = trace;
  record.baseline = baseline;
  record.runs = runs;
  record.currentFit = currentFit;
  record.selectedMode = selectedMode;
  record.undoStack = undoStack;
  record.redoStack = redoStack;
  record.thresholdEnabled = thresholdEnabled;
  record.thresholdValue = thresholdValue;
  record.viewport = { ...viewport };
  record.runLabel = runLabel.value;
}

function allRuns() {
  return images.flatMap((record) => record.runs.map((run) => ({ ...run, image_name: record.name })));
}

function isImageFile(file) {
  return Boolean(file?.type?.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|tiff?|heic|heif)$/i.test(file?.name || ""));
}

function clonePoint(point) {
  return { x: point.x, y: point.y };
}

function clonePoints(points) {
  return points.map(clonePoint);
}

function cloneFit(fit) {
  return fit ? JSON.parse(JSON.stringify(fit)) : null;
}

function invalidateCurrentFit() {
  currentFit = null;
}

function pushHistory(action) {
  undoStack.push(action);
  redoStack = [];
  if (undoStack.length > 1000) undoStack.shift();
}

function applyHistory(action, direction) {
  const redo = direction === "redo";
  if (action.type === "trace:add") {
    if (redo) trace.push(clonePoint(action.point));
    else trace.pop();
  } else if (action.type === "baseline:set") {
    baseline = clonePoints(redo ? action.next : action.previous);
  }
  invalidateCurrentFit();
  syncActiveRecord();
  draw();
}

function undoPoint() {
  const action = undoStack.pop();
  if (!action) return;
  applyHistory(action, "undo");
  redoStack.push(action);
  syncActiveRecord();
}

function redoPoint() {
  const action = redoStack.pop();
  if (!action) return;
  applyHistory(action, "redo");
  undoStack.push(action);
  syncActiveRecord();
}

function setThresholdEnabled(enabled, shouldDraw = true) {
  thresholdEnabled = enabled;
  thresholdControl.classList.toggle("active", thresholdEnabled);
  syncThresholdToggleButton();
  syncActiveRecord();
  if (shouldDraw) draw();
}

function setThresholdValue(value, shouldDraw = true) {
  thresholdValue = clamp(Math.round(Number(value) || 0), 0, 255);
  thresholdInput.value = thresholdValue;
  thresholdInput.title = `Threshold: ${thresholdValue}`;
  const record = activeRecord();
  if (record) record.thresholdCache = null;
  syncActiveRecord();
  if (shouldDraw) draw();
}

function toggleThresholdView() {
  setThresholdEnabled(!thresholdEnabled);
}

function syncThresholdToggleButton() {
  thresholdToggleBtn.setAttribute("aria-pressed", String(thresholdEnabled));
  thresholdToggleBtn.textContent = thresholdEnabled ? "On" : "Off";
}

function updateSpacingBubble() {
  const min = Number(spacing.min);
  const max = Number(spacing.max);
  const value = Number(spacing.value);
  const percent = ((value - min) / (max - min)) * 100;
  spacingBubble.textContent = String(value);
  spacingBubble.style.left = `${percent}%`;
}

function showSpacingBubble() {
  updateSpacingBubble();
  spacing.parentElement.classList.add("active");
}

function hideSpacingBubble() {
  spacing.parentElement.classList.remove("active");
}

function setFitControlsDisabled(disabled) {
  fitBtn.disabled = disabled;
}

document.querySelectorAll(".mode").forEach((button) => {
  button.addEventListener("click", () => {
    setMode(button.dataset.mode);
    syncActiveRecord();
  });
});

setMode(mode, { temporary: true });

function updateZoomLabel() {
  zoomLevel.textContent = `${Math.round(viewport.zoom * 100)}%`;
}

function resetViewport(shouldDraw = true) {
  viewport = { zoom: 1, panX: 0, panY: 0 };
  syncActiveRecord();
  updateZoomLabel();
  if (shouldDraw) draw();
}

function resizeCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

applyStoredPanelSizes();
setupOutputTableColumnResize();
window.addEventListener("resize", resizeCanvas);
resizeCanvas();
updateZoomLabel();
updateRunControls();
renderImageList();
updateSpacingBubble();

function resetFitSummary() {
  fitSummary.classList.add("muted");
  fitSummary.textContent = "No fit yet.";
}

function clearActiveImage() {
  activeImageId = null;
  img = null;
  imageName = "image";
  trace = [];
  baseline = [];
  runs = [];
  currentFit = null;
  selectedMode = "trace";
  undoStack = [];
  redoStack = [];
  thresholdEnabled = false;
  thresholdValue = 128;
  viewport = { zoom: 1, panX: 0, panY: 0 };
  runLabel.value = "Run 1";
  hoveredRunIndex = null;
  thresholdInput.value = thresholdValue;
  thresholdControl.classList.remove("active");
  syncThresholdToggleButton();
  imageNameDisplay.textContent = "No image loaded";
  imageNameDisplay.title = "";
  emptyState.style.display = "";
  setMode("trace");
  resetFitSummary();
  updateZoomLabel();
  renderRuns();
  renderImageList();
  draw();
}

function switchToImage(imageId) {
  syncActiveRecord();
  const record = images.find((item) => item.id === imageId);
  if (!record) {
    clearActiveImage();
    return;
  }
  activeImageId = record.id;
  hoveredRunIndex = null;
  img = record.img;
  imageName = record.name;
  trace = record.trace;
  baseline = record.baseline;
  runs = record.runs;
  currentFit = record.currentFit;
  selectedMode = record.selectedMode || "trace";
  undoStack = record.undoStack || [];
  redoStack = record.redoStack || [];
  thresholdEnabled = Boolean(record.thresholdEnabled);
  thresholdValue = record.thresholdValue ?? 128;
  viewport = { ...record.viewport };
  runLabel.value = record.runLabel || `Run ${runs.length + 1}`;
  thresholdInput.value = thresholdValue;
  thresholdControl.classList.toggle("active", thresholdEnabled);
  syncThresholdToggleButton();
  imageNameDisplay.textContent = record.name;
  imageNameDisplay.title = record.name;
  emptyState.style.display = "none";
  setMode(selectedMode, { temporary: true });
  updateZoomLabel();
  if (currentFit) renderFit(currentFit);
  else resetFitSummary();
  renderRuns();
  renderImageList();
  draw();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const nextImage = new Image();
    nextImage.onload = () => resolve(nextImage);
    nextImage.onerror = () => reject(new Error("Could not load image."));
    nextImage.src = src;
  });
}

async function loadImageFile(file) {
  if (!isImageFile(file)) return;
  const key = `${file.name}:${file.size}:${file.lastModified}`;
  const existing = images.find((record) => record.key === key);
  if (existing) {
    switchToImage(existing.id);
    return;
  }
  const dataUrl = await readFileAsDataUrl(file);
  const loadedImage = await loadImageElement(dataUrl);
  const record = {
    id: `image-${++imageSerial}`,
    key,
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    img: loadedImage,
    trace: [],
    baseline: [],
    runs: [],
    currentFit: null,
    selectedMode: "trace",
    undoStack: [],
    redoStack: [],
    thresholdEnabled: false,
    thresholdValue: 128,
    thresholdCache: null,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    runLabel: "Run 1",
  };
  images.push(record);
  switchToImage(record.id);
}

async function loadFiles(fileList) {
  const files = Array.from(fileList || []).filter(isImageFile);
  for (const file of files) {
    await loadImageFile(file);
  }
  imageInput.value = "";
}

imageInput.addEventListener("change", (event) => {
  loadFiles(event.target.files);
});

runLabel.addEventListener("input", syncActiveRecord);
thresholdInput.addEventListener("input", () => setThresholdValue(thresholdInput.value));
thresholdToggleBtn.addEventListener("click", toggleThresholdView);
spacing.addEventListener("input", showSpacingBubble);
spacing.addEventListener("pointerdown", showSpacingBubble);
spacing.addEventListener("pointerup", hideSpacingBubble);
spacing.addEventListener("pointercancel", hideSpacingBubble);
spacing.addEventListener("focus", showSpacingBubble);
spacing.addEventListener("blur", hideSpacingBubble);

resizeHandles.forEach((handle) => {
  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    panelResize = {
      side: handle.dataset.resizePanel,
      startX: event.clientX,
      railWidth: document.querySelector(".rail").getBoundingClientRect().width,
      panelWidth: document.querySelector(".panel").getBoundingClientRect().width,
      handle,
    };
    handle.setPointerCapture(event.pointerId);
    handle.classList.add("active");
    document.body.classList.add("resizing-panels");
  });
});

window.addEventListener("pointermove", (event) => {
  if (columnResize) {
    const widths = currentColumnWidths();
    widths[columnResize.index] = clamp(
      columnResize.startWidth + event.clientX - columnResize.startX,
      MIN_OUTPUT_COLUMN_WIDTHS[columnResize.index],
      MAX_OUTPUT_COLUMN_WIDTH,
    );
    applyOutputColumnWidths(widths);
    localStorage.setItem(TABLE_COLUMN_WIDTHS_KEY, JSON.stringify(widths.map((width) => Math.round(width))));
    return;
  }
  if (!panelResize) return;
  const dx = event.clientX - panelResize.startX;
  if (panelResize.side === "rail") {
    const width = clamp(panelResize.railWidth + dx, 210, Math.min(420, window.innerWidth * 0.42));
    app.style.setProperty("--rail-width", `${width}px`);
    localStorage.setItem("contactAngleRailWidth", String(Math.round(width)));
  } else {
    const width = clamp(panelResize.panelWidth - dx, 300, Math.min(620, window.innerWidth * 0.52));
    app.style.setProperty("--panel-width", `${width}px`);
    localStorage.setItem("contactAnglePanelWidth", String(Math.round(width)));
  }
  resizeCanvas();
});

window.addEventListener("pointerup", () => {
  if (columnResize) {
    columnResize.handle.classList.remove("active");
    document.body.classList.remove("resizing-table-column");
    columnResize = null;
    return;
  }
  if (!panelResize) return;
  panelResize.handle.classList.remove("active");
  document.body.classList.remove("resizing-panels");
  panelResize = null;
  resizeCanvas();
});

window.addEventListener("pointercancel", () => {
  if (columnResize) {
    columnResize.handle.classList.remove("active");
    document.body.classList.remove("resizing-table-column");
    columnResize = null;
    return;
  }
  if (!panelResize) return;
  panelResize.handle.classList.remove("active");
  document.body.classList.remove("resizing-panels");
  panelResize = null;
  resizeCanvas();
});

function eventHasImageFiles(event) {
  const transfer = event.dataTransfer;
  if (!transfer) return false;
  if (Array.from(transfer.items || []).some((item) => item.kind === "file" && (!item.type || item.type.startsWith("image/")))) {
    return true;
  }
  return Array.from(transfer.types || []).includes("Files");
}

window.addEventListener("dragenter", (event) => {
  if (!eventHasImageFiles(event)) return;
  event.preventDefault();
  document.body.classList.add("dragging-files");
});

window.addEventListener("dragover", (event) => {
  if (!eventHasImageFiles(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  document.body.classList.add("dragging-files");
});

window.addEventListener("dragleave", (event) => {
  if (event.relatedTarget) return;
  document.body.classList.remove("dragging-files");
});

window.addEventListener("drop", (event) => {
  event.preventDefault();
  document.body.classList.remove("dragging-files");
  loadFiles(event.dataTransfer.files);
});

function computeView() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!img) {
    view = { scale: 1, fitScale: 1, ox: 0, oy: 0, width, height };
    return;
  }
  const fitScale = Math.min(width / img.width, height / img.height) * 0.96;
  const scale = fitScale * viewport.zoom;
  const drawWidth = img.width * scale;
  const drawHeight = img.height * scale;
  view = {
    scale,
    fitScale,
    ox: (width - drawWidth) / 2 + viewport.panX,
    oy: (height - drawHeight) / 2 + viewport.panY,
    width: drawWidth,
    height: drawHeight,
  };
}

function eventToCanvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function screenToImagePoint(x, y, shouldClamp = true) {
  const imageX = (x - view.ox) / view.scale;
  const imageY = (y - view.oy) / view.scale;
  if (!shouldClamp) return { x: imageX, y: imageY };
  return {
    x: clamp(imageX, 0, img?.width || 0),
    y: clamp(imageY, 0, img?.height || 0),
  };
}

function screenToImage(event) {
  const point = eventToCanvasPoint(event);
  return screenToImagePoint(point.x, point.y);
}

function imageToScreen(point) {
  return {
    x: view.ox + point.x * view.scale,
    y: view.oy + point.y * view.scale,
  };
}

function zoomAt(factor, anchorX = canvas.clientWidth / 2, anchorY = canvas.clientHeight / 2) {
  if (!img) return;
  computeView();
  const imageAnchor = screenToImagePoint(anchorX, anchorY, false);
  viewport.zoom = clamp(viewport.zoom * factor, 0.5, 32);
  computeView();
  viewport.panX += anchorX - (view.ox + imageAnchor.x * view.scale);
  viewport.panY += anchorY - (view.oy + imageAnchor.y * view.scale);
  syncActiveRecord();
  updateZoomLabel();
  draw();
}

canvas.addEventListener("wheel", (event) => {
  if (!img) return;
  event.preventDefault();
  const anchor = eventToCanvasPoint(event);
  const factor = Math.exp(-event.deltaY * 0.0015);
  zoomAt(factor, anchor.x, anchor.y);
}, { passive: false });

zoomOutBtn.addEventListener("click", () => zoomAt(0.8));
zoomInBtn.addEventListener("click", () => zoomAt(1.25));
zoomResetBtn.addEventListener("click", () => resetViewport());

function addTracePoint(point) {
  if (currentFit) {
    trace = [];
    undoStack = [];
    redoStack = [];
    lastPoint = null;
    hoveredRunIndex = null;
    updateRunRowHover();
    resetFitSummary();
    invalidateCurrentFit();
  }

  const minSpacing = Number(spacing.value);
  if (!lastPoint || Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) >= minSpacing) {
    const nextPoint = clonePoint(point);
    trace.push(nextPoint);
    lastPoint = point;
    pushHistory({ type: "trace:add", point: nextPoint });
    syncActiveRecord();
    draw();
  }
}

function startPan(event) {
  isPanning = true;
  panStart = {
    x: event.clientX,
    y: event.clientY,
    panX: viewport.panX,
    panY: viewport.panY,
  };
  canvas.classList.add("is-panning");
}

function stopPointerWork() {
  isDrawing = false;
  isPanning = false;
  lastPoint = null;
  panStart = null;
  canvas.classList.remove("is-panning");
}

canvas.addEventListener("pointerdown", (event) => {
  if (!img) return;
  protractorCursorPoint = eventToCanvasPoint(event);
  canvas.setPointerCapture(event.pointerId);
  computeView();
  if (event.button === 1 || event.button === 2 || event.altKey) {
    event.preventDefault();
    startPan(event);
    return;
  }
  if (event.button !== 0) return;
  const overlayIndex = runOverlayAt(eventToCanvasPoint(event));
  if (overlayIndex !== null) {
    event.preventDefault();
    selectRun(overlayIndex);
    return;
  }
  const point = screenToImage(event);
  if (mode === "baseline") {
    const previous = clonePoints(baseline);
    if (baseline.length >= 2) baseline = [];
    baseline.push(clonePoint(point));
    pushHistory({ type: "baseline:set", previous, next: clonePoints(baseline) });
    invalidateCurrentFit();
    syncActiveRecord();
    draw();
    return;
  }
  isDrawing = true;
  lastPoint = null;
  addTracePoint(point);
});

canvas.addEventListener("pointermove", (event) => {
  protractorCursorPoint = eventToCanvasPoint(event);
  if (!img) return;
  if (isPanning && panStart) {
    viewport.panX = panStart.panX + event.clientX - panStart.x;
    viewport.panY = panStart.panY + event.clientY - panStart.y;
    syncActiveRecord();
    draw();
    return;
  }
  if (!isDrawing) {
    setHoveredRunIndex(runOverlayAt(eventToCanvasPoint(event)));
    if (protractorCursorEnabled) draw();
    return;
  }
  if (mode !== "trace") return;
  addTracePoint(screenToImage(event));
});

canvas.addEventListener("pointerup", stopPointerWork);
canvas.addEventListener("pointercancel", stopPointerWork);
canvas.addEventListener("pointerleave", () => {
  protractorCursorPoint = null;
  if (!isDrawing && !isPanning) setHoveredRunIndex(null);
  if (protractorCursorEnabled) draw();
});
canvas.addEventListener("contextmenu", (event) => event.preventDefault());

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

function makeLocalFrame(sourceBaseline = baseline, sourceTrace = trace) {
  if (sourceBaseline.length !== 2) return null;
  const [a, b] = sourceBaseline;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 2) return null;
  const ux = { x: dx / length, y: dy / length };
  const n1 = { x: -ux.y, y: ux.x };
  const median = sourceTrace.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  median.x = median.x / Math.max(sourceTrace.length, 1) - a.x;
  median.y = median.y / Math.max(sourceTrace.length, 1) - a.y;
  const sign = median.x * n1.x + median.y * n1.y >= 0 ? 1 : -1;
  return {
    origin: a,
    ux,
    normal: { x: n1.x * sign, y: n1.y * sign },
  };
}

function localToImage(x, y, frame) {
  return {
    x: frame.origin.x + x * frame.ux.x + y * frame.normal.x,
    y: frame.origin.y + x * frame.ux.y + y * frame.normal.y,
  };
}

function localToScreen(x, y, frame) {
  return imageToScreen(localToImage(x, y, frame));
}

function ellipseSlope(fit, x, y = 0) {
  const cosP = Math.cos(fit.phi);
  const sinP = Math.sin(fit.phi);
  const xr = (x - fit.cx) * cosP + (y - fit.cy) * sinP;
  const yr = -(x - fit.cx) * sinP + (y - fit.cy) * cosP;
  const dfdx = (2 * xr * cosP) / (fit.a * fit.a) - (2 * yr * sinP) / (fit.b * fit.b);
  const dfdy = (2 * xr * sinP) / (fit.a * fit.a) + (2 * yr * cosP) / (fit.b * fit.b);
  if (Math.abs(dfdy) < 1e-9) return Infinity;
  return -dfdx / dfdy;
}

function tangentSlope(fit, contactX) {
  if (fit.kind === "young-laplace") {
    const midpoint = (fit.contact_left + fit.contact_right) * 0.5;
    return contactX <= midpoint ? fit.slope_left : fit.slope_right;
  }
  if (fit.kind === "ellipse") return ellipseSlope(fit, contactX);
  return -(contactX - fit.cx) / (0 - fit.cy);
}

function tangentAngleThroughDrop(slope) {
  if (!Number.isFinite(slope)) return Math.PI / 2;
  if (slope >= 0) return Math.atan(slope);
  return Math.PI + Math.atan(slope);
}

function fitForKind(run, kind) {
  if (!run) return null;
  if (kind === "young-laplace") return run.young_laplace || null;
  if (kind === "ellipse") return run.ellipse || null;
  if (kind === "circle") return run.circle || null;
  return null;
}

function lowestResidualFitKind(run) {
  const candidates = ["young-laplace", "ellipse", "circle"]
    .map((kind) => ({ kind, residual: modelResidual(fitForKind(run, kind)) }))
    .filter((candidate) => Number.isFinite(candidate.residual));
  if (!candidates.length) return run?.circle ? "circle" : "young-laplace";
  candidates.sort((a, b) => a.residual - b.residual);
  return candidates[0].kind;
}

function selectedOverlayKind(run) {
  if (fitForKind(run, run?.overlayFit)) return run.overlayFit;
  return lowestResidualFitKind(run);
}

function selectedFitDetails(run) {
  return fitForKind(run, selectedOverlayKind(run));
}

function localSampleToScreen(sample, frame) {
  return localToScreen(sample[0], sample[1], frame);
}

function tangentSegmentAt(fit, contactX, frame) {
  const slope = tangentSlope(fit, contactX);
  const span = Math.max(1, Math.abs(fit.contact_right - fit.contact_left));
  const halfLength = Math.max(16 / view.scale, Math.min(90, span * 0.24));
  let dx = 0;
  let dy = halfLength;
  if (Number.isFinite(slope)) {
    const norm = Math.hypot(1, slope);
    dx = halfLength / norm;
    dy = (slope * halfLength) / norm;
  }
  const p1 = localToScreen(contactX - dx, -dy, frame);
  const p2 = localToScreen(contactX + dx, dy, frame);
  return [p1, p2];
}

function drawTangentAt(fit, contactX, frame) {
  const [p1, p2] = tangentSegmentAt(fit, contactX, frame);
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
}

function drawContactAngleArc(fit, contactX, side, frame, style = {}) {
  const slope = tangentSlope(fit, contactX);
  const tangentAngle = tangentAngleThroughDrop(slope);
  const span = Math.max(1, Math.abs(fit.contact_right - fit.contact_left));
  const radius = Math.max(14 / view.scale, Math.min(42, span * 0.12));
  const start = side === "left" ? 0 : tangentAngle;
  const end = side === "left" ? tangentAngle : Math.PI;
  const steps = Math.max(12, Math.ceil(Math.abs(end - start) / 0.08));

  ctx.strokeStyle = style.arcColor || "rgba(255, 219, 92, 0.98)";
  ctx.lineWidth = style.arcWidth || 2;
  ctx.setLineDash([]);
  ctx.beginPath();
  for (let i = 0; i <= steps; i += 1) {
    const a = start + ((end - start) * i) / steps;
    const p = localToScreen(contactX + radius * Math.cos(a), radius * Math.sin(a), frame);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

function drawFitOverlayFor(fitResult, sourceBaseline, sourceTrace, style = {}) {
  if (!fitResult || sourceBaseline.length !== 2) return;
  const frame = makeLocalFrame(sourceBaseline, sourceTrace);
  if (!frame) return;
  const fit = selectedFitDetails(fitResult);
  if (!fit) return;
  const curveColor = style.curveColor || "rgba(31, 122, 101, 0.95)";
  const tangentColor = style.tangentColor || "rgba(255, 112, 67, 0.98)";
  const pointColor = style.pointColor || "#b24f34";
  const width = style.width || 2;

  ctx.strokeStyle = curveColor;
  ctx.lineWidth = width;
  ctx.setLineDash([]);
  ctx.beginPath();
  if (fit.kind === "young-laplace" && fit.samples?.length) {
    fit.samples.forEach((sample, index) => {
      const p = localSampleToScreen(sample, frame);
      if (index === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
  } else if (fit.kind === "circle") {
    for (let i = 0; i <= 160; i += 1) {
      const t = (Math.PI * 2 * i) / 160;
      const p = localToScreen(fit.cx + fit.radius * Math.cos(t), fit.cy + fit.radius * Math.sin(t), frame);
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
      const p = localToScreen(x, y, frame);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
  }
  ctx.stroke();

  const left = localToScreen(fit.contact_left, 0, frame);
  const right = localToScreen(fit.contact_right, 0, frame);
  ctx.fillStyle = pointColor;
  [left, right].forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.strokeStyle = tangentColor;
  ctx.lineWidth = style.tangentWidth || 2.2;
  ctx.setLineDash(style.tangentDash || [8, 5]);
  ctx.beginPath();
  drawTangentAt(fit, fit.contact_left, frame);
  drawTangentAt(fit, fit.contact_right, frame);
  ctx.stroke();
  ctx.setLineDash([]);

  drawContactAngleArc(fit, fit.contact_left, "left", frame, style);
  drawContactAngleArc(fit, fit.contact_right, "right", frame, style);
}

function runOverlayPoints(points) {
  return (points || []).map((point) => (
    Array.isArray(point) ? { x: point[0], y: point[1] } : clonePoint(point)
  ));
}

function runOverlayBaseline(run) {
  return runOverlayPoints(run.overlayBaseline || run.baseline);
}

function runOverlayTrace(run) {
  return runOverlayPoints(run.overlayTrace);
}

function drawSavedRunOverlays() {
  runs.forEach((run, index) => {
    const sourceBaseline = runOverlayBaseline(run);
    const sourceTrace = runOverlayTrace(run);
    if (sourceBaseline.length !== 2 || sourceTrace.length < 2) return;
    const highlighted = hoveredRunIndex === index || run === currentFit;
    drawPolyline(sourceTrace, highlighted ? "rgba(241, 200, 75, 0.82)" : "rgba(194, 196, 188, 0.42)", highlighted ? 2.8 : 1.8);
    drawPoints(sourceTrace.filter((_, i) => i % 10 === 0), highlighted ? "rgba(255, 241, 166, 0.78)" : "rgba(210, 211, 204, 0.36)", highlighted ? 2.8 : 2);
    drawPolyline(sourceBaseline, highlighted ? "rgba(37, 128, 195, 0.82)" : "rgba(160, 172, 178, 0.52)", highlighted ? 3 : 2);
    drawPoints(sourceBaseline, highlighted ? "rgba(216, 239, 255, 0.86)" : "rgba(190, 198, 202, 0.58)", highlighted ? 5 : 4);
    drawFitOverlayFor(run, sourceBaseline, sourceTrace, {
      curveColor: highlighted ? "rgba(31, 122, 101, 0.98)" : "rgba(180, 187, 174, 0.56)",
      tangentColor: highlighted ? "rgba(255, 112, 67, 0.98)" : "rgba(202, 176, 108, 0.54)",
      pointColor: highlighted ? "#b24f34" : "rgba(178, 166, 142, 0.64)",
      arcColor: highlighted ? "rgba(255, 219, 92, 0.98)" : "rgba(206, 196, 153, 0.43)",
      width: highlighted ? 2.4 : 1.5,
      tangentWidth: highlighted ? 2.4 : 1.5,
      tangentDash: highlighted ? [8, 5] : [6, 6],
    });
  });
}

function fitCurveScreenPoints(fit, frame) {
  const points = [];
  if (!fit) return points;
  if (fit.kind === "young-laplace" && fit.samples?.length) {
    fit.samples.forEach((sample) => points.push(localSampleToScreen(sample, frame)));
  } else if (fit.kind === "circle") {
    for (let i = 0; i <= 96; i += 1) {
      const t = (Math.PI * 2 * i) / 96;
      points.push(localToScreen(fit.cx + fit.radius * Math.cos(t), fit.cy + fit.radius * Math.sin(t), frame));
    }
  } else {
    for (let i = 0; i <= 112; i += 1) {
      const t = (Math.PI * 2 * i) / 112;
      const xp = fit.a * Math.cos(t);
      const yp = fit.b * Math.sin(t);
      points.push(localToScreen(
        fit.cx + xp * Math.cos(fit.phi) - yp * Math.sin(fit.phi),
        fit.cy + xp * Math.sin(fit.phi) + yp * Math.cos(fit.phi),
        frame,
      ));
    }
  }
  return points;
}

function distanceToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 1e-9) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq, 0, 1);
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function distanceToPolyline(point, points) {
  if (points.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 1; i < points.length; i += 1) {
    best = Math.min(best, distanceToSegment(point, points[i - 1], points[i]));
  }
  return best;
}

function runOverlayAt(screenPoint) {
  computeView();
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index];
    const sourceBaseline = runOverlayBaseline(run);
    const sourceTrace = runOverlayTrace(run);
    if (sourceBaseline.length !== 2 || sourceTrace.length < 2) continue;
    const frame = makeLocalFrame(sourceBaseline, sourceTrace);
    const fit = selectedFitDetails(run);
    if (!frame || !fit) continue;
    const traceScreen = sourceTrace.map(imageToScreen);
    const baselineScreen = sourceBaseline.map(imageToScreen);
    const curveScreen = fitCurveScreenPoints(fit, frame);
    const leftTangent = tangentSegmentAt(fit, fit.contact_left, frame);
    const rightTangent = tangentSegmentAt(fit, fit.contact_right, frame);
    const distance = Math.min(
      distanceToPolyline(screenPoint, curveScreen),
      distanceToPolyline(screenPoint, traceScreen),
      distanceToPolyline(screenPoint, baselineScreen),
      distanceToSegment(screenPoint, leftTangent[0], leftTangent[1]),
      distanceToSegment(screenPoint, rightTangent[0], rightTangent[1]),
    );
    if (distance <= 9) return index;
  }
  return null;
}

function updateRunRowHover() {
  runsBody.querySelectorAll("[data-run-row]").forEach((row) => {
    const index = Number(row.dataset.runRow);
    row.classList.toggle("run-hover", index === hoveredRunIndex);
    row.classList.toggle("run-selected", runs[index] === currentFit);
  });
  canvas.classList.toggle("has-run-hover", hoveredRunIndex !== null);
}

function setHoveredRunIndex(index) {
  if (hoveredRunIndex === index) return;
  hoveredRunIndex = index;
  updateRunRowHover();
  draw();
}

function selectRun(index) {
  const run = runs[index];
  if (!run) return;
  currentFit = run;
  hoveredRunIndex = index;
  renderFit(currentFit);
  updateRunRowHover();
  syncActiveRecord();
  draw();
}

function thresholdCanvasForActiveImage() {
  const record = activeRecord();
  if (!record || !img) return img;
  if (record.thresholdCache?.value === thresholdValue) return record.thresholdCache.canvas;

  const source = document.createElement("canvas");
  source.width = img.width;
  source.height = img.height;
  const sourceCtx = source.getContext("2d", { willReadFrequently: true });
  sourceCtx.drawImage(img, 0, 0);
  const imageData = sourceCtx.getImageData(0, 0, source.width, source.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const luminance = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    const value = luminance >= thresholdValue ? 255 : 0;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  sourceCtx.putImageData(imageData, 0, 0);
  record.thresholdCache = { value: thresholdValue, canvas: source };
  return source;
}

function setProtractorCursorEnabled(enabled) {
  protractorCursorEnabled = enabled;
  canvas.classList.toggle("protractor-cursor", protractorCursorEnabled);
  draw();
}

function toggleProtractorCursor() {
  setProtractorCursorEnabled(!protractorCursorEnabled);
}

function drawProtractorCursor() {
  if (!protractorCursorEnabled || !protractorCursorPoint) return;
  const cx = protractorCursorPoint.x;
  const cy = protractorCursorPoint.y;
  const outerRadius = 94;
  const innerRadius = 38;
  const frame = baseline.length === 2 ? makeLocalFrame(baseline, trace) : null;
  const xAxis = frame ? frame.ux : { x: 1, y: 0 };
  const yAxis = frame ? frame.normal : { x: 0, y: -1 };
  const pointAt = (degrees, radius) => {
    const radians = (degrees * Math.PI) / 180;
    const radialX = Math.cos(radians) * xAxis.x + Math.sin(radians) * yAxis.x;
    const radialY = Math.cos(radians) * xAxis.y + Math.sin(radians) * yAxis.y;
    return {
      x: cx + radialX * radius,
      y: cy + radialY * radius,
    };
  };

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  for (let degrees = 180; degrees >= 0; degrees -= 2) {
    const p = pointAt(degrees, outerRadius);
    if (degrees === 180) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  for (let degrees = 0; degrees <= 180; degrees += 2) {
    const p = pointAt(degrees, innerRadius);
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.fillStyle = "rgba(246, 248, 241, 0.34)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.68)";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.strokeStyle = "rgba(29, 36, 32, 0.62)";
  ctx.lineWidth = 1;
  for (let degrees = 0; degrees <= 180; degrees += 1) {
    const major = degrees % 10 === 0;
    const medium = degrees % 5 === 0;
    const tickLength = major ? 13 : medium ? 9 : 5;
    const p1 = pointAt(degrees, outerRadius);
    const p2 = pointAt(degrees, outerRadius - tickLength);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(178, 79, 52, 0.78)";
  ctx.lineWidth = 1.4;
  [0, 45, 90, 135, 180].forEach((degrees) => {
    const p = pointAt(degrees, outerRadius - 18);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  });

  ctx.fillStyle = "rgba(29, 36, 32, 0.84)";
  ctx.font = "700 10px Inter, ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let degrees = 0; degrees <= 180; degrees += 30) {
    const p = pointAt(degrees, outerRadius - 27);
    ctx.fillText(String(degrees), p.x, p.y);
  }

  ctx.strokeStyle = "rgba(37, 128, 195, 0.78)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(cx - xAxis.x * (outerRadius + 8), cy - xAxis.y * (outerRadius + 8));
  ctx.lineTo(cx + xAxis.x * (outerRadius + 8), cy + xAxis.y * (outerRadius + 8));
  ctx.moveTo(cx - yAxis.x * 10, cy - yAxis.y * 10);
  ctx.lineTo(cx + yAxis.x * 10, cy + yAxis.y * 10);
  ctx.stroke();

  ctx.fillStyle = "rgba(37, 128, 195, 0.9)";
  ctx.beginPath();
  ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function draw() {
  computeView();
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  if (!img) return;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(thresholdEnabled ? thresholdCanvasForActiveImage() : img, view.ox, view.oy, view.width, view.height);
  ctx.fillStyle = "rgba(0, 0, 0, 0.24)";
  ctx.fillRect(view.ox, view.oy, view.width, view.height);
  drawSavedRunOverlays();
  if (!currentFit) {
    drawPolyline(trace, "#f1c84b", 2.5);
    drawPoints(trace.filter((_, i) => i % 8 === 0), "#fff1a6", 2.5);
    drawPolyline(baseline, "#2580c3", 3);
    drawPoints(baseline, "#d8efff", 5);
  }
  drawProtractorCursor();
}

function format(value, places = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return Number(value).toFixed(places);
}

function contactWidth(fit) {
  if (!fit || fit.contact_left === undefined || fit.contact_right === undefined) return null;
  return fit.contact_right - fit.contact_left;
}

function modelResidual(fit) {
  if (!fit) return null;
  return fit.residual_rms ?? fit.residual_stdev;
}

function selectedResidual(run) {
  return modelResidual(selectedFitDetails(run));
}

function circleContactWidth(run) {
  return contactWidth(run.circle);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderFit(result) {
  fitSummary.classList.remove("muted");
  const ellipse = result.ellipse;
  const circle = result.circle;
  const youngLaplace = result.young_laplace;
  const circleWidth = circle ? circle.contact_right - circle.contact_left : null;
  const ellipseWidth = ellipse ? ellipse.contact_right - ellipse.contact_left : null;
  const youngLaplaceWidth = youngLaplace ? youngLaplace.contact_right - youngLaplace.contact_left : null;
  const selected = selectedOverlayKind(result);
  fitSummary.innerHTML = `
    <section class="fit-card fit-card-young-laplace ${selected === "young-laplace" ? "selected" : ""} ${youngLaplace ? "" : "unavailable"}" data-fit-overlay="young-laplace" role="button" tabindex="${youngLaplace ? "0" : "-1"}" aria-pressed="${selected === "young-laplace"}" aria-disabled="${!youngLaplace}">
      <div class="fit-card-head"><span>Young-Laplace fit</span><b>${youngLaplace ? (selected === "young-laplace" ? "Drawn" : "Available") : "Unavailable"}</b></div>
      <div class="metric"><span>Mean angle</span><b>${youngLaplace ? `${format(youngLaplace.theta_mean)}&deg;` : "n/a"}</b></div>
      <div class="metric"><span>Left / right</span><b>${youngLaplace ? `${format(youngLaplace.theta_left)}&deg; / ${format(youngLaplace.theta_right)}&deg;` : "n/a"}</b></div>
      <div class="metric"><span>Width</span><b>${youngLaplace ? `${format(youngLaplaceWidth)} px` : "n/a"}</b></div>
      <div class="metric"><span>Bond / scale</span><b>${youngLaplace ? `${format(youngLaplace.bond, 3)} / ${format(youngLaplace.scale_px)}` : "n/a"}</b></div>
      <div class="metric"><span>YL RMS residual</span><b>${youngLaplace ? format(youngLaplace.residual_rms, 3) : "n/a"}</b></div>
    </section>
    <section class="fit-card fit-card-ellipse ${selected === "ellipse" ? "selected" : ""} ${ellipse ? "" : "unavailable"}" data-fit-overlay="ellipse" role="button" tabindex="${ellipse ? "0" : "-1"}" aria-pressed="${selected === "ellipse"}" aria-disabled="${!ellipse}">
      <div class="fit-card-head"><span>Ellipse fit</span><b>${ellipse ? (selected === "ellipse" ? "Drawn" : "Available") : "Unavailable"}</b></div>
      <div class="metric"><span>Mean angle</span><b>${ellipse ? `${format(ellipse.theta_mean)}&deg;` : "n/a"}</b></div>
      <div class="metric"><span>Left / right</span><b>${ellipse ? `${format(ellipse.theta_left)}&deg; / ${format(ellipse.theta_right)}&deg;` : "n/a"}</b></div>
      <div class="metric"><span>Width</span><b>${ellipse ? `${format(ellipseWidth)} px` : "n/a"}</b></div>
      <div class="metric"><span>a / b / e</span><b>${ellipse ? `${format(ellipse.a)} / ${format(ellipse.b)} / ${format(ellipse.eccentricity, 3)}` : "n/a"}</b></div>
      <div class="metric"><span>Ellipse residual</span><b>${ellipse ? format(ellipse.residual_stdev, 3) : "n/a"}</b></div>
    </section>
    <section class="fit-card fit-card-circle ${selected === "circle" ? "selected" : ""}" data-fit-overlay="circle" role="button" tabindex="0" aria-pressed="${selected === "circle"}">
      <div class="fit-card-head"><span>Circle fit</span><b>${selected === "circle" ? "Drawn" : "Available"}</b></div>
      <div class="metric"><span>Mean angle</span><b>${format(circle.theta_mean)}&deg;</b></div>
      <div class="metric"><span>Left / right</span><b>${format(circle.theta_left)}&deg; / ${format(circle.theta_right)}&deg;</b></div>
      <div class="metric"><span>Width / radius</span><b>${format(circleWidth)} / ${format(circle.radius)}</b></div>
      <div class="metric"><span>Residual</span><b>${format(circle.residual_stdev, 3)}</b></div>
    </section>
  `;
}

async function fitCurrent() {
  if (!img || fitBtn.disabled) return;
  const label = runLabel.value || `Run ${runs.length + 1}`;
  const payload = {
    imageName,
    label,
    baseline: baseline.map((p) => [p.x, p.y]),
    points: trace.map((p) => [p.x, p.y]),
  };
  setFitControlsDisabled(true);
  try {
    const response = await fetch("/api/fit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Fit failed.");
    const savedRun = {
      ...result,
      label,
      overlayFit: lowestResidualFitKind(result),
      overlayTrace: clonePoints(trace),
      overlayBaseline: clonePoints(baseline),
      saved_at: new Date().toISOString(),
    };
    runs.push(savedRun);
    currentFit = savedRun;
    hoveredRunIndex = runs.length - 1;
    renderFit(savedRun);
    renderRuns();
    renderImageList();
    runLabel.value = `Run ${runs.length + 1}`;
    syncActiveRecord();
    draw();
  } catch (error) {
    fitSummary.classList.add("muted");
    fitSummary.textContent = error.message;
  } finally {
    setFitControlsDisabled(false);
  }
}

fitBtn.addEventListener("click", () => fitCurrent());

function updateRunControls() {
  const disabled = allRuns().length === 0;
  exportBtn.disabled = disabled;
  exportTableBtn.disabled = disabled;
}

function setCurrentOverlayFit(kind) {
  if (!currentFit || !fitForKind(currentFit, kind)) return;
  currentFit.overlayFit = kind;
  syncActiveRecord();
  renderFit(currentFit);
  updateRunRowHover();
  draw();
}

fitSummary.addEventListener("click", (event) => {
  const card = event.target.closest("[data-fit-overlay]");
  if (!card || card.classList.contains("unavailable")) return;
  setCurrentOverlayFit(card.dataset.fitOverlay);
});

fitSummary.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const card = event.target.closest("[data-fit-overlay]");
  if (!card || card.classList.contains("unavailable")) return;
  event.preventDefault();
  setCurrentOverlayFit(card.dataset.fitOverlay);
});

function renderImageList() {
  if (!images.length) {
    imageList.innerHTML = `<div class="image-empty">No images loaded.</div>`;
    return;
  }
  imageList.innerHTML = images.map((record) => `
    <div class="image-row ${record.id === activeImageId ? "active" : ""}">
      <button class="image-select" data-image-id="${record.id}" title="${escapeHtml(record.name)}">
        <strong>${escapeHtml(record.name)}</strong>
        <span>${record.runs.length} saved row${record.runs.length === 1 ? "" : "s"}</span>
      </button>
      <button class="remove-image" data-remove-image="${record.id}" title="Remove image" aria-label="Remove image">x</button>
    </div>
  `).join("");
}

function renderRuns() {
  const active = activeRecord();
  activeResultsLabel.textContent = active ? `Showing rows for ${active.name}` : "No active image";
  activeResultsLabel.title = active?.name || "";
  runsBody.innerHTML = runs.map((run, index) => `
    <tr data-run-row="${index}" class="${[
      hoveredRunIndex === index ? "run-hover" : "",
      run === currentFit ? "run-selected" : "",
    ].filter(Boolean).join(" ")}">
      <td><input class="run-label-input" data-edit-run-label="${index}" value="${escapeHtml(run.label || `Run ${index + 1}`)}" aria-label="Run label"></td>
      <td>${format(run.young_laplace?.theta_mean)}</td>
      <td>${format(contactWidth(run.young_laplace), 1)}</td>
      <td>${format(modelResidual(run.young_laplace), 3)}</td>
      <td>${format(run.circle?.theta_mean)}</td>
      <td>${format(contactWidth(run.circle), 1)}</td>
      <td>${format(modelResidual(run.circle), 3)}</td>
      <td>${format(run.ellipse?.theta_mean)}</td>
      <td>${format(contactWidth(run.ellipse), 1)}</td>
      <td>${format(modelResidual(run.ellipse), 3)}</td>
      <td>${run.point_count}</td>
      <td><button class="delete-run" data-delete-run="${index}" title="Delete row" aria-label="Delete row">x</button></td>
    </tr>
  `).join("");
  updateRunRowHover();
  updateRunControls();
}

imageList.addEventListener("click", (event) => {
  const selectButton = event.target.closest("[data-image-id]");
  const removeButton = event.target.closest("[data-remove-image]");
  if (removeButton) {
    const id = removeButton.dataset.removeImage;
    syncActiveRecord();
    const index = images.findIndex((record) => record.id === id);
    if (index < 0) return;
    images.splice(index, 1);
    if (id === activeImageId) {
      const next = images[images.length - 1];
      if (next) switchToImage(next.id);
      else clearActiveImage();
    } else {
      renderImageList();
      updateRunControls();
    }
    return;
  }
  if (selectButton) {
    switchToImage(selectButton.dataset.imageId);
  }
});

runsBody.addEventListener("click", (event) => {
  const button = event.target.closest("[data-delete-run]");
  if (button) {
    const deletedIndex = Number(button.dataset.deleteRun);
    const deletedRun = runs[deletedIndex];
    runs.splice(deletedIndex, 1);
    if (hoveredRunIndex === deletedIndex) hoveredRunIndex = null;
    else if (hoveredRunIndex !== null && hoveredRunIndex > deletedIndex) hoveredRunIndex -= 1;
    if (deletedRun === currentFit) {
      currentFit = null;
      resetFitSummary();
    }
    syncActiveRecord();
    renderRuns();
    renderImageList();
    runLabel.value = `Run ${runs.length + 1}`;
    syncActiveRecord();
    draw();
    return;
  }
  if (event.target.closest("[data-edit-run-label]")) return;
  const row = event.target.closest("[data-run-row]");
  if (!row) return;
  selectRun(Number(row.dataset.runRow));
});

runsBody.addEventListener("input", (event) => {
  const input = event.target.closest("[data-edit-run-label]");
  if (!input) return;
  const index = Number(input.dataset.editRunLabel);
  if (!runs[index]) return;
  runs[index].label = input.value;
  syncActiveRecord();
});

runsBody.addEventListener("pointerover", (event) => {
  const row = event.target.closest("[data-run-row]");
  if (!row) return;
  setHoveredRunIndex(Number(row.dataset.runRow));
});

runsBody.addEventListener("pointerleave", () => {
  setHoveredRunIndex(null);
});

undoBtn.addEventListener("click", undoPoint);

function clearDrawing() {
  trace = [];
  baseline = [];
  undoStack = [];
  redoStack = [];
  invalidateCurrentFit();
  syncActiveRecord();
  draw();
}

clearBtn.addEventListener("click", clearDrawing);

function exportRuns() {
  syncActiveRecord();
  const exportRows = allRuns();
  if (!exportRows.length) return;
  const headers = [
    "image_name",
    "label",
    "fit",
    "theta_mean_deg",
    "theta_left_deg",
    "theta_right_deg",
    "contact_width_px",
    "baseline_length_px",
    "point_count",
    "selected_residual_stdev",
    "young_laplace_theta_mean_deg",
    "young_laplace_theta_left_deg",
    "young_laplace_theta_right_deg",
    "young_laplace_contact_width_px",
    "young_laplace_bond",
    "young_laplace_scale_px",
    "young_laplace_residual_rms",
    "circle_theta_mean_deg",
    "circle_theta_left_deg",
    "circle_theta_right_deg",
    "circle_contact_width_px",
    "circle_radius",
    "circle_points_used",
    "circle_residual_stdev",
    "ellipse_theta_mean_deg",
    "ellipse_theta_left_deg",
    "ellipse_theta_right_deg",
    "ellipse_contact_width_px",
    "ellipse_a",
    "ellipse_b",
    "ellipse_eccentricity",
    "ellipse_residual_stdev",
    "saved_at",
  ];
  const rows = exportRows.map((run) => {
    const ellipse = run.ellipse || {};
    const ellipseWidth = ellipse.contact_right !== undefined && ellipse.contact_left !== undefined
      ? ellipse.contact_right - ellipse.contact_left
      : null;
    const youngLaplace = run.young_laplace || {};
    const youngLaplaceWidth = youngLaplace.contact_right !== undefined && youngLaplace.contact_left !== undefined
      ? youngLaplace.contact_right - youngLaplace.contact_left
      : null;
    return [
      run.image_name,
      run.label,
      run.fit,
      run.theta_mean,
      run.theta_left,
      run.theta_right,
      run.contact_width_px,
      run.baseline_length_px,
      run.point_count,
      selectedResidual(run),
      youngLaplace.theta_mean,
      youngLaplace.theta_left,
      youngLaplace.theta_right,
      youngLaplaceWidth,
      youngLaplace.bond,
      youngLaplace.scale_px,
      youngLaplace.residual_rms,
      run.circle.theta_mean,
      run.circle.theta_left,
      run.circle.theta_right,
      circleContactWidth(run),
      run.circle.radius,
      run.circle.points_used,
      run.circle.residual_stdev,
      ellipse.theta_mean,
      ellipse.theta_left,
      ellipse.theta_right,
      ellipseWidth,
      ellipse.a,
      ellipse.b,
      ellipse.eccentricity,
      ellipse.residual_stdev,
      run.saved_at,
    ];
  });
  const csv = [headers, ...rows].map((row) => row.map((cell) => {
    const value = cell ?? "";
    return `"${String(value).replaceAll('"', '""')}"`;
  }).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const link = document.createElement("a");
  const baseName = images.length > 1 ? "session" : imageName.replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "-") || "image";
  link.href = URL.createObjectURL(blob);
  link.download = `contact-angle-${baseName}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

exportBtn.addEventListener("click", exportRuns);
exportTableBtn.addEventListener("click", exportRuns);

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  const inFormControl = isFormControl(event.target);

  if (event.key === "Shift" && !event.repeat && !inFormControl) {
    beginHeldMode(selectedMode === "baseline" ? "trace" : "baseline");
    return;
  }

  if (!inFormControl && event.ctrlKey && !event.shiftKey && key === "z") {
    event.preventDefault();
    undoPoint();
    return;
  }

  if (!inFormControl && event.altKey && key === "z") {
    event.preventDefault();
    redoPoint();
    return;
  }

  if (event.ctrlKey && !event.shiftKey && !event.altKey && key === "p") {
    event.preventDefault();
    if (!event.repeat) toggleProtractorCursor();
    return;
  }

  if (inFormControl || event.ctrlKey || event.metaKey || event.altKey) return;

  if (key === "f") {
    event.preventDefault();
    fitCurrent();
  } else if (key === "t") {
    event.preventDefault();
    toggleThresholdView();
  } else if (key === "e") {
    event.preventDefault();
    exportRuns();
  } else if (event.key === "+" || event.key === "=") {
    event.preventDefault();
    zoomAt(1.25);
  } else if (event.key === "-" || event.key === "_") {
    event.preventDefault();
    zoomAt(0.8);
  } else if (event.key === "0") {
    event.preventDefault();
    resetViewport();
  } else if (event.key === "Escape") {
    event.preventDefault();
    heldMode = null;
    heldModeReturn = null;
    setMode("trace");
    syncActiveRecord();
  }
});

window.addEventListener("keyup", (event) => {
  if (event.key === "Shift" && heldMode) endHeldMode(heldMode);
});

window.addEventListener("blur", () => {
  if (!heldMode) return;
  heldMode = null;
  heldModeReturn = null;
  setMode("trace");
});
