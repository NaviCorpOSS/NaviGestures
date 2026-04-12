(() => {
  const api = typeof browser !== "undefined" ? browser : chrome;
  const isBrowserApi = typeof browser !== "undefined";
  const common = globalThis.NaviGesturesCommon;
  const STATIONARY_CLICK_PX = 4;
  const RIGHT_MENU_DOUBLECLICK_MS = 350;
  const ROCKER_SUPPRESS_CLICK_MS = 500;
  const ROCKER_WHEEL_COOLDOWN_MS = 180;
  const ROCKER_WHEEL_MIN_DELTA_X = 6;
  const ROCKER_WHEEL_DOMINANCE_RATIO = 1.3;
  const LOCAL_SCROLL_STEP_RATIO = 0.85;
  const DEBUG_LOG_MAX_LINES = 220;
  /** Fixed layout size; visual size stays constant via inverse page-zoom scale on the host. */
  const DEBUG_PANEL_WIDTH_PX = 380;
  const DEBUG_PANEL_MAX_HEIGHT_PX = 400;
  const GESTURE_HINT_MAX_WIDTH_PX = 280;
  const HINT_BORDER_DEFAULT = "rgba(200, 230, 255, 0.38)";
  const HINT_BORDER_MATCHED = "rgba(92, 224, 124, 0.8)";
  let settings = common.sanitizeSettings(common.DEFAULT_SETTINGS);
  let tracking = false;
  let path = [];
  let anchorPoint = null;
  let totalDistance = 0;
  let suppressNextContextMenu = false;
  let trailCanvas = null;
  let trailCtx = null;
  let gesturePipeCanvas = null;
  let gesturePipeCtx = null;
  let gesturePipeScale = 1;
  let gesturePipeScaleLocked = false;
  let gestureFirstSegmentMaxProjection = 0;
  let gestureStartClientPoint = null;
  let clearTrailTimer = null;
  let trailLastPoint = null;
  let trailPixelRatio = 1;
  let blockGestureUntilRelease = false;
  let lastRightStationaryClickAt = 0;
  let suppressPointerAfterRockerUntil = 0;
  let lastRockerWheelAt = 0;
  let debugPanel = null;
  let debugLogBody = null;
  let debugLogLines = [];
  let debugCollapsed = false;
  /** Unified pipe state: recognition geometry + elimination + progress. */
  let pipeState = null;
  let debugCandidatesEl = null;
  let gestureHintEl = null;
  /** Inner node inside shadow root (text + border); host handles position and zoom scale. */
  let gestureHintPillEl = null;
  let strokePoints = [];
  let overlayViewportListener = null;
  /** From `tabs.getZoom` (Ctrl+/- page zoom); combined with visual viewport pinch in `getOverlayZoomCompensationFactor`. */
  let cachedTabZoomFactor = 1;

  function randomNaviGesturesUiSuffix() {
    try {
      if (globalThis.crypto && globalThis.crypto.getRandomValues) {
        const buf = new Uint8Array(8);
        globalThis.crypto.getRandomValues(buf);
        return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
      }
    } catch (_) {
      /* ignore */
    }
    return String(Math.random()).slice(2, 18);
  }

  function nowTimeLabel() {
    const d = new Date();
    return d.toLocaleTimeString([], { hour12: false }) + "." + String(d.getMilliseconds()).padStart(3, "0");
  }

  function appendDebugLog(message) {
    if (!settings.showDebugLogWindow) return;
    if (!debugLogBody) return;
    debugLogLines.push(`[${nowTimeLabel()}] ${message}`);
    if (debugLogLines.length > DEBUG_LOG_MAX_LINES) {
      debugLogLines.shift();
    }
    debugLogBody.textContent = debugLogLines.join("\n");
    debugLogBody.scrollTop = debugLogBody.scrollHeight;
  }

  function createDebugPanel() {
    if (!settings.showDebugLogWindow || debugPanel || !document.documentElement) return;
    const uid = randomNaviGesturesUiSuffix();
    const host = document.createElement("div");
    host.id = `ng-dbg-host-${uid}`;
    host.setAttribute("data-navigestures-ui", "debug");
    host.style.cssText =
      "position:fixed;right:12px;bottom:12px;z-index:2147483646;pointer-events:auto;display:block;";
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      *, *::before, *::after { box-sizing: border-box; }
      .ng-dbg-shell {
        width: ${DEBUG_PANEL_WIDTH_PX}px;
        max-height: ${DEBUG_PANEL_MAX_HEIGHT_PX}px;
        display: flex;
        flex-direction: column;
        background: rgba(8, 10, 16, 0.9);
        border: 1px solid rgba(180, 220, 255, 0.28);
        border-radius: 8px;
        color: #e8f4ff;
        font: 500 11px/1.35 ui-monospace, Menlo, Monaco, Consolas, monospace;
        box-shadow: 0 10px 32px rgba(0, 0, 0, 0.55);
        overflow: hidden;
      }
      .ng-dbg-shell.ng-dbg-collapsed { max-height: none; }
      .ng-dbg-header {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 0 0 auto;
        padding: 8px 8px 6px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.12);
      }
      .ng-dbg-title {
        flex: 1;
        font-size: 11px;
        font-weight: 700;
        color: #f5fbff;
        letter-spacing: 0.02em;
      }
      .ng-dbg-btn {
        cursor: pointer;
        font: inherit;
        font-weight: 600;
        font-size: 11px;
        padding: 2px 6px;
        border-radius: 4px;
        border: 1px solid rgba(200, 230, 255, 0.35);
        background: rgba(255, 255, 255, 0.1);
        color: #f0f8ff;
      }
      .ng-dbg-btn:hover { background: rgba(255, 255, 255, 0.16); }
      .ng-dbg-candidates {
        flex: 0 0 auto;
        padding: 6px 8px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        font-size: 10px;
        line-height: 1.4;
        color: #b8d8ff;
        word-break: break-word;
        max-height: 72px;
        overflow-y: auto;
      }
      .ng-dbg-body {
        margin: 0;
        flex: 1 1 auto;
        min-height: 0;
        padding: 8px;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
        user-select: text;
        color: #dceeff;
      }
    `;
    shadow.appendChild(style);

    const shell = document.createElement("section");
    shell.className = "ng-dbg-shell";
    shell.id = `ng-dbg-panel-${uid}`;
    shell.setAttribute("aria-label", "NaviGestures debug logs");

    const header = document.createElement("div");
    header.className = "ng-dbg-header";
    header.id = `ng-dbg-head-${uid}`;

    const title = document.createElement("strong");
    title.className = "ng-dbg-title";
    title.id = `ng-dbg-title-${uid}`;
    title.textContent = "NaviGestures debug";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "ng-dbg-btn";
    copyBtn.id = `ng-dbg-copy-${uid}`;
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(debugLogLines.join("\n"));
        appendDebugLog("Copied logs to clipboard.");
      } catch (_) {
        appendDebugLog("Copy failed: clipboard access denied.");
      }
    });

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "ng-dbg-btn";
    clearBtn.id = `ng-dbg-clear-${uid}`;
    clearBtn.textContent = "Clear";
    clearBtn.addEventListener("click", () => {
      debugLogLines = [];
      if (debugLogBody) debugLogBody.textContent = "";
      appendDebugLog("Log cleared.");
    });

    const collapseBtn = document.createElement("button");
    collapseBtn.type = "button";
    collapseBtn.className = "ng-dbg-btn";
    collapseBtn.id = `ng-dbg-collapse-${uid}`;
    collapseBtn.textContent = "Hide";

    debugLogBody = document.createElement("pre");
    debugLogBody.className = "ng-dbg-body";
    debugLogBody.id = `ng-dbg-log-${uid}`;

    debugCandidatesEl = document.createElement("div");
    debugCandidatesEl.className = "ng-dbg-candidates";
    debugCandidatesEl.id = `ng-dbg-cand-${uid}`;
    debugCandidatesEl.setAttribute("aria-live", "polite");

    collapseBtn.addEventListener("click", () => {
      debugCollapsed = !debugCollapsed;
      debugLogBody.style.display = debugCollapsed ? "none" : "";
      if (debugCandidatesEl) debugCandidatesEl.style.display = debugCollapsed ? "none" : "";
      shell.classList.toggle("ng-dbg-collapsed", debugCollapsed);
      collapseBtn.textContent = debugCollapsed ? "Show" : "Hide";
      applyDebugPanelZoomIndependence();
    });

    header.appendChild(title);
    header.appendChild(copyBtn);
    header.appendChild(clearBtn);
    header.appendChild(collapseBtn);
    shell.appendChild(header);
    shell.appendChild(debugCandidatesEl);
    shell.appendChild(debugLogBody);
    shadow.appendChild(shell);

    debugPanel = host;
    document.documentElement.appendChild(debugPanel);
    applyDebugPanelZoomIndependence();
    updateOverlayViewportListeners();
    appendDebugLog("Debug panel ready.");
  }

  function removeDebugPanel() {
    if (debugPanel && debugPanel.parentNode) {
      debugPanel.parentNode.removeChild(debugPanel);
    }
    debugPanel = null;
    debugLogBody = null;
    debugCandidatesEl = null;
    debugCollapsed = false;
    debugLogLines = [];
    updateOverlayViewportListeners();
  }

  function syncDebugPanelVisibility() {
    if (settings.showDebugLogWindow) {
      createDebugPanel();
      return;
    }
    removeDebugPanel();
  }

  function formatActionList(actions) {
    if (!Array.isArray(actions) || actions.length === 0) return "(none)";
    return actions.join(", ");
  }

  function getConfiguredMouseButtonCode() {
    return settings.triggerMouseButton === "middle" ? 1 : 2;
  }

  function getConfiguredMouseButtonMask() {
    return settings.triggerMouseButton === "middle" ? 4 : 2;
  }

  function isMatchingMouseButton(buttonCode) {
    return buttonCode === getConfiguredMouseButtonCode();
  }

  function isMiddleButtonPressed(buttonMask) {
    return (buttonMask & 4) !== 0;
  }

  function getRockerActionForButton(buttonCode) {
    if (buttonCode === 0) return settings.rockerMiddleLeftAction;
    if (buttonCode === 2) return settings.rockerMiddleRightAction;
    return "none";
  }

  function isRockerMouseDown(event) {
    if (event.button !== 0 && event.button !== 2) return false;
    return isMiddleButtonPressed(event.buttons);
  }

  function getRockerActionForWheelDelta(deltaX) {
    if (deltaX < 0) return settings.rockerMiddleLeftAction;
    if (deltaX > 0) return settings.rockerMiddleRightAction;
    return "none";
  }

  function isLikelyRockerWheelEvent(event) {
    const absX = Math.abs(event.deltaX);
    const absY = Math.abs(event.deltaY);
    if (absX < ROCKER_WHEEL_MIN_DELTA_X) return false;
    if (absX < absY * ROCKER_WHEEL_DOMINANCE_RATIO) return false;
    return true;
  }

  function suppressPointerEventsAfterRocker() {
    suppressPointerAfterRockerUntil = Date.now() + ROCKER_SUPPRESS_CLICK_MS;
  }

  function shouldSuppressPointerAfterRocker() {
    return Date.now() <= suppressPointerAfterRockerUntil;
  }

  function isModifierSatisfied(event) {
    switch (settings.triggerModifier) {
      case "alt":
        return !!event.altKey || !!event.metaKey;
      case "shift":
        return !!event.shiftKey;
      case "ctrl":
        return !!event.ctrlKey;
      default:
        return true;
    }
  }

  function storageGet(key) {
    if (isBrowserApi) {
      return api.storage.local.get(key).catch(() => ({}));
    }

    return new Promise((resolve) => {
      try {
        api.storage.local.get(key, (value) => {
          const err = api.runtime && api.runtime.lastError;
          if (err) {
            resolve({});
            return;
          }
          resolve(value || {});
        });
      } catch (_) {
        resolve({});
      }
    });
  }

  async function loadSettings() {
    const data = await storageGet("settings");
    settings = common.sanitizeSettings(data.settings || common.DEFAULT_SETTINGS);
    applyTrailStyle();
    syncDebugPanelVisibility();
    requestTabZoomFromBackground();
    appendDebugLog(
      `Settings loaded: minSegmentPx=${settings.minSegmentPx}, inaccuracy=${settings.inaccuracyDegrees}°, trigger=${settings.triggerMouseButton}, rockerLeft=${settings.rockerMiddleLeftAction}, rockerRight=${settings.rockerMiddleRightAction}`
    );
  }

  function pipeColorForAction(action, alpha) {
    let h = 0;
    for (let i = 0; i < action.length; i += 1) {
      h = (h * 33 + action.charCodeAt(i)) % 360;
    }
    const a = Math.max(0, Math.min(1, alpha != null ? alpha : 1));
    return `hsla(${h}, 88%, 62%, ${a})`;
  }

  function clampGesturePipeScale(v) {
    return Math.min(20, Math.max(1, v));
  }

  function directionUnitVector(direction) {
    const deg = common.angleForDirection(direction);
    const rad = (deg * Math.PI) / 180;
    return { x: Math.cos(rad), y: Math.sin(rad) };
  }

  function updateGesturePipeScaleFromStroke() {
    if (gesturePipeScaleLocked) return false;
    if (!gestureStartClientPoint || path.length === 0 || strokePoints.length === 0) return false;
    const firstDir = path[0];
    const u = directionUnitVector(firstDir);
    const p = strokePoints[strokePoints.length - 1];
    const dx = p.x - gestureStartClientPoint.x;
    const dy = p.y - gestureStartClientPoint.y;
    const proj = dx * u.x + dy * u.y;
    if (proj > gestureFirstSegmentMaxProjection) {
      gestureFirstSegmentMaxProjection = proj;
    }
    const base = common.pipeScaleBase(settings);
    const nextScale = clampGesturePipeScale(gestureFirstSegmentMaxProjection / base);
    const changed = Math.abs(nextScale - gesturePipeScale) >= 0.05;
    if (changed) gesturePipeScale = nextScale;
    if (path.length >= 2) {
      const firstAngle = common.angleForDirection(path[0]);
      for (let i = 1; i < path.length; i += 1) {
        if (common.angularDifference(firstAngle, common.angleForDirection(path[i])) > 90) {
          gesturePipeScaleLocked = true;
          break;
        }
      }
    }
    return changed;
  }

  function createGesturePipeCanvas() {
    if (gesturePipeCanvas || !document.documentElement) return;
    gesturePipeCanvas = document.createElement("canvas");
    gesturePipeCanvas.setAttribute("aria-hidden", "true");
    gesturePipeCanvas.style.position = "fixed";
    gesturePipeCanvas.style.left = "0";
    gesturePipeCanvas.style.top = "0";
    gesturePipeCanvas.style.width = "100vw";
    gesturePipeCanvas.style.height = "100vh";
    gesturePipeCanvas.style.pointerEvents = "none";
    // Keep pipe overlay below active stroke / hint layers.
    gesturePipeCanvas.style.zIndex = "2147483644";
    gesturePipeCtx = gesturePipeCanvas.getContext("2d");
    document.documentElement.appendChild(gesturePipeCanvas);
  }

  function createTrailCanvas() {
    if (trailCanvas || !document.documentElement) return;
    createGesturePipeCanvas();
    trailCanvas = document.createElement("canvas");
    trailCanvas.setAttribute("aria-hidden", "true");
    trailCanvas.style.position = "fixed";
    trailCanvas.style.left = "0";
    trailCanvas.style.top = "0";
    trailCanvas.style.width = "100vw";
    trailCanvas.style.height = "100vh";
    trailCanvas.style.pointerEvents = "none";
    trailCanvas.style.zIndex = "2147483647";

    trailCtx = trailCanvas.getContext("2d");
    resizeTrailCanvas();
    applyTrailStyle();
    document.documentElement.appendChild(trailCanvas);
  }

  function resizeTrailCanvas() {
    if (!trailCanvas || !trailCtx) return;
    const viewport = window.visualViewport;
    const cssWidth = viewport ? viewport.width : window.innerWidth;
    const cssHeight = viewport ? viewport.height : window.innerHeight;
    trailPixelRatio = window.devicePixelRatio || 1;
    if (gesturePipeCanvas && gesturePipeCtx) {
      gesturePipeCanvas.width = Math.max(1, Math.floor(cssWidth * trailPixelRatio));
      gesturePipeCanvas.height = Math.max(1, Math.floor(cssHeight * trailPixelRatio));
    }
    trailCanvas.width = Math.max(1, Math.floor(cssWidth * trailPixelRatio));
    trailCanvas.height = Math.max(1, Math.floor(cssHeight * trailPixelRatio));
    applyTrailStyle();
    redrawGesturePipeOverlay();
  }

  function toTrailPoint(clientX, clientY) {
    const viewport = window.visualViewport;
    if (!viewport) return { x: clientX, y: clientY };
    return {
      x: (clientX + viewport.offsetLeft) * viewport.scale,
      y: (clientY + viewport.offsetTop) * viewport.scale
    };
  }

  function applyTrailStyle() {
    if (!trailCtx) return;
    const lineW = settings.trailWidth * trailPixelRatio;
    trailCtx.lineWidth = lineW;
    trailCtx.lineCap = "round";
    trailCtx.lineJoin = "round";
    trailCtx.strokeStyle = settings.trailColor;
    trailCtx.shadowColor = settings.trailColor;
    trailCtx.shadowBlur = Math.max(0.5, lineW * 0.55);
    trailCtx.shadowOffsetX = 0;
    trailCtx.shadowOffsetY = 0;
  }

  function trailStrokeStyle(color) {
    if (!trailCtx) return;
    const lineW = settings.trailWidth * trailPixelRatio;
    trailCtx.lineWidth = lineW;
    trailCtx.lineCap = "round";
    trailCtx.lineJoin = "round";
    trailCtx.strokeStyle = color;
    trailCtx.shadowColor = color;
    trailCtx.shadowBlur = Math.max(0.5, lineW * 0.55);
    trailCtx.shadowOffsetX = 0;
    trailCtx.shadowOffsetY = 0;
  }

  function drawCenterline(points, color, widthPx, maxLen) {
    if (!points || points.length < 2) return;
    let remaining = Number.isFinite(maxLen) ? Math.max(0, maxLen) : Number.POSITIVE_INFINITY;
    gesturePipeCtx.beginPath();
    gesturePipeCtx.moveTo(points[0].x * trailPixelRatio, points[0].y * trailPixelRatio);
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      if (segLen < 1e-6) continue;
      if (remaining >= segLen) {
        gesturePipeCtx.lineTo(b.x * trailPixelRatio, b.y * trailPixelRatio);
        remaining -= segLen;
        continue;
      }
      const t = remaining / segLen;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      gesturePipeCtx.lineTo(x * trailPixelRatio, y * trailPixelRatio);
      remaining = 0;
      break;
    }
    gesturePipeCtx.lineWidth = widthPx;
    gesturePipeCtx.lineCap = "round";
    gesturePipeCtx.lineJoin = "round";
    gesturePipeCtx.strokeStyle = color;
    gesturePipeCtx.shadowBlur = 0;
    gesturePipeCtx.stroke();
  }

  function drawPipe(pts, action, radiusPx) {
    if (!pts || pts.length < 2) return;
    drawCenterline(pts, pipeColorForAction(action, 0.13), radiusPx * 2);
    drawCenterline(
      pts,
      pipeColorForAction(action, 0.8),
      Math.max(1.2, settings.trailWidth * 0.75) * trailPixelRatio
    );
  }

  function redrawGesturePipeOverlay() {
    if (!gesturePipeCtx || !gesturePipeCanvas) return;
    gesturePipeCtx.clearRect(0, 0, gesturePipeCanvas.width, gesturePipeCanvas.height);
    if (!tracking || !pipeState) return;
    const surviving = pipeState.pipes.filter((p) => !p.eliminated);
    if (!surviving.length) return;
    const radiusPx = pipeState.radius * trailPixelRatio;
    for (const pipe of surviving) {
      const trailPts = pipe.centerline.map((p) => toTrailPoint(p.x, p.y));
      drawPipe(trailPts, pipe.action, radiusPx);
    }
  }

  function redrawTrailSegmented() {
    if (!trailCtx || strokePoints.length < 2) return;
    trailCtx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
    trailStrokeStyle(settings.trailColor);
    trailCtx.beginPath();
    const pts = strokePoints.map((p) => toTrailPoint(p.x, p.y));
    trailCtx.moveTo(pts[0].x * trailPixelRatio, pts[0].y * trailPixelRatio);
    for (let i = 1; i < pts.length; i += 1) {
      trailCtx.lineTo(pts[i].x * trailPixelRatio, pts[i].y * trailPixelRatio);
    }
    trailCtx.stroke();
    trailLastPoint = pts[pts.length - 1];
  }

  function clearTrail() {
    if (!trailCtx || !trailCanvas) return;
    trailCtx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
    trailLastPoint = null;
  }

  function clearGesturePipeOverlay() {
    if (gesturePipeCtx && gesturePipeCanvas) {
      gesturePipeCtx.clearRect(0, 0, gesturePipeCanvas.width, gesturePipeCanvas.height);
    }
  }

  function startTrail(x, y) {
    createTrailCanvas();
    if (!trailCtx) return;
    if (clearTrailTimer) {
      clearTimeout(clearTrailTimer);
      clearTrailTimer = null;
    }
    clearTrail();
    trailCtx.beginPath();
    trailCtx.moveTo(x * trailPixelRatio, y * trailPixelRatio);
    trailLastPoint = { x, y };
  }

  function extendTrail(x, y) {
    if (!trailCtx || !trailLastPoint) return;
    const dist = Math.hypot(x - trailLastPoint.x, y - trailLastPoint.y);
    if (dist < 0.6) return;
    trailCtx.lineTo(x * trailPixelRatio, y * trailPixelRatio);
    trailCtx.stroke();
    trailLastPoint = { x, y };
  }

  function updateDebugCandidatesBar() {
    if (!debugCandidatesEl) return;
    if (!tracking || !pipeState) {
      debugCandidatesEl.textContent = "";
      return;
    }
    const surviving = common.survivingPipeActions(pipeState);
    const labels = surviving.map((a) => common.ACTION_LABELS[a] || a);
    debugCandidatesEl.textContent =
      labels.length === 0 ? "Pipes: (none)" : `Pipes: ${labels.join(", ")}`;
  }

  function finishTrail() {
    if (clearTrailTimer) clearTimeout(clearTrailTimer);
    clearTrailTimer = setTimeout(() => {
      clearTrail();
      clearTrailTimer = null;
    }, 160);
  }

  function refreshOverlaysForZoom() {
    applyGestureHintZoomIndependence();
    applyDebugPanelZoomIndependence();
  }

  function requestTabZoomFromBackground() {
    try {
      if (isBrowserApi) {
        api.runtime
          .sendMessage({ type: "navigestures-get-tab-zoom" })
          .then((response) => {
            if (response && typeof response.zoom === "number" && response.zoom > 0) {
              cachedTabZoomFactor = response.zoom;
            }
            refreshOverlaysForZoom();
          })
          .catch(() => refreshOverlaysForZoom());
      } else {
        api.runtime.sendMessage({ type: "navigestures-get-tab-zoom" }, (response) => {
          const err = api.runtime && api.runtime.lastError;
          if (!err && response && typeof response.zoom === "number" && response.zoom > 0) {
            cachedTabZoomFactor = response.zoom;
          }
          refreshOverlaysForZoom();
        });
      }
    } catch (_) {
      refreshOverlaysForZoom();
    }
  }

  function getVisualViewportPinchScale() {
    const vv = window.visualViewport;
    if (!vv || typeof vv.scale !== "number" || !(vv.scale > 0)) return 1;
    return vv.scale;
  }

  function getLayoutViewportZoomHint() {
    const vv = window.visualViewport;
    if (!vv || vv.width <= 0) return 1;
    const layoutW = document.documentElement.clientWidth;
    if (layoutW <= 0) return 1;
    const r = layoutW / vv.width;
    if (r >= 0.65 && r <= 2.5) return r;
    return 1;
  }

  /**
   * Effective zoom for counter-scaling fixed UI. Desktop Ctrl+/- is exposed as `tabs.getZoom`;
   * `visualViewport.scale` covers pinch; layout ratio is a fallback when the others sit at 1.
   */
  function getOverlayZoomCompensationFactor() {
    const zTab = typeof cachedTabZoomFactor === "number" && cachedTabZoomFactor > 0 ? cachedTabZoomFactor : 1;
    const zPinch = getVisualViewportPinchScale();
    const zLayout = getLayoutViewportZoomHint();

    if (Math.abs(zTab - 1) >= 0.02) {
      return zTab * (Math.abs(zPinch - 1) >= 0.02 ? zPinch : 1);
    }
    if (Math.abs(zPinch - 1) >= 0.02) {
      return zPinch;
    }
    if (Math.abs(zLayout - 1) >= 0.02) {
      return zLayout;
    }
    return 1;
  }

  function applyGestureHintZoomIndependence() {
    if (!gestureHintEl) return;
    const z = getOverlayZoomCompensationFactor();
    if (Math.abs(z - 1) < 0.02) {
      gestureHintEl.style.removeProperty("transform");
      gestureHintEl.style.removeProperty("transform-origin");
      return;
    }
    const inv = 1 / z;
    gestureHintEl.style.transformOrigin = "top left";
    gestureHintEl.style.transform = `scale(${inv})`;
  }

  function applyDebugPanelZoomIndependence() {
    if (!debugPanel) return;
    const z = getOverlayZoomCompensationFactor();
    if (Math.abs(z - 1) < 0.02) {
      debugPanel.style.removeProperty("transform");
      debugPanel.style.removeProperty("transform-origin");
      return;
    }
    debugPanel.style.transformOrigin = "bottom right";
    debugPanel.style.transform = `scale(${1 / z})`;
  }

  function updateOverlayViewportListeners() {
    const vv = window.visualViewport;
    const needListener = !!(debugPanel || tracking);
    if (!vv) return;
    if (!needListener) {
      if (overlayViewportListener) {
        vv.removeEventListener("resize", overlayViewportListener);
        vv.removeEventListener("scroll", overlayViewportListener);
        overlayViewportListener = null;
      }
      return;
    }
    if (overlayViewportListener) return;
    overlayViewportListener = () => {
      if (gestureHintEl) applyGestureHintZoomIndependence();
      if (debugPanel) applyDebugPanelZoomIndependence();
    };
    vv.addEventListener("resize", overlayViewportListener);
    vv.addEventListener("scroll", overlayViewportListener);
  }

  function ensureGestureHint() {
    if (gestureHintEl || !document.documentElement) return;
    const uid = randomNaviGesturesUiSuffix();
    const host = document.createElement("div");
    host.id = `ng-hint-host-${uid}`;
    host.setAttribute("data-navigestures-ui", "gesture-hint");
    host.setAttribute("aria-live", "polite");
    host.style.cssText =
      "position:fixed;z-index:2147483646;pointer-events:none;visibility:hidden;display:block;";
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      *, *::before, *::after { box-sizing: border-box; }
      .ng-gesture-hint-pill {
        max-width: ${GESTURE_HINT_MAX_WIDTH_PX}px;
        padding: 6px 12px;
        border-radius: 999px;
        font: 600 13px/1.25 system-ui, -apple-system, "Segoe UI", "Roboto", "Helvetica Neue", sans-serif;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: #f0f8ff;
        background: rgba(8, 10, 18, 0.9);
        border: 1px solid rgba(200, 230, 255, 0.38);
        box-shadow: 0 2px 16px rgba(0, 0, 0, 0.5);
        text-shadow:
          0 0 8px rgba(0, 0, 0, 0.9),
          0 1px 2px rgba(0, 0, 0, 0.95),
          1px 0 2px rgba(0, 0, 0, 0.85),
          -1px 0 2px rgba(0, 0, 0, 0.85);
      }
    `;
    shadow.appendChild(style);
    const pill = document.createElement("div");
    pill.className = "ng-gesture-hint-pill";
    pill.id = `ng-hint-pill-${uid}`;
    shadow.appendChild(pill);
    gestureHintEl = host;
    gestureHintPillEl = pill;
    document.documentElement.appendChild(gestureHintEl);
  }

  function removeGestureHint() {
    if (gestureHintEl && gestureHintEl.parentNode) {
      gestureHintEl.parentNode.removeChild(gestureHintEl);
    }
    gestureHintEl = null;
    gestureHintPillEl = null;
  }

  function syncGestureHint(clientX, clientY) {
    if (!gestureHintEl || !gestureHintPillEl) return;
    applyGestureHintZoomIndependence();
    const offsetX = 14;
    const offsetY = 28;
    gestureHintEl.style.left = `${clientX + offsetX}px`;
    gestureHintEl.style.top = `${clientY + offsetY}px`;

    const surviving = common.survivingPipeActions(pipeState);
    let hintText = "";
    let borderColor = HINT_BORDER_DEFAULT;

    if (surviving.length === 0) {
      gestureHintPillEl.textContent = "";
      gestureHintEl.style.visibility = "hidden";
      return;
    } else if (surviving.length === 1) {
      hintText = common.ACTION_LABELS[surviving[0]] || surviving[0];
      borderColor = HINT_BORDER_MATCHED;
    } else {
      hintText = "Multiple Matches";
    }

    gestureHintPillEl.style.borderColor = borderColor;
    gestureHintPillEl.textContent = hintText;
    gestureHintEl.style.visibility = "visible";

    const rect = gestureHintEl.getBoundingClientRect();
    let left = clientX + offsetX;
    let top = clientY + offsetY;
    if (rect.right > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - rect.width - 8);
    }
    if (rect.bottom > window.innerHeight - 8) {
      top = Math.max(8, clientY - offsetY - rect.height);
    }
    gestureHintEl.style.left = `${left}px`;
    gestureHintEl.style.top = `${top}px`;
  }

  function beginGestureTracking(startX, startY) {
    tracking = true;
    path = [];
    strokePoints = [{ x: startX, y: startY }];
    totalDistance = 0;
    anchorPoint = { x: startX, y: startY };
    gestureStartClientPoint = { x: startX, y: startY };
    gesturePipeScale = 1;
    gesturePipeScaleLocked = false;
    gestureFirstSegmentMaxProjection = 0;
    pipeState = common.createPipeMatchState(settings, { x: startX, y: startY }, gesturePipeScale);
    redrawGesturePipeOverlay();
    ensureGestureHint();
    updateOverlayViewportListeners();
    const startPoint = toTrailPoint(startX, startY);
    startTrail(startPoint.x, startPoint.y);
    applyTrailStyle();
    updateDebugCandidatesBar();
    appendDebugLog(`Gesture start at (${Math.round(startX)}, ${Math.round(startY)})`);
  }

  function resetGestureState() {
    tracking = false;
    path = [];
    strokePoints = [];
    anchorPoint = null;
    totalDistance = 0;
    pipeState = null;
    gesturePipeScale = 1;
    gesturePipeScaleLocked = false;
    gestureFirstSegmentMaxProjection = 0;
    gestureStartClientPoint = null;
    clearGesturePipeOverlay();
    removeGestureHint();
    updateDebugCandidatesBar();
    updateOverlayViewportListeners();
  }

  function completeGesture(allowAction) {
    if (!tracking) return;
    const observedPath = [...path];
    const observedDistance = totalDistance;
    const surviving = common.survivingPipeActions(pipeState);
    const action = common.resolvePipeAction(pipeState);

    resetGestureState();
    finishTrail();

    appendDebugLog(
      `Gesture end: allowAction=${allowAction}, path=${observedPath.join(" -> ") || "(none)"}, distance=${observedDistance.toFixed(1)}, surviving=${formatActionList(surviving)}, resolved=${action || "none"}`
    );
    if (!allowAction) {
      appendDebugLog("Gesture ignored: release button does not match trigger.");
      return;
    }

    if (surviving.length === 0) {
      appendDebugLog("Gesture rejected: all pipes eliminated during draw.");
      return;
    }

    if (action) {
      appendDebugLog(`Pipe match: ${action}`);
      sendGestureAction(action);
      if (settings.triggerMouseButton === "right") suppressNextContextMenu = true;
    } else if (observedDistance >= settings.minSegmentPx * 1.5) {
      appendDebugLog("No pipe completed (insufficient progress), suppressing context menu due to substantial movement.");
      if (settings.triggerMouseButton === "right") suppressNextContextMenu = true;
    } else {
      appendDebugLog("No pipe completed and movement too small to suppress context menu.");
    }
  }

  function cancelGesture() {
    blockGestureUntilRelease = false;
    if (clearTrailTimer) {
      clearTimeout(clearTrailTimer);
      clearTrailTimer = null;
    }
    resetGestureState();
    clearTrail();
    appendDebugLog("Gesture cancelled.");
  }

  function sendGestureAction(action) {
    if (performLocalPageAction(action)) return;
    try {
      api.runtime.sendMessage({ type: "navigestures-perform-action", action });
    } catch (_) {
      // Ignore messaging failures on restricted pages.
    }
  }

  function performLocalPageAction(action) {
    const step = Math.max(120, Math.round(window.innerWidth * LOCAL_SCROLL_STEP_RATIO));
    switch (action) {
      case "scrollLeft":
        window.scrollBy({ left: -step, top: 0, behavior: "smooth" });
        return true;
      case "scrollRight":
        window.scrollBy({ left: step, top: 0, behavior: "smooth" });
        return true;
      default:
        return false;
    }
  }

  function onMouseDown(event) {
    if (isRockerMouseDown(event)) {
      const action = getRockerActionForButton(event.button);
      if (action !== "none") {
        if (tracking) cancelGesture();
        suppressPointerEventsAfterRocker();
        suppressNextContextMenu = true;
        event.preventDefault();
        event.stopPropagation();
        appendDebugLog(
          `Middle rocker action fired: ${event.button === 0 ? "left" : "right"} -> ${action}`
        );
        sendGestureAction(action);
        return;
      }
    }

    if (!isMatchingMouseButton(event.button)) return;
    if (!isModifierSatisfied(event)) {
      appendDebugLog(`Mouse down ignored: modifier '${settings.triggerModifier}' not held.`);
      return;
    }

    if (settings.triggerMouseButton === "right") {
      const now = Date.now();
      const isSecondStationaryClick = now - lastRightStationaryClickAt <= RIGHT_MENU_DOUBLECLICK_MS;
      if (isSecondStationaryClick) {
        // Second stationary right click: let native context menu flow.
        lastRightStationaryClickAt = 0;
        blockGestureUntilRelease = true;
        appendDebugLog("Right-click bypass: second stationary click opens native context menu.");
        return;
      }
    }

    blockGestureUntilRelease = false;
    beginGestureTracking(event.clientX, event.clientY);
    // Linux (and some toolkits) open the menu from default right-button mousedown;
    // preventDefault here reliably defers the menu until the double–right-click bypass path.
    if (settings.triggerMouseButton === "right") {
      event.preventDefault();
    }
  }

  function onMouseMove(event) {
    if (!tracking || !anchorPoint) return;

    if ((event.buttons & getConfiguredMouseButtonMask()) === 0) {
      completeGesture(false);
      return;
    }
    strokePoints.push({ x: event.clientX, y: event.clientY });

    const state = { anchorX: anchorPoint.x, anchorY: anchorPoint.y };
    const { stepDist, pushed } = common.processGestureMove(
      state,
      event.clientX,
      event.clientY,
      settings.minSegmentPx,
      path
    );
    totalDistance += stepDist;
    anchorPoint = { x: state.anchorX, y: state.anchorY };

    if (pushed) {
      appendDebugLog(
        `Direction added: path=${path.join(" -> ")}, step=${stepDist.toFixed(1)}`
      );
    }
    const scaleChanged = updateGesturePipeScaleFromStroke();
    if (scaleChanged) {
      appendDebugLog(`Pipe scale updated: x${gesturePipeScale.toFixed(2)}`);
    }

    pipeState = common.advancePipeMatchState(
      pipeState,
      { x: event.clientX, y: event.clientY },
      gesturePipeScale,
      settings
    );

    if (pipeState && pipeState.allEliminated && path.length > 0) {
      appendDebugLog("All pipes eliminated — aborting gesture.");
      resetGestureState();
      clearTrail();
      finishTrail();
      return;
    }

    redrawGesturePipeOverlay();
    redrawTrailSegmented();
    syncGestureHint(event.clientX, event.clientY);
    updateDebugCandidatesBar();
  }

  function onMouseUp(event) {
    if (blockGestureUntilRelease && isMatchingMouseButton(event.button)) {
      blockGestureUntilRelease = false;
      return;
    }
    if (!tracking) return;

    if (settings.triggerMouseButton === "right" && isMatchingMouseButton(event.button)) {
      const isStationaryClick = path.length === 0 && totalDistance <= STATIONARY_CLICK_PX;
      lastRightStationaryClickAt = isStationaryClick ? Date.now() : 0;
      if (isStationaryClick) {
        appendDebugLog("Stationary right click detected (possible context-menu double-click sequence).");
      }
    }

    completeGesture(isMatchingMouseButton(event.button));
  }

  function onContextMenu(event) {
    if (shouldSuppressPointerAfterRocker()) {
      event.preventDefault();
      appendDebugLog("Context menu suppressed after middle rocker.");
      return;
    }

    if (suppressNextContextMenu) {
      event.preventDefault();
      suppressNextContextMenu = false;
      appendDebugLog("Context menu suppressed after gesture.");
      return;
    }

    if (tracking) {
      // While tracking, menu is always suppressed (gesture press cycle).
      event.preventDefault();
      appendDebugLog("Context menu suppressed while tracking gesture.");
      return;
    }
  }

  function onClick(event) {
    if (!shouldSuppressPointerAfterRocker()) return;
    event.preventDefault();
    event.stopPropagation();
    appendDebugLog("Click suppressed after middle rocker.");
  }

  function onAuxClick(event) {
    if (!shouldSuppressPointerAfterRocker()) return;
    event.preventDefault();
    event.stopPropagation();
    appendDebugLog("Aux click suppressed after middle rocker.");
  }

  function onWheel(event) {
    if (!isLikelyRockerWheelEvent(event)) return;
    const now = Date.now();
    if (now - lastRockerWheelAt < ROCKER_WHEEL_COOLDOWN_MS) return;

    const action = getRockerActionForWheelDelta(event.deltaX);
    if (action === "none") return;

    if (tracking) cancelGesture();
    lastRockerWheelAt = now;
    suppressPointerEventsAfterRocker();
    suppressNextContextMenu = true;
    event.preventDefault();
    event.stopPropagation();
    appendDebugLog(
      `Middle rocker wheel action fired: ${event.deltaX < 0 ? "left" : "right"} -> ${action} (deltaX=${event.deltaX.toFixed(2)}, deltaY=${event.deltaY.toFixed(2)})`
    );
    sendGestureAction(action);
  }

  api.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes.settings) return;
    settings = common.sanitizeSettings(changes.settings.newValue || common.DEFAULT_SETTINGS);
    applyTrailStyle();
    syncDebugPanelVisibility();
    requestTabZoomFromBackground();
    appendDebugLog("Settings updated from storage change.");
  });

  api.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "navigestures-tab-zoom-changed") return;
    if (typeof message.zoom === "number" && message.zoom > 0) {
      cachedTabZoomFactor = message.zoom;
      refreshOverlaysForZoom();
    }
  });

  window.addEventListener("DOMContentLoaded", syncDebugPanelVisibility, { once: true });
  if (document.documentElement) {
    createTrailCanvas();
  } else {
    window.addEventListener("DOMContentLoaded", createTrailCanvas, { once: true });
  }
  window.addEventListener("resize", resizeTrailCanvas);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", resizeTrailCanvas);
    window.visualViewport.addEventListener("scroll", resizeTrailCanvas);
  }

  async function attachGestureListenersAfterSettings() {
    await loadSettings();
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("mousemove", onMouseMove, true);
    window.addEventListener("mouseup", onMouseUp, true);
    window.addEventListener("blur", cancelGesture);
    window.addEventListener("pagehide", cancelGesture);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) cancelGesture();
    });
    window.addEventListener("contextmenu", onContextMenu, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("auxclick", onAuxClick, true);
    window.addEventListener("wheel", onWheel, { capture: true, passive: false });
  }

  void attachGestureListenersAfterSettings();
})();
