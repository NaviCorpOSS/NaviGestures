(() => {
  const api = typeof browser !== "undefined" ? browser : chrome;
  const isBrowserApi = typeof browser !== "undefined";
  const common = globalThis.N3TGestureCommon;

  const form = document.getElementById("settingsForm");
  const gestureRows = document.getElementById("gestureRows");
  const minSegmentPxInput = document.getElementById("minSegmentPx");
  const inaccuracyDegreesInput = document.getElementById("inaccuracyDegrees");
  const trailColorPickerInput = document.getElementById("trailColorPicker");
  const trailColorHexInput = document.getElementById("trailColorHex");
  const resetBtn = document.getElementById("resetBtn");
  const statusEl = document.getElementById("status");

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
    statusEl.style.color = isError ? "crimson" : "";
  }

  function syncColorInputs(rawColor) {
    const color = common.normalizeHexColor(rawColor, common.DEFAULT_SETTINGS.trailColor);
    trailColorPickerInput.value = color;
    trailColorHexInput.value = color;
  }

  function buildGestureRows() {
    gestureRows.innerHTML = "";
    for (const action of common.ACTIONS) {
      const row = document.createElement("div");
      row.className = "row";

      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "text";
      input.id = `gesture-${action}`;
      input.dataset.action = action;
      input.placeholder = "e.g. D U";

      label.htmlFor = input.id;
      label.textContent = common.ACTION_LABELS[action];

      row.appendChild(label);
      row.appendChild(input);
      gestureRows.appendChild(row);
    }
  }

  function renderSettings(settings) {
    for (const action of common.ACTIONS) {
      const input = document.getElementById(`gesture-${action}`);
      input.value = (settings.gestures[action] || []).join(" ");
    }
    minSegmentPxInput.value = String(settings.minSegmentPx);
    inaccuracyDegreesInput.value = String(settings.inaccuracyDegrees);
    syncColorInputs(settings.trailColor);
  }

  function collectSettingsFromForm() {
    const gestures = {};
    for (const action of common.ACTIONS) {
      const input = document.getElementById(`gesture-${action}`);
      gestures[action] = common.parseGestureInput(
        input.value,
        common.DEFAULT_SETTINGS.gestures[action]
      );
    }

    return common.sanitizeSettings({
      gestures,
      minSegmentPx: minSegmentPxInput.value,
      inaccuracyDegrees: inaccuracyDegreesInput.value,
      trailColor: trailColorHexInput.value
    });
  }

  async function loadAndRender() {
    const data = await storageGet("settings");
    const settings = common.sanitizeSettings(data.settings || common.DEFAULT_SETTINGS);
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

  trailColorPickerInput.addEventListener("input", () => {
    syncColorInputs(trailColorPickerInput.value);
  });

  trailColorHexInput.addEventListener("input", () => {
    const normalized = common.normalizeHexColor(
      trailColorHexInput.value,
      common.DEFAULT_SETTINGS.trailColor
    );
    if (normalized !== trailColorHexInput.value.toLowerCase()) return;
    trailColorPickerInput.value = normalized;
  });

  trailColorHexInput.addEventListener("blur", () => {
    syncColorInputs(trailColorHexInput.value);
  });

  buildGestureRows();
  loadAndRender();
})();
