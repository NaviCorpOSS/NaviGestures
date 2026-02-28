(() => {
  const api = typeof browser !== "undefined" ? browser : chrome;
  const isBrowserApi = typeof browser !== "undefined";

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

  async function performAction(action, senderTabId) {
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
        default:
          break;
      }
    } catch (_) {
      // Ignore errors from restricted pages or unavailable tab history.
    }
  }

  api.runtime.onMessage.addListener((message, sender) => {
    if (!message || message.type !== "n3t-perform-action") return;
    performAction(message.action, sender && sender.tab ? sender.tab.id : null);
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
