// Service worker: injects the audio pipeline, tab capture fallback, and tab diagnostics.
(function initBackground(root) {
  try {
    if (!root.StreamVolumeGuard) {
      importScripts("storage/settings.js", "license/capabilities.js");
    }
  } catch (error) {
    console.warn("StreamVolume Guard could not import shared scripts.", error);
  }

  const WLG = root.StreamVolumeGuard = root.StreamVolumeGuard || {};
  const Settings = WLG.Settings;
  const captureStatuses = new Map();

  const SCRIPT_FILES = [
    "storage/settings.js",
    "license/capabilities.js",
    "audio/analyser.js",
    "audio/limiter.js",
    "audio/stream-status.js",
    "audio/normalizer.js",
    "content.js"
  ];

  function getActiveTab() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        resolve(tabs && tabs[0] ? tabs[0] : null);
      });
    });
  }

  function getAllTabs() {
    return new Promise((resolve) => {
      chrome.tabs.query({}, (tabs) => {
        resolve(Array.isArray(tabs) ? tabs : []);
      });
    });
  }

  function sendMessage(tabId, message) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(response || null);
      });
    });
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || { ok: true });
      });
    });
  }

  function executeScripts(tabId) {
    return new Promise((resolve, reject) => {
      chrome.scripting.executeScript(
        {
          target: { tabId },
          files: SCRIPT_FILES
        },
        () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve();
        }
      );
    });
  }

  function containsPermission(origins) {
    return new Promise((resolve) => {
      chrome.permissions.contains({ origins }, (contains) => resolve(Boolean(contains)));
    });
  }

  function requestPermission(origins) {
    return new Promise((resolve) => {
      chrome.permissions.request({ origins }, (granted) => resolve(Boolean(granted)));
    });
  }

  function originsForDomain(domain) {
    return [`*://${domain}/*`, `*://*.${domain}/*`];
  }

  function getDomainFromUrl(url) {
    try {
      return Settings.normalizeDomain(new URL(url).hostname);
    } catch (error) {
      return "";
    }
  }

  function canInjectUrl(url) {
    return /^https?:\/\//i.test(url || "") || /^file:\/\//i.test(url || "");
  }

  function canCaptureTab() {
    return Boolean(
      chrome.tabCapture &&
      chrome.tabCapture.getMediaStreamId &&
      chrome.offscreen &&
      chrome.offscreen.createDocument
    );
  }

  function getCaptureStatus(tabId) {
    return captureStatuses.get(tabId) || null;
  }

  function baseStatusForTab(tab) {
    return {
      ok: true,
      installed: false,
      enabled: false,
      sourceType: "none",
      panicActive: false,
      site: getDomainFromUrl(tab && tab.url),
      canInject: canInjectUrl(tab && tab.url),
      canCaptureTab: canCaptureTab(),
      mediaDetected: 0,
      mediaProcessed: 0,
      gainDb: 0,
      rmsDb: -120,
      peakDb: -120,
      predictedPeakDb: -120,
      riskLevel: "safe",
      containedPeakCount: 0
    };
  }

  function mergeStatus(tab, contentStatus) {
    const base = contentStatus || baseStatusForTab(tab);
    const captureStatus = tab && tab.id ? getCaptureStatus(tab.id) : null;
    const shared = {
      ...base,
      site: base.site || getDomainFromUrl(tab && tab.url),
      canCaptureTab: canCaptureTab()
    };

    if (captureStatus && captureStatus.enabled) {
      return {
        ...shared,
        ...captureStatus,
        canInject: shared.canInject,
        canCaptureTab: canCaptureTab()
      };
    }

    return shared;
  }

  async function ensureOffscreenDocument() {
    if (!canCaptureTab()) {
      throw new Error("tabCapture is not available in this browser build.");
    }

    if (chrome.offscreen.hasDocument) {
      const exists = await chrome.offscreen.hasDocument();
      if (exists) return;
    }

    return new Promise((resolve, reject) => {
      chrome.offscreen.createDocument(
        {
          url: "offscreen/offscreen.html",
          reasons: ["AUDIO_PLAYBACK"],
          justification: "StreamVolume Guard processes captured tab audio locally."
        },
        () => {
          if (chrome.runtime.lastError) {
            const message = chrome.runtime.lastError.message || "Could not create offscreen document.";
            if (/Only a single offscreen document/i.test(message)) {
              resolve();
              return;
            }
            reject(new Error(message));
            return;
          }
          resolve();
        }
      );
    });
  }

  function getTabCaptureStreamId(tabId) {
    return new Promise((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
        if (chrome.runtime.lastError || !streamId) {
          reject(new Error(chrome.runtime.lastError ? chrome.runtime.lastError.message : "No tab capture stream id."));
          return;
        }
        resolve(streamId);
      });
    });
  }

  async function injectAndSet(tab, enabled) {
    if (!tab || !tab.id || !canInjectUrl(tab.url)) {
      return {
        ok: false,
        error: "This tab cannot be processed by a Chrome extension content script."
      };
    }

    await executeScripts(tab.id);
    const response = await sendMessage(tab.id, {
      type: "WLG_SET_ENABLED",
      enabled: Boolean(enabled),
      mode: "manual"
    });

    return response || { ok: true };
  }

  async function getStatusForActiveTab() {
    const tab = await getActiveTab();
    if (!tab || !tab.id) {
      return { ok: false, installed: false, error: "No active tab found." };
    }

    const response = await sendMessage(tab.id, { type: "WLG_GET_STATUS" });
    return mergeStatus(tab, response);
  }

  async function grantAutoDomainForActiveTab() {
    const tab = await getActiveTab();
    const domain = tab ? getDomainFromUrl(tab.url) : "";
    if (!domain) {
      return { ok: false, error: "No valid domain for this tab." };
    }

    const origins = originsForDomain(domain);
    const granted = await requestPermission(origins);
    if (!granted) {
      return { ok: false, granted: false, domain };
    }

    const settings = await Settings.getSettings();
    await Settings.saveSettings({
      autoDomains: Array.from(new Set([...(settings.autoDomains || []), domain]))
    });

    return { ok: true, granted: true, domain };
  }

  async function startTabCaptureForActiveTab() {
    const tab = await getActiveTab();
    if (!tab || !tab.id || !/^https?:\/\//i.test(tab.url || "")) {
      return { ok: false, error: "Tab capture needs a normal web tab." };
    }
    if (!canCaptureTab()) {
      return { ok: false, canCaptureTab: false, error: "tabCapture is not available in this browser." };
    }

    const site = getDomainFromUrl(tab.url);
    const savedSettings = await Settings.getSettings();
    if (Settings.isDomainExcluded(site, savedSettings)) {
      return {
        ok: false,
        enabled: false,
        excluded: true,
        site,
        canInject: canInjectUrl(tab.url),
        canCaptureTab: canCaptureTab(),
        error: "This domain is excluded from StreamVolume Guard."
      };
    }

    const settings = Settings.getSettingsForDomain(savedSettings, site);
    await ensureOffscreenDocument();
    const streamId = await getTabCaptureStreamId(tab.id);

    captureStatuses.set(tab.id, {
      ...baseStatusForTab(tab),
      installed: true,
      enabled: true,
      sourceType: "tab-capture",
      mode: "tab-capture",
      activeProfile: settings.activeProfile,
      lastError: "",
      updatedAt: Date.now()
    });

    const response = await sendRuntimeMessage({
      target: "offscreen",
      type: "WLG_START_TAB_CAPTURE",
      tabId: tab.id,
      streamId,
      site,
      settings
    });

    if (!response.ok) {
      captureStatuses.delete(tab.id);
      return response;
    }

    return mergeStatus(tab, response.status || captureStatuses.get(tab.id));
  }

  async function stopTabCaptureForActiveTab() {
    const tab = await getActiveTab();
    if (!tab || !tab.id) return { ok: true, enabled: false };
    await sendRuntimeMessage({ target: "offscreen", type: "WLG_STOP_TAB_CAPTURE", tabId: tab.id });
    captureStatuses.delete(tab.id);
    return getStatusForActiveTab();
  }

  async function setPanicForActiveTab(active) {
    const tab = await getActiveTab();
    if (!tab || !tab.id) return { ok: false, error: "No active tab found." };

    const contentResponse = await sendMessage(tab.id, { type: "WLG_SET_PANIC", active });
    const captureStatus = getCaptureStatus(tab.id);
    let updatedCaptureStatus = null;
    if (captureStatus && captureStatus.enabled) {
      const captureResponse = await sendRuntimeMessage({ target: "offscreen", type: "WLG_SET_CAPTURE_PANIC", tabId: tab.id, active });
      updatedCaptureStatus = captureResponse && captureResponse.status ? captureResponse.status : null;
    }

    return mergeStatus(tab, updatedCaptureStatus || contentResponse);
  }

  async function refreshTab(tab) {
    if (!tab || !tab.id) return { ok: true };
    const contentResponse = await sendMessage(tab.id, { type: "WLG_REFRESH_SETTINGS" });
    const captureStatus = getCaptureStatus(tab.id);
    let updatedCaptureStatus = null;
    if (captureStatus && captureStatus.enabled) {
      const site = captureStatus.site || getDomainFromUrl(tab.url);
      const savedSettings = await Settings.getSettings();
      if (Settings.isDomainExcluded(site, savedSettings)) {
        await sendRuntimeMessage({ target: "offscreen", type: "WLG_STOP_TAB_CAPTURE", tabId: tab.id });
        captureStatuses.delete(tab.id);
        return mergeStatus(tab, {
          ...contentResponse,
          enabled: false,
          excluded: true,
          sourceType: "none",
          site
        });
      }
      const settings = Settings.getSettingsForDomain(savedSettings, site);
      const captureResponse = await sendRuntimeMessage({ target: "offscreen", type: "WLG_UPDATE_CAPTURE_SETTINGS", tabId: tab.id, settings, site });
      updatedCaptureStatus = captureResponse && captureResponse.status ? captureResponse.status : null;
    }
    return mergeStatus(tab, updatedCaptureStatus || contentResponse);
  }

  async function refreshActiveTab() {
    return refreshTab(await getActiveTab());
  }

  async function refreshOpenTabs() {
    const tabs = await getAllTabs();
    const statuses = await Promise.all(tabs.map(refreshTab));
    return {
      ok: true,
      refreshed: statuses.filter((status) => status && (status.installed || status.sourceType !== "none")).length
    };
  }

  async function maybeAutoInject(tabId, tab) {
    if (!tab || !tab.url || !canInjectUrl(tab.url)) return;

    const settings = await Settings.getSettings();
    const domain = getDomainFromUrl(tab.url);
    if (!settings.enabled || !domain) return;
    if (Settings.isDomainExcluded(domain, settings)) return;
    if (!Settings.isDomainAutoEnabled(domain, settings)) return;

    const origins = originsForDomain(domain);
    const allowed = await containsPermission(origins);
    if (!allowed) return;

    try {
      await executeScripts(tabId);
      await sendMessage(tabId, {
        type: "WLG_SET_ENABLED",
        enabled: true,
        mode: "auto"
      });
    } catch (error) {
      console.warn("StreamVolume Guard auto activation failed.", error);
    }
  }

  chrome.runtime.onInstalled.addListener(() => {
    Settings.getSettings().then((settings) => Settings.saveSettings(settings));
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete") {
      if (captureStatuses.has(tabId)) {
        captureStatuses.delete(tabId);
        sendRuntimeMessage({ target: "offscreen", type: "WLG_STOP_TAB_CAPTURE", tabId });
      }
      maybeAutoInject(tabId, tab);
    }
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    captureStatuses.delete(tabId);
    sendRuntimeMessage({ target: "offscreen", type: "WLG_STOP_TAB_CAPTURE", tabId });
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const type = message && message.type;

    if (type === "WLG_CAPTURE_STATUS") {
      if (message.tabId) {
        if (message.status && message.status.enabled) {
          captureStatuses.set(message.tabId, message.status);
        } else {
          captureStatuses.delete(message.tabId);
        }
      }
      return false;
    }

    if (type === "WLG_ACTIVATE_CURRENT_TAB") {
      getActiveTab()
        .then((tab) => injectAndSet(tab, true))
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (type === "WLG_DEACTIVATE_CURRENT_TAB") {
      getActiveTab()
        .then(async (tab) => {
          if (!tab || !tab.id) return { ok: true, enabled: false };
          await stopTabCaptureForActiveTab();
          return sendMessage(tab.id, { type: "WLG_SET_ENABLED", enabled: false });
        })
        .then((response) => sendResponse(response || { ok: true, enabled: false }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (type === "WLG_GET_ACTIVE_STATUS") {
      getStatusForActiveTab()
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (type === "WLG_REQUEST_AUTO_DOMAIN_PERMISSION") {
      grantAutoDomainForActiveTab()
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (type === "WLG_START_TAB_CAPTURE") {
      startTabCaptureForActiveTab()
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (type === "WLG_STOP_TAB_CAPTURE") {
      stopTabCaptureForActiveTab()
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (type === "WLG_SET_PANIC") {
      setPanicForActiveTab(Boolean(message.active))
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (type === "WLG_REFRESH_ACTIVE_TAB") {
      (message.scope === "all-open-tabs" ? refreshOpenTabs() : refreshActiveTab())
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    return false;
  });
})(globalThis);
