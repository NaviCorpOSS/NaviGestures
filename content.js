(() => {
  const api = typeof browser !== "undefined" ? browser : chrome;
  const isBrowserApi = typeof browser !== "undefined";
  const common = globalThis.N3TGestureCommon;
  const INVALID_TRAIL_COLOR = "#ff3b30";
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

  function getConfiguredMouseButtonCode() {
    return settings.triggerMouseButton === "middle" ? 1 : 2;
  }

  function getConfiguredMouseButtonMask() {
    return settings.triggerMouseButton === "middle" ? 4 : 2;
  }

  function isMatchingMouseButton(buttonCode) {
    return buttonCode === getConfiguredMouseButtonCode();
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

    if (!allowAction) return;
    if (!observedPath.length || observedDistance < settings.minSegmentPx || wasInvalid) return;

    const action = detectExactAction(observedPath);
    if (action) {
      sendGestureAction(action);
      if (settings.triggerMouseButton === "right") suppressNextContextMenu = true;
    } else if (observedDistance >= settings.minSegmentPx * 1.5) {
      if (settings.triggerMouseButton === "right") suppressNextContextMenu = true;
    }
  }

  function cancelGesture() {
    if (clearTrailTimer) {
      clearTimeout(clearTrailTimer);
      clearTrailTimer = null;
    }
    resetGestureState();
    clearTrail();
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
      api.runtime.sendMessage({ type: "n3t-perform-action", action });
    } catch (_) {
      // Ignore messaging failures on restricted pages.
    }
  }

  function onMouseDown(event) {
    if (!isMatchingMouseButton(event.button)) return;
    if (!isModifierSatisfied(event)) return;
    tracking = true;
    gestureInvalid = false;
    path = [];
    totalDistance = 0;
    lastPoint = { x: event.clientX, y: event.clientY };
    const startPoint = toTrailPoint(event.clientX, event.clientY);
    startTrail(startPoint.x, startPoint.y);
    applyTrailStyle();
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
      if (!gestureInvalid && !pathCanStillMatchAnyAction(path)) {
        gestureInvalid = true;
        applyTrailStyle();
      }
    }
    lastPoint = { x: event.clientX, y: event.clientY };
  }

  function onMouseUp(event) {
    if (!tracking) return;
    completeGesture(isMatchingMouseButton(event.button));
  }

  function onContextMenu(event) {
    if (tracking || suppressNextContextMenu) {
      event.preventDefault();
      suppressNextContextMenu = false;
    }
  }

  api.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes.settings) return;
    settings = common.sanitizeSettings(changes.settings.newValue || common.DEFAULT_SETTINGS);
    applyTrailStyle();
  });

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
})();
