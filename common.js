(() => {
  const VALID_DIRECTIONS = ["U", "D", "L", "R", "UL", "UR", "DL", "DR"];
  const ACTIONS = [
    "reload",
    "closeTab",
    "reopenClosedTab",
    "forward",
    "back",
    "newTab",
    "zoomIn",
    "zoomOut",
    "scrollLeft",
    "scrollRight",
    "toggleMaximizeWindow",
    "maximizeWindow",
    "minimizeWindow",
    "toggleFullscreen",
  ];
  const ROCKER_ASSIGNABLE_ACTIONS = ["none", ...ACTIONS];
  const VALID_MOUSE_BUTTONS = ["right", "middle"];
  const VALID_MODIFIERS = ["unset", "alt", "meta", "ctrl"];
  const ACTION_LABELS = {
    none: "Do nothing",
    reload: "Reload page",
    closeTab: "Close tab",
    reopenClosedTab: "Reopen closed tab",
    forward: "Go forward",
    back: "Go back",
    newTab: "Open new tab",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    scrollLeft: "Scroll left",
    scrollRight: "Scroll right",
    toggleMaximizeWindow: "Toggle maximize window",
    maximizeWindow: "Maximize window",
    minimizeWindow: "Minimize window",
    toggleFullscreen: "Toggle fullscreen",
  };

  const DEFAULT_SETTINGS = {
    gestures: {
      reload: ["D", "U"],
      closeTab: ["D", "R"],
      reopenClosedTab: [],
      forward: ["R"],
      back: ["L"],
      newTab: ["UR"],
      zoomIn: [],
      zoomOut: [],
      scrollLeft: [],
      scrollRight: [],
      toggleMaximizeWindow: [],
      maximizeWindow: [],
      minimizeWindow: [],
      toggleFullscreen: [],
    },
    minSegmentPx: 35,
    pipeWidth: 150,
    inaccuracyDegrees: 50,
    trailColor: "#24a1ff",
    trailWidth: 3,
    triggerMouseButton: "right",
    triggerModifier: "unset",
    rockerMiddleLeftAction: "back",
    rockerMiddleRightAction: "forward",
    rockerLrLeftAction: "back",
    rockerLrRightAction: "forward",
    showDebugLogWindow: false,
    trainingMode: false,
  };

  const PATH_TEMPLATE_SAMPLES = 36;
  const PATH_MATCH_MIN_STROKE_PX = 22;

  function defaultGesturePathTemplates() {
    const o = {};
    for (const action of ACTIONS) o[action] = null;
    return o;
  }

  function polylineLength(points) {
    if (!points || points.length < 2) return 0;
    let t = 0;
    for (let i = 1; i < points.length; i += 1) {
      t += Math.hypot(
        points[i].x - points[i - 1].x,
        points[i].y - points[i - 1].y,
      );
    }
    return t;
  }

  function resampleStrokePoints(points, n) {
    if (!points.length) return [];
    if (points.length === 1) {
      const p0 = points[0];
      return Array.from({ length: n }, () => ({ x: p0.x, y: p0.y }));
    }
    const dists = [];
    let total = 0;
    for (let i = 1; i < points.length; i += 1) {
      const d = Math.hypot(
        points[i].x - points[i - 1].x,
        points[i].y - points[i - 1].y,
      );
      dists.push(d);
      total += d;
    }
    if (total < 1e-6) {
      const p0 = points[0];
      return Array.from({ length: n }, () => ({ x: p0.x, y: p0.y }));
    }
    const result = [];
    let acc = 0;
    let j = 0;
    for (let k = 0; k < n; k += 1) {
      const target = (k / (n - 1)) * total;
      while (j < dists.length && acc + dists[j] < target) {
        acc += dists[j];
        j += 1;
      }
      const segFrac =
        j < dists.length && dists[j] > 1e-6 ? (target - acc) / dists[j] : 0;
      const p0 = points[j];
      const p1 = points[j + 1] || p0;
      result.push({
        x: p0.x + (p1.x - p0.x) * segFrac,
        y: p0.y + (p1.y - p0.y) * segFrac,
      });
    }
    return result;
  }

  function centroid2d(pts) {
    let sx = 0;
    let sy = 0;
    for (const p of pts) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / pts.length, y: sy / pts.length };
  }

  function normalizeStrokeToTemplate(rawPoints) {
    const sampled = resampleStrokePoints(rawPoints, PATH_TEMPLATE_SAMPLES);
    const c = centroid2d(sampled);
    for (const p of sampled) {
      p.x -= c.x;
      p.y -= c.y;
    }
    let maxB = 0;
    for (const p of sampled) {
      maxB = Math.max(maxB, Math.abs(p.x), Math.abs(p.y));
    }
    if (maxB < 1e-6) maxB = 1;
    const inv = 1 / maxB;
    const out = [];
    for (let i = 0; i < PATH_TEMPLATE_SAMPLES; i += 1) {
      out.push([sampled[i].x * inv, sampled[i].y * inv]);
    }
    return out;
  }

  function gestureTokensToPreviewPolyline(tokens, stepPx, uTurnSpreadPx) {
    const step = stepPx != null ? stepPx : 14;
    const spread = uTurnSpreadPx != null ? uTurnSpreadPx : 4;
    if (!tokens || !tokens.length) return [];
    let x = 0;
    let y = 0;
    const pts = [{ x: 0, y: 0 }];
    for (let i = 0; i < tokens.length; i += 1) {
      const u = directionVector(tokens[i]);
      const len = Math.hypot(u.x, u.y);
      if (len < 1e-9) continue;
      const ux = u.x / len;
      const uy = u.y / len;
      if (i > 0) {
        const v = directionVector(tokens[i - 1]);
        const vl = Math.hypot(v.x, v.y);
        if (vl < 1e-9) continue;
        const vx = v.x / vl;
        const vy = v.y / vl;
        if (ux * vx + uy * vy < -0.35) {
          x += -vy * spread;
          y += vx * spread;
        }
      }
      x += ux * step;
      y += uy * step;
      pts.push({ x, y });
    }
    return pts;
  }

  function decimatePolylineUniform(npts, maxVerts) {
    if (!npts || npts.length < 2) return npts;
    const cap = Math.max(2, maxVerts);
    if (npts.length <= cap) return npts;
    const out = [];
    const last = npts.length - 1;
    for (let k = 0; k < cap; k += 1) {
      const idx = Math.round((k / (cap - 1)) * last);
      out.push(npts[idx]);
    }
    const deduped = [out[0]];
    for (let i = 1; i < out.length; i += 1) {
      const p = out[i];
      const q = deduped[deduped.length - 1];
      if (Math.hypot(p.x - q.x, p.y - q.y) > 1e-4) deduped.push(p);
    }
    const lastPt = npts[last];
    const dLast = deduped[deduped.length - 1];
    if (Math.hypot(lastPt.x - dLast.x, lastPt.y - dLast.y) > 1e-4)
      deduped.push(lastPt);
    return deduped.length >= 2 ? deduped : npts;
  }

  function arrowSegmentsAlongPolyline(npts, maxArrows) {
    const n = npts.length;
    if (n < 2) return [];
    const cap = Math.max(1, maxArrows != null ? maxArrows : 8);
    const cum = [0];
    for (let i = 0; i < n - 1; i += 1) {
      cum.push(
        cum[i] +
          Math.hypot(npts[i + 1].x - npts[i].x, npts[i + 1].y - npts[i].y),
      );
    }
    const total = cum[cum.length - 1];
    if (total < 1e-9) return [];
    const out = [];
    for (let a = 0; a < cap; a += 1) {
      const target = ((a + 0.5) / cap) * total;
      for (let i = 0; i < n - 1; i += 1) {
        if (cum[i + 1] >= target - 1e-9) {
          out.push({
            x1: npts[i].x,
            y1: npts[i].y,
            x2: npts[i + 1].x,
            y2: npts[i + 1].y,
          });
          break;
        }
      }
    }
    return out;
  }

  function polylineToArrowPreviewSpec(pts, pad, strokePad, maxArrows) {
    const padV = pad != null ? pad : 6;
    const sp = strokePad != null ? strokePad : 3;
    const empty = !pts || pts.length < 2;
    if (empty) {
      return {
        empty: true,
        viewBox: "0 0 24 24",
        start: null,
        strokeD: "M 4 20 L 20 4",
        arrowSegments: [],
      };
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const norm = (p) => ({
      x: p.x - minX + padV + sp,
      y: p.y - minY + padV + sp,
    });
    const npts = pts.map(norm);
    const w = Math.max(maxX - minX, 1);
    const h = Math.max(maxY - minY, 1);
    const vbW = w + (padV + sp) * 2;
    const vbH = h + (padV + sp) * 2;
    const strokeD = npts
      .map(
        (p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`,
      )
      .join(" ");
    const coarse = decimatePolylineUniform(
      npts,
      Math.min(40, Math.max(12, Math.ceil(npts.length / 2))),
    );
    const arrowSegments = arrowSegmentsAlongPolyline(coarse, maxArrows);
    return {
      empty: false,
      viewBox: `0 0 ${vbW.toFixed(2)} ${vbH.toFixed(2)}`,
      start: { cx: npts[0].x, cy: npts[0].y },
      strokeD,
      arrowSegments,
    };
  }

  function gesturePreviewArrowSpecFromTokens(tokens) {
    const pts = gestureTokensToPreviewPolyline(tokens, 14, 4);
    return polylineToArrowPreviewSpec(pts, 6, 3, 24);
  }

  function gesturePreviewArrowSpecFromTemplate(tmpl) {
    if (!tmpl || tmpl.length < 2) {
      return polylineToArrowPreviewSpec(null);
    }
    const scale = 34;
    const pts = tmpl.map((p) => ({ x: p[0] * scale, y: p[1] * scale }));
    return polylineToArrowPreviewSpec(pts, 10, 5, 12);
  }

  function sanitizeGesturePathTemplates(raw) {
    const defs = defaultGesturePathTemplates();
    if (!raw || typeof raw !== "object") return defs;
    const out = { ...defs };
    for (const action of ACTIONS) {
      const v = raw[action];
      if (!v || !Array.isArray(v) || v.length !== PATH_TEMPLATE_SAMPLES) {
        out[action] = null;
        continue;
      }
      const sanitized = [];
      let ok = true;
      for (let i = 0; i < v.length; i += 1) {
        const p = v[i];
        if (!Array.isArray(p) || p.length !== 2) {
          ok = false;
          break;
        }
        const x = Number(p[0]);
        const y = Number(p[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          ok = false;
          break;
        }
        sanitized.push([x, y]);
      }
      out[action] = ok ? sanitized : null;
    }
    return out;
  }

  function clampNumber(value, min, max, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, Math.round(num)));
  }

  function normalizeGestureArray(input, fallbackArray) {
    if (Array.isArray(input) && input.length === 0) return [];
    const source = Array.isArray(input) ? input : fallbackArray;
    const out = [];
    for (const part of source) {
      const token = String(part || "")
        .trim()
        .toUpperCase();
      if (VALID_DIRECTIONS.includes(token)) out.push(token);
    }
    return out.length ? out : [...fallbackArray];
  }

  function normalizeHexColor(input, fallbackColor) {
    if (typeof input !== "string") return fallbackColor;
    let value = input.trim();
    if (!value) return fallbackColor;
    if (!value.startsWith("#")) value = `#${value}`;
    const shortHex = /^#([0-9a-fA-F]{3})$/;
    const fullHex = /^#([0-9a-fA-F]{6})$/;

    if (shortHex.test(value)) {
      const chars = value.slice(1).split("");
      return `#${chars
        .map((c) => c + c)
        .join("")
        .toLowerCase()}`;
    }
    if (fullHex.test(value)) {
      return value.toLowerCase();
    }
    return fallbackColor;
  }

  function normalizeChoice(value, validChoices, fallbackValue) {
    const normalized = String(value || "")
      .trim()
      .toLowerCase();
    for (const choice of validChoices) {
      if (String(choice).toLowerCase() === normalized) return choice;
    }
    return fallbackValue;
  }

  function normalizeBoolean(value, fallbackValue) {
    if (typeof value === "boolean") return value;
    return fallbackValue;
  }

  const DIRECTION_ANGLES = {
    R: 0,
    DR: 45,
    D: 90,
    DL: 135,
    L: 180,
    UL: 225,
    U: 270,
    UR: 315,
  };

  function angleForDirection(direction) {
    return DIRECTION_ANGLES[direction];
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
    return (
      direction === "R" ||
      direction === "D" ||
      direction === "L" ||
      direction === "U"
    );
  }

  function collapseBridgeDiagonal(pathDirections) {
    if (pathDirections.length < 3) return false;
    const aIndex = pathDirections.length - 3;
    const bIndex = pathDirections.length - 2;
    const a = pathDirections[aIndex];
    const b = pathDirections[bIndex];
    const c = pathDirections[pathDirections.length - 1];
    if (!isCardinal(a) || !isCardinal(c) || a === c) return false;

    const aVec = directionVector(a);
    const cVec = directionVector(c);
    if (aVec.x === cVec.x || aVec.y === cVec.y) return false;

    const bridge = directionFromVector(aVec.x + cVec.x, aVec.y + cVec.y);
    if (!bridge || b !== bridge) return false;

    pathDirections.splice(bIndex, 1);
    return true;
  }

  function createGestureAnchorState(startX, startY) {
    return { anchorX: startX, anchorY: startY };
  }

  function processGestureMove(state, x, y, minSegmentPx, path) {
    const dx = x - state.anchorX;
    const dy = y - state.anchorY;
    const dist = Math.hypot(dx, dy);
    if (dist < minSegmentPx) {
      return { stepDist: dist, pushed: false };
    }
    const dir = vectorToDirection(dx, dy);
    let pushed = false;
    if (path[path.length - 1] !== dir) {
      path.push(dir);
      collapseBridgeDiagonal(path);
      pushed = true;
    }
    state.anchorX = x;
    state.anchorY = y;
    return { stepDist: dist, pushed };
  }

  function actionHasValidTemplate(action, settings) {
    const t =
      settings.gesturePathTemplates && settings.gesturePathTemplates[action];
    return !!(t && Array.isArray(t) && t.length === PATH_TEMPLATE_SAMPLES);
  }

  function actionHasTokens(action, settings) {
    const g = settings.gestures[action];
    return Array.isArray(g) && g.length > 0;
  }

  function gestureTokensPrefixMatch(action, settings, observedPath) {
    if (!settings || !observedPath || observedPath.length === 0) return true;
    const toks = settings.gestures[action];
    if (!Array.isArray(toks) || toks.length === 0) return true;
    if (observedPath.length > toks.length) return false;
    const tolerance =
      settings && Number.isFinite(settings.inaccuracyDegrees)
        ? settings.inaccuracyDegrees
        : DEFAULT_SETTINGS.inaccuracyDegrees;
    for (let i = 0; i < observedPath.length; i += 1) {
      const observed = observedPath[i];
      const expected = toks[i];
      if (observed === expected) continue;
      const observedAngle = angleForDirection(observed);
      const expectedAngle = angleForDirection(expected);
      if (
        !Number.isFinite(observedAngle) ||
        !Number.isFinite(expectedAngle) ||
        angularDifference(observedAngle, expectedAngle) > tolerance
      ) {
        return false;
      }
    }
    return true;
  }

  /** True if this action has a token sequence and/or a taught path template. */
  function actionIsConfigured(action, settings) {
    return (
      actionHasTokens(action, settings) ||
      actionHasValidTemplate(action, settings)
    );
  }

  function sanitizeSettings(raw) {
    const base = raw && typeof raw === "object" ? raw : {};
    const rawGestures =
      base.gestures && typeof base.gestures === "object" ? base.gestures : {};

    const gestures = {};
    for (const action of ACTIONS) {
      gestures[action] = normalizeGestureArray(
        rawGestures[action],
        DEFAULT_SETTINGS.gestures[action],
      );
    }

    return {
      gestures,
      gesturePathTemplates: sanitizeGesturePathTemplates(
        base.gesturePathTemplates,
      ),
      minSegmentPx: clampNumber(
        base.minSegmentPx,
        8,
        80,
        DEFAULT_SETTINGS.minSegmentPx,
      ),
      pipeWidth: clampNumber(
        base.pipeWidth,
        20,
        200,
        DEFAULT_SETTINGS.pipeWidth,
      ),
      inaccuracyDegrees: clampNumber(
        base.inaccuracyDegrees,
        10,
        85,
        DEFAULT_SETTINGS.inaccuracyDegrees,
      ),
      trailColor: normalizeHexColor(
        base.trailColor,
        DEFAULT_SETTINGS.trailColor,
      ),
      trailWidth: clampNumber(
        base.trailWidth,
        1,
        16,
        DEFAULT_SETTINGS.trailWidth,
      ),
      triggerMouseButton: normalizeChoice(
        base.triggerMouseButton,
        VALID_MOUSE_BUTTONS,
        DEFAULT_SETTINGS.triggerMouseButton,
      ),
      triggerModifier: normalizeChoice(
        base.triggerModifier,
        VALID_MODIFIERS,
        DEFAULT_SETTINGS.triggerModifier,
      ),
      rockerMiddleLeftAction: normalizeChoice(
        base.rockerMiddleLeftAction,
        ROCKER_ASSIGNABLE_ACTIONS,
        DEFAULT_SETTINGS.rockerMiddleLeftAction,
      ),
      rockerMiddleRightAction: normalizeChoice(
        base.rockerMiddleRightAction,
        ROCKER_ASSIGNABLE_ACTIONS,
        DEFAULT_SETTINGS.rockerMiddleRightAction,
      ),
      rockerLrLeftAction: normalizeChoice(
        base.rockerLrLeftAction,
        ROCKER_ASSIGNABLE_ACTIONS,
        DEFAULT_SETTINGS.rockerLrLeftAction,
      ),
      rockerLrRightAction: normalizeChoice(
        base.rockerLrRightAction,
        ROCKER_ASSIGNABLE_ACTIONS,
        DEFAULT_SETTINGS.rockerLrRightAction,
      ),
      showDebugLogWindow: normalizeBoolean(
        base.showDebugLogWindow,
        DEFAULT_SETTINGS.showDebugLogWindow,
      ),
      trainingMode: normalizeBoolean(
        base.trainingMode,
        DEFAULT_SETTINGS.trainingMode,
      ),
    };
  }

  DEFAULT_SETTINGS.gesturePathTemplates = defaultGesturePathTemplates();

  // --- Unified pipe-based gesture recognition ---

  function pipeScaleBase(settings) {
    return Math.max(40, settings.minSegmentPx * 3.0);
  }

  function buildPipeCenterline(action, settings, startPoint, scaleFactor) {
    const s = Math.max(1, scaleFactor || 1);
    const template =
      settings.gesturePathTemplates && settings.gesturePathTemplates[action];
    const tokens = settings.gestures[action] || [];
    if (
      template &&
      Array.isArray(template) &&
      template.length === PATH_TEMPLATE_SAMPLES
    ) {
      const t0 = template[0];
      if (Array.isArray(t0) && t0.length === 2) {
        let maxExtent = 0;
        for (const p of template) {
          if (!Array.isArray(p) || p.length !== 2) continue;
          maxExtent = Math.max(
            maxExtent,
            Math.abs(p[0] - t0[0]),
            Math.abs(p[1] - t0[1]),
          );
        }
        maxExtent = Math.max(maxExtent, 0.3);
        const scale = (pipeScaleBase(settings) * s) / maxExtent;
        const pts = [];
        for (const p of template) {
          if (!Array.isArray(p) || p.length !== 2) continue;
          pts.push({
            x: startPoint.x + (p[0] - t0[0]) * scale,
            y: startPoint.y + (p[1] - t0[1]) * scale,
          });
        }
        if (pts.length >= 2) return pts;
      }
    }
    if (Array.isArray(tokens) && tokens.length > 0) {
      const step = pipeScaleBase(settings) * s;
      const pts = [{ x: startPoint.x, y: startPoint.y }];
      let x = startPoint.x;
      let y = startPoint.y;
      for (const token of tokens) {
        const deg = DIRECTION_ANGLES[token];
        if (deg == null) continue;
        const rad = (deg * Math.PI) / 180;
        x += Math.cos(rad) * step;
        y += Math.sin(rad) * step;
        pts.push({ x, y });
      }
      if (pts.length >= 2) return pts;
    }
    return null;
  }

  function computePipeRadius(scaleFactor, settings) {
    const s = Math.max(1, scaleFactor || 1);
    return settings.minSegmentPx * (settings.pipeWidth / 100) * Math.sqrt(s);
  }

  function visibleTrailHalfWidth(scaleFactor, settings) {
    const s = Math.max(1, scaleFactor || 1);
    return (settings.trailWidth * s) / 2;
  }

  function computePipeContainmentRadius(scaleFactor, settings) {
    const pipeRadius = computePipeRadius(scaleFactor, settings);
    const trailHalf = visibleTrailHalfWidth(scaleFactor, settings);
    return Math.max(1, pipeRadius - trailHalf);
  }

  function pipeScaleCandidates(scaleFactor) {
    const base = Math.max(1, scaleFactor || 1);
    const raw = [base * 0.95, base, base * 1.08];
    const out = [];
    for (const v of raw) {
      const s = Math.min(20, Math.max(1, v));
      if (!out.some((x) => Math.abs(x - s) < 0.03)) out.push(s);
    }
    return out;
  }

  function startDirectionForPolyline(polyline, minDistance) {
    if (!polyline || polyline.length < 2) return null;
    const start = polyline[0];
    const minDist = Math.max(1, minDistance || 1);
    for (let i = 1; i < polyline.length; i += 1) {
      const p = polyline[i];
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      if (Math.hypot(dx, dy) >= minDist) {
        return vectorToDirection(dx, dy);
      }
    }
    const last = polyline[polyline.length - 1];
    return vectorToDirection(last.x - start.x, last.y - start.y);
  }

  function templatePipePrefixMatch(pipe, settings, observedPath) {
    if (!observedPath || observedPath.length === 0) return true;
    const toks = settings.gestures[pipe.action];
    if (Array.isArray(toks) && toks.length > 0) return true;
    const expected = startDirectionForPolyline(
      pipe.centerline,
      settings.minSegmentPx * 0.8,
    );
    const observed = observedPath[0];
    const observedAngle = angleForDirection(observed);
    const expectedAngle = angleForDirection(expected);
    if (!Number.isFinite(observedAngle) || !Number.isFinite(expectedAngle)) {
      return true;
    }
    const tolerance = Math.max(
      settings.inaccuracyDegrees || DEFAULT_SETTINGS.inaccuracyDegrees,
      55,
    );
    return angularDifference(observedAngle, expectedAngle) <= tolerance;
  }

  function pointAtArcLength(polyline, arcLength) {
    if (!polyline || polyline.length < 2) return null;
    const target = Math.max(0, arcLength || 0);
    let totalArc = 0;
    for (let i = 0; i < polyline.length - 1; i += 1) {
      const a = polyline[i];
      const b = polyline[i + 1];
      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const segLen = Math.hypot(vx, vy);
      if (segLen < 1e-6) continue;
      const segEnd = totalArc + segLen;
      if (target <= segEnd) {
        const t = segLen > 1e-6 ? (target - totalArc) / segLen : 0;
        return {
          x: a.x + vx * t,
          y: a.y + vy * t,
        };
      }
      totalArc = segEnd;
    }
    const last = polyline[polyline.length - 1];
    return last ? { x: last.x, y: last.y } : null;
  }

  /**
   * Find the closest point on `polyline` to `point`, restricted to an arc-length
   * window. This keeps candidate matching in lock-step with the same centerline
   * used to draw the training pipe, so the pointer cannot jump ahead to a later
   * segment or skip intermediate parts of the gesture.
   */
  function pointToPolylineInfo(point, polyline, minArcLength, maxArcLength) {
    if (!polyline || polyline.length < 2 || !point) {
      return {
        distance: Infinity,
        progress: 0,
        arcLength: 0,
        tangentX: 0,
        tangentY: 0,
      };
    }
    const minArc = minArcLength > 0 ? minArcLength : 0;
    const maxArc = Number.isFinite(maxArcLength)
      ? Math.max(minArc, maxArcLength)
      : Number.POSITIVE_INFINITY;
    let bestDist2 = Infinity;
    let bestArc = minArc;
    let bestTangentX = 0;
    let bestTangentY = 0;
    let totalArc = 0;
    for (let i = 0; i < polyline.length - 1; i += 1) {
      const a = polyline[i];
      const b = polyline[i + 1];
      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const segLen = Math.hypot(vx, vy);
      if (segLen < 1e-6) continue;
      const segStart = totalArc;
      const segEnd = totalArc + segLen;
      if (segEnd < minArc) {
        totalArc = segEnd;
        continue;
      }
      if (segStart > maxArc) {
        totalArc = segEnd;
        continue;
      }
      const wx = point.x - a.x;
      const wy = point.y - a.y;
      let t = (wx * vx + wy * vy) / (segLen * segLen);
      if (t < 0) t = 0;
      if (t > 1) t = 1;
      let arcAtT = segStart + segLen * t;
      const clampedMinArc = Math.max(minArc, segStart);
      const clampedMaxArc = Math.min(maxArc, segEnd);
      if (arcAtT < clampedMinArc) {
        t = Math.min(1, (clampedMinArc - segStart) / segLen);
        arcAtT = segStart + segLen * t;
      }
      if (arcAtT > clampedMaxArc) {
        t = Math.max(0, (clampedMaxArc - segStart) / segLen);
        arcAtT = segStart + segLen * t;
      }
      if (arcAtT < clampedMinArc - 1e-6 || arcAtT > clampedMaxArc + 1e-6) {
        totalArc = segEnd;
        continue;
      }
      const px = a.x + vx * t;
      const py = a.y + vy * t;
      const dx = point.x - px;
      const dy = point.y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist2) {
        bestDist2 = d2;
        bestArc = arcAtT;
        bestTangentX = vx / segLen;
        bestTangentY = vy / segLen;
      }
      totalArc = segEnd;
    }
    const progress = totalArc > 1e-6 ? bestArc / totalArc : 0;
    return {
      distance: Math.sqrt(bestDist2),
      progress: Math.max(0, Math.min(1, progress)),
      arcLength: bestArc,
      tangentX: bestTangentX,
      tangentY: bestTangentY,
    };
  }

  /**
   * Build the initial pipe set for all configured gestures.
   * Each pipe has a centerline (polyline in client coordinates) and tracks elimination / progress.
   */
  function createPipeMatchState(settings, startPoint, scaleFactor) {
    const pipes = [];
    for (const action of ACTIONS) {
      if (!actionIsConfigured(action, settings)) continue;
      for (const candidateScale of pipeScaleCandidates(scaleFactor)) {
        const centerline = buildPipeCenterline(
          action,
          settings,
          startPoint,
          candidateScale,
        );
        if (!centerline) continue;
        const radius = computePipeRadius(candidateScale, settings);
        const containmentRadius = computePipeContainmentRadius(
          candidateScale,
          settings,
        );
        pipes.push({
          action,
          centerline,
          progress: 0,
          arcLength: 0,
          lastPoint: { x: startPoint.x, y: startPoint.y },
          scaleFactor: candidateScale,
          radius,
          containmentRadius,
          misses: 0,
          tokenMisses: 0,
          penalty: 0,
          score: 0,
          eliminated: false,
        });
      }
    }
    const radius = computePipeRadius(scaleFactor, settings);
    const containmentRadius = computePipeContainmentRadius(
      scaleFactor,
      settings,
    );
    return {
      pipes,
      radius,
      containmentRadius,
      startPoint: { x: startPoint.x, y: startPoint.y },
      scaleFactor,
      allEliminated: pipes.length === 0,
    };
  }

  /**
   * Per-move update: rebuild geometry if scale changed, then test containment.
   * Near misses accrue penalty before elimination, which helps noisy fast strokes
   * without letting candidates jump arbitrarily along the centerline.
   */
  function advancePipeMatchState(
    prevState,
    mousePoint,
    scaleFactor,
    settings,
    observedPath,
  ) {
    if (!prevState || prevState.allEliminated) return prevState;
    let pipes = prevState.pipes;
    let radius = prevState.radius;
    let containmentRadius = prevState.containmentRadius;
    const scaleChanged = Math.abs(scaleFactor - prevState.scaleFactor) >= 0.01;
    if (scaleChanged) {
      radius = computePipeRadius(scaleFactor, settings);
      containmentRadius = computePipeContainmentRadius(scaleFactor, settings);
      const rebuilt = [];
      for (const oldPipe of pipes) {
        const scaleRatio =
          prevState.scaleFactor > 1e-6
            ? oldPipe.scaleFactor / prevState.scaleFactor
            : 1;
        const candidateScale = Math.min(20, Math.max(1, scaleFactor * scaleRatio));
        const centerline = buildPipeCenterline(
          oldPipe.action,
          settings,
          prevState.startPoint,
          candidateScale,
        );
        if (!centerline) {
          rebuilt.push({ ...oldPipe, eliminated: true });
          continue;
        }
        const radiusForPipe = computePipeRadius(candidateScale, settings);
        const containmentForPipe = computePipeContainmentRadius(
          candidateScale,
          settings,
        );
        const lastPoint =
          pointAtArcLength(centerline, oldPipe.arcLength || 0) ||
          prevState.startPoint;
        rebuilt.push({
          ...oldPipe,
          centerline,
          lastPoint,
          scaleFactor: candidateScale,
          radius: radiusForPipe,
          containmentRadius: containmentForPipe,
        });
      }
      pipes = rebuilt;
    }
    const updated = pipes.map((pipe) => {
      if (pipe.eliminated) return pipe;
      if (
        !gestureTokensPrefixMatch(pipe.action, settings, observedPath) ||
        !templatePipePrefixMatch(pipe, settings, observedPath)
      ) {
        const tokenMisses = (pipe.tokenMisses || 0) + 1;
        if (tokenMisses >= 2) return { ...pipe, eliminated: true };
        return {
          ...pipe,
          tokenMisses,
          penalty: (pipe.penalty || 0) + 0.18,
          score: (pipe.score || 0) - 0.18,
        };
      }
      const pipeContainmentRadius =
        pipe.containmentRadius || containmentRadius || 1;
      const currentArc = Math.max(0, pipe.arcLength || 0);
      const prevPoint =
        pipe.lastPoint ||
        pointAtArcLength(pipe.centerline, currentArc) ||
        prevState.startPoint;
      const moveX = mousePoint.x - prevPoint.x;
      const moveY = mousePoint.y - prevPoint.y;
      const moveLen = Math.hypot(moveX, moveY);
      const backtrackWindow = Math.max(
        pipeContainmentRadius * 0.75,
        settings.minSegmentPx * 0.5,
      );
      const leadWindow = Math.max(
        pipeContainmentRadius * 3.25,
        settings.minSegmentPx * 2.2,
        moveLen * 2.4,
      );
      const minArc = Math.max(0, currentArc - backtrackWindow);
      const maxArc = currentArc + leadWindow;
      const info = pointToPolylineInfo(
        mousePoint,
        pipe.centerline,
        minArc,
        maxArc,
      );
      if (!Number.isFinite(info.distance)) {
        return { ...pipe, eliminated: true };
      }
      const hardLimit = pipeContainmentRadius * 2.25;
      if (info.distance > hardLimit) return { ...pipe, eliminated: true };

      const outsideBy = info.distance - pipeContainmentRadius;
      const wasOutside = outsideBy > 0;
      const misses = wasOutside ? (pipe.misses || 0) + 1 : 0;
      if (misses >= 3) return { ...pipe, eliminated: true };

      const nextArc = Math.max(currentArc, info.arcLength);
      const nextPoint = pointAtArcLength(pipe.centerline, nextArc) || prevPoint;
      const nextProgress = Math.max(pipe.progress, info.progress);
      const distanceRatio = info.distance / Math.max(1, pipeContainmentRadius);
      const penalty = Math.max(
        0,
        (pipe.penalty || 0) * (wasOutside ? 1 : 0.82) +
          (wasOutside ? Math.min(0.22, outsideBy / (pipeContainmentRadius * 3)) : 0),
      );
      return {
        ...pipe,
        progress: nextProgress,
        arcLength: nextArc,
        lastPoint: nextPoint,
        misses,
        tokenMisses: 0,
        penalty,
        score: nextProgress - penalty - distanceRatio * 0.08,
      };
    });
    const surviving = updated.filter((p) => !p.eliminated);
    return {
      pipes: updated,
      radius,
      containmentRadius,
      startPoint: prevState.startPoint,
      scaleFactor,
      allEliminated: surviving.length === 0,
    };
  }

  function gestureTokensExactPathMatch(action, settings, observedPath) {
    if (!observedPath || observedPath.length === 0 || !settings) return false;
    const toks = settings.gestures[action];
    if (!Array.isArray(toks) || toks.length === 0) return false;
    if (toks.length !== observedPath.length) return false;
    for (let i = 0; i < toks.length; i += 1) {
      if (toks[i] !== observedPath[i]) return false;
    }
    return true;
  }

  function templateMeanDistance(a, b) {
    if (
      !Array.isArray(a) ||
      !Array.isArray(b) ||
      a.length !== PATH_TEMPLATE_SAMPLES ||
      b.length !== PATH_TEMPLATE_SAMPLES
    ) {
      return Infinity;
    }
    let total = 0;
    for (let i = 0; i < PATH_TEMPLATE_SAMPLES; i += 1) {
      const pa = a[i];
      const pb = b[i];
      if (!Array.isArray(pa) || !Array.isArray(pb)) return Infinity;
      total += Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
    }
    return total / PATH_TEMPLATE_SAMPLES;
  }

  function templateResolveBonus(action, settings, observedTemplate) {
    const template =
      settings && settings.gesturePathTemplates
        ? settings.gesturePathTemplates[action]
        : null;
    if (
      !template ||
      !observedTemplate ||
      !Array.isArray(template) ||
      template.length !== PATH_TEMPLATE_SAMPLES
    ) {
      return { bonus: 0, distance: Infinity };
    }
    const distance = templateMeanDistance(template, observedTemplate);
    if (!Number.isFinite(distance)) return { bonus: 0, distance: Infinity };
    return {
      bonus: Math.max(-0.45, 0.5 - distance),
      distance,
    };
  }

  /**
   * Pick the best surviving pipe. Prefer configured token paths that exactly
   * match the observed direction sequence over template-only gestures, so a
   * drawn D→R does not lose to a loose circular template match.
   */
  function resolvePipeAction(
    state,
    minProgressFraction,
    observedPath,
    settings,
    observedPoints,
  ) {
    if (!state || state.allEliminated) return null;
    const minProg = minProgressFraction != null ? minProgressFraction : 0.3;
    const observedTemplate =
      observedPoints && observedPoints.length >= 2
        ? normalizeStrokeToTemplate(observedPoints)
        : null;
    const bestByAction = new Map();
    for (const pipe of state.pipes) {
      if (pipe.eliminated) continue;
      const prev = bestByAction.get(pipe.action);
      const pipeScore = Number.isFinite(pipe.score) ? pipe.score : pipe.progress;
      const prevScore =
        prev && Number.isFinite(prev.score) ? prev.score : prev ? prev.progress : -Infinity;
      if (!prev || pipeScore > prevScore) bestByAction.set(pipe.action, pipe);
    }
    const surviving = Array.from(bestByAction.values());
    if (!surviving.length) return null;
    const canTok = !!(settings && observedPath && observedPath.length);
    const resolveScore = (pipe) => {
      const baseScore = Number.isFinite(pipe.score) ? pipe.score : pipe.progress;
      return baseScore + templateResolveBonus(pipe.action, settings, observedTemplate).bonus;
    };
    surviving.sort((a, b) => {
      if (canTok) {
        const ea = gestureTokensExactPathMatch(a.action, settings, observedPath)
          ? 1
          : 0;
        const eb = gestureTokensExactPathMatch(b.action, settings, observedPath)
          ? 1
          : 0;
        if (ea !== eb) return eb - ea;
      }
      const sa = resolveScore(a);
      const sb = resolveScore(b);
      if (Math.abs(sa - sb) > 0.01) return sb - sa;
      if (Math.abs(a.progress - b.progress) > 0.01) return b.progress - a.progress;
      return ACTIONS.indexOf(a.action) - ACTIONS.indexOf(b.action);
    });
    const best = surviving[0];
    if (best.progress < minProg) return null;
    const bestTemplate = templateResolveBonus(
      best.action,
      settings,
      observedTemplate,
    );
    if (
      Number.isFinite(bestTemplate.distance) &&
      bestTemplate.distance > 0.8 &&
      !gestureTokensExactPathMatch(best.action, settings, observedPath)
    ) {
      return null;
    }
    if (
      surviving.length > 1 &&
      !gestureTokensExactPathMatch(best.action, settings, observedPath)
    ) {
      const bestScore = resolveScore(best);
      const second = surviving[1];
      const secondScore = resolveScore(second);
      if (secondScore >= bestScore - 0.06) return null;
    }
    return best.action;
  }

  function survivingPipeActions(state) {
    if (!state) return [];
    const out = [];
    for (const pipe of state.pipes) {
      if (pipe.eliminated || out.includes(pipe.action)) continue;
      out.push(pipe.action);
    }
    return out;
  }

  globalThis.NaviGesturesCommon = {
    VALID_DIRECTIONS,
    ACTIONS,
    ACTION_LABELS,
    ROCKER_ASSIGNABLE_ACTIONS,
    VALID_MOUSE_BUTTONS,
    VALID_MODIFIERS,
    DEFAULT_SETTINGS,
    PATH_TEMPLATE_SAMPLES,
    PATH_MATCH_MIN_STROKE_PX,
    defaultGesturePathTemplates,
    polylineLength,
    normalizeStrokeToTemplate,
    gesturePreviewArrowSpecFromTokens,
    gesturePreviewArrowSpecFromTemplate,
    normalizeGestureArray,
    normalizeHexColor,
    sanitizeSettings,
    DIRECTION_ANGLES,
    angleForDirection,
    angularDifference,
    vectorToDirection,
    createGestureAnchorState,
    processGestureMove,
    collapseBridgeDiagonal,
    actionIsConfigured,
    sanitizeGesturePathTemplates,
    pipeScaleBase,
    buildPipeCenterline,
    computePipeRadius,
    computePipeContainmentRadius,
    pointAtArcLength,
    pointToPolylineInfo,
    createPipeMatchState,
    advancePipeMatchState,
    resolvePipeAction,
    survivingPipeActions,
    gestureTokensPrefixMatch,
  };
})();
