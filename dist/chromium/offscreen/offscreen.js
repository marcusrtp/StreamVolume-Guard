(function initOffscreen(root) {
  const WLG = root.StreamVolumeGuard;
  const Settings = WLG.Settings;
  const Normalizer = WLG.Normalizer;
  const captures = new Map();

  function baseStatus(tabId, site, settings) {
    return {
      ok: true,
      installed: true,
      enabled: true,
      mode: "tab-capture",
      sourceType: "tab-capture",
      panicActive: false,
      site: Settings.normalizeDomain(site),
      activeProfile: settings.activeProfile,
      excluded: false,
      canInject: true,
      canCaptureTab: true,
      mediaDetected: 1,
      mediaProcessed: 1,
      skippedAlreadyProcessed: 0,
      gainDb: 0,
      rmsDb: -120,
      peakDb: -120,
      predictedPeakDb: -120,
      riskLevel: "safe",
      containedPeakCount: 0,
      lastError: "",
      updatedAt: Date.now(),
      tabId
    };
  }

  function postStatus(tabId, status) {
    chrome.runtime.sendMessage({ type: "WLG_CAPTURE_STATUS", tabId, status });
  }

  function updateStatus(tabId, partial) {
    const capture = captures.get(tabId);
    if (!capture) return null;
    capture.status = {
      ...capture.status,
      ...partial,
      updatedAt: Date.now()
    };
    postStatus(tabId, capture.status);
    return capture.status;
  }

  function stopCapture(tabId) {
    const capture = captures.get(tabId);
    if (!capture) return { ok: true, enabled: false };

    try {
      capture.normalizer.stop();
    } catch (error) {
      // Best-effort cleanup when the tab or offscreen document is closing.
    }

    try {
      capture.stream.getTracks().forEach((track) => track.stop());
    } catch (error) {
      // Some browsers already stop tracks when capture ends.
    }

    captures.delete(tabId);
    const status = { ...capture.status, enabled: false, mediaProcessed: 0, sourceType: "none", updatedAt: Date.now() };
    postStatus(tabId, status);
    return { ok: true, status };
  }

  async function startCapture(message) {
    const tabId = Number(message.tabId);
    if (!tabId || !message.streamId) {
      return { ok: false, error: "Invalid tab capture request." };
    }

    stopCapture(tabId);

    const settings = Settings.getSettingsForDomain(message.settings, message.site);
    const status = baseStatus(tabId, message.site, settings);
    let stream = null;
    let audio = null;
    let normalizer = null;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: "tab",
            chromeMediaSourceId: message.streamId
          }
        },
        video: false
      });
      audio = new Audio();
      audio.srcObject = stream;
      audio.autoplay = true;
      audio.volume = 1;

      normalizer = Normalizer.createMediaNormalizer(audio, settings, {
        onState(nextState) {
          updateStatus(tabId, {
            gainDb: nextState.gainDb,
            rmsDb: nextState.rmsDb,
            peakDb: nextState.peakDb,
            predictedPeakDb: nextState.predictedPeakDb,
            riskLevel: nextState.riskLevel,
            containedPeakCount: nextState.containedPeakCount,
            activeProfile: nextState.profileId,
            panicActive: nextState.panicActive
          });
        }
      });

      captures.set(tabId, { audio, stream, normalizer, settings, site: message.site, status });
      stream.getTracks().forEach((track) => {
        track.addEventListener("ended", () => stopCapture(tabId), { once: true });
      });

      await audio.play();
      await normalizer.start();
      postStatus(tabId, status);
      return { ok: true, status };
    } catch (error) {
      if (captures.has(tabId)) {
        stopCapture(tabId);
      } else {
        try {
          if (normalizer) normalizer.stop();
        } catch (cleanupError) {
          // Best-effort cleanup after a failed capture startup.
        }
        try {
          if (stream) stream.getTracks().forEach((track) => track.stop());
        } catch (cleanupError) {
          // Best-effort cleanup after a failed capture startup.
        }
        if (audio) {
          audio.srcObject = null;
        }
      }
      const failedStatus = { ...status, ok: false, enabled: false, mediaProcessed: 0, lastError: error.message };
      postStatus(tabId, failedStatus);
      return { ok: false, error: error.message, status: failedStatus };
    }
  }

  function updateSettings(message) {
    const tabId = Number(message.tabId);
    const capture = captures.get(tabId);
    if (!capture) return { ok: true, enabled: false };
    const settings = Settings.getSettingsForDomain(message.settings, message.site || capture.site);
    capture.settings = settings;
    capture.site = message.site || capture.site;
    capture.normalizer.updateSettings(settings);
    const status = updateStatus(tabId, {
      site: Settings.normalizeDomain(capture.site),
      activeProfile: settings.activeProfile
    });
    return { ok: true, status };
  }

  function setPanic(message) {
    const tabId = Number(message.tabId);
    const capture = captures.get(tabId);
    if (!capture) return { ok: true, enabled: false };
    capture.normalizer.setPanic(Boolean(message.active));
    const status = updateStatus(tabId, { panicActive: Boolean(message.active) });
    return { ok: true, status };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.target !== "offscreen") return false;

    if (message.type === "WLG_START_TAB_CAPTURE") {
      startCapture(message).then(sendResponse);
      return true;
    }

    if (message.type === "WLG_STOP_TAB_CAPTURE") {
      sendResponse(stopCapture(Number(message.tabId)));
      return false;
    }

    if (message.type === "WLG_UPDATE_CAPTURE_SETTINGS") {
      sendResponse(updateSettings(message));
      return false;
    }

    if (message.type === "WLG_SET_CAPTURE_PANIC") {
      sendResponse(setPanic(message));
      return false;
    }

    return false;
  });
})(globalThis);
