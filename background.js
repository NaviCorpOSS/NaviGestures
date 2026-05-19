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

  function getAllFramesInTab(tabId) {
    const nav = api.webNavigation;
    if (!nav || typeof nav.getAllFrames !== "function") {
      return Promise.resolve(null);
    }
    if (isBrowserApi) {
      return nav.getAllFrames({ tabId }).catch(() => null);
    }
    return new Promise((resolve) => {
      try {
        nav.getAllFrames({ tabId }, (frames) => {
          const err = api.runtime && api.runtime.lastError;
          resolve(err ? null : frames);
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  function sendTabMessageToFrame(tabId, message, frameId) {
    let p = null;
    try {
      p = api.tabs.sendMessage(tabId, message, { frameId });
    } catch (_) {
      /* ignore */
    }
    if (p && typeof p.catch === "function") p.catch(() => {});
  }

  function broadcastTabMessageToAllFrames(tabId, message) {
    void getAllFramesInTab(tabId).then((frames) => {
      if (!Array.isArray(frames) || frames.length === 0) {
        sendTabMessageToFrame(tabId, message, 0);
        return;
      }
      const seen = new Set();
      for (const frame of frames) {
        if (!frame || typeof frame.frameId !== "number") continue;
        if (seen.has(frame.frameId)) continue;
        seen.add(frame.frameId);
        sendTabMessageToFrame(tabId, message, frame.frameId);
      }
    });
  }

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message) return;

    const tabFromSender =
      sender && sender.tab ? sender.tab.id : null;

    if (message.type === "navigestures-pointer-relay") {
      if (tabFromSender == null) return false;
      const relay = {};
      relay.kind = message.kind;
      relay.clientX = message.clientX;
      relay.clientY = message.clientY;
      relay.buttons = message.buttons;
      relay.button = message.button;
      relay.altKey = message.altKey;
      relay.shiftKey = message.shiftKey;
      relay.ctrlKey = message.ctrlKey;
      relay.metaKey = message.metaKey;
      relay.deltaX = message.deltaX;
      relay.deltaY = message.deltaY;
      relay.deltaMode = message.deltaMode;
      const payload = {
        type: "navigestures-handle-relay",
        relay,
      };
      let p = null;
      try {
        p = api.tabs.sendMessage(tabFromSender, payload, { frameId: 0 });
      } catch (_) {
        /* ignore */
      }
      if (p && typeof p.catch === "function") p.catch(() => {});
      return false;
    }

    if (message.type === "navigestures-broadcast-context-suppress") {
      if (tabFromSender == null) return false;
      broadcastTabMessageToAllFrames(tabFromSender, {
        type: "navigestures-remote-suppress-context",
      });
      return false;
    }

    if (message.type === "navigestures-broadcast-iframe-gesture") {
      if (tabFromSender == null) return false;
      broadcastTabMessageToAllFrames(tabFromSender, {
        type: "navigestures-iframe-gesture-active",
        active: !!message.active,
      });
      return false;
    }

    if (message.type === "navigestures-get-tab-zoom") {
      const tabId = sender && sender.tab && sender.tab.id;
      if (tabId == null) {
        sendResponse({ zoom: 1 });
        return false;
      }
      getTabZoom(tabId)
        .then((z) => sendResponse({ zoom: typeof z === "number" && z > 0 ? z : 1 }))
        .catch(() => sendResponse({ zoom: 1 }));
      return true;
    }
    if (message.type === "navigestures-perform-action") {
      performAction(message.action, sender && sender.tab ? sender.tab : null);
    }
  });

  if (api.tabs && api.tabs.onZoomChange) {
    api.tabs.onZoomChange.addListener((info) => {
      if (!info || info.tabId == null) return;
      const msg = { type: "navigestures-tab-zoom-changed", zoom: info.newZoomFactor };
      const p = api.tabs.sendMessage(info.tabId, msg);
      if (p && typeof p.catch === "function") p.catch(() => {});
    });
  }

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
