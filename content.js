(() => {
  const api = typeof browser !== "undefined" ? browser : chrome;
  const isBrowserApi = typeof browser !== "undefined";
  const common = globalThis.NaviGesturesCommon;
  const STATIONARY_CLICK_PX = 4;
  /** Minimum drag from press origin before pipe matching and training overlays start. */
  const GESTURE_ACTIVATION_DRAG_PX = 8;
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
  /** Grace window after modified right-click gestures; catches mouseup-deferred Linux menus. */
  const MODIFIED_RIGHT_CONTEXT_SUPPRESS_MS = 2500;
  let settings = common.sanitizeSettings(common.DEFAULT_SETTINGS);
  let tracking = false;
  /** Press origin while waiting for activation drag; cleared when tracking starts. */
  let pendingGesturePress = null;
  let path = [];
  let anchorPoint = null;
  let totalDistance = 0;
  let suppressNextContextMenu = false;
  /** True while the configured right-click gesture button is held after a committed press. */
  let rightGestureButtonDown = false;
  let modifiedRightContextSuppressUntil = 0;
  let rightGestureButtonDownReleaseTimer = null;
  let trailCanvas = null;
  let trailCtx = null;
  let gesturePipeCanvas = null;
  let gesturePipeCtx = null;
  let gesturePipeScale = 1;
  let gesturePipeScaleLocked = false;
  let gestureFirstSegmentMaxProjection = 0;
  /** True after curve-based scale boost was applied; cleared when token path shows a sharp corner. */
  let gestureCurveBoostActive = false;
let gestureCurveScaleLen = 0;
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
  let gesturePoints = [];
  let gestureZoomFactor = 1;
  let overlayViewportListener = null;
  /** From `tabs.getZoom` (Ctrl+/- page zoom); combined with visual viewport pinch in `getOverlayZoomCompensationFactor`. */
  let cachedTabZoomFactor = 1;
  const NG_IS_TOP_FRAME = window === window.top;
  let pendingRemoteIframeContextSuppressUntil = 0;
  const REMOTE_IFRAME_CONTEXT_SUPPRESS_MS = 5500;

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
    return (
      d.toLocaleTimeString([], { hour12: false }) +
      "." +
      String(d.getMilliseconds()).padStart(3, "0")
    );
  }

  function appendDebugLog(message) {
    if (!NG_IS_TOP_FRAME || !settings.showDebugLogWindow) return;
    if (!debugLogBody) return;
    debugLogLines.push(`[${nowTimeLabel()}] ${message}`);
    if (debugLogLines.length > DEBUG_LOG_MAX_LINES) {
      debugLogLines.shift();
    }
    debugLogBody.textContent = debugLogLines.join("\n");
    debugLogBody.scrollTop = debugLogBody.scrollHeight;
  }

  function createDebugPanel() {
    if (!settings.showDebugLogWindow || debugPanel || !document.documentElement)
      return;
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
      if (debugCandidatesEl)
        debugCandidatesEl.style.display = debugCollapsed ? "none" : "";
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
    if (!NG_IS_TOP_FRAME) return;
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

  function isLeftButtonPressed(buttonMask) {
    return (buttonMask & 1) !== 0;
  }

  function isRightButtonPressed(buttonMask) {
    return (buttonMask & 2) !== 0;
  }

  function getRockerActionForButton(buttonCode) {
    if (buttonCode === 0) return settings.rockerMiddleLeftAction;
    if (buttonCode === 2) return settings.rockerMiddleRightAction;
    return "none";
  }

  function getLrRockerActionForButton(buttonCode) {
    if (buttonCode === 0) return settings.rockerLrLeftAction;
    if (buttonCode === 2) return settings.rockerLrRightAction;
    return "none";
  }

  function isRockerMouseDown(event) {
    if (event.button !== 0 && event.button !== 2) return false;
    return isMiddleButtonPressed(event.buttons);
  }

  function isLrRockerMouseDown(event) {
    if (event.button !== 0 && event.button !== 2) return false;
    if (event.button === 0) return isRightButtonPressed(event.buttons);
    if (event.button === 2) return isLeftButtonPressed(event.buttons);
    return false;
  }

  function tryFireRockerMouseDown(event) {
    let action = "none";
    let rockerLabel = "";
    if (isRockerMouseDown(event)) {
      action = getRockerActionForButton(event.button);
      rockerLabel = "Middle";
    } else if (isLrRockerMouseDown(event)) {
      action = getLrRockerActionForButton(event.button);
      rockerLabel = "L/R";
    }
    if (action === "none" || !rockerLabel) return false;
    if (tracking) cancelGesture();
    suppressPointerEventsAfterRocker();
    setSuppressFollowingContextMenu();
    event.preventDefault();
    event.stopPropagation();
    appendDebugLog(
      `${rockerLabel} rocker action fired: ${event.button === 0 ? "left" : "right"} -> ${action}`,
    );
    sendGestureAction(action);
    return true;
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
        return !!event.altKey;
      case "meta":
        return !!event.metaKey;
      case "ctrl":
        return !!event.ctrlKey;
      default:
        return true;
    }
  }

  function requiresGestureModifier() {
    return settings.triggerModifier !== "unset";
  }

  function isModifiedRightClickWithModifierHeld(event) {
    return (
      settings.triggerMouseButton === "right" &&
      requiresGestureModifier() &&
      !!event &&
      isModifierSatisfied(event)
    );
  }

  function clearPendingGesturePress() {
    pendingGesturePress = null;
  }

  function armGesturePress(clientX, clientY) {
    pendingGesturePress = { clientX, clientY };
    appendDebugLog(
      `Gesture press armed at (${Math.round(clientX)}, ${Math.round(clientY)}); waiting for ${GESTURE_ACTIVATION_DRAG_PX}px drag.`,
    );
  }

  function getPendingGestureDragDistance(clientX, clientY) {
    if (!pendingGesturePress) return 0;
    const dx = clientX - pendingGesturePress.clientX;
    const dy = clientY - pendingGesturePress.clientY;
    return Math.hypot(dx, dy);
  }

  function maybeActivateGestureTracking(clientX, clientY) {
    if (tracking || !pendingGesturePress) return false;
    if (getPendingGestureDragDistance(clientX, clientY) < GESTURE_ACTIVATION_DRAG_PX) {
      return false;
    }
    const startX = pendingGesturePress.clientX;
    const startY = pendingGesturePress.clientY;
    clearPendingGesturePress();
    beginGestureTracking(startX, startY);
    return true;
  }

  function clearRightClickPressSuppression() {
    rightGestureButtonDown = false;
    suppressNextContextMenu = false;
    clearPendingGesturePress();
    if (rightGestureButtonDownReleaseTimer != null) {
      clearTimeout(rightGestureButtonDownReleaseTimer);
      rightGestureButtonDownReleaseTimer = null;
    }
  }

  function clearModifiedRightGestureSuppressionState() {
    modifiedRightContextSuppressUntil = 0;
    suppressNextContextMenu = false;
    rightGestureButtonDown = false;
    clearPendingGesturePress();
    if (rightGestureButtonDownReleaseTimer != null) {
      clearTimeout(rightGestureButtonDownReleaseTimer);
      rightGestureButtonDownReleaseTimer = null;
    }
    hideModifiedRightGestureCaptureOverlay(0);
  }

  function armModifiedRightContextMenuSuppress(durationMs) {
    if (!requiresGestureModifier()) return;
    const extendTo =
      Date.now() + (durationMs || MODIFIED_RIGHT_CONTEXT_SUPPRESS_MS);
    if (extendTo > modifiedRightContextSuppressUntil) {
      modifiedRightContextSuppressUntil = extendTo;
    }
    setSuppressFollowingContextMenu();
  }

  function shouldBlockGestureContextMenu() {
    return (
      suppressNextContextMenu ||
      rightGestureButtonDown ||
      tracking ||
      Date.now() < modifiedRightContextSuppressUntil
    );
  }

  function contextMenuBlockReason() {
    if (rightGestureButtonDown) {
      return "Context menu suppressed during right-click gesture press.";
    }
    if (tracking) return "Context menu suppressed while tracking gesture.";
    if (Date.now() < modifiedRightContextSuppressUntil) {
      return "Context menu suppressed (modified right-click grace window).";
    }
    return "Context menu suppressed after gesture.";
  }

  function scheduleRightGestureButtonDownRelease() {
    if (rightGestureButtonDownReleaseTimer != null) {
      clearTimeout(rightGestureButtonDownReleaseTimer);
    }
    rightGestureButtonDownReleaseTimer = setTimeout(() => {
      rightGestureButtonDownReleaseTimer = null;
      rightGestureButtonDown = false;
    }, 150);
  }

  function finishModifiedRightGesturePress(event) {
    if (
      settings.triggerMouseButton !== "right" ||
      !isMatchingMouseButton(event.button) ||
      !rightGestureButtonDown
    ) {
      return;
    }
    if (requiresGestureModifier()) {
      armModifiedRightContextMenuSuppress(MODIFIED_RIGHT_CONTEXT_SUPPRESS_MS);
      event.preventDefault();
      event.stopPropagation();
      hideModifiedRightGestureCaptureOverlay(MODIFIED_RIGHT_CONTEXT_SUPPRESS_MS);
    }
    scheduleRightGestureButtonDownRelease();
  }

  function suppressGestureContextMenu(event, reason) {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
    appendDebugLog(reason);
  }

  let modifiedRightGestureCaptureOverlay = null;
  let modifiedRightGestureCaptureHideTimer = null;

  function showModifiedRightGestureCaptureOverlay(event) {
    if (!isModifiedRightClickWithModifierHeld(event)) return;
    const root = document.documentElement;
    if (!root) return;
    if (!modifiedRightGestureCaptureOverlay) {
      const el = document.createElement("div");
      el.setAttribute("data-navigestures-modified-right-capture", "");
      el.style.cssText =
        "position:fixed;inset:0;z-index:2147483646;background:transparent;cursor:default;";
      el.addEventListener(
        "contextmenu",
        (event) => {
          if (shouldBlockGestureContextMenu()) {
            suppressGestureContextMenu(
              event,
              "Context menu suppressed on modified right-click capture overlay.",
            );
          }
        },
        true,
      );
      modifiedRightGestureCaptureOverlay = el;
    }
    if (modifiedRightGestureCaptureHideTimer != null) {
      clearTimeout(modifiedRightGestureCaptureHideTimer);
      modifiedRightGestureCaptureHideTimer = null;
    }
    if (!modifiedRightGestureCaptureOverlay.isConnected) {
      root.appendChild(modifiedRightGestureCaptureOverlay);
    }
  }

  function hideModifiedRightGestureCaptureOverlay(delayMs) {
    if (!modifiedRightGestureCaptureOverlay) return;
    if (modifiedRightGestureCaptureHideTimer != null) {
      clearTimeout(modifiedRightGestureCaptureHideTimer);
    }
    modifiedRightGestureCaptureHideTimer = setTimeout(() => {
      modifiedRightGestureCaptureHideTimer = null;
      if (
        modifiedRightGestureCaptureOverlay &&
        modifiedRightGestureCaptureOverlay.isConnected &&
        !rightGestureButtonDown &&
        !tracking
      ) {
        modifiedRightGestureCaptureOverlay.remove();
      }
    }, delayMs || MODIFIED_RIGHT_CONTEXT_SUPPRESS_MS);
  }

  function clientCoordsInTopViewport(clientX, clientY) {
    try {
      let x = clientX;
      let y = clientY;
      let w = window;
      while (w !== w.top) {
        const fe = w.frameElement;
        if (!fe) return null;
        const r = fe.getBoundingClientRect();
        x += r.left;
        y += r.top;
        w = w.parent;
      }
      return { clientX: x, clientY: y };
    } catch (_) {
      return null;
    }
  }

  function setSuppressFollowingContextMenu() {
    suppressNextContextMenu = true;
    if (!NG_IS_TOP_FRAME) return;
    try {
      api.runtime.sendMessage({ type: "navigestures-broadcast-context-suppress" });
    } catch (_) {
      /* ignore */
    }
  }

  function broadcastIframeGestureActive(active) {
    if (!NG_IS_TOP_FRAME) return;
    try {
      api.runtime.sendMessage({
        type: "navigestures-broadcast-iframe-gesture",
        active: !!active,
      });
    } catch (_) {
      /* ignore */
    }
  }

  function buildRelaySynthEvent(relay) {
    const rel = relay || {};
    return {
      clientX: rel.clientX ?? 0,
      clientY: rel.clientY ?? 0,
      buttons: typeof rel.buttons === "number" ? rel.buttons : 0,
      button: typeof rel.button === "number" ? rel.button : 0,
      altKey: !!rel.altKey,
      shiftKey: !!rel.shiftKey,
      ctrlKey: !!rel.ctrlKey,
      metaKey: !!rel.metaKey,
      deltaX: typeof rel.deltaX === "number" ? rel.deltaX : 0,
      deltaY: typeof rel.deltaY === "number" ? rel.deltaY : 0,
      deltaMode: typeof rel.deltaMode === "number" ? rel.deltaMode : 0,
      preventDefault() {},
      stopPropagation() {},
      stopImmediatePropagation() {},
    };
  }

  function applyRelayedPointer(relay) {
    if (!NG_IS_TOP_FRAME || !relay || !relay.kind) return;
    switch (relay.kind) {
      case "mousedown":
        onMouseDown(buildRelaySynthEvent(relay));
        break;
      case "mousemove":
        onMouseMove(buildRelaySynthEvent(relay));
        break;
      case "mouseup":
        onMouseUp(buildRelaySynthEvent(relay));
        break;
      case "wheel":
        onWheel(buildRelaySynthEvent(relay));
        break;
      default:
        break;
    }
  }

  let sawPointerRelayError = false;
  let subframeRightGestureContextGuardUntil = 0;
  let subframeRightGestureButtonDown = false;
  let subframeRemoteGestureActive = false;

  function armSubframeRightGestureContextGuard() {
    subframeRightGestureContextGuardUntil = Date.now() + 5500;
  }

  function disarmSubframeRightGestureContextGuard() {
    subframeRightGestureContextGuardUntil = 0;
  }

  function relayPointerToMainFrame(kind, relayPayload) {
    try {
      const payload = Object.assign({}, relayPayload, {
        type: "navigestures-pointer-relay",
        kind,
      });
      if (isBrowserApi) {
        const p = api.runtime.sendMessage(payload);
        if (p && typeof p.catch === "function") {
          p.catch(() => {
            if (!sawPointerRelayError && settings.showDebugLogWindow) {
              sawPointerRelayError = true;
              appendDebugLog("Pointer relay: background messaging failed.");
            }
          });
        }
      } else {
        api.runtime.sendMessage(payload, () => {
          const err = api.runtime && api.runtime.lastError;
          if (err && !sawPointerRelayError && settings.showDebugLogWindow) {
            sawPointerRelayError = true;
            appendDebugLog("Pointer relay: background messaging failed.");
          }
        });
      }
    } catch (_) {
      /* ignore */
    }
  }

  function envelopeFromMouse(event, xy) {
    return {
      clientX: xy.clientX,
      clientY: xy.clientY,
      buttons: event.buttons,
      button: event.button,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    };
  }

  function envelopeFromWheel(event, xy) {
    const base = envelopeFromMouse(event, xy);
    base.deltaX = event.deltaX;
    base.deltaY = event.deltaY;
    base.deltaMode = typeof event.deltaMode === "number" ? event.deltaMode : 0;
    return base;
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
    settings = common.sanitizeSettings(
      data.settings || common.DEFAULT_SETTINGS,
    );
    applyTrailStyle();
    syncDebugPanelVisibility();
    await requestTabZoomFromBackground();
    refreshOverlaysForZoom();
    appendDebugLog(
      `Settings loaded: minSegmentPx=${settings.minSegmentPx}, inaccuracy=${settings.inaccuracyDegrees}°, trainingMode=${settings.trainingMode}, trigger=${settings.triggerMouseButton}, rockerLeft=${settings.rockerMiddleLeftAction}, rockerRight=${settings.rockerMiddleRightAction}, lrRockerLeft=${settings.rockerLrLeftAction}, lrRockerRight=${settings.rockerLrRightAction}`,
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

  /**
   * Resample the stroke at fixed arc-length spacing so turn angles reflect
   * geometry instead of 8-way token jitter.
   */
  function resampleStrokeByArcLength(strokePoints, stepPx) {
    if (!strokePoints || strokePoints.length < 2)
      return strokePoints ? [...strokePoints] : [];
    const pts = strokePoints;
    const out = [{ x: pts[0].x, y: pts[0].y }];
    let covered = 0;
    let nextTarget = stepPx;

    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1];
      const b = pts[i];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      if (segLen < 1e-6) continue;
      const segStart = covered;
      const segEnd = covered + segLen;
      while (nextTarget < segEnd - 1e-6) {
        const dFromA = nextTarget - segStart;
        const t = dFromA / segLen;
        out.push({
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
        });
        nextTarget += stepPx;
      }
      covered = segEnd;
    }
    const L = pts[pts.length - 1];
    const lastOut = out[out.length - 1];
    if (Math.hypot(L.x - lastOut.x, L.y - lastOut.y) > 1e-3) {
      out.push({ x: L.x, y: L.y });
    }
    return out;
  }

  /** Turning angle (signed deg) at each interior resampled vertex. */
  function strokeTurnMetricsAtSamples(sampled) {
    let maxAbsDeg = 0;
    let absSumDeg = 0;
    let signedSumDeg = 0;
    if (!sampled || sampled.length < 3) {
      return { maxAbsDeg: 0, absSumDeg: 0, signedSumDeg: 0 };
    }
    for (let i = 1; i < sampled.length - 1; i += 1) {
      const ax = sampled[i].x - sampled[i - 1].x;
      const ay = sampled[i].y - sampled[i - 1].y;
      const bx = sampled[i + 1].x - sampled[i].x;
      const by = sampled[i + 1].y - sampled[i].y;
      const la = Math.hypot(ax, ay);
      const lb = Math.hypot(bx, by);
      if (la < 1e-3 || lb < 1e-3) continue;
      const dot = ax * bx + ay * by;
      const cross = ax * by - ay * bx;
      const deg = (Math.atan2(cross, dot) * 180) / Math.PI;
      signedSumDeg += deg;
      const ad = Math.abs(deg);
      absSumDeg += ad;
      maxAbsDeg = Math.max(maxAbsDeg, ad);
    }
    return { maxAbsDeg, absSumDeg, signedSumDeg };
  }

  function strokeBounds(points) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return {
      width: Math.max(0, maxX - minX),
      height: Math.max(0, maxY - minY),
    };
  }

  function decimatePointsUniform(points, maxPoints) {
    if (!points || points.length <= maxPoints) return points || [];
    const out = [];
    const last = points.length - 1;
    for (let i = 0; i < maxPoints; i += 1) {
      out.push(points[Math.round((i / (maxPoints - 1)) * last)]);
    }
    return out;
  }

  /**
   * Estimate gesture size from physical geometry. Curved strokes use signed
   * turn to infer radius, which is much more stable for noisy circles/arcs than
   * projection onto the first quantized direction.
   */
  function strokeScaleHints(strokePoints, settings) {
    const empty = {
      curveLike: false,
      maxDistFromStart: 0,
      curveScaleLen: 0,
    };
    if (!strokePoints || strokePoints.length < 3) return empty;
    const hintPoints = decimatePointsUniform(strokePoints, 96);
    const totalLen = common.polylineLength(hintPoints);
    const stepPx = Math.max(7, settings.minSegmentPx * 0.42);
    if (totalLen < stepPx * 2.2) return empty;
    const sampled = resampleStrokeByArcLength(hintPoints, stepPx);
    if (sampled.length < 4) return empty;
    const m = strokeTurnMetricsAtSamples(sampled);
    const start = hintPoints[0];
    let maxDistFromStart = 0;
    for (const p of hintPoints) {
      maxDistFromStart = Math.max(
        maxDistFromStart,
        Math.hypot(p.x - start.x, p.y - start.y),
      );
    }
    if (m.absSumDeg < 1e-6) {
      return { ...empty, maxDistFromStart };
    }
    const coherence = Math.abs(m.signedSumDeg) / m.absSumDeg;
    const maxCornerDeg = 58;
    const minBendDeg = 85;
    const curveLike =
      m.maxAbsDeg <= maxCornerDeg &&
      m.absSumDeg >= minBendDeg &&
      coherence >= 0.45;
    const bounds = strokeBounds(hintPoints);
    const observedSpan = Math.max(maxDistFromStart, bounds.width, bounds.height);
    const curveScaleLen = observedSpan;
    return {
      curveLike,
      maxDistFromStart,
      curveScaleLen,
    };
  }

  /** Any >45° turn in the quantized path (e.g. D→R) — disables curve-based scale boost. */
  function pathHasSharpCorner(path) {
    if (!path || path.length < 2) return false;
    for (let i = 1; i < path.length; i += 1) {
      if (
        common.angularDifference(
          common.angleForDirection(path[i - 1]),
          common.angleForDirection(path[i]),
        ) > 45
      ) {
        return true;
      }
    }
    return false;
  }

  function updateGesturePipeScaleFromStroke() {
    if (
      !gestureStartClientPoint ||
      path.length === 0 ||
      gesturePoints.length === 0
    )
      return false;

    const sharp = pathHasSharpCorner(path);
    const scaleHints = strokeScaleHints(gesturePoints, settings);
    const useCurve = scaleHints.curveLike;

    const base = common.pipeScaleBase(settings);
    const firstDir = path[0];
    const firstAngle = common.angleForDirection(firstDir);
    const turnedAwayFromFirst =
      path.length >= 2 &&
      path.some(
        (dir, i) =>
          i > 0 &&
          common.angularDifference(firstAngle, common.angleForDirection(dir)) >
            45,
      );

    if (turnedAwayFromFirst && !useCurve) {
      gesturePipeScaleLocked = true;
    }
    if (gesturePipeScaleLocked && !useCurve) return false;

    const u = directionUnitVector(firstDir);
    const p = gesturePoints[gesturePoints.length - 1];
    const dx = p.x - gestureStartClientPoint.x;
    const dy = p.y - gestureStartClientPoint.y;
    const proj = dx * u.x + dy * u.y;
    const maxDist = Math.hypot(dx, dy);

    if (sharp && gestureCurveBoostActive && !useCurve) {
      gestureCurveBoostActive = false;
      gestureCurveScaleLen = 0;
      gestureFirstSegmentMaxProjection = Math.max(proj, maxDist * 0.75);
      gesturePipeScale = clampGesturePipeScale(
        gestureFirstSegmentMaxProjection / base,
      );
    }

    const scaleLen = useCurve
      ? scaleHints.curveScaleLen
      : Math.max(proj, scaleHints.maxDistFromStart * 0.75);
    if (useCurve) {
      gestureCurveBoostActive = true;
      if (!gestureCurveScaleLen) gestureCurveScaleLen = scaleLen;
      const boundedCurveLen = Math.min(
        gestureCurveScaleLen * 1.08,
        Math.max(gestureCurveScaleLen * 0.92, scaleLen),
      );
      gestureCurveScaleLen =
        gestureCurveScaleLen * 0.78 + boundedCurveLen * 0.22;
      const prevLen = gestureFirstSegmentMaxProjection || gestureCurveScaleLen;
      const boundedPipeLen = Math.min(
        prevLen * 1.05,
        Math.max(prevLen * 0.95, gestureCurveScaleLen),
      );
      gestureFirstSegmentMaxProjection =
        prevLen * 0.72 + boundedPipeLen * 0.28;
    } else if (scaleLen > gestureFirstSegmentMaxProjection) {
      gestureFirstSegmentMaxProjection = scaleLen;
    }

    const nextScale = clampGesturePipeScale(
      gestureFirstSegmentMaxProjection / base,
    );
    const changed = Math.abs(nextScale - gesturePipeScale) >= 0.05;
    if (changed) gesturePipeScale = nextScale;
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
    trailCanvas.style.zIndex = "2147483645";

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
      gesturePipeCanvas.width = Math.max(
        1,
        Math.floor(cssWidth * trailPixelRatio),
      );
      gesturePipeCanvas.height = Math.max(
        1,
        Math.floor(cssHeight * trailPixelRatio),
      );
    }
    trailCanvas.width = Math.max(1, Math.floor(cssWidth * trailPixelRatio));
    trailCanvas.height = Math.max(1, Math.floor(cssHeight * trailPixelRatio));
    applyTrailStyle();
    redrawGesturePipeOverlay();
  }

  function toTrailPoint(clientX, clientY) {
    return { x: clientX, y: clientY };
  }

  function toGesturePoint(clientX, clientY) {
    const z = tracking ? gestureZoomFactor : getOverlayZoomCompensationFactor();
    if (Math.abs(z - 1) < 0.02) return { x: clientX, y: clientY };
    return {
      x: clientX * z,
      y: clientY * z,
    };
  }

  function gesturePointToTrailPoint(point) {
    if (!point) return { x: 0, y: 0 };
    const z = tracking ? gestureZoomFactor : getOverlayZoomCompensationFactor();
    if (Math.abs(z - 1) < 0.02) return { x: point.x, y: point.y };
    return {
      x: point.x / z,
      y: point.y / z,
    };
  }

  function applyTrailStyle() {
    if (!trailCtx) return;
    const lineW =
      settings.trailWidth * trailPixelRatio * gestureOverlayZoomBoost();
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
    const lineW =
      settings.trailWidth * trailPixelRatio * gestureOverlayZoomBoost();
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
    let remaining = Number.isFinite(maxLen)
      ? Math.max(0, maxLen)
      : Number.POSITIVE_INFINITY;
    gesturePipeCtx.beginPath();
    gesturePipeCtx.moveTo(
      points[0].x * trailPixelRatio,
      points[0].y * trailPixelRatio,
    );
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
    const boost = gestureOverlayZoomBoost();
    drawCenterline(pts, pipeColorForAction(action, 0.13), radiusPx * 2);
    drawCenterline(
      pts,
      pipeColorForAction(action, 0.8),
      Math.max(1.2, settings.trailWidth * 0.75) * trailPixelRatio * boost,
    );
  }

  function redrawGesturePipeOverlay() {
    if (!gesturePipeCtx || !gesturePipeCanvas) return;
    gesturePipeCtx.clearRect(
      0,
      0,
      gesturePipeCanvas.width,
      gesturePipeCanvas.height,
    );
    if (!settings.trainingMode) return;
    if (!tracking || !pipeState) return;
    const bestByAction = new Map();
    for (const pipe of pipeState.pipes) {
      if (pipe.eliminated) continue;
      const current = bestByAction.get(pipe.action);
      const pipeScore = Number.isFinite(pipe.score) ? pipe.score : pipe.progress;
      const currentScore =
        current && Number.isFinite(current.score)
          ? current.score
          : current
            ? current.progress
            : -Infinity;
      if (!current || pipeScore > currentScore) bestByAction.set(pipe.action, pipe);
    }
    const surviving = Array.from(bestByAction.values());
    if (!surviving.length) return;
    for (const pipe of surviving) {
      const pipeRadius = pipe.radius || pipeState.radius;
      const radiusPx = pipeRadius * trailPixelRatio * gestureOverlayZoomBoost();
      const trailPts = pipe.centerline.map((p) => gesturePointToTrailPoint(p));
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
      gesturePipeCtx.clearRect(
        0,
        0,
        gesturePipeCanvas.width,
        gesturePipeCanvas.height,
      );
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
    if (trailCtx) {
      applyTrailStyle();
      if (tracking && strokePoints.length >= 2) redrawTrailSegmented();
      redrawGesturePipeOverlay();
    }
  }

  function requestTabZoomFromBackground() {
    return new Promise((resolve) => {
      try {
        if (isBrowserApi) {
          api.runtime
            .sendMessage({ type: "navigestures-get-tab-zoom" })
            .then((response) => {
              if (
                response &&
                typeof response.zoom === "number" &&
                response.zoom > 0
              ) {
                cachedTabZoomFactor = response.zoom;
              }
              refreshOverlaysForZoom();
              resolve();
            })
            .catch(() => {
              refreshOverlaysForZoom();
              resolve();
            });
        } else {
          api.runtime.sendMessage(
            { type: "navigestures-get-tab-zoom" },
            (response) => {
              const err = api.runtime && api.runtime.lastError;
              if (
                !err &&
                response &&
                typeof response.zoom === "number" &&
                response.zoom > 0
              ) {
                cachedTabZoomFactor = response.zoom;
              }
              refreshOverlaysForZoom();
              resolve();
            },
          );
        }
      } catch (_) {
        refreshOverlaysForZoom();
        resolve();
      }
    });
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
   * Effective zoom for counter-scaling fixed UI and normalizing gesture recognition.
   * Prefer explicit tab zoom for desktop page zoom; fall back to visual viewport scale
   * for pinch zoom and finally to a layout-derived hint when neither is available.
   */
  function getOverlayZoomCompensationFactor() {
    const zTab =
      typeof cachedTabZoomFactor === "number" && cachedTabZoomFactor > 0
        ? cachedTabZoomFactor
        : 1;
    const zPinch = getVisualViewportPinchScale();
    const zLayout = getLayoutViewportZoomHint();

    if (Math.abs(zTab - 1) >= 0.02) {
      return zTab;
    }
    if (Math.abs(zPinch - 1) >= 0.02) {
      return zPinch;
    }
    if (Math.abs(zLayout - 1) >= 0.02) {
      return zLayout;
    }
    return 1;
  }

  /**
   * Tab / pinch zoom shrinks CSS pixels on screen; scale stroke thickness so trail
   * and pipe walls stay readable without CSS transform (which breaks cursor alignment).
   */
  function gestureOverlayZoomBoost() {
    const z = getOverlayZoomCompensationFactor();
    if (Math.abs(z - 1) < 0.02) return 1;
    return 1 / z;
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
      "position:fixed;z-index:2147483647;pointer-events:none;visibility:hidden;display:block;";
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

  function pathIsPrefixOfGestureTokens(path, tokens) {
    if (
      !path ||
      !path.length ||
      !tokens ||
      !Array.isArray(tokens) ||
      !tokens.length
    )
      return false;
    if (path.length > tokens.length) return false;
    for (let i = 0; i < path.length; i += 1) {
      if (path[i] !== tokens[i]) return false;
    }
    return true;
  }

  /** When exactly one survivor's token path still matches the drawn direction prefix. */
  function dominantSurvivingByTokenPrefix(surviving, path, settings) {
    if (!surviving || surviving.length < 2 || !path || !path.length)
      return null;
    const matches = surviving.filter((a) =>
      pathIsPrefixOfGestureTokens(path, settings.gestures[a] || []),
    );
    return matches.length === 1 ? matches[0] : null;
  }

  function syncGestureHint(clientX, clientY) {
    if (!gestureHintEl || !gestureHintPillEl) return;
    applyGestureHintZoomIndependence();
    const zoomBoost = gestureOverlayZoomBoost();
    const offsetX = 14 * zoomBoost;
    const offsetY = 28 * zoomBoost;
    const edgePad = 8 * zoomBoost;
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
      const dominant = dominantSurvivingByTokenPrefix(
        surviving,
        path,
        settings,
      );
      if (dominant) {
        const label = common.ACTION_LABELS[dominant] || dominant;
        const extra = surviving.length - 1;
        hintText = extra > 0 ? `${label} +${extra}` : label;
        borderColor = HINT_BORDER_MATCHED;
      } else {
        hintText = "Multiple Matches";
      }
    }

    gestureHintPillEl.style.borderColor = borderColor;
    gestureHintPillEl.textContent = hintText;
    gestureHintEl.style.visibility = "visible";

    const rect = gestureHintEl.getBoundingClientRect();
    let left = clientX + offsetX;
    let top = clientY + offsetY;
    if (rect.right > window.innerWidth - edgePad) {
      left = Math.max(edgePad, window.innerWidth - rect.width - edgePad);
    }
    if (rect.bottom > window.innerHeight - edgePad) {
      top = Math.max(edgePad, clientY - offsetY - rect.height);
    }
    gestureHintEl.style.left = `${left}px`;
    gestureHintEl.style.top = `${top}px`;
  }

  function beginGestureTracking(startX, startY) {
    tracking = true;
    blockGestureUntilRelease = false;
    path = [];
    strokePoints = [{ x: startX, y: startY }];
    gestureZoomFactor = getOverlayZoomCompensationFactor();
    const startGesturePoint = toGesturePoint(startX, startY);
    gesturePoints = [startGesturePoint];
    totalDistance = 0;
    anchorPoint = { x: startGesturePoint.x, y: startGesturePoint.y };
    gestureStartClientPoint = {
      x: startGesturePoint.x,
      y: startGesturePoint.y,
    };
    gesturePipeScale = 1;
    gesturePipeScaleLocked = false;
    gestureFirstSegmentMaxProjection = 0;
    gestureCurveBoostActive = false;
    gestureCurveScaleLen = 0;
    pipeState = common.createPipeMatchState(
      settings,
      { x: startGesturePoint.x, y: startGesturePoint.y },
      gesturePipeScale,
    );
    redrawGesturePipeOverlay();
    ensureGestureHint();
    updateOverlayViewportListeners();
    const startPoint = toTrailPoint(startX, startY);
    startTrail(startPoint.x, startPoint.y);
    applyTrailStyle();
    updateDebugCandidatesBar();
    appendDebugLog(
      `Gesture start at (${Math.round(startX)}, ${Math.round(startY)})`,
    );
    broadcastIframeGestureActive(true);
  }

  function resetGestureState() {
    tracking = false;
    path = [];
    strokePoints = [];
    gesturePoints = [];
    gestureZoomFactor = 1;
    anchorPoint = null;
    totalDistance = 0;
    pipeState = null;
    gesturePipeScale = 1;
    gesturePipeScaleLocked = false;
    gestureFirstSegmentMaxProjection = 0;
    gestureCurveBoostActive = false;
    gestureCurveScaleLen = 0;
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
    const action = common.resolvePipeAction(
      pipeState,
      undefined,
      observedPath,
      settings,
      gesturePoints,
    );

    resetGestureState();
    broadcastIframeGestureActive(false);
    finishTrail();

    appendDebugLog(
      `Gesture end: allowAction=${allowAction}, path=${observedPath.join(" -> ") || "(none)"}, distance=${observedDistance.toFixed(1)}, surviving=${formatActionList(surviving)}, resolved=${action || "none"}`,
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
      if (settings.triggerMouseButton === "right")
        setSuppressFollowingContextMenu();
    } else if (observedDistance >= settings.minSegmentPx * 1.5) {
      appendDebugLog(
        "No pipe completed (insufficient progress), suppressing context menu due to substantial movement.",
      );
      if (settings.triggerMouseButton === "right")
        setSuppressFollowingContextMenu();
    } else if (requiresGestureModifier()) {
      armModifiedRightContextMenuSuppress(MODIFIED_RIGHT_CONTEXT_SUPPRESS_MS);
      appendDebugLog(
        "Context menu suppressed after modified right-click gesture release.",
      );
    } else {
      appendDebugLog(
        "No pipe completed and movement too small to suppress context menu.",
      );
    }
  }

  function cancelGesture() {
    blockGestureUntilRelease = false;
    clearPendingGesturePress();
    if (clearTrailTimer) {
      clearTimeout(clearTrailTimer);
      clearTrailTimer = null;
    }
    resetGestureState();
    broadcastIframeGestureActive(false);
    clearTrail();
    if (rightGestureButtonDownReleaseTimer != null) {
      clearTimeout(rightGestureButtonDownReleaseTimer);
      rightGestureButtonDownReleaseTimer = null;
    }
    hideModifiedRightGestureCaptureOverlay(0);
    rightGestureButtonDown = false;
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
    const step = Math.max(
      120,
      Math.round(window.innerWidth * LOCAL_SCROLL_STEP_RATIO),
    );
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

  /**
   * Process one pointer position for direction path + pipe matching.
   * Call from mousemove; also call once on pointer release with
   * `updateVisuals: false` so the final segment is committed when the last
   * interval before button-up did not yet reach minSegmentPx from the anchor
   * (common on fast D→R-style strokes with sparse coalesced move events).
   */
  function ingestGesturePointerSample(
    clientX,
    clientY,
    { updateVisuals = true } = {},
  ) {
    if (!tracking || !anchorPoint) return;

    strokePoints.push({ x: clientX, y: clientY });
    const gesturePoint = toGesturePoint(clientX, clientY);
    gesturePoints.push(gesturePoint);

    const state = { anchorX: anchorPoint.x, anchorY: anchorPoint.y };
    const { stepDist, pushed } = common.processGestureMove(
      state,
      gesturePoint.x,
      gesturePoint.y,
      settings.minSegmentPx,
      path,
    );
    totalDistance += stepDist;
    anchorPoint = { x: state.anchorX, y: state.anchorY };

    if (pushed) {
      appendDebugLog(
        `Direction added: path=${path.join(" -> ")}, step=${stepDist.toFixed(1)}`,
      );
    }
    const scaleChanged = updateGesturePipeScaleFromStroke();
    if (scaleChanged) {
      appendDebugLog(`Pipe scale updated: x${gesturePipeScale.toFixed(2)}`);
    }

    pipeState = common.advancePipeMatchState(
      pipeState,
      { x: gesturePoint.x, y: gesturePoint.y },
      gesturePipeScale,
      settings,
      path,
    );

    if (pipeState && pipeState.allEliminated && path.length > 0) {
      appendDebugLog("All pipes eliminated — aborting gesture.");
      resetGestureState();
      broadcastIframeGestureActive(false);
      clearTrail();
      finishTrail();
      if (requiresGestureModifier()) {
        armModifiedRightContextMenuSuppress(MODIFIED_RIGHT_CONTEXT_SUPPRESS_MS);
        appendDebugLog(
          "Context menu armed for suppress after modified gesture abort.",
        );
      }
      return;
    }

    if (updateVisuals) {
      redrawGesturePipeOverlay();
      extendTrail(clientX, clientY);
      syncGestureHint(clientX, clientY);
      updateDebugCandidatesBar();
    }
  }

  function onMouseDown(event) {
    if (tryFireRockerMouseDown(event)) return;

    if (!isMatchingMouseButton(event.button)) return;
    if (!isModifierSatisfied(event)) {
      if (
        isMatchingMouseButton(event.button) &&
        settings.triggerMouseButton === "right" &&
        requiresGestureModifier()
      ) {
        clearModifiedRightGestureSuppressionState();
      }
      appendDebugLog(
        `Mouse down ignored: modifier '${settings.triggerModifier}' not held.`,
      );
      return;
    }

    if (
      settings.triggerMouseButton === "right" &&
      !requiresGestureModifier()
    ) {
      const now = Date.now();
      const isSecondStationaryClick =
        now - lastRightStationaryClickAt <= RIGHT_MENU_DOUBLECLICK_MS;
      if (isSecondStationaryClick) {
        // Second stationary right click: let native context menu flow.
        lastRightStationaryClickAt = 0;
        blockGestureUntilRelease = true;
        clearRightClickPressSuppression();
        appendDebugLog(
          "Right-click bypass: second stationary click opens native context menu.",
        );
        return;
      }
    }

    blockGestureUntilRelease = false;

    if (isModifiedRightClickWithModifierHeld(event)) {
      armModifiedRightContextMenuSuppress(MODIFIED_RIGHT_CONTEXT_SUPPRESS_MS);
      showModifiedRightGestureCaptureOverlay(event);
    }

    if (settings.triggerMouseButton === "right") {
      rightGestureButtonDown = true;
      // Linux (and some toolkits) open the menu from default right-button mousedown;
      // preventDefault must run before gesture setup so the menu stays deferred.
      event.preventDefault();
    }

    armGesturePress(event.clientX, event.clientY);
  }

  function onMouseMove(event) {
    if (!tracking && pendingGesturePress) {
      if ((event.buttons & getConfiguredMouseButtonMask()) === 0) {
        clearPendingGesturePress();
        return;
      }
      if (maybeActivateGestureTracking(event.clientX, event.clientY)) {
        ingestGesturePointerSample(event.clientX, event.clientY);
      }
      return;
    }

    if (!tracking || !anchorPoint) return;

    if ((event.buttons & getConfiguredMouseButtonMask()) === 0) {
      // Do not end the gesture here: some platforms deliver a move with
      // button released before mouseup, which would have completed with
      // allowAction=false and stolen the real release. Flush coordinates only.
      ingestGesturePointerSample(event.clientX, event.clientY, {
        updateVisuals: true,
      });
      return;
    }
    ingestGesturePointerSample(event.clientX, event.clientY);
  }

  function onMouseUp(event) {
    if (blockGestureUntilRelease && isMatchingMouseButton(event.button)) {
      blockGestureUntilRelease = false;
      clearRightClickPressSuppression();
      return;
    }

    const endingRightGesturePress =
      settings.triggerMouseButton === "right" &&
      isMatchingMouseButton(event.button) &&
      rightGestureButtonDown;

    if (endingRightGesturePress && requiresGestureModifier()) {
      event.preventDefault();
      event.stopPropagation();
    }

    if (!tracking && pendingGesturePress) {
      maybeActivateGestureTracking(event.clientX, event.clientY);
    }

    if (!tracking) {
      if (pendingGesturePress) {
        if (
          settings.triggerMouseButton === "right" &&
          !requiresGestureModifier() &&
          isMatchingMouseButton(event.button)
        ) {
          // Release without reaching activation drag always counts as stationary
          // for the double–right-click context menu bypass.
          lastRightStationaryClickAt = Date.now();
          appendDebugLog(
            "Stationary right click detected (possible context-menu double-click sequence).",
          );
        }
        clearPendingGesturePress();
      }
      if (endingRightGesturePress) finishModifiedRightGesturePress(event);
      return;
    }

    ingestGesturePointerSample(event.clientX, event.clientY, {
      updateVisuals: false,
    });
    if (!tracking) {
      // ingestGesturePointerSample may have aborted (all pipes eliminated)
      if (
        isMatchingMouseButton(event.button) &&
        settings.triggerMouseButton === "right"
      ) {
        lastRightStationaryClickAt = 0;
      }
      if (endingRightGesturePress) finishModifiedRightGesturePress(event);
      return;
    }

    if (
      settings.triggerMouseButton === "right" &&
      !requiresGestureModifier() &&
      isMatchingMouseButton(event.button)
    ) {
      const isStationaryClick =
        path.length === 0 && totalDistance <= STATIONARY_CLICK_PX;
      lastRightStationaryClickAt = isStationaryClick ? Date.now() : 0;
      if (isStationaryClick) {
        appendDebugLog(
          "Stationary right click detected (possible context-menu double-click sequence).",
        );
      }
    }

    completeGesture(isMatchingMouseButton(event.button));

    if (endingRightGesturePress) finishModifiedRightGesturePress(event);
  }

  function onContextMenu(event) {
    if (shouldSuppressPointerAfterRocker()) {
      suppressGestureContextMenu(event, "Context menu suppressed after rocker.");
      return;
    }

    if (
      requiresGestureModifier() &&
      settings.triggerMouseButton === "right" &&
      !isModifierSatisfied(event)
    ) {
      clearModifiedRightGestureSuppressionState();
      if (!shouldBlockGestureContextMenu()) return;
    }

    if (!shouldBlockGestureContextMenu()) return;

    const hadQueuedSuppress = suppressNextContextMenu;
    if (hadQueuedSuppress) suppressNextContextMenu = false;
    suppressGestureContextMenu(event, contextMenuBlockReason());
  }

  function onClick(event) {
    if (!shouldSuppressPointerAfterRocker()) return;
    event.preventDefault();
    event.stopPropagation();
    appendDebugLog("Click suppressed after rocker.");
  }

  function onAuxClick(event) {
    if (shouldSuppressPointerAfterRocker()) {
      event.preventDefault();
      event.stopPropagation();
      appendDebugLog("Aux click suppressed after rocker.");
      return;
    }
    if (event.button === 2 && shouldBlockGestureContextMenu()) {
      event.preventDefault();
      event.stopPropagation();
      appendDebugLog("Aux click suppressed during modified right-click gesture.");
    }
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
    setSuppressFollowingContextMenu();
    event.preventDefault();
    event.stopPropagation();
    appendDebugLog(
      `Middle rocker wheel action fired: ${event.deltaX < 0 ? "left" : "right"} -> ${action} (deltaX=${event.deltaX.toFixed(2)}, deltaY=${event.deltaY.toFixed(2)})`,
    );
    sendGestureAction(action);
  }

  api.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes.settings) return;
    settings = common.sanitizeSettings(
      changes.settings.newValue || common.DEFAULT_SETTINGS,
    );
    if (!NG_IS_TOP_FRAME) return;
    applyTrailStyle();
    syncDebugPanelVisibility();
    refreshOverlaysForZoom();
    requestTabZoomFromBackground();
    appendDebugLog("Settings updated from storage change.");
  });

  api.runtime.onMessage.addListener((message) => {
    if (!message) return;
    if (message.type === "navigestures-tab-zoom-changed") {
      if (
        NG_IS_TOP_FRAME &&
        typeof message.zoom === "number" &&
        message.zoom > 0
      ) {
        cachedTabZoomFactor = message.zoom;
        refreshOverlaysForZoom();
      }
      return;
    }
    if (message.type === "navigestures-handle-relay" && NG_IS_TOP_FRAME) {
      applyRelayedPointer(message.relay);
      return;
    }
    if (message.type === "navigestures-remote-suppress-context" && !NG_IS_TOP_FRAME) {
      pendingRemoteIframeContextSuppressUntil =
        Date.now() + REMOTE_IFRAME_CONTEXT_SUPPRESS_MS;
      return;
    }
    if (
      message.type === "navigestures-iframe-gesture-active" &&
      !NG_IS_TOP_FRAME
    ) {
      subframeRemoteGestureActive = !!message.active;
      if (!message.active) {
        pendingRemoteIframeContextSuppressUntil = 0;
      }
    }
  });

  window.addEventListener("DOMContentLoaded", syncDebugPanelVisibility, {
    once: true,
  });
  if (NG_IS_TOP_FRAME) {
    if (document.documentElement) {
      createTrailCanvas();
    } else {
      window.addEventListener("DOMContentLoaded", createTrailCanvas, {
        once: true,
      });
    }
    window.addEventListener("resize", resizeTrailCanvas);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", resizeTrailCanvas);
      window.visualViewport.addEventListener("scroll", resizeTrailCanvas);
    }
  }

  async function loadBridgeSettingsOnly() {
    const data = await storageGet("settings");
    settings = common.sanitizeSettings(
      data.settings || common.DEFAULT_SETTINGS,
    );
  }

  function subframeOnMouseDownForRelay(event) {
    const xy = clientCoordsInTopViewport(event.clientX, event.clientY);
    if (!xy) return;

    if (isRockerMouseDown(event) || isLrRockerMouseDown(event)) {
      suppressPointerEventsAfterRocker();
      event.preventDefault();
      event.stopPropagation();
      relayPointerToMainFrame("mousedown", envelopeFromMouse(event, xy));
      return;
    }
    if (!isMatchingMouseButton(event.button)) return;
    if (!isModifierSatisfied(event)) return;

    if (settings.triggerMouseButton === "right") {
      event.preventDefault();
      armSubframeRightGestureContextGuard();
      subframeRightGestureButtonDown = true;
    }
    relayPointerToMainFrame("mousedown", envelopeFromMouse(event, xy));
  }

  function subframeOnMouseMoveForRelay(event) {
    if ((event.buttons & 7) === 0) return;
    const xy = clientCoordsInTopViewport(event.clientX, event.clientY);
    if (!xy) return;
    relayPointerToMainFrame("mousemove", envelopeFromMouse(event, xy));
  }

  function subframeOnMouseUpForRelay(event) {
    const xy = clientCoordsInTopViewport(event.clientX, event.clientY);
    if (!xy) return;
    if (settings.triggerMouseButton === "right" && event.button === 2) {
      disarmSubframeRightGestureContextGuard();
      subframeRightGestureButtonDown = false;
    }
    relayPointerToMainFrame("mouseup", envelopeFromMouse(event, xy));
  }

  function subframeOnWheelForRelay(event) {
    if (!isLikelyRockerWheelEvent(event)) return;
    const xy = clientCoordsInTopViewport(event.clientX, event.clientY);
    if (!xy) return;
    suppressPointerEventsAfterRocker();
    event.preventDefault();
    event.stopPropagation();
    relayPointerToMainFrame("wheel", envelopeFromWheel(event, xy));
  }

  function subframeRelayContextMenu(event) {
    if (Date.now() < pendingRemoteIframeContextSuppressUntil) {
      pendingRemoteIframeContextSuppressUntil = 0;
      event.preventDefault();
      return;
    }
    if (shouldSuppressPointerAfterRocker()) {
      event.preventDefault();
      return;
    }
    if (
      subframeRightGestureButtonDown ||
      subframeRemoteGestureActive ||
      Date.now() < modifiedRightContextSuppressUntil ||
      (settings.triggerMouseButton === "right" &&
        Date.now() < subframeRightGestureContextGuardUntil)
    ) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function subframeOnClickRelay(event) {
    if (!shouldSuppressPointerAfterRocker()) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function subframeOnAuxClickRelay(event) {
    if (!shouldSuppressPointerAfterRocker()) return;
    event.preventDefault();
    event.stopPropagation();
  }

  async function attachSubframePointerBridge() {
    await loadBridgeSettingsOnly();
    window.addEventListener("mousedown", subframeOnMouseDownForRelay, true);
    window.addEventListener("mousemove", subframeOnMouseMoveForRelay, true);
    window.addEventListener("mouseup", subframeOnMouseUpForRelay, true);
    window.addEventListener("contextmenu", subframeRelayContextMenu, true);
    window.addEventListener("click", subframeOnClickRelay, true);
    window.addEventListener("auxclick", subframeOnAuxClickRelay, true);
    window.addEventListener("wheel", subframeOnWheelForRelay, {
      capture: true,
      passive: false,
    });
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
    document.addEventListener("contextmenu", onContextMenu, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("auxclick", onAuxClick, true);
    window.addEventListener("wheel", onWheel, {
      capture: true,
      passive: false,
    });
  }

  if (NG_IS_TOP_FRAME) {
    void attachGestureListenersAfterSettings();
  } else {
    void attachSubframePointerBridge();
  }
})();
