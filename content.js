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
  const DEBUG_LOG_MAX_LINES = 220;
  const directionAngles = {
    R: 0,
    DR: 45,
    D: 90,
    DL: 135,
    L: 180,
    UL: 225,
    U: 270,
    UR: 315
  };
  const orderedActions = ["reload", "closeTab", "forward", "back", "newTab"];

  let settings = common.sanitizeSettings(common.DEFAULT_SETTINGS);
  let tracking = false;
  let path = [];
  let lastPoint = null;
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
    const diff = angularDifference(angleForDirection(observed), angleForDirection(expected));
    return `${observed} vs ${expected} (${diff.toFixed(1)}°)`;
  }

  function prefixCompatibilityDetails(observedPath) {
    const observedLen = observedPath.length;
    const details = [];
    for (const action of orderedActions) {
      const expected = settings.gestures[action] || [];
      if (expected.length < observedLen) {
        details.push(`${action}: too short (${expected.length} < ${observedLen})`);
        continue;
      }
      let mismatch = null;
      for (let i = 0; i < observedLen; i += 1) {
        if (!directionsCompatible(observedPath[i], expected[i])) {
          mismatch = `${action}: mismatch at ${i + 1} (${diffLabel(observedPath[i], expected[i])}, tol=${settings.inaccuracyDegrees}°)`;
          break;
        }
      }
      details.push(mismatch || `${action}: compatible`);
    }
    return details;
  }

  function exactMatchEvaluation(observedPath) {
    const details = [];
    for (const action of orderedActions) {
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
        const diff = angularDifference(angleForDirection(observed), angleForDirection(wanted));
        if (diff > settings.inaccuracyDegrees) {
          details.push(`${action}: reject at ${i + 1} (${diffLabel(observed, wanted)}, tol=${settings.inaccuracyDegrees}°)`);
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
    trailCtx.lineWidth = settings.trailWidth * trailPixelRatio;
    trailCtx.lineCap = "round";
    trailCtx.lineJoin = "round";
    const color = gestureInvalid ? INVALID_TRAIL_COLOR : settings.trailColor;
    trailCtx.strokeStyle = color;
    trailCtx.shadowColor = color;
    trailCtx.shadowBlur = 5 * trailPixelRatio;
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

  function finishTrail() {
    if (clearTrailTimer) clearTimeout(clearTrailTimer);
    clearTrailTimer = setTimeout(() => {
      clearTrail();
      clearTrailTimer = null;
    }, 160);
  }

  function beginGestureTracking(startX, startY) {
    tracking = true;
    gestureInvalid = false;
    path = [];
    totalDistance = 0;
    lastPoint = { x: startX, y: startY };
    const startPoint = toTrailPoint(startX, startY);
    startTrail(startPoint.x, startPoint.y);
    applyTrailStyle();
    appendDebugLog(`Gesture start at (${Math.round(startX)}, ${Math.round(startY)})`);
  }

  function resetGestureState() {
    tracking = false;
    path = [];
    lastPoint = null;
    totalDistance = 0;
    gestureInvalid = false;
  }

  function completeGesture(allowAction) {
    if (!tracking) return;
    const observedPath = [...path];
    const observedDistance = totalDistance;
    const wasInvalid = gestureInvalid;
    resetGestureState();
    finishTrail();

    appendDebugLog(
      `Gesture end: allowAction=${allowAction}, path=${observedPath.join(" -> ") || "(none)"}, distance=${observedDistance.toFixed(1)}, invalid=${wasInvalid}`
    );
    if (!allowAction) {
      appendDebugLog("Gesture ignored: release button does not match trigger.");
      return;
    }
    if (!observedPath.length) {
      appendDebugLog("Gesture ignored: no direction segments captured.");
      return;
    }
    if (observedDistance < settings.minSegmentPx) {
      appendDebugLog(
        `Gesture ignored: distance ${observedDistance.toFixed(1)} < minSegmentPx ${settings.minSegmentPx}.`
      );
      return;
    }
    if (wasInvalid) {
      appendDebugLog("Gesture rejected: path was previously marked invalid.");
      return;
    }

    appendDebugLog(`Exact matching checks: ${exactMatchEvaluation(observedPath).join(" | ")}`);
    const action = detectExactAction(observedPath);
    if (action) {
      appendDebugLog(`Action accepted: ${action}`);
      sendGestureAction(action);
      if (settings.triggerMouseButton === "right") suppressNextContextMenu = true;
    } else if (observedDistance >= settings.minSegmentPx * 1.5) {
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

  function angleForDirection(direction) {
    return directionAngles[direction];
  }

  function angularDifference(a, b) {
    const diff = Math.abs(a - b);
    return Math.min(diff, 360 - diff);
  }

  function vectorToDirection(dx, dy) {
    const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    const sectors = ["R", "DR", "D", "DL", "L", "UL", "U", "UR"];
    const index = Math.round(angle / 45) % 8;
    return sectors[index];
  }

  function directionVector(direction) {
    switch (direction) {
      case "R":
        return { x: 1, y: 0 };
      case "DR":
        return { x: 1, y: 1 };
      case "D":
        return { x: 0, y: 1 };
      case "DL":
        return { x: -1, y: 1 };
      case "L":
        return { x: -1, y: 0 };
      case "UL":
        return { x: -1, y: -1 };
      case "U":
        return { x: 0, y: -1 };
      case "UR":
        return { x: 1, y: -1 };
      default:
        return { x: 0, y: 0 };
    }
  }

  function directionFromVector(x, y) {
    if (x === 1 && y === 0) return "R";
    if (x === 1 && y === 1) return "DR";
    if (x === 0 && y === 1) return "D";
    if (x === -1 && y === 1) return "DL";
    if (x === -1 && y === 0) return "L";
    if (x === -1 && y === -1) return "UL";
    if (x === 0 && y === -1) return "U";
    if (x === 1 && y === -1) return "UR";
    return null;
  }

  function isCardinal(direction) {
    return direction === "R" || direction === "D" || direction === "L" || direction === "U";
  }

  function collapseBridgeDiagonal(pathDirections) {
    if (pathDirections.length < 3) return false;
    const aIndex = pathDirections.length - 3;
    const bIndex = pathDirections.length - 2;
    const cIndex = pathDirections.length - 1;
    const a = pathDirections[aIndex];
    const b = pathDirections[bIndex];
    const c = pathDirections[cIndex];
    if (!isCardinal(a) || !isCardinal(c) || a === c) return false;

    const aVec = directionVector(a);
    const cVec = directionVector(c);
    // A hard corner must switch axes.
    if (aVec.x === cVec.x || aVec.y === cVec.y) return false;

    const bridge = directionFromVector(aVec.x + cVec.x, aVec.y + cVec.y);
    if (!bridge || b !== bridge) return false;

    pathDirections.splice(bIndex, 1);
    return true;
  }

  function directionsCompatible(observed, expected) {
    if (observed === expected) return true;
    const diff = angularDifference(angleForDirection(observed), angleForDirection(expected));
    return diff <= settings.inaccuracyDegrees;
  }

  function pathCanStillMatchAnyAction(observedPath) {
    for (const action of orderedActions) {
      const expected = settings.gestures[action] || [];
      if (expected.length < observedPath.length) continue;
      let allCompatible = true;
      for (let i = 0; i < observedPath.length; i += 1) {
        if (!directionsCompatible(observedPath[i], expected[i])) {
          allCompatible = false;
          break;
        }
      }
      if (allCompatible) return true;
    }
    return false;
  }

  function detectExactAction(observedPath) {
    let bestAction = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const action of orderedActions) {
      const expected = settings.gestures[action] || [];
      if (expected.length !== observedPath.length) continue;
      let allCompatible = true;
      let score = 0;
      for (let i = 0; i < observedPath.length; i += 1) {
        const observed = observedPath[i];
        const wanted = expected[i];
        const diff = angularDifference(angleForDirection(observed), angleForDirection(wanted));
        if (diff > settings.inaccuracyDegrees) {
          allCompatible = false;
          break;
        }
        // Prefer the closest gesture when multiple are within tolerance.
        score += diff;
      }
      if (allCompatible && score < bestScore) {
        bestScore = score;
        bestAction = action;
      }
    }
    return bestAction;
  }

  function sendGestureAction(action) {
    try {
      api.runtime.sendMessage({ type: "navigestures-perform-action", action });
    } catch (_) {
      // Ignore messaging failures on restricted pages.
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
  }

  function onMouseMove(event) {
    if (!tracking || !lastPoint) return;

    if ((event.buttons & getConfiguredMouseButtonMask()) === 0) {
      completeGesture(false);
      return;
    }
    const trailPoint = toTrailPoint(event.clientX, event.clientY);
    extendTrail(trailPoint.x, trailPoint.y);
    const dx = event.clientX - lastPoint.x;
    const dy = event.clientY - lastPoint.y;
    const dist = Math.hypot(dx, dy);
    totalDistance += dist;

    if (dist < settings.minSegmentPx) return;

    const dir = vectorToDirection(dx, dy);
    if (path[path.length - 1] !== dir) {
      path.push(dir);
      appendDebugLog(
        `Direction added: ${dir} (dx=${dx.toFixed(1)}, dy=${dy.toFixed(1)}, step=${dist.toFixed(1)}), path=${path.join(" -> ")}`
      );
      if (collapseBridgeDiagonal(path)) {
        appendDebugLog(`Path smoothed: collapsed bridge diagonal, path=${path.join(" -> ")}`);
      }
      if (!gestureInvalid && !pathCanStillMatchAnyAction(path)) {
        gestureInvalid = true;
        applyTrailStyle();
        appendDebugLog(`Path invalidated: ${prefixCompatibilityDetails(path).join(" | ")}`);
      }
    }
    lastPoint = { x: event.clientX, y: event.clientY };
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
  loadSettings();
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
})();
