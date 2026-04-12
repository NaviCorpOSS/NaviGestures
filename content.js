(() => {
  const api = typeof browser !== "undefined" ? browser : chrome;
  const isBrowserApi = typeof browser !== "undefined";
  const common = globalThis.NaviGesturesCommon;
  const INVALID_TRAIL_COLOR = "#ff3b30";
  const STATIONARY_CLICK_PX = 4;
  const RIGHT_MENU_DOUBLECLICK_MS = 350;
  const ROCKER_SUPPRESS_CLICK_MS = 500;
  const ROCKER_WHEEL_COOLDOWN_MS = 180;
  const ROCKER_WHEEL_MIN_DELTA_X = 6;
  const ROCKER_WHEEL_DOMINANCE_RATIO = 1.3;
  const LOCAL_SCROLL_STEP_RATIO = 0.85;
  const DEBUG_LOG_MAX_LINES = 220;
  let settings = common.sanitizeSettings(common.DEFAULT_SETTINGS);
  let tracking = false;
  let path = [];
  let anchorPoint = null;
  let totalDistance = 0;
  let suppressNextContextMenu = false;
  let trailCanvas = null;
  let trailCtx = null;
  let clearTrailTimer = null;
  let trailLastPoint = null;
  let trailPixelRatio = 1;
  let gestureInvalid = false;
  let blockGestureUntilRelease = false;
  let lastRightStationaryClickAt = 0;
  let suppressPointerAfterRockerUntil = 0;
  let lastRockerWheelAt = 0;
  let debugPanel = null;
  let debugLogBody = null;
  let debugLogLines = [];
  let debugCollapsed = false;
  let gestureHintEl = null;
  let strokePoints = [];
  let pathTemplateDeviant = false;
  let lastTrailInvalidForDraw = false;

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
    debugPanel = document.createElement("section");
    debugPanel.setAttribute("aria-label", "NaviGestures debug logs");
    debugPanel.style.position = "fixed";
    debugPanel.style.right = "12px";
    debugPanel.style.bottom = "12px";
    debugPanel.style.width = "380px";
    debugPanel.style.maxHeight = "44vh";
    debugPanel.style.background = "rgba(0,0,0,0.82)";
    debugPanel.style.border = "1px solid rgba(255,255,255,0.2)";
    debugPanel.style.borderRadius = "8px";
    debugPanel.style.color = "#f2f2f2";
    debugPanel.style.zIndex = "2147483646";
    debugPanel.style.fontFamily = "ui-monospace, Menlo, Monaco, Consolas, monospace";
    debugPanel.style.fontSize = "11px";
    debugPanel.style.lineHeight = "1.35";
    debugPanel.style.pointerEvents = "auto";
    debugPanel.style.boxShadow = "0 8px 28px rgba(0,0,0,0.35)";

    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.gap = "6px";
    header.style.padding = "8px 8px 6px";
    header.style.borderBottom = "1px solid rgba(255,255,255,0.12)";

    const title = document.createElement("strong");
    title.textContent = "NaviGestures debug";
    title.style.flex = "1";
    title.style.fontSize = "11px";
    title.style.fontWeight = "600";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.textContent = "Copy";
    copyBtn.style.cursor = "pointer";
    copyBtn.style.fontSize = "11px";
    copyBtn.style.padding = "2px 6px";
    copyBtn.style.borderRadius = "4px";
    copyBtn.style.border = "1px solid rgba(255,255,255,0.3)";
    copyBtn.style.background = "rgba(255,255,255,0.08)";
    copyBtn.style.color = "inherit";
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
    clearBtn.textContent = "Clear";
    clearBtn.style.cursor = "pointer";
    clearBtn.style.fontSize = "11px";
    clearBtn.style.padding = "2px 6px";
    clearBtn.style.borderRadius = "4px";
    clearBtn.style.border = "1px solid rgba(255,255,255,0.3)";
    clearBtn.style.background = "rgba(255,255,255,0.08)";
    clearBtn.style.color = "inherit";
    clearBtn.addEventListener("click", () => {
      debugLogLines = [];
      if (debugLogBody) debugLogBody.textContent = "";
      appendDebugLog("Log cleared.");
    });

    const collapseBtn = document.createElement("button");
    collapseBtn.type = "button";
    collapseBtn.textContent = "Hide";
    collapseBtn.style.cursor = "pointer";
    collapseBtn.style.fontSize = "11px";
    collapseBtn.style.padding = "2px 6px";
    collapseBtn.style.borderRadius = "4px";
    collapseBtn.style.border = "1px solid rgba(255,255,255,0.3)";
    collapseBtn.style.background = "rgba(255,255,255,0.08)";
    collapseBtn.style.color = "inherit";

    debugLogBody = document.createElement("pre");
    debugLogBody.style.margin = "0";
    debugLogBody.style.padding = "8px";
    debugLogBody.style.maxHeight = "calc(44vh - 42px)";
    debugLogBody.style.overflow = "auto";
    debugLogBody.style.whiteSpace = "pre-wrap";
    debugLogBody.style.wordBreak = "break-word";
    debugLogBody.style.userSelect = "text";

    collapseBtn.addEventListener("click", () => {
      debugCollapsed = !debugCollapsed;
      debugLogBody.style.display = debugCollapsed ? "none" : "block";
      debugPanel.style.maxHeight = debugCollapsed ? "unset" : "44vh";
      collapseBtn.textContent = debugCollapsed ? "Show" : "Hide";
    });

    header.appendChild(title);
    header.appendChild(copyBtn);
    header.appendChild(clearBtn);
    header.appendChild(collapseBtn);
    debugPanel.appendChild(header);
    debugPanel.appendChild(debugLogBody);
    document.documentElement.appendChild(debugPanel);
    appendDebugLog("Debug panel ready.");
  }

  function removeDebugPanel() {
    if (debugPanel && debugPanel.parentNode) {
      debugPanel.parentNode.removeChild(debugPanel);
    }
    debugPanel = null;
    debugLogBody = null;
    debugCollapsed = false;
    debugLogLines = [];
  }

  function syncDebugPanelVisibility() {
    if (settings.showDebugLogWindow) {
      createDebugPanel();
      return;
    }
    removeDebugPanel();
  }

  function diffLabel(observed, expected) {
    const diff = common.angularDifference(
      common.angleForDirection(observed),
      common.angleForDirection(expected)
    );
    return `${observed} vs ${expected} (${diff.toFixed(1)}°)`;
  }

  function prefixCompatibilityDetails(observedPath) {
    const observedLen = observedPath.length;
    const details = [];
    const tol = settings.inaccuracyDegrees;
    for (const action of common.ACTIONS) {
      const expected = settings.gestures[action] || [];
      if (expected.length < observedLen) {
        details.push(`${action}: too short (${expected.length} < ${observedLen})`);
        continue;
      }
      let mismatch = null;
      for (let i = 0; i < observedLen; i += 1) {
        if (!common.directionsCompatible(observedPath[i], expected[i], tol)) {
          mismatch = `${action}: mismatch at ${i + 1} (${diffLabel(observedPath[i], expected[i])}, tol=${tol}°)`;
          break;
        }
      }
      details.push(mismatch || `${action}: compatible`);
    }
    return details;
  }

  function exactMatchEvaluation(observedPath) {
    const details = [];
    const tol = settings.inaccuracyDegrees;
    for (const action of common.ACTIONS) {
      const expected = settings.gestures[action] || [];
      if (expected.length !== observedPath.length) {
        details.push(`${action}: length ${expected.length} != ${observedPath.length}`);
        continue;
      }
      let allCompatible = true;
      let score = 0;
      for (let i = 0; i < observedPath.length; i += 1) {
        const observed = observedPath[i];
        const wanted = expected[i];
        const diff = common.angularDifference(
          common.angleForDirection(observed),
          common.angleForDirection(wanted)
        );
        if (diff > tol) {
          details.push(`${action}: reject at ${i + 1} (${diffLabel(observed, wanted)}, tol=${tol}°)`);
          allCompatible = false;
          break;
        }
        score += diff;
      }
      if (allCompatible) details.push(`${action}: candidate score=${score.toFixed(1)}`);
    }
    return details;
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
    appendDebugLog(
      `Settings loaded: minSegmentPx=${settings.minSegmentPx}, inaccuracy=${settings.inaccuracyDegrees}°, trigger=${settings.triggerMouseButton}, rockerLeft=${settings.rockerMiddleLeftAction}, rockerRight=${settings.rockerMiddleRightAction}`
    );
  }

  function createTrailCanvas() {
    if (trailCanvas || !document.documentElement) return;
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
    trailCanvas.width = Math.max(1, Math.floor(cssWidth * trailPixelRatio));
    trailCanvas.height = Math.max(1, Math.floor(cssHeight * trailPixelRatio));
    applyTrailStyle();
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
    const color =
      gestureInvalid || pathTemplateDeviant ? INVALID_TRAIL_COLOR : settings.trailColor;
    trailCtx.strokeStyle = color;
    trailCtx.shadowColor = color;
    trailCtx.shadowBlur = Math.max(0.5, lineW * 0.55);
    trailCtx.shadowOffsetX = 0;
    trailCtx.shadowOffsetY = 0;
  }

  function clearTrail() {
    if (!trailCtx || !trailCanvas) return;
    trailCtx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
    trailLastPoint = null;
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

  function redrawTrailFromStrokePoints() {
    if (!trailCtx || strokePoints.length < 1) return;
    trailCtx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
    applyTrailStyle();
    const pts = strokePoints.map((p) => toTrailPoint(p.x, p.y));
    trailCtx.beginPath();
    trailCtx.moveTo(pts[0].x * trailPixelRatio, pts[0].y * trailPixelRatio);
    for (let i = 1; i < pts.length; i += 1) {
      trailCtx.lineTo(pts[i].x * trailPixelRatio, pts[i].y * trailPixelRatio);
    }
    trailCtx.stroke();
    trailLastPoint = pts[pts.length - 1];
  }

  function updatePathTemplateDeviantFlag() {
    pathTemplateDeviant = !common.anyConfiguredGestureStillPossible(path, settings, strokePoints);
  }

  function finishTrail() {
    if (clearTrailTimer) clearTimeout(clearTrailTimer);
    clearTrailTimer = setTimeout(() => {
      clearTrail();
      clearTrailTimer = null;
    }, 160);
  }

  function ensureGestureHint() {
    if (gestureHintEl || !document.documentElement) return;
    gestureHintEl = document.createElement("div");
    gestureHintEl.setAttribute("aria-live", "polite");
    gestureHintEl.style.position = "fixed";
    gestureHintEl.style.zIndex = "2147483646";
    gestureHintEl.style.pointerEvents = "none";
    gestureHintEl.style.maxWidth = "min(280px, 92vw)";
    gestureHintEl.style.padding = "6px 12px";
    gestureHintEl.style.borderRadius = "999px";
    gestureHintEl.style.fontFamily =
      'system-ui, -apple-system, "Segoe UI", "Roboto", "Helvetica Neue", sans-serif';
    gestureHintEl.style.fontSize = "13px";
    gestureHintEl.style.fontWeight = "600";
    gestureHintEl.style.letterSpacing = "0.06em";
    gestureHintEl.style.textTransform = "uppercase";
    gestureHintEl.style.color = "#e8f4ff";
    gestureHintEl.style.background = "rgba(6, 10, 22, 0.62)";
    gestureHintEl.style.border = "1px solid rgba(200, 220, 255, 0.35)";
    gestureHintEl.style.boxShadow = "0 2px 16px rgba(0,0,0,0.45)";
    gestureHintEl.style.textShadow =
      "0 0 8px rgba(0,0,0,0.9), 0 1px 2px rgba(0,0,0,0.95), 1px 0 2px rgba(0,0,0,0.85), -1px 0 2px rgba(0,0,0,0.85)";
    gestureHintEl.style.visibility = "hidden";
    document.documentElement.appendChild(gestureHintEl);
  }

  function removeGestureHint() {
    if (gestureHintEl && gestureHintEl.parentNode) {
      gestureHintEl.parentNode.removeChild(gestureHintEl);
    }
    gestureHintEl = null;
  }

  function syncGestureHint(clientX, clientY) {
    if (!gestureHintEl) return;
    const offsetX = 14;
    const offsetY = 28;
    gestureHintEl.style.left = `${clientX + offsetX}px`;
    gestureHintEl.style.top = `${clientY + offsetY}px`;

    const pathHint =
      common.hasAnyPathTemplate(settings) && strokePoints.length >= 2
        ? common.livePathTemplateHintDisplay(path, strokePoints, settings)
        : "";
    const tokenHintRaw = path.length ? common.liveGestureLabel(path, settings) : "";
    const tokenHint =
      common.hasAnyPathTemplate(settings) && tokenHintRaw === "\u2014" ? "" : tokenHintRaw;
    const hintText = pathHint || tokenHint;

    if (!hintText && !gestureInvalid && !pathTemplateDeviant) {
      gestureHintEl.textContent = "";
      gestureHintEl.style.visibility = "hidden";
      return;
    }
    gestureHintEl.style.visibility = "visible";
    if (gestureInvalid || pathTemplateDeviant) {
      gestureHintEl.style.borderColor = "rgba(255, 120, 120, 0.5)";
      gestureHintEl.textContent = hintText || "\u2014";
    } else {
      gestureHintEl.style.borderColor = "rgba(200, 220, 255, 0.35)";
      gestureHintEl.textContent = hintText;
    }
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
    gestureInvalid = false;
    pathTemplateDeviant = false;
    lastTrailInvalidForDraw = false;
    path = [];
    strokePoints = [{ x: startX, y: startY }];
    totalDistance = 0;
    anchorPoint = { x: startX, y: startY };
    ensureGestureHint();
    const startPoint = toTrailPoint(startX, startY);
    startTrail(startPoint.x, startPoint.y);
    applyTrailStyle();
    appendDebugLog(`Gesture start at (${Math.round(startX)}, ${Math.round(startY)})`);
  }

  function resetGestureState() {
    tracking = false;
    path = [];
    strokePoints = [];
    anchorPoint = null;
    totalDistance = 0;
    gestureInvalid = false;
    pathTemplateDeviant = false;
    lastTrailInvalidForDraw = false;
    removeGestureHint();
  }

  function completeGesture(allowAction) {
    if (!tracking) return;
    const observedPath = [...path];
    const observedDistance = totalDistance;
    const wasInvalid = gestureInvalid;
    const pointsSnap = strokePoints.map((p) => ({ x: p.x, y: p.y }));
    resetGestureState();
    finishTrail();

    appendDebugLog(
      `Gesture end: allowAction=${allowAction}, path=${observedPath.join(" -> ") || "(none)"}, distance=${observedDistance.toFixed(1)}, invalid=${wasInvalid}, strokePts=${pointsSnap.length}`
    );
    if (!allowAction) {
      appendDebugLog("Gesture ignored: release button does not match trigger.");
      return;
    }

    const pathMatch = common.matchBestPathTemplate(pointsSnap, settings);
    const tokenAction = common.detectExactAction(observedPath, settings);

    if (wasInvalid && !pathMatch) {
      appendDebugLog("Gesture rejected: path was previously marked invalid.");
      return;
    }

    if (!pathMatch) {
      const strokeLen = common.polylineLength(pointsSnap);
      if (!observedPath.length) {
        if (strokeLen < common.PATH_MATCH_MIN_STROKE_PX) {
          appendDebugLog("Gesture ignored: stroke too short.");
          return;
        }
        appendDebugLog(
          "Gesture ignored: no direction steps and no shape match (smooth curves need a taught template + Save in settings)."
        );
        return;
      }
      if (observedDistance < settings.minSegmentPx) {
        appendDebugLog(
          `Gesture ignored: distance ${observedDistance.toFixed(1)} < minSegmentPx ${settings.minSegmentPx}.`
        );
        return;
      }
    }

    let action = null;
    if (pathMatch) {
      action = pathMatch.action;
      appendDebugLog(`Path template match: ${action} (score=${pathMatch.score.toFixed(3)})`);
    } else {
      appendDebugLog(`Exact matching checks: ${exactMatchEvaluation(observedPath).join(" | ")}`);
      if (tokenAction) {
        action = tokenAction;
        appendDebugLog(`Token gesture match: ${action}`);
      }
    }

    if (action) {
      sendGestureAction(action);
      if (settings.triggerMouseButton === "right") suppressNextContextMenu = true;
    } else if (pathMatch === null && observedDistance >= settings.minSegmentPx * 1.5) {
      appendDebugLog("No exact action match, suppressing context menu due to substantial movement.");
      if (settings.triggerMouseButton === "right") suppressNextContextMenu = true;
    } else {
      appendDebugLog("No exact action match and movement too small to suppress context menu.");
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
      if (!common.hasAnyPathTemplate(settings)) {
        const stillStrict = common.pathCanStillMatchAnyAction(path, settings);
        const stillLoose = common.pathCanStillMatchAnyAction(
          path,
          settings,
          common.PREFIX_LOOSE_TOLERANCE_DEG
        );
        if (!gestureInvalid && !stillStrict && !stillLoose) {
          gestureInvalid = true;
          appendDebugLog(`Path invalidated: ${prefixCompatibilityDetails(path).join(" | ")}`);
        }
      }
    }

    const trailPoint = toTrailPoint(event.clientX, event.clientY);
    updatePathTemplateDeviantFlag();
    const invCombined = gestureInvalid || pathTemplateDeviant;
    applyTrailStyle();
    if (invCombined !== lastTrailInvalidForDraw && strokePoints.length >= 2) {
      lastTrailInvalidForDraw = invCombined;
      redrawTrailFromStrokePoints();
    } else {
      extendTrail(trailPoint.x, trailPoint.y);
    }
    syncGestureHint(event.clientX, event.clientY);
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
    appendDebugLog("Settings updated from storage change.");
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
