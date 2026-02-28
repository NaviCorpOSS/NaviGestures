(() => {
  const api = typeof browser !== "undefined" ? browser : chrome;
  const isBrowserApi = typeof browser !== "undefined";
  const ZOOM_STEP = 0.1;
  const MIN_ZOOM = 0.3;
  const MAX_ZOOM = 3;

  function runTabAction(method, tabId, extra) {
    if (isBrowserApi) {
      if (typeof extra === "undefined") return api.tabs[method](tabId);
      return api.tabs[method](tabId, extra);
    }

    return new Promise((resolve, reject) => {
      try {
        const done = () => {
          const err = api.runtime && api.runtime.lastError;
          if (err) {
            reject(new Error(err.message));
            return;
          }
          resolve();
        };
        if (typeof extra === "undefined") {
          api.tabs[method](tabId, done);
        } else {
          api.tabs[method](tabId, extra, done);
        }
      } catch (err) {
        reject(err);
      }
    });
  }

  function createTab(url) {
    if (isBrowserApi) return api.tabs.create({ url });

    return new Promise((resolve, reject) => {
      try {
        api.tabs.create({ url }, () => {
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

  function getTabZoom(tabId) {
    if (isBrowserApi) return api.tabs.getZoom(tabId);

    return new Promise((resolve, reject) => {
      try {
        api.tabs.getZoom(tabId, (zoom) => {
          const err = api.runtime && api.runtime.lastError;
          if (err) {
            reject(new Error(err.message));
            return;
          }
          resolve(zoom);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  function setTabZoom(tabId, zoomFactor) {
    if (isBrowserApi) return api.tabs.setZoom(tabId, zoomFactor);

    return new Promise((resolve, reject) => {
      try {
        api.tabs.setZoom(tabId, zoomFactor, () => {
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

  function getWindow(windowId) {
    if (isBrowserApi) return api.windows.get(windowId);

    return new Promise((resolve, reject) => {
      try {
        api.windows.get(windowId, (windowObj) => {
          const err = api.runtime && api.runtime.lastError;
          if (err) {
            reject(new Error(err.message));
            return;
          }
          resolve(windowObj);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  function updateWindow(windowId, updateInfo) {
    if (isBrowserApi) return api.windows.update(windowId, updateInfo);

    return new Promise((resolve, reject) => {
      try {
        api.windows.update(windowId, updateInfo, (windowObj) => {
          const err = api.runtime && api.runtime.lastError;
          if (err) {
            reject(new Error(err.message));
            return;
          }
          resolve(windowObj);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  async function adjustTabZoom(tabId, delta) {
    const current = await getTabZoom(tabId);
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(current) + delta));
    await setTabZoom(tabId, next);
  }

  async function setWindowState(windowId, state) {
    if (!windowId) return;
    await updateWindow(windowId, { state });
  }

  async function toggleWindowFullscreen(windowId) {
    if (!windowId) return;
    const currentWindow = await getWindow(windowId);
    const nextState = currentWindow && currentWindow.state === "fullscreen" ? "normal" : "fullscreen";
    await updateWindow(windowId, { state: nextState });
  }

  async function toggleWindowMaximized(windowId) {
    if (!windowId) return;
    const currentWindow = await getWindow(windowId);
    const nextState = currentWindow && currentWindow.state === "maximized" ? "normal" : "maximized";
    await updateWindow(windowId, { state: nextState });
  }

  async function performAction(action, senderTab) {
    const senderTabId = senderTab ? senderTab.id : null;
    const senderWindowId = senderTab ? senderTab.windowId : null;
    if (!senderTabId && action !== "newTab") return;

    try {
      switch (action) {
        case "reload":
          await runTabAction("reload", senderTabId);
          break;
        case "closeTab":
          await runTabAction("remove", senderTabId);
          break;
        case "forward":
          await runTabAction("goForward", senderTabId);
          break;
        case "back":
          await runTabAction("goBack", senderTabId);
          break;
        case "newTab":
          await createTab("about:blank");
          break;
        case "zoomIn":
          await adjustTabZoom(senderTabId, ZOOM_STEP);
          break;
        case "zoomOut":
          await adjustTabZoom(senderTabId, -ZOOM_STEP);
          break;
        case "toggleMaximizeWindow":
          await toggleWindowMaximized(senderWindowId);
          break;
        case "maximizeWindow":
          await setWindowState(senderWindowId, "maximized");
          break;
        case "minimizeWindow":
          await setWindowState(senderWindowId, "minimized");
          break;
        case "toggleFullscreen":
          await toggleWindowFullscreen(senderWindowId);
          break;
        default:
          break;
      }
    } catch (_) {
      // Ignore errors from restricted pages or unavailable tab history.
    }
  }

  api.runtime.onMessage.addListener((message, sender) => {
    if (!message || message.type !== "navigestures-perform-action") return;
    performAction(message.action, sender && sender.tab ? sender.tab : null);
  });

  const actionApi = api.action || api.browserAction;
  if (!actionApi || !actionApi.onClicked) return;

  actionApi.onClicked.addListener(() => {
    if (isBrowserApi) {
      api.runtime.openOptionsPage().catch(() => {});
      return;
    }

    try {
      api.runtime.openOptionsPage(() => {});
    } catch (_) {
      // Ignore.
    }
  });
})();
