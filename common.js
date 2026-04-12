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
  const PATH_MATCH_MAX_AVG_DIST = 0.33;
  const PATH_MATCH_MAX_AVG_DIST_HINT = 0.42;
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

  function pathTemplateAvgDistance(a, b) {
    let sum = 0;
    const n = Math.min(a.length, b.length);
    if (!n) return Number.POSITIVE_INFINITY;
    for (let i = 0; i < n; i += 1) {
      const dx = a[i][0] - b[i][0];
      const dy = a[i][1] - b[i][1];
      sum += dx * dx + dy * dy;
    }
    return Math.sqrt(sum / n);
  }

  /** Point-wise distance in normalized template space (no rotation): matches taught start and orientation. */
  function pathTemplateDistanceAligned(cand, tmpl) {
    if (!cand.length || !tmpl.length) return Number.POSITIVE_INFINITY;
    return pathTemplateAvgDistance(cand, tmpl);
  }

  function hasAnyPathTemplate(settings) {
    const t = settings.gesturePathTemplates;
    if (!t || typeof t !== "object") return false;
    return ACTIONS.some((a) => t[a] && Array.isArray(t[a]) && t[a].length === PATH_TEMPLATE_SAMPLES);
  }

  function pathTemplateBestMatch(strokePoints, settings, minPolylineLenPx) {
    const minLen =
      minPolylineLenPx != null ? minPolylineLenPx : PATH_MATCH_MIN_STROKE_PX * 0.45;
    if (!hasAnyPathTemplate(settings) || !strokePoints || strokePoints.length < 6) return null;
    if (polylineLength(strokePoints) < minLen) return null;
    const templates = settings.gesturePathTemplates;
    const cand = normalizeStrokeToTemplate(strokePoints);
    let bestAction = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const action of ACTIONS) {
      const tmpl = templates[action];
      if (!tmpl || tmpl.length !== PATH_TEMPLATE_SAMPLES) continue;
      const d = pathTemplateDistanceAligned(cand, tmpl);
      if (d < bestD) {
        bestD = d;
        bestAction = action;
      }
    }
    if (bestAction == null || !Number.isFinite(bestD)) return null;
    return { bestD, bestAction };
  }

  function matchBestPathTemplate(rawPoints, settings) {
    const templates = settings.gesturePathTemplates;
    if (!templates || !rawPoints || rawPoints.length < 2) return null;
    if (polylineLength(rawPoints) < PATH_MATCH_MIN_STROKE_PX) return null;
    const cand = normalizeStrokeToTemplate(rawPoints);
    let bestAction = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const action of ACTIONS) {
      const tmpl = templates[action];
      if (!tmpl || tmpl.length !== PATH_TEMPLATE_SAMPLES) continue;
      const d = pathTemplateDistanceAligned(cand, tmpl);
      if (d < bestD) {
        bestD = d;
        bestAction = action;
      }
    }
    if (bestAction != null && bestD <= PATH_MATCH_MAX_AVG_DIST) {
      return { action: bestAction, score: bestD };
    }
    return null;
  }

  function pathTemplateAllWithinHint(strokePoints, settings) {
    const minLen = PATH_MATCH_MIN_STROKE_PX * 0.45;
    if (!hasAnyPathTemplate(settings) || !strokePoints || strokePoints.length < 6) return [];
    if (polylineLength(strokePoints) < minLen) return [];
    const cand = normalizeStrokeToTemplate(strokePoints);
    const templates = settings.gesturePathTemplates;
    const out = [];
    for (const action of ACTIONS) {
      const tmpl = templates[action];
      if (!tmpl || tmpl.length !== PATH_TEMPLATE_SAMPLES) continue;
      const d = pathTemplateDistanceAligned(cand, tmpl);
      if (d <= PATH_MATCH_MAX_AVG_DIST_HINT) out.push({ action, d });
    }
    out.sort((a, b) => {
      if (a.d !== b.d) return a.d - b.d;
      return ACTIONS.indexOf(a.action) - ACTIONS.indexOf(b.action);
    });
    return out;
  }

  function anyPathTemplateWithinHintDistance(strokePoints, settings) {
    return pathTemplateAllWithinHint(strokePoints, settings).length > 0;
  }

  function livePathTemplateLabel(strokePoints, settings) {
    const withinHint = pathTemplateAllWithinHint(strokePoints, settings);
    if (!withinHint.length) return "";
    if (withinHint.length === 1) return ACTION_LABELS[withinHint[0].action];
    return "Multiple matches";
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

  function directionsCompatible(observed, expected, inaccuracyDegrees) {
    if (observed === expected) return true;
    const diff = angularDifference(angleForDirection(observed), angleForDirection(expected));
    return diff <= inaccuracyDegrees;
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

  function strokeToGesturePath(points, minSegmentPx) {
    if (!points.length) return { path: [], totalDistance: 0 };
    const path = [];
    const state = createGestureAnchorState(points[0].x, points[0].y);
    let totalDistance = 0;
    for (let i = 1; i < points.length; i += 1) {
      const { stepDist } = processGestureMove(state, points[i].x, points[i].y, minSegmentPx, path);
      totalDistance += stepDist;
    }
    return { path, totalDistance };
  }

  const PREFIX_LOOSE_TOLERANCE_DEG = 85;

  function pathCanStillMatchAnyAction(observedPath, settings, toleranceOverride) {
    const tol =
      toleranceOverride !== undefined ? toleranceOverride : settings.inaccuracyDegrees;
    for (const action of ACTIONS) {
      const expected = settings.gestures[action] || [];
      if (expected.length < observedPath.length) continue;
      let allCompatible = true;
      for (let i = 0; i < observedPath.length; i += 1) {
        if (!directionsCompatible(observedPath[i], expected[i], tol)) {
          allCompatible = false;
          break;
        }
      }
      if (allCompatible) return true;
    }
    return false;
  }

  function directionSequenceFromTemplate(tmpl) {
    if (!tmpl || tmpl.length < 2) return [];
    const seq = [];
    for (let i = 0; i < tmpl.length - 1; i += 1) {
      const dx = tmpl[i + 1][0] - tmpl[i][0];
      const dy = tmpl[i + 1][1] - tmpl[i][1];
      if (dx * dx + dy * dy < 1e-10) continue;
      const d = vectorToDirection(dx, dy);
      if (!seq.length || seq[seq.length - 1] !== d) seq.push(d);
    }
    return seq;
  }

  /** True if taught polyline is closed in normalized space (circle / loop). */
  function isTemplateClosedLoop(tmpl) {
    if (!tmpl || tmpl.length < 3) return false;
    const a = tmpl[0];
    const b = tmpl[tmpl.length - 1];
    return Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.14;
  }

  /** Chord directions around the full loop, including edge last→first (needed for phase-agnostic prefix checks). */
  function directionSequenceFromTemplateClosedLoop(tmpl) {
    const n = tmpl.length;
    if (n < 2) return [];
    const seq = [];
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      const dx = tmpl[j][0] - tmpl[i][0];
      const dy = tmpl[j][1] - tmpl[i][1];
      if (dx * dx + dy * dy < 1e-12) continue;
      const d = vectorToDirection(dx, dy);
      if (!seq.length || seq[seq.length - 1] !== d) seq.push(d);
    }
    return seq;
  }

  function templateDirectionSequenceForPrefixMatch(tmpl) {
    if (!tmpl || tmpl.length < 2) return [];
    return isTemplateClosedLoop(tmpl)
      ? directionSequenceFromTemplateClosedLoop(tmpl)
      : directionSequenceFromTemplate(tmpl);
  }

  /** Prefix must match template from index 0 (open strokes / same start phase as taught). */
  function pathPrefixMatchesTemplateDirs(observedDirs, templateDirs, tol) {
    if (!observedDirs.length) return true;
    if (!templateDirs.length) return false;
    const lim = Math.min(observedDirs.length, templateDirs.length);
    for (let i = 0; i < lim; i += 1) {
      if (!directionsCompatible(observedDirs[i], templateDirs[i], tol)) return false;
    }
    return true;
  }

  /** Closed templates: observed prefix may start at any phase on the loop. */
  function pathPrefixMatchesTemplateDirsCyclic(observedDirs, templateDirs, tol) {
    if (!observedDirs.length) return true;
    if (!templateDirs.length) return false;
    const m = templateDirs.length;
    for (let o = 0; o < m; o += 1) {
      let ok = true;
      for (let i = 0; i < observedDirs.length; i += 1) {
        if (!directionsCompatible(observedDirs[i], templateDirs[(o + i) % m], tol)) {
          ok = false;
          break;
        }
      }
      if (ok) return true;
    }
    return false;
  }

  /**
   * Live stroke directions include extra diagonals between template chords (L→DL→D vs template L→D).
   * Walk the template in order (periodic if closed): each step either matches the current observed
   * segment (advance both) or skips a template chord (advance template only). If all observed
   * segments are consumed, the stroke is still consistent with that template.
   */
  function greedyTemplateWalkMatchesObserved(observedDirs, templateDirs, tol, closedLoop) {
    if (!observedDirs.length) return true;
    if (!templateDirs.length) return false;
    const m = templateDirs.length;
    const maxT = closedLoop ? m * (observedDirs.length + 8) : m + m * observedDirs.length;
    if (closedLoop) {
      for (let o = 0; o < m; o += 1) {
        let t = 0;
        let j = 0;
        while (j < observedDirs.length && t < maxT) {
          const td = templateDirs[(o + t) % m];
          if (directionsCompatible(observedDirs[j], td, tol)) j += 1;
          t += 1;
        }
        if (j === observedDirs.length) return true;
      }
      return false;
    }
    let t = 0;
    let j = 0;
    while (j < observedDirs.length && t < maxT) {
      if (t >= m) return false;
      const td = templateDirs[t];
      if (directionsCompatible(observedDirs[j], td, tol)) j += 1;
      t += 1;
    }
    return j === observedDirs.length;
  }

  function pathPrefixMatchesTemplateForTmpl(observedDirs, tmpl, tol) {
    const dirs = templateDirectionSequenceForPrefixMatch(tmpl);
    if (!dirs.length) return false;
    const closed = isTemplateClosedLoop(tmpl);
    if (closed) {
      if (pathPrefixMatchesTemplateDirsCyclic(observedDirs, dirs, tol)) return true;
    } else if (pathPrefixMatchesTemplateDirs(observedDirs, dirs, tol)) {
      return true;
    }
    return greedyTemplateWalkMatchesObserved(observedDirs, dirs, tol, closed);
  }

  function anyPathTemplatePrefixStillMatches(observedDirs, settings, tol) {
    const templates = settings.gesturePathTemplates;
    if (!templates) return false;
    for (const action of ACTIONS) {
      const tmpl = templates[action];
      if (!tmpl || tmpl.length !== PATH_TEMPLATE_SAMPLES) continue;
      if (pathPrefixMatchesTemplateForTmpl(observedDirs, tmpl, tol)) return true;
    }
    return false;
  }

  function anyConfiguredGestureStillPossible(observedPath, settings, strokePoints) {
    if (pathCanStillMatchAnyAction(observedPath, settings, settings.inaccuracyDegrees)) {
      return true;
    }
    if (pathCanStillMatchAnyAction(observedPath, settings, PREFIX_LOOSE_TOLERANCE_DEG)) {
      return true;
    }
    if (!hasAnyPathTemplate(settings)) return false;
    if (anyPathTemplatePrefixStillMatches(observedPath, settings, settings.inaccuracyDegrees)) {
      return true;
    }
    if (anyPathTemplatePrefixStillMatches(observedPath, settings, PREFIX_LOOSE_TOLERANCE_DEG)) {
      return true;
    }
    if (strokePoints && strokePoints.length >= 2 && anyPathTemplateWithinHintDistance(strokePoints, settings)) {
      return true;
    }
    return false;
  }

  function livePathTemplateHintDisplay(observedPath, strokePoints, settings) {
    if (!hasAnyPathTemplate(settings) || !strokePoints || strokePoints.length < 2) {
      return "";
    }
    const withinHint = pathTemplateAllWithinHint(strokePoints, settings);
    if (withinHint.length >= 2) return "Multiple matches";
    if (withinHint.length === 1) return ACTION_LABELS[withinHint[0].action];

    const strict = settings.inaccuracyDegrees;
    const loose = PREFIX_LOOSE_TOLERANCE_DEG;
    const templates = settings.gesturePathTemplates;
    const viable = [];
    for (const action of ACTIONS) {
      const tmpl = templates[action];
      if (!tmpl || tmpl.length !== PATH_TEMPLATE_SAMPLES) continue;
      if (
        pathPrefixMatchesTemplateForTmpl(observedPath, tmpl, strict) ||
        pathPrefixMatchesTemplateForTmpl(observedPath, tmpl, loose)
      ) {
        viable.push(action);
      }
    }
    if (viable.length >= 2) return "Multiple matches";
    if (viable.length === 1) return ACTION_LABELS[viable[0]];
    return "";
  }

  function detectExactAction(observedPath, settings) {
    const tol = settings.inaccuracyDegrees;
    let bestAction = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const action of ACTIONS) {
      const expected = settings.gestures[action] || [];
      if (expected.length !== observedPath.length) continue;
      let allCompatible = true;
      let score = 0;
      for (let i = 0; i < observedPath.length; i += 1) {
        const observed = observedPath[i];
        const wanted = expected[i];
        const diff = angularDifference(angleForDirection(observed), angleForDirection(wanted));
        if (diff > tol) {
          allCompatible = false;
          break;
        }
        score += diff;
      }
      if (allCompatible && score < bestScore) {
        bestScore = score;
        bestAction = action;
      }
    }
    return bestAction;
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

  function prefixMatchScore(observedPath, expected, inaccuracyDegrees) {
    if (expected.length < observedPath.length) return null;
    let score = 0;
    for (let i = 0; i < observedPath.length; i += 1) {
      if (!directionsCompatible(observedPath[i], expected[i], inaccuracyDegrees)) return null;
      score += angularDifference(
        angleForDirection(observedPath[i]),
        angleForDirection(expected[i])
      );
    }
    return score;
  }

  function liveGestureLabel(observedPath, settings) {
    if (!observedPath.length) return "";
    const tol = settings.inaccuracyDegrees;
    const candidates = [];
    for (const action of ACTIONS) {
      const expected = settings.gestures[action] || [];
      const sc = prefixMatchScore(observedPath, expected, tol);
      if (sc !== null) candidates.push({ action, score: sc });
    }
    if (!candidates.length) {
      for (const action of ACTIONS) {
        const expected = settings.gestures[action] || [];
        const sc = prefixMatchScore(observedPath, expected, PREFIX_LOOSE_TOLERANCE_DEG);
        if (sc !== null) candidates.push({ action, score: sc });
      }
    }
    if (!candidates.length) return "\u2014";
    if (candidates.length === 1) return ACTION_LABELS[candidates[0].action];
    candidates.sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return ACTIONS.indexOf(a.action) - ACTIONS.indexOf(b.action);
    });
    const best = candidates[0].score;
    const tied = candidates.filter((c) => c.score === best);
    if (tied.length === 1) return ACTION_LABELS[tied[0].action];
    return "Multiple matches";
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
    PATH_MATCH_MAX_AVG_DIST,
    PATH_MATCH_MAX_AVG_DIST_HINT,
    defaultGesturePathTemplates,
    polylineLength,
    normalizeStrokeToTemplate,
    hasAnyPathTemplate,
    pathTemplateBestMatch,
    matchBestPathTemplate,
    pathTemplateAllWithinHint,
    livePathTemplateHintDisplay,
    livePathTemplateLabel,
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
    directionsCompatible,
    pathCanStillMatchAnyAction,
    anyConfiguredGestureStillPossible,
    PREFIX_LOOSE_TOLERANCE_DEG,
    detectExactAction,
    liveGestureLabel,
    strokeToGesturePath,
    gestureTokensToSvgViewSpec,
    sanitizeGesturePathTemplates
  };
})();
