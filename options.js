(() => {
  const api = typeof browser !== "undefined" ? browser : chrome;
  const isBrowserApi = typeof browser !== "undefined";
  const common = globalThis.NaviGesturesCommon;

  const form = document.getElementById("settingsForm");
  const gestureRows = document.getElementById("gestureRows");
  const minSegmentPxInput = document.getElementById("minSegmentPx");
  const pipeWidthInput = document.getElementById("pipeWidth");
  const inaccuracyDegreesInput = document.getElementById("inaccuracyDegrees");
  const trailColorPickerInput = document.getElementById("trailColorPicker");
  const trailColorHexInput = document.getElementById("trailColorHex");
  const trailOpacityInput = document.getElementById("trailOpacity");
  const trailOpacityValueEl = document.getElementById("trailOpacityValue");
  const trailWidthInput = document.getElementById("trailWidth");
  const hintBackgroundPickerInput = document.getElementById(
    "hintBackgroundPicker",
  );
  const hintBackgroundHexInput = document.getElementById("hintBackgroundHex");
  const hintBackgroundOpacityInput = document.getElementById(
    "hintBackgroundOpacity",
  );
  const hintBackgroundOpacityValueEl = document.getElementById(
    "hintBackgroundOpacityValue",
  );
  const hintBorderPickerInput = document.getElementById("hintBorderPicker");
  const hintBorderHexInput = document.getElementById("hintBorderHex");
  const hintBorderOpacityInput = document.getElementById("hintBorderOpacity");
  const hintBorderOpacityValueEl = document.getElementById(
    "hintBorderOpacityValue",
  );
  const hintBorderMatchedPickerInput = document.getElementById(
    "hintBorderMatchedPicker",
  );
  const hintBorderMatchedHexInput = document.getElementById(
    "hintBorderMatchedHex",
  );
  const hintBorderMatchedOpacityInput = document.getElementById(
    "hintBorderMatchedOpacity",
  );
  const hintBorderMatchedOpacityValueEl = document.getElementById(
    "hintBorderMatchedOpacityValue",
  );
  const triggerMouseButtonInput = document.getElementById("triggerMouseButton");
  const triggerModifierInput = document.getElementById("triggerModifier");
  const rockerMiddleLeftActionInput = document.getElementById(
    "rockerMiddleLeftAction",
  );
  const rockerMiddleRightActionInput = document.getElementById(
    "rockerMiddleRightAction",
  );
  const rockerLrLeftActionInput = document.getElementById("rockerLrLeftAction");
  const rockerLrRightActionInput = document.getElementById("rockerLrRightAction");
  const trainingModeInput = document.getElementById("trainingMode");
  const showDebugLogWindowInput = document.getElementById("showDebugLogWindow");
  const resetBtn = document.getElementById("resetBtn");
  const statusEl = document.getElementById("status");
  const teachModal = document.getElementById("teachModal");
  const teachCanvas = document.getElementById("teachCanvas");
  const teachPreview = document.getElementById("teachPreview");
  const teachSave = document.getElementById("teachSave");
  const teachCancel = document.getElementById("teachCancel");
  const teachRestoreDefault = document.getElementById("teachRestoreDefault");
  const teachModalTitle = document.getElementById("teachModalTitle");
  const teachCtx = teachCanvas.getContext("2d");

  const PREVIEW_DISPLAY_PX = 264;
  const TARGET_LINE_PX = 2.1;
  const TARGET_CIRCLE_R_PX = 9;
  const TARGET_CIRCLE_STROKE_PX = 2.1;
  const TARGET_ARROW_LEN_PX = 18;
  const TARGET_ARROW_HALF_PX = 7;
  const TARGET_ARROW_EDGE_PX = 1.25;

  let teachRecording = false;
  let teachPoints = [];
  let teachCurrentAction = null;
  let teachLastStroke = { template: null };
  let gesturePathTemplatesState = common.defaultGesturePathTemplates();
  let gestureTokensState = {};

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

  function storageSet(value) {
    if (isBrowserApi) {
      return api.storage.local.set(value);
    }

    return new Promise((resolve, reject) => {
      try {
        api.storage.local.set(value, () => {
          const err = api.runtime && api.runtime.lastError;
          if (err) {
            reject(new Error(err.message));
            return;
          }
          resolve();
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  function setStatus(text, isError = false) {
    statusEl.textContent = text;
    statusEl.classList.toggle("err", !!isError);
  }

  function formatOpacityPercent(opacity) {
    return `${opacity}%`;
  }

  function syncColorWithOpacityInputs(
    pickerInput,
    hexInput,
    opacityInput,
    opacityValueEl,
    rawColor,
    rawOpacity,
    fallbackColor,
    fallbackOpacity,
  ) {
    const color = common.normalizeHexColor(rawColor, fallbackColor);
    const opacity = common.normalizeOpacityPercent(
      rawOpacity,
      fallbackOpacity,
    );
    pickerInput.value = color;
    hexInput.value = color;
    opacityInput.value = String(opacity);
    if (opacityValueEl) {
      opacityValueEl.textContent = formatOpacityPercent(opacity);
    }
  }

  function bindColorWithOpacityInputs(
    pickerInput,
    hexInput,
    opacityInput,
    opacityValueEl,
    fallbackColor,
    fallbackOpacity,
  ) {
    pickerInput.addEventListener("input", () => {
      syncColorWithOpacityInputs(
        pickerInput,
        hexInput,
        opacityInput,
        opacityValueEl,
        pickerInput.value,
        opacityInput.value,
        fallbackColor,
        fallbackOpacity,
      );
    });

    hexInput.addEventListener("input", () => {
      const normalized = common.normalizeHexColor(
        hexInput.value,
        fallbackColor,
      );
      if (normalized !== hexInput.value.toLowerCase()) return;
      pickerInput.value = normalized;
    });

    hexInput.addEventListener("blur", () => {
      syncColorWithOpacityInputs(
        pickerInput,
        hexInput,
        opacityInput,
        opacityValueEl,
        hexInput.value,
        opacityInput.value,
        fallbackColor,
        fallbackOpacity,
      );
    });

    opacityInput.addEventListener("input", () => {
      const opacity = common.normalizeOpacityPercent(
        opacityInput.value,
        fallbackOpacity,
      );
      opacityInput.value = String(opacity);
      if (opacityValueEl) {
        opacityValueEl.textContent = formatOpacityPercent(opacity);
      }
    });
  }

  function getMinSegmentPxFromForm() {
    const m = Number(minSegmentPxInput.value);
    if (!Number.isFinite(m)) return common.DEFAULT_SETTINGS.minSegmentPx;
    return Math.min(80, Math.max(8, Math.round(m)));
  }

  function clearTeachCanvas() {
    const w = teachCanvas.width;
    const h = teachCanvas.height;
    teachCtx.clearRect(0, 0, w, h);
    teachCtx.strokeStyle = "#31d0ff";
    teachCtx.lineWidth = 2;
    teachCtx.lineCap = "round";
    teachCtx.lineJoin = "round";
  }

  function clientToCanvas(clientX, clientY) {
    const r = teachCanvas.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * teachCanvas.width;
    const y = ((clientY - r.top) / r.height) * teachCanvas.height;
    return { x, y };
  }

  function redrawTeachStroke() {
    clearTeachCanvas();
    if (teachPoints.length < 2) return;
    teachCtx.beginPath();
    const p0 = clientToCanvas(teachPoints[0].x, teachPoints[0].y);
    teachCtx.moveTo(p0.x, p0.y);
    for (let i = 1; i < teachPoints.length; i += 1) {
      const p = clientToCanvas(teachPoints[i].x, teachPoints[i].y);
      teachCtx.lineTo(p.x, p.y);
    }
    teachCtx.stroke();
  }

  function closeTeachModal() {
    teachModal.setAttribute("hidden", "");
    teachCurrentAction = null;
    teachRecording = false;
    teachPoints = [];
  }

  function parseViewBoxSize(viewBoxStr) {
    const p = String(viewBoxStr || "")
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (p.length < 4 || p.some((x) => !Number.isFinite(x))) {
      return { vbW: 24, vbH: 24 };
    }
    return { vbW: p[2], vbH: p[3] };
  }

  function pxThicknessToUserUnits(px, displayPx, vbW, vbH) {
    const pxPerU = Math.min(displayPx / vbW, displayPx / vbH);
    return px / pxPerU;
  }

  function appendGestureArrowHead(
    ns,
    svg,
    x1,
    y1,
    x2,
    y2,
    arrowLenU,
    halfU,
    edgeU,
  ) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dlen = Math.hypot(dx, dy);
    if (dlen < 1e-6) return;
    const ux = dx / dlen;
    const uy = dy / dlen;
    const px = -uy;
    const py = ux;
    const tipX = x2;
    const tipY = y2;
    const bx = x2 - ux * arrowLenU;
    const by = y2 - uy * arrowLenU;
    const poly = document.createElementNS(ns, "polygon");
    poly.setAttribute(
      "points",
      `${tipX},${tipY} ${bx + px * halfU},${by + py * halfU} ${bx - px * halfU},${by - py * halfU}`,
    );
    poly.setAttribute("fill", "#31d0ff");
    poly.setAttribute("stroke", "#070a12");
    poly.setAttribute("stroke-width", String(edgeU));
    poly.setAttribute("stroke-linejoin", "round");
    poly.setAttribute("class", "gesture-arrowhead");
    svg.appendChild(poly);
  }

  function applyGesturePreviewSvg(svg, spec) {
    const ns = "http://www.w3.org/2000/svg";
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    svg.setAttribute("viewBox", spec.viewBox);
    svg.classList.toggle("gesture-preview-empty", !!spec.empty);

    const { vbW, vbH } = parseViewBoxSize(spec.viewBox);
    const D = PREVIEW_DISPLAY_PX;
    const lineU = pxThicknessToUserUnits(TARGET_LINE_PX, D, vbW, vbH);
    const circleRU = pxThicknessToUserUnits(TARGET_CIRCLE_R_PX, D, vbW, vbH);
    const circleSU = pxThicknessToUserUnits(
      TARGET_CIRCLE_STROKE_PX,
      D,
      vbW,
      vbH,
    );
    const arrowLenU = pxThicknessToUserUnits(TARGET_ARROW_LEN_PX, D, vbW, vbH);
    const arrowHalfU = pxThicknessToUserUnits(
      TARGET_ARROW_HALF_PX,
      D,
      vbW,
      vbH,
    );
    const arrowEdgeU = pxThicknessToUserUnits(
      TARGET_ARROW_EDGE_PX,
      D,
      vbW,
      vbH,
    );

    const pathBg = document.createElementNS(ns, "path");
    pathBg.setAttribute("class", "gesture-path");
    pathBg.setAttribute("d", spec.strokeD);
    pathBg.setAttribute("fill", "none");
    pathBg.setAttribute("stroke", "#31d0ff");
    pathBg.setAttribute("stroke-width", String(lineU));
    pathBg.setAttribute("stroke-linecap", "round");
    pathBg.setAttribute("stroke-linejoin", "round");
    svg.appendChild(pathBg);

    if (!spec.empty && spec.start) {
      const c = document.createElementNS(ns, "circle");
      c.setAttribute("class", "gesture-start");
      c.setAttribute("cx", String(spec.start.cx));
      c.setAttribute("cy", String(spec.start.cy));
      c.setAttribute("r", String(circleRU));
      c.setAttribute("fill", "none");
      c.setAttribute("stroke", "#31d0ff");
      c.setAttribute("stroke-width", String(circleSU));
      svg.appendChild(c);
    }

    if (!spec.empty && spec.arrowSegments) {
      for (const seg of spec.arrowSegments) {
        appendGestureArrowHead(
          ns,
          svg,
          seg.x1,
          seg.y1,
          seg.x2,
          seg.y2,
          arrowLenU,
          arrowHalfU,
          arrowEdgeU,
        );
      }
    }
  }

  function updateGestureRowPreview(action) {
    const svg = document.getElementById(`gesture-svg-${action}`);
    if (!svg) return;
    const tmpl = gesturePathTemplatesState[action];
    const spec =
      tmpl && tmpl.length
        ? common.gesturePreviewArrowSpecFromTemplate(tmpl)
        : common.gesturePreviewArrowSpecFromTokens(
            gestureTokensState[action] || [],
          );
    applyGesturePreviewSvg(svg, spec);
  }

  function openTeachModal(action) {
    teachCurrentAction = action;
    teachModalTitle.textContent = `Edit: ${common.ACTION_LABELS[action]}`;
    teachModal.removeAttribute("hidden");
    teachPoints = [];
    teachLastStroke = { template: null };
    teachSave.disabled = true;
    teachPreview.textContent = "";
    teachRecording = false;
    clearTeachCanvas();
  }

  function buildGestureRows() {
    gestureRows.innerHTML = "";
    for (const action of common.ACTIONS) {
      const row = document.createElement("div");
      row.className = "row";

      const label = document.createElement("label");
      label.textContent = common.ACTION_LABELS[action];

      const wrap = document.createElement("div");
      wrap.className = "gesture-input-wrap";

      const hit = document.createElement("button");
      hit.type = "button";
      hit.className = "gesture-preview-btn";
      hit.setAttribute(
        "aria-label",
        `Edit gesture for ${common.ACTION_LABELS[action]} — click to teach or restore default`,
      );

      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "gesture-preview-svg");
      svg.setAttribute("width", "264");
      svg.setAttribute("height", "264");
      svg.setAttribute("aria-hidden", "true");
      svg.id = `gesture-svg-${action}`;

      hit.appendChild(svg);
      hit.addEventListener("click", () => openTeachModal(action));

      wrap.appendChild(hit);
      row.appendChild(label);
      row.appendChild(wrap);
      gestureRows.appendChild(row);
    }
  }

  function buildRockerActionOptions(selectEl) {
    selectEl.innerHTML = "";
    for (const action of common.ROCKER_ASSIGNABLE_ACTIONS) {
      const option = document.createElement("option");
      option.value = action;
      option.textContent = common.ACTION_LABELS[action];
      selectEl.appendChild(option);
    }
  }

  function renderSettings(settings) {
    gesturePathTemplatesState = common.sanitizeGesturePathTemplates(
      settings.gesturePathTemplates,
    );
    for (const action of common.ACTIONS) {
      gestureTokensState[action] = [...(settings.gestures[action] || [])];
      updateGestureRowPreview(action);
    }
    minSegmentPxInput.value = String(settings.minSegmentPx);
    pipeWidthInput.value = String(settings.pipeWidth);
    inaccuracyDegreesInput.value = String(settings.inaccuracyDegrees);
    syncColorWithOpacityInputs(
      trailColorPickerInput,
      trailColorHexInput,
      trailOpacityInput,
      trailOpacityValueEl,
      settings.trailColor,
      settings.trailOpacity,
      common.DEFAULT_SETTINGS.trailColor,
      common.DEFAULT_SETTINGS.trailOpacity,
    );
    trailWidthInput.value = String(settings.trailWidth);
    syncColorWithOpacityInputs(
      hintBackgroundPickerInput,
      hintBackgroundHexInput,
      hintBackgroundOpacityInput,
      hintBackgroundOpacityValueEl,
      settings.hintBackgroundColor,
      settings.hintBackgroundOpacity,
      common.DEFAULT_SETTINGS.hintBackgroundColor,
      common.DEFAULT_SETTINGS.hintBackgroundOpacity,
    );
    syncColorWithOpacityInputs(
      hintBorderPickerInput,
      hintBorderHexInput,
      hintBorderOpacityInput,
      hintBorderOpacityValueEl,
      settings.hintBorderColor,
      settings.hintBorderOpacity,
      common.DEFAULT_SETTINGS.hintBorderColor,
      common.DEFAULT_SETTINGS.hintBorderOpacity,
    );
    syncColorWithOpacityInputs(
      hintBorderMatchedPickerInput,
      hintBorderMatchedHexInput,
      hintBorderMatchedOpacityInput,
      hintBorderMatchedOpacityValueEl,
      settings.hintBorderMatchedColor,
      settings.hintBorderMatchedOpacity,
      common.DEFAULT_SETTINGS.hintBorderMatchedColor,
      common.DEFAULT_SETTINGS.hintBorderMatchedOpacity,
    );
    triggerMouseButtonInput.value = settings.triggerMouseButton;
    triggerModifierInput.value = settings.triggerModifier;
    rockerMiddleLeftActionInput.value = settings.rockerMiddleLeftAction;
    rockerMiddleRightActionInput.value = settings.rockerMiddleRightAction;
    rockerLrLeftActionInput.value = settings.rockerLrLeftAction;
    rockerLrRightActionInput.value = settings.rockerLrRightAction;
    trainingModeInput.checked = !!settings.trainingMode;
    showDebugLogWindowInput.checked = !!settings.showDebugLogWindow;
  }

  function collectSettingsFromForm() {
    const gestures = {};
    for (const action of common.ACTIONS) {
      if (
        gesturePathTemplatesState[action] &&
        gesturePathTemplatesState[action].length
      ) {
        gestures[action] = [];
      } else {
        gestures[action] = common.normalizeGestureArray(
          gestureTokensState[action],
          common.DEFAULT_SETTINGS.gestures[action],
        );
      }
    }

    return common.sanitizeSettings({
      gestures,
      gesturePathTemplates: gesturePathTemplatesState,
      minSegmentPx: minSegmentPxInput.value,
      pipeWidth: pipeWidthInput.value,
      inaccuracyDegrees: inaccuracyDegreesInput.value,
      trailColor: trailColorHexInput.value,
      trailOpacity: trailOpacityInput.value,
      trailWidth: trailWidthInput.value,
      hintBackgroundColor: hintBackgroundHexInput.value,
      hintBackgroundOpacity: hintBackgroundOpacityInput.value,
      hintBorderColor: hintBorderHexInput.value,
      hintBorderOpacity: hintBorderOpacityInput.value,
      hintBorderMatchedColor: hintBorderMatchedHexInput.value,
      hintBorderMatchedOpacity: hintBorderMatchedOpacityInput.value,
      triggerMouseButton: triggerMouseButtonInput.value,
      triggerModifier: triggerModifierInput.value,
      rockerMiddleLeftAction: rockerMiddleLeftActionInput.value,
      rockerMiddleRightAction: rockerMiddleRightActionInput.value,
      rockerLrLeftAction: rockerLrLeftActionInput.value,
      rockerLrRightAction: rockerLrRightActionInput.value,
      trainingMode: trainingModeInput.checked,
      showDebugLogWindow: showDebugLogWindowInput.checked,
    });
  }

  async function loadAndRender() {
    const data = await storageGet("settings");
    const settings = common.sanitizeSettings(
      data.settings || common.DEFAULT_SETTINGS,
    );
    renderSettings(settings);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const settings = collectSettingsFromForm();
      await storageSet({ settings });
      setStatus("Saved.");
      renderSettings(settings);
    } catch (_) {
      setStatus("Could not save settings.", true);
    }
  });

  resetBtn.addEventListener("click", async () => {
    try {
      await storageSet({ settings: common.DEFAULT_SETTINGS });
      renderSettings(common.DEFAULT_SETTINGS);
      setStatus("Defaults restored.");
    } catch (_) {
      setStatus("Could not reset settings.", true);
    }
  });

  bindColorWithOpacityInputs(
    trailColorPickerInput,
    trailColorHexInput,
    trailOpacityInput,
    trailOpacityValueEl,
    common.DEFAULT_SETTINGS.trailColor,
    common.DEFAULT_SETTINGS.trailOpacity,
  );
  bindColorWithOpacityInputs(
    hintBackgroundPickerInput,
    hintBackgroundHexInput,
    hintBackgroundOpacityInput,
    hintBackgroundOpacityValueEl,
    common.DEFAULT_SETTINGS.hintBackgroundColor,
    common.DEFAULT_SETTINGS.hintBackgroundOpacity,
  );
  bindColorWithOpacityInputs(
    hintBorderPickerInput,
    hintBorderHexInput,
    hintBorderOpacityInput,
    hintBorderOpacityValueEl,
    common.DEFAULT_SETTINGS.hintBorderColor,
    common.DEFAULT_SETTINGS.hintBorderOpacity,
  );
  bindColorWithOpacityInputs(
    hintBorderMatchedPickerInput,
    hintBorderMatchedHexInput,
    hintBorderMatchedOpacityInput,
    hintBorderMatchedOpacityValueEl,
    common.DEFAULT_SETTINGS.hintBorderMatchedColor,
    common.DEFAULT_SETTINGS.hintBorderMatchedOpacity,
  );

  teachCancel.addEventListener("click", () => closeTeachModal());

  teachRestoreDefault.addEventListener("click", async () => {
    if (!teachCurrentAction) return;
    const a = teachCurrentAction;
    gesturePathTemplatesState[a] = null;
    gestureTokensState[a] = [...(common.DEFAULT_SETTINGS.gestures[a] || [])];
    closeTeachModal();
    updateGestureRowPreview(a);
    try {
      const settings = collectSettingsFromForm();
      await storageSet({ settings });
      setStatus("Gesture restored to default path.");
      renderSettings(settings);
    } catch (_) {
      setStatus("Could not save restored gesture.", true);
    }
  });

  teachSave.addEventListener("click", async () => {
    if (!teachCurrentAction || !teachLastStroke.template) return;
    gesturePathTemplatesState[teachCurrentAction] = teachLastStroke.template;
    gestureTokensState[teachCurrentAction] = [];
    updateGestureRowPreview(teachCurrentAction);
    closeTeachModal();
    try {
      const settings = collectSettingsFromForm();
      await storageSet({ settings });
      setStatus("Gesture saved.");
      renderSettings(settings);
    } catch (_) {
      setStatus(
        "Gesture updated on this page but could not write storage.",
        true,
      );
    }
  });

  teachModal.addEventListener("click", (e) => {
    if (e.target === teachModal) closeTeachModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !teachModal.hasAttribute("hidden")) {
      e.preventDefault();
      closeTeachModal();
    }
  });

  function teachModalIsOpen() {
    return !teachModal.hasAttribute("hidden");
  }

  function suppressMenuOnTeachCanvas(e) {
    if (!teachModalIsOpen()) return;
    e.preventDefault();
    e.stopPropagation();
  }

  teachCanvas.addEventListener("contextmenu", suppressMenuOnTeachCanvas, true);
  teachCanvas.addEventListener(
    "mousedown",
    (e) => {
      if (!teachModalIsOpen() || e.button !== 2) return;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );

  teachCanvas.addEventListener("pointerdown", (e) => {
    if (teachModal.hasAttribute("hidden")) return;
    teachRecording = true;
    teachSave.disabled = true;
    teachPoints = [{ x: e.clientX, y: e.clientY }];
    clearTeachCanvas();
    try {
      teachCanvas.setPointerCapture(e.pointerId);
    } catch (_) {}
    e.preventDefault();
  });

  teachCanvas.addEventListener("pointermove", (e) => {
    if (!teachRecording || teachModal.hasAttribute("hidden")) return;
    teachPoints.push({ x: e.clientX, y: e.clientY });
    redrawTeachStroke();
    teachPreview.textContent =
      teachPoints.length > 2
        ? "Drawing\u2026 release to finish."
        : "Draw a gesture\u2026";
    e.preventDefault();
  });

  function finishTeachStroke(e) {
    if (!teachRecording) return;
    teachRecording = false;
    try {
      if (e.pointerId != null) teachCanvas.releasePointerCapture(e.pointerId);
    } catch (_) {}
    const minPx = Math.max(
      getMinSegmentPxFromForm(),
      common.PATH_MATCH_MIN_STROKE_PX,
    );
    const pts = teachPoints.map((p) => ({ x: p.x, y: p.y }));
    const len = common.polylineLength(pts);
    teachLastStroke = { template: null };
    if (len >= minPx) {
      teachLastStroke.template = common.normalizeStrokeToTemplate(pts);
      teachSave.disabled = false;
      teachPreview.textContent = "Shape ready — click Save gesture.";
    } else {
      teachSave.disabled = true;
      teachPreview.textContent = `Need more movement (total ${Math.round(len)}px, need ${minPx}px).`;
    }
  }

  teachCanvas.addEventListener("pointerup", (e) => {
    finishTeachStroke(e);
    e.preventDefault();
  });

  teachCanvas.addEventListener("pointercancel", (e) => {
    finishTeachStroke(e);
  });

  buildGestureRows();
  buildRockerActionOptions(rockerMiddleLeftActionInput);
  buildRockerActionOptions(rockerMiddleRightActionInput);
  buildRockerActionOptions(rockerLrLeftActionInput);
  buildRockerActionOptions(rockerLrRightActionInput);
  loadAndRender();
})();
