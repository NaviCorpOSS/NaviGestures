(() => {
  const VALID_DIRECTIONS = ["U", "D", "L", "R", "UL", "UR", "DL", "DR"];
  const ACTIONS = [
    "reload",
    "closeTab",
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
    "toggleFullscreen"
  ];
  const ROCKER_ASSIGNABLE_ACTIONS = ["none", ...ACTIONS];
  const VALID_MOUSE_BUTTONS = ["right", "middle"];
  const VALID_MODIFIERS = ["unset", "alt", "shift", "ctrl"];
  const ACTION_LABELS = {
    none: "Do nothing",
    reload: "Reload page",
    closeTab: "Close tab",
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
    toggleFullscreen: "Toggle fullscreen"
  };

  const DEFAULT_SETTINGS = {
    gestures: {
      reload: ["D", "U"],
      closeTab: ["D", "R"],
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
      toggleFullscreen: []
    },
    minSegmentPx: 18,
    pipeWidth: 100,
    inaccuracyDegrees: 50,
    trailColor: "#24a1ff",
    trailWidth: 3,
    triggerMouseButton: "right",
    triggerModifier: "unset",
    rockerMiddleLeftAction: "back",
    rockerMiddleRightAction: "forward",
    showDebugLogWindow: false
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
      t += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
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
      const d = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
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
      const segFrac = j < dists.length && dists[j] > 1e-6 ? (target - acc) / dists[j] : 0;
      const p0 = points[j];
      const p1 = points[j + 1] || p0;
      result.push({
        x: p0.x + (p1.x - p0.x) * segFrac,
        y: p0.y + (p1.y - p0.y) * segFrac
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

  function gesturePathTemplateToSvgViewSpec(template) {
    const pad = 8;
    const strokePad = 2;
    if (!template || template.length < 2) {
      return { d: "M 4 20 L 20 4", viewBox: "0 0 24 24", empty: true };
    }
    const scale = 34;
    const cx = 0;
    const cy = 0;
    const pts = template.map((p) => ({
      x: p[0] * scale + cx,
      y: p[1] * scale + cy
    }));
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
    const w = Math.max(maxX - minX, 1);
    const h = Math.max(maxY - minY, 1);
    const d = pts
      .map((p, i) => {
        const px = p.x - minX + pad + strokePad;
        const py = p.y - minY + pad + strokePad;
        return `${i === 0 ? "M" : "L"} ${px.toFixed(2)} ${py.toFixed(2)}`;
      })
      .join(" ");
    const vbW = w + (pad + strokePad) * 2;
    const vbH = h + (pad + strokePad) * 2;
    return {
      d,
      viewBox: `0 0 ${vbW.toFixed(2)} ${vbH.toFixed(2)}`,
      empty: false
    };
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
    if (Math.hypot(lastPt.x - dLast.x, lastPt.y - dLast.y) > 1e-4) deduped.push(lastPt);
    return deduped.length >= 2 ? deduped : npts;
  }

  function arrowSegmentsAlongPolyline(npts, maxArrows) {
    const n = npts.length;
    if (n < 2) return [];
    const cap = Math.max(1, maxArrows != null ? maxArrows : 8);
    const cum = [0];
    for (let i = 0; i < n - 1; i += 1) {
      cum.push(cum[i] + Math.hypot(npts[i + 1].x - npts[i].x, npts[i + 1].y - npts[i].y));
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
            y2: npts[i + 1].y
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
        arrowSegments: []
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
    const norm = (p) => ({ x: p.x - minX + padV + sp, y: p.y - minY + padV + sp });
    const npts = pts.map(norm);
    const w = Math.max(maxX - minX, 1);
    const h = Math.max(maxY - minY, 1);
    const vbW = w + (padV + sp) * 2;
    const vbH = h + (padV + sp) * 2;
    const strokeD = npts
      .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
      .join(" ");
    const coarse = decimatePolylineUniform(npts, Math.min(40, Math.max(12, Math.ceil(npts.length / 2))));
    const arrowSegments = arrowSegmentsAlongPolyline(coarse, maxArrows);
    return {
      empty: false,
      viewBox: `0 0 ${vbW.toFixed(2)} ${vbH.toFixed(2)}`,
      start: { cx: npts[0].x, cy: npts[0].y },
      strokeD,
      arrowSegments
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
      const token = String(part || "").trim().toUpperCase();
      if (VALID_DIRECTIONS.includes(token)) out.push(token);
    }
    return out.length ? out : [...fallbackArray];
  }

  function parseGestureInput(text, fallbackArray) {
    if (typeof text !== "string") return [...fallbackArray];
    const tokens = text
      .toUpperCase()
      .replace(/[-=>]/g, " ")
      .split(/[\s,]+/)
      .filter(Boolean);
    return normalizeGestureArray(tokens, fallbackArray);
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
      return `#${chars.map((c) => c + c).join("").toLowerCase()}`;
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
    UR: 315
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
    return direction === "R" || direction === "D" || direction === "L" || direction === "U";
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
    const t = settings.gesturePathTemplates && settings.gesturePathTemplates[action];
    return !!(t && Array.isArray(t) && t.length === PATH_TEMPLATE_SAMPLES);
  }

  function actionHasTokens(action, settings) {
    const g = settings.gestures[action];
    return Array.isArray(g) && g.length > 0;
  }

  /** True if this action has a token sequence and/or a taught path template. */
  function actionIsConfigured(action, settings) {
    return actionHasTokens(action, settings) || actionHasValidTemplate(action, settings);
  }

  function gestureTokensToSvgViewSpec(tokens) {
    const step = 14;
    const pad = 6;
    const strokePad = 2;
    if (!tokens || !tokens.length) {
      return {
        d: "M 4 20 L 20 4",
        viewBox: "0 0 24 24",
        empty: true
      };
    }
    let x = 0;
    let y = 0;
    const pts = [{ x: 0, y: 0 }];
    for (const t of tokens) {
      const v = directionVector(t);
      const inv = 1 / Math.hypot(v.x, v.y);
      x += v.x * inv * step;
      y += v.y * inv * step;
      pts.push({ x, y });
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
    const w = Math.max(maxX - minX, 1);
    const h = Math.max(maxY - minY, 1);
    const d = pts
      .map((p, i) => {
        const px = p.x - minX + pad + strokePad;
        const py = p.y - minY + pad + strokePad;
        return `${i === 0 ? "M" : "L"} ${px.toFixed(2)} ${py.toFixed(2)}`;
      })
      .join(" ");
    const vbW = w + (pad + strokePad) * 2;
    const vbH = h + (pad + strokePad) * 2;
    return {
      d,
      viewBox: `0 0 ${vbW.toFixed(2)} ${vbH.toFixed(2)}`,
      empty: false
    };
  }

  function sanitizeSettings(raw) {
    const base = raw && typeof raw === "object" ? raw : {};
    const rawGestures = base.gestures && typeof base.gestures === "object" ? base.gestures : {};

    const gestures = {};
    for (const action of ACTIONS) {
      gestures[action] = normalizeGestureArray(rawGestures[action], DEFAULT_SETTINGS.gestures[action]);
    }

    return {
      gestures,
      gesturePathTemplates: sanitizeGesturePathTemplates(base.gesturePathTemplates),
      minSegmentPx: clampNumber(base.minSegmentPx, 8, 80, DEFAULT_SETTINGS.minSegmentPx),
      pipeWidth: clampNumber(base.pipeWidth, 20, 200, DEFAULT_SETTINGS.pipeWidth),
      inaccuracyDegrees: clampNumber(base.inaccuracyDegrees, 10, 85, DEFAULT_SETTINGS.inaccuracyDegrees),
      trailColor: normalizeHexColor(base.trailColor, DEFAULT_SETTINGS.trailColor),
      trailWidth: clampNumber(base.trailWidth, 1, 16, DEFAULT_SETTINGS.trailWidth),
      triggerMouseButton: normalizeChoice(
        base.triggerMouseButton,
        VALID_MOUSE_BUTTONS,
        DEFAULT_SETTINGS.triggerMouseButton
      ),
      triggerModifier: normalizeChoice(
        base.triggerModifier,
        VALID_MODIFIERS,
        DEFAULT_SETTINGS.triggerModifier
      ),
      rockerMiddleLeftAction: normalizeChoice(
        base.rockerMiddleLeftAction,
        ROCKER_ASSIGNABLE_ACTIONS,
        DEFAULT_SETTINGS.rockerMiddleLeftAction
      ),
      rockerMiddleRightAction: normalizeChoice(
        base.rockerMiddleRightAction,
        ROCKER_ASSIGNABLE_ACTIONS,
        DEFAULT_SETTINGS.rockerMiddleRightAction
      ),
      showDebugLogWindow: normalizeBoolean(
        base.showDebugLogWindow,
        DEFAULT_SETTINGS.showDebugLogWindow
      )
    };
  }

  DEFAULT_SETTINGS.gesturePathTemplates = defaultGesturePathTemplates();

  // --- Unified pipe-based gesture recognition ---

  function pipeScaleBase(settings) {
    return Math.max(40, settings.minSegmentPx * 3.0);
  }

  function buildPipeCenterline(action, settings, startPoint, scaleFactor) {
    const s = Math.max(1, scaleFactor || 1);
    const template = settings.gesturePathTemplates && settings.gesturePathTemplates[action];
    const tokens = settings.gestures[action] || [];
    if (template && Array.isArray(template) && template.length === PATH_TEMPLATE_SAMPLES) {
      const t0 = template[0];
      if (Array.isArray(t0) && t0.length === 2) {
        let maxExtent = 0;
        for (const p of template) {
          if (!Array.isArray(p) || p.length !== 2) continue;
          maxExtent = Math.max(maxExtent, Math.abs(p[0] - t0[0]), Math.abs(p[1] - t0[1]));
        }
        maxExtent = Math.max(maxExtent, 0.3);
        const scale = pipeScaleBase(settings) * s / maxExtent;
        const pts = [];
        for (const p of template) {
          if (!Array.isArray(p) || p.length !== 2) continue;
          pts.push({
            x: startPoint.x + (p[0] - t0[0]) * scale,
            y: startPoint.y + (p[1] - t0[1]) * scale
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

  /**
   * Find the closest point on `polyline` to `point`, optionally ignoring
   * the polyline before `minArcLength` (used for forward-progress enforcement).
   * For overlapping segments (e.g. D→U hairpin), the earlier segment wins at
   * equal distance; the later segment takes over once the minArcLength constraint
   * pushes the earlier segment's clamped projection further from the mouse.
   */
  function pointToPolylineInfo(point, polyline, minArcLength) {
    if (!polyline || polyline.length < 2 || !point) {
      return { distance: Infinity, progress: 0, arcLength: 0 };
    }
    const minArc = minArcLength > 0 ? minArcLength : 0;
    let bestDist2 = Infinity;
    let bestArc = 0;
    let totalArc = 0;
    for (let i = 0; i < polyline.length - 1; i += 1) {
      const a = polyline[i];
      const b = polyline[i + 1];
      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const segLen = Math.hypot(vx, vy);
      if (segLen < 1e-6) continue;
      const segEnd = totalArc + segLen;
      if (segEnd < minArc) {
        totalArc = segEnd;
        continue;
      }
      const wx = point.x - a.x;
      const wy = point.y - a.y;
      let t = (wx * vx + wy * vy) / (segLen * segLen);
      if (t < 0) t = 0;
      if (t > 1) t = 1;
      if (totalArc + segLen * t < minArc) {
        t = Math.min(1, (minArc - totalArc) / segLen);
      }
      const px = a.x + vx * t;
      const py = a.y + vy * t;
      const dx = point.x - px;
      const dy = point.y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist2) {
        bestDist2 = d2;
        bestArc = totalArc + segLen * t;
      }
      totalArc = segEnd;
    }
    const progress = totalArc > 1e-6 ? bestArc / totalArc : 0;
    return {
      distance: Math.sqrt(bestDist2),
      progress: Math.max(0, Math.min(1, progress)),
      arcLength: bestArc
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
      const centerline = buildPipeCenterline(action, settings, startPoint, scaleFactor);
      if (!centerline) continue;
      pipes.push({ action, centerline, progress: 0, arcLength: 0, eliminated: false });
    }
    const radius = computePipeRadius(scaleFactor, settings);
    return {
      pipes,
      radius,
      startPoint: { x: startPoint.x, y: startPoint.y },
      scaleFactor,
      allEliminated: pipes.length === 0
    };
  }

  /**
   * Per-move update: rebuild geometry if scale changed, then test containment.
   * Once a pipe is eliminated it stays eliminated.
   */
  function advancePipeMatchState(prevState, mousePoint, scaleFactor, settings) {
    if (!prevState || prevState.allEliminated) return prevState;
    let pipes = prevState.pipes;
    let radius = prevState.radius;
    const scaleChanged = Math.abs(scaleFactor - prevState.scaleFactor) >= 0.01;
    if (scaleChanged) {
      radius = computePipeRadius(scaleFactor, settings);
      pipes = pipes.map((pipe) => {
        if (pipe.eliminated) return pipe;
        const centerline = buildPipeCenterline(pipe.action, settings, prevState.startPoint, scaleFactor);
        return centerline ? { ...pipe, centerline } : { ...pipe, eliminated: true };
      });
    }
    const regressionWindow = radius * 2;
    const updated = pipes.map((pipe) => {
      if (pipe.eliminated) return pipe;
      const minArc = Math.max(0, (pipe.arcLength || 0) - regressionWindow);
      const info = pointToPolylineInfo(mousePoint, pipe.centerline, minArc);
      if (info.distance > radius) {
        return { ...pipe, eliminated: true };
      }
      return {
        ...pipe,
        progress: Math.max(pipe.progress, info.progress),
        arcLength: Math.max(pipe.arcLength || 0, info.arcLength)
      };
    });
    const surviving = updated.filter((p) => !p.eliminated);
    return {
      pipes: updated,
      radius,
      startPoint: prevState.startPoint,
      scaleFactor,
      allEliminated: surviving.length === 0
    };
  }

  /** At release, pick the surviving pipe with the best progress. */
  function resolvePipeAction(state, minProgressFraction) {
    if (!state || state.allEliminated) return null;
    const minProg = minProgressFraction != null ? minProgressFraction : 0.3;
    const surviving = state.pipes.filter((p) => !p.eliminated);
    if (!surviving.length) return null;
    surviving.sort((a, b) => {
      if (Math.abs(a.progress - b.progress) > 0.01) return b.progress - a.progress;
      return ACTIONS.indexOf(a.action) - ACTIONS.indexOf(b.action);
    });
    const best = surviving[0];
    if (best.progress < minProg) return null;
    return best.action;
  }

  function survivingPipeActions(state) {
    if (!state) return [];
    return state.pipes.filter((p) => !p.eliminated).map((p) => p.action);
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
    gesturePathTemplateToSvgViewSpec,
    gesturePreviewArrowSpecFromTokens,
    gesturePreviewArrowSpecFromTemplate,
    parseGestureInput,
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
    gestureTokensToSvgViewSpec,
    sanitizeGesturePathTemplates,
    pipeScaleBase,
    buildPipeCenterline,
    computePipeRadius,
    pointToPolylineInfo,
    createPipeMatchState,
    advancePipeMatchState,
    resolvePipeAction,
    survivingPipeActions
  };
})();
