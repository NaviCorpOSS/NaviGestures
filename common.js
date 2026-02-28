(() => {
  const VALID_DIRECTIONS = ["U", "D", "L", "R", "UL", "UR", "DL", "DR"];
  const ACTIONS = ["reload", "closeTab", "forward", "back", "newTab"];
  const VALID_MOUSE_BUTTONS = ["right", "middle"];
  const VALID_MODIFIERS = ["unset", "alt", "shift", "ctrl"];
  const ACTION_LABELS = {
    reload: "Reload page",
    closeTab: "Close tab",
    forward: "Go forward",
    back: "Go back",
    newTab: "Open new tab"
  };

  const DEFAULT_SETTINGS = {
    gestures: {
      reload: ["D", "U"],
      closeTab: ["D", "R"],
      forward: ["R"],
      back: ["L"],
      newTab: ["UR"]
    },
    minSegmentPx: 18,
    inaccuracyDegrees: 50,
    trailColor: "#24a1ff",
    trailWidth: 3,
    triggerMouseButton: "right",
    triggerModifier: "unset"
  };

  function clampNumber(value, min, max, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, Math.round(num)));
  }

  function normalizeGestureArray(input, fallbackArray) {
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
    return validChoices.includes(normalized) ? normalized : fallbackValue;
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
      )
    };
  }

  globalThis.N3TGestureCommon = {
    VALID_DIRECTIONS,
    ACTIONS,
    ACTION_LABELS,
    VALID_MOUSE_BUTTONS,
    VALID_MODIFIERS,
    DEFAULT_SETTINGS,
    parseGestureInput,
    normalizeHexColor,
    sanitizeSettings
  };
})();
