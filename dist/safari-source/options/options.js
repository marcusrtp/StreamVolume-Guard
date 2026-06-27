(function initOptions(root) {
  const WLG = root.StreamVolumeGuard;
  const Settings = WLG.Settings;
  const Capabilities = WLG.Capabilities;

  const elements = {
    form: document.getElementById("settingsForm"),
    saveState: document.getElementById("saveState"),
    activeProfile: document.getElementById("activeProfile"),
    targetRmsDb: document.getElementById("targetRmsDb"),
    targetRmsSlider: document.getElementById("targetRmsSlider"),
    targetRmsDisplay: document.getElementById("targetRmsDisplay"),
    playTargetPreviewButton: document.getElementById("playTargetPreviewButton"),
    stopTargetPreviewButton: document.getElementById("stopTargetPreviewButton"),
    maxBoostDb: document.getElementById("maxBoostDb"),
    maxReductionDb: document.getElementById("maxReductionDb"),
    enabled: document.getElementById("enabled"),
    compressorEnabled: document.getElementById("compressorEnabled"),
    limiterEnabled: document.getElementById("limiterEnabled"),
    autoDomains: document.getElementById("autoDomains"),
    excludedDomains: document.getElementById("excludedDomains"),
    platformProfilesList: document.getElementById("platformProfilesList"),
    capabilitiesList: document.getElementById("capabilitiesList"),
    applySettingsButton: document.getElementById("applySettingsButton"),
    resetButton: document.getElementById("resetButton"),
    exportDiagnosticsButton: document.getElementById("exportDiagnosticsButton")
  };
  let targetPreview = null;

  function i18n(key, fallback) {
    if (root.chrome && chrome.i18n && chrome.i18n.getMessage) {
      return chrome.i18n.getMessage(key) || fallback || key;
    }
    return fallback || key;
  }

  function localizeHelpText() {
    if (root.chrome && chrome.i18n && chrome.i18n.getUILanguage) {
      document.documentElement.lang = chrome.i18n.getUILanguage().startsWith("fr") ? "fr" : "en";
    }

    document.querySelectorAll("[data-i18n]").forEach((node) => {
      node.textContent = i18n(node.dataset.i18n, node.textContent);
    });

    document.querySelectorAll("[data-help-i18n]").forEach((node) => {
      const text = i18n(node.dataset.helpI18n, node.getAttribute("aria-label") || "Aide");
      node.setAttribute("aria-label", text);
    });
  }

  function setSaveState(text) {
    elements.saveState.textContent = text;
  }

  function setApplyButtonState(state) {
    elements.applySettingsButton.disabled = state === "sending";
    elements.applySettingsButton.dataset.applyState = state;

    if (state === "sending") {
      elements.applySettingsButton.textContent = i18n("optionsApplySending", "Envoi...");
      return;
    }

    if (state === "applied") {
      elements.applySettingsButton.textContent = i18n("optionsApplyApplied", "Appliqué");
      return;
    }

    if (state === "error") {
      elements.applySettingsButton.textContent = i18n("optionsApplyError", "Non appliqué");
      return;
    }

    elements.applySettingsButton.textContent = i18n("optionsApplyIdle", "Appliquer les réglages");
  }

  function refreshOpenTabs() {
    return new Promise((resolve) => {
      if (!root.chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
        resolve({ ok: false, error: "runtime unavailable" });
        return;
      }

      chrome.runtime.sendMessage({ type: "WLG_REFRESH_ACTIVE_TAB", scope: "all-open-tabs" }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || { ok: false, error: "empty response" });
      });
    });
  }

  function clampTargetRms(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return -21;
    return Math.max(-36, Math.min(-14, number));
  }

  function syncTargetRmsControls(value) {
    const target = clampTargetRms(value);
    elements.targetRmsDb.value = target;
    elements.targetRmsSlider.value = target;
    elements.targetRmsDisplay.textContent = `${target.toFixed(1)} dB`;
    updateTargetPreviewGain(target);
    refreshWarningsFromForm();
  }

  function dbToGain(db) {
    return Math.pow(10, db / 20);
  }

  function previewGainForTarget(targetRmsDb) {
    return Math.max(0.04, Math.min(0.7, dbToGain(targetRmsDb + 10)));
  }

  const profileLabelKeys = {
    soft: "profileSoft",
    normal: "profileNormal",
    stream: "profileStream",
    obs: "profileObs",
    night: "profileNight"
  };

  const platformNameByDomain = {
    "youtube.com": "YouTube",
    "twitch.tv": "Twitch",
    "tiktok.com": "TikTok",
    "kick.com": "Kick",
    "spotify.com": "Spotify",
    "deezer.com": "Deezer"
  };

  function fillProfiles() {
    const fragment = document.createDocumentFragment();
    Object.values(Settings.PROFILES).forEach((profile) => {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = i18n(profileLabelKeys[profile.id], profile.label);
      fragment.appendChild(option);
    });
    elements.activeProfile.replaceChildren(fragment);
  }

  function profileLabel(profileId) {
    const profile = Settings.getProfile(profileId);
    return i18n(profileLabelKeys[profile.id], profile.label);
  }

  function platformLabel(rule) {
    const primaryDomain = Settings.normalizeDomain(rule.domains[0]);
    return platformNameByDomain[primaryDomain] || primaryDomain;
  }

  function customProfileForRule(settings, rule) {
    const domainProfiles = settings.domainProfiles || {};
    return rule.domains
      .map(Settings.normalizeDomain)
      .map((domain) => domainProfiles[domain])
      .find((profileId) => Settings.PROFILES[profileId]) || "";
  }

  function domainsFromTextarea(value) {
    return value
      .split(/\r?\n/)
      .map(Settings.normalizeDomain)
      .filter(Boolean);
  }

  function settingsFromForm() {
    return {
      activeProfile: elements.activeProfile.value,
      targetRmsDb: Number(elements.targetRmsDb.value),
      maxBoostDb: Number(elements.maxBoostDb.value),
      maxReductionDb: Number(elements.maxReductionDb.value),
      enabled: elements.enabled.checked,
      compressorEnabled: elements.compressorEnabled.checked,
      limiterEnabled: elements.limiterEnabled.checked,
      autoDomains: domainsFromTextarea(elements.autoDomains.value),
      excludedDomains: domainsFromTextarea(elements.excludedDomains.value)
    };
  }

  function getOptionWarnings(settings) {
    const warnings = [];
    const targetRmsDb = Number(settings.targetRmsDb);
    const maxBoostDb = Number(settings.maxBoostDb);
    const compressorEnabled = settings.compressorEnabled !== false;
    const limiterEnabled = settings.limiterEnabled !== false;
    const excludedDomains = settings.excludedDomains || [];

    if (targetRmsDb > -14) {
      warnings.push({ field: "targetRmsDb", key: "warningTargetHot", severity: "warning" });
    }

    if (maxBoostDb > 12) {
      warnings.push({ field: "maxBoostDb", key: "warningBoostHigh", severity: "warning" });
    }

    if (compressorEnabled === false) {
      warnings.push({ field: "compressorEnabled", key: "warningCompressorOff", severity: "warning" });
    }

    if (limiterEnabled === false) {
      warnings.push({ field: "limiterEnabled", key: "warningLimiterOff", severity: "danger" });
    }

    if (excludedDomains.length > 0) {
      warnings.push({ field: "excludedDomains", key: "warningExcludedDomains", severity: "warning" });
    }

    return warnings;
  }

  function renderWarnings(settings) {
    const warnings = getOptionWarnings(settings);

    document.querySelectorAll("[data-warning-for]").forEach((badge) => {
      const warning = warnings.find((entry) => entry.field === badge.dataset.warningFor);
      const warningText = warning ? i18n(warning.key, warning.key) : "";
      badge.classList.toggle("is-active", Boolean(warning));
      badge.classList.toggle("is-danger", Boolean(warning && warning.severity === "danger"));
      badge.dataset.warningText = warningText;

      if (warningText) {
        badge.setAttribute("aria-label", warningText);
        badge.setAttribute("tabindex", "0");
      } else {
        badge.removeAttribute("aria-label");
        badge.removeAttribute("tabindex");
      }
    });
  }

  function refreshWarningsFromForm() {
    renderWarnings(settingsFromForm());
  }

  function updateTargetPreviewGain(targetRmsDb) {
    if (!targetPreview || !targetPreview.masterGain) return;
    const gain = previewGainForTarget(targetRmsDb);
    targetPreview.masterGain.gain.setTargetAtTime(gain, targetPreview.context.currentTime, 0.05);
  }

  async function startTargetPreview() {
    stopTargetPreview();
    const AudioContextConstructor = root.AudioContext || root.webkitAudioContext;
    if (!AudioContextConstructor) {
      setSaveState("audio preview impossible");
      return;
    }

    const context = new AudioContextConstructor();
    const masterGain = context.createGain();
    const toneGain = context.createGain();
    const bass = context.createOscillator();
    const lead = context.createOscillator();
    const shimmer = context.createOscillator();
    const now = context.currentTime;

    masterGain.gain.value = previewGainForTarget(elements.targetRmsDb.value);
    toneGain.gain.value = 0.22;

    bass.type = "sine";
    bass.frequency.value = 196;
    lead.type = "triangle";
    lead.frequency.value = 392;
    shimmer.type = "sine";
    shimmer.frequency.value = 523.25;

    bass.connect(toneGain);
    lead.connect(toneGain);
    shimmer.connect(toneGain);
    toneGain.connect(masterGain);
    masterGain.connect(context.destination);

    bass.start(now);
    lead.start(now);
    shimmer.start(now);
    if (context.state === "suspended") await context.resume();

    targetPreview = { context, masterGain, oscillators: [bass, lead, shimmer] };
    elements.playTargetPreviewButton.disabled = true;
    elements.stopTargetPreviewButton.disabled = false;
  }

  function stopTargetPreview() {
    if (!targetPreview) return;
    targetPreview.oscillators.forEach((oscillator) => {
      try {
        oscillator.stop();
      } catch (error) {
        // Best-effort cleanup when the preview is already stopped.
      }
    });
    targetPreview.context.close();
    targetPreview = null;
    elements.playTargetPreviewButton.disabled = false;
    elements.stopTargetPreviewButton.disabled = true;
  }

  function sendRuntimeMessage(type) {
    return new Promise((resolve) => {
      if (!root.chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
        resolve({ ok: false, error: "runtime unavailable" });
        return;
      }

      chrome.runtime.sendMessage({ type }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || { ok: false, error: "empty response" });
      });
    });
  }

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function safeStatus(status) {
    const source = status && typeof status === "object" ? status : {};
    return {
      ok: source.ok !== false,
      installed: Boolean(source.installed),
      enabled: Boolean(source.enabled),
      mode: String(source.mode || ""),
      sourceType: String(source.sourceType || ""),
      site: Settings.normalizeDomain(source.site || ""),
      activeProfile: String(source.activeProfile || ""),
      excluded: Boolean(source.excluded),
      canInject: source.canInject !== false,
      mediaDetected: finiteNumber(source.mediaDetected, 0),
      mediaProcessed: finiteNumber(source.mediaProcessed, 0),
      skippedAlreadyProcessed: finiteNumber(source.skippedAlreadyProcessed, 0),
      gainDb: finiteNumber(source.gainDb, 0),
      rmsDb: finiteNumber(source.rmsDb, -120),
      peakDb: finiteNumber(source.peakDb, -120),
      predictedPeakDb: finiteNumber(source.predictedPeakDb, -120),
      riskLevel: String(source.riskLevel || "safe"),
      containedPeakCount: finiteNumber(source.containedPeakCount, 0),
      lastError: String(source.lastError || source.error || "").slice(0, 300),
      updatedAt: finiteNumber(source.updatedAt, 0)
    };
  }

  async function buildDiagnosticReport() {
    const settings = await Settings.getSettings();
    const status = await sendRuntimeMessage("WLG_GET_ACTIVE_STATUS");
    const manifest = chrome.runtime.getManifest ? chrome.runtime.getManifest() : {};

    return {
      schemaVersion: 1,
      product: "StreamVolume Guard",
      extensionVersion: manifest.version || "dev",
      generatedAt: new Date().toISOString(),
      browser: {
        userAgent: root.navigator && root.navigator.userAgent ? root.navigator.userAgent : "",
        language: root.navigator && root.navigator.language ? root.navigator.language : ""
      },
      settings: {
        enabled: Boolean(settings.enabled),
        activeProfile: settings.activeProfile,
        targetRmsDb: settings.targetRmsDb,
        maxBoostDb: settings.maxBoostDb,
        maxReductionDb: settings.maxReductionDb,
        compressorEnabled: settings.compressorEnabled,
        limiterEnabled: settings.limiterEnabled,
        autoDomainsCount: (settings.autoDomains || []).length,
        excludedDomainsCount: (settings.excludedDomains || []).length,
        domainProfilesCount: Object.keys(settings.domainProfiles || {}).length,
        platformProfilesEnabled: Boolean(settings.platformProfilesEnabled)
      },
      activeTab: safeStatus(status),
      privacy: {
        localOnly: true,
        sentAutomatically: false,
        includesAudio: false,
        includesFullUrl: false,
        includesPageTitle: false
      }
    };
  }

  function safeFilenamePart(value) {
    return String(value || "local")
      .toLowerCase()
      .replace(/[^a-z0-9.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "local";
  }

  function downloadDiagnosticReport(report) {
    const date = report.generatedAt.slice(0, 10);
    const site = safeFilenamePart(report.activeTab && report.activeTab.site);
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `streamvolume-guard-diagnostic-${site}-${date}.json`;
    link.click();
    root.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportDiagnostics() {
    try {
      const report = await buildDiagnosticReport();
      downloadDiagnosticReport(report);
      setSaveState("diagnostic exporté");
    } catch (error) {
      setSaveState("diagnostic impossible");
    }

    root.setTimeout(() => setSaveState("prêt"), 1400);
  }

  function renderCapabilities() {
    const features = [
      ["safetyLimiter", "capabilitySafetyLimiter", "Limiteur de sécurité"],
      ["perDomainProfiles", "capabilityPerDomainProfiles", "Profils par domaine"],
      ["tabCaptureFallback", "capabilityTabCaptureFallback", "Capture d'onglet"],
      ["panicMode", "capabilityPanicMode", "Mode Panic"],
      ["diagnosticCopy", "capabilityDiagnosticCopy", "Diagnostic copiable"],
      ["guidedObsCalibration", "capabilityGuidedObsCalibration", "Calibration OBS guidée"],
      ["advancedLimiter", "capabilityAdvancedLimiter", "Limiteur avancé"],
      ["settingsSync", "capabilitySettingsSync", "Synchronisation"],
      ["advancedShortcuts", "capabilityAdvancedShortcuts", "Raccourcis avancés"]
    ];

    const fragment = document.createDocumentFragment();
    features.forEach(([id, labelKey, fallback]) => {
      const allowed = Capabilities.canUseFeature(id);
      const item = document.createElement("li");
      const name = document.createElement("strong");
      name.textContent = i18n(labelKey, fallback);
      item.appendChild(name);
      item.appendChild(document.createTextNode(` - ${allowed ? i18n("capabilityActive", "actif") : i18n("capabilityLocked", "prévu")}`));
      fragment.appendChild(item);
    });
    elements.capabilitiesList.replaceChildren(fragment);
  }

  function renderPlatformProfiles(settings) {
    const fragment = document.createDocumentFragment();
    Settings.PLATFORM_PROFILE_RULES.forEach((rule) => {
      const primaryDomain = Settings.normalizeDomain(rule.domains[0]);
      const customProfileId = customProfileForRule(settings, rule);
      const activeProfileId = customProfileId || rule.profileId;
      const isCustomized = Boolean(customProfileId);
      const card = document.createElement("article");
      const heading = document.createElement("div");
      const title = document.createElement("strong");
      const domains = document.createElement("span");
      const details = document.createElement("p");
      const controls = document.createElement("div");
      const select = document.createElement("select");
      const reset = document.createElement("button");

      card.className = "platform-profile-card";
      title.textContent = platformLabel(rule);
      domains.textContent = rule.domains.join(", ");
      heading.append(title, domains);

      details.textContent = `${i18n("platformProfileApplied", "Appliqué")} : ${profileLabel(activeProfileId)} - ${
        isCustomized
          ? i18n("platformProfileCustomized", "personnalisé")
          : i18n("platformProfileRecommended", "recommandé")
      }`;

      Object.values(Settings.PROFILES).forEach((profile) => {
        const option = document.createElement("option");
        option.value = profile.id;
        option.textContent = profileLabel(profile.id);
        select.appendChild(option);
      });
      select.value = activeProfileId;
      select.dataset.platformDomain = primaryDomain;

      reset.type = "button";
      reset.dataset.platformDomain = primaryDomain;
      reset.textContent = i18n("platformProfileReset", "Réinitialiser");
      reset.disabled = !isCustomized;

      controls.className = "platform-profile-controls";
      controls.append(select, reset);
      card.append(heading, details, controls);
      fragment.appendChild(card);
    });
    elements.platformProfilesList.replaceChildren(fragment);
  }

  async function savePlatformProfile(primaryDomain, profileId) {
    const current = await Settings.getSettings();
    const rule = Settings.PLATFORM_PROFILE_RULES.find((entry) => {
      return Settings.normalizeDomain(entry.domains[0]) === Settings.normalizeDomain(primaryDomain);
    });
    if (!rule || !Settings.PROFILES[profileId]) return;

    const domainProfiles = { ...(current.domainProfiles || {}) };
    rule.domains.map(Settings.normalizeDomain).forEach((domain) => {
      if (profileId === rule.profileId) {
        delete domainProfiles[domain];
      } else {
        domainProfiles[domain] = profileId;
      }
    });

    await Settings.saveSettings({ domainProfiles: domainProfiles });
    await refreshOpenTabs();
    await render();
    setSaveState(i18n("popupProfileSaved", "Profil enregistré pour ce site"));
    root.setTimeout(() => setSaveState("prêt"), 1200);
  }

  async function resetPlatformProfile(primaryDomain) {
    const rule = Settings.PLATFORM_PROFILE_RULES.find((entry) => {
      return Settings.normalizeDomain(entry.domains[0]) === Settings.normalizeDomain(primaryDomain);
    });
    if (!rule) return;
    await savePlatformProfile(primaryDomain, rule.profileId);
  }

  async function render() {
    const settings = await Settings.getSettings();
    elements.activeProfile.value = settings.activeProfile;
    elements.targetRmsDb.value = settings.targetRmsDb;
    syncTargetRmsControls(settings.targetRmsDb);
    elements.maxBoostDb.value = settings.maxBoostDb;
    elements.maxReductionDb.value = settings.maxReductionDb;
    elements.enabled.checked = settings.enabled;
    elements.compressorEnabled.checked = settings.compressorEnabled;
    elements.limiterEnabled.checked = settings.limiterEnabled;
    elements.autoDomains.value = (settings.autoDomains || []).join("\n");
    elements.excludedDomains.value = (settings.excludedDomains || []).join("\n");
    renderPlatformProfiles(settings);
    renderCapabilities();
    renderWarnings(settings);
  }

  async function saveFromForm() {
    const nextSettings = settingsFromForm();

    setApplyButtonState("sending");
    setSaveState(i18n("optionsApplySendingStatus", "envoi aux onglets ouverts..."));

    try {
      await Settings.saveSettings(nextSettings);
      renderWarnings(nextSettings);
      const refreshResult = await refreshOpenTabs();

      if (!refreshResult.ok) {
        setApplyButtonState("error");
        setSaveState(i18n("optionsApplyErrorStatus", "réglages enregistrés, envoi impossible"));
        return;
      }

      if (Number(refreshResult.refreshed || 0) > 0) {
        setApplyButtonState("applied");
        setSaveState(i18n("optionsApplyAppliedStatus", "réglages appliqués aux onglets actifs"));
      } else {
        setApplyButtonState("applied");
        setSaveState(i18n("optionsApplySavedNoTab", "réglages enregistrés, aucun onglet traité ouvert"));
      }
    } catch (error) {
      setApplyButtonState("error");
      setSaveState(i18n("optionsSaveErrorStatus", "sauvegarde impossible"));
    }

    root.setTimeout(() => {
      setApplyButtonState("idle");
      setSaveState("prêt");
    }, 1600);
  }

  elements.activeProfile.addEventListener("change", () => {
    const profile = Settings.getProfile(elements.activeProfile.value);
    syncTargetRmsControls(profile.targetRmsDb);
  });

  elements.targetRmsSlider.addEventListener("input", () => {
    syncTargetRmsControls(elements.targetRmsSlider.value);
  });

  elements.targetRmsDb.addEventListener("input", () => {
    syncTargetRmsControls(elements.targetRmsDb.value);
  });

  [
    elements.maxBoostDb,
    elements.compressorEnabled,
    elements.limiterEnabled,
    elements.excludedDomains
  ].forEach((element) => {
    element.addEventListener("input", refreshWarningsFromForm);
    element.addEventListener("change", refreshWarningsFromForm);
  });

  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveFromForm();
  });

  elements.resetButton.addEventListener("click", async () => {
    await Settings.resetSettings();
    await refreshOpenTabs();
    await render();
    setSaveState("réinitialisé");
    root.setTimeout(() => setSaveState("prêt"), 1200);
  });

  elements.exportDiagnosticsButton.addEventListener("click", exportDiagnostics);

  elements.playTargetPreviewButton.addEventListener("click", startTargetPreview);
  elements.stopTargetPreviewButton.addEventListener("click", stopTargetPreview);

  elements.platformProfilesList.addEventListener("change", (event) => {
    if (event.target.matches("select[data-platform-domain]")) {
      savePlatformProfile(event.target.dataset.platformDomain, event.target.value);
    }
  });

  elements.platformProfilesList.addEventListener("click", (event) => {
    if (event.target.matches("button[data-platform-domain]")) {
      resetPlatformProfile(event.target.dataset.platformDomain);
    }
  });

  document.querySelectorAll(".help-button").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
  });

  localizeHelpText();
  fillProfiles();
  elements.stopTargetPreviewButton.disabled = true;
  render();
  root.addEventListener("unload", stopTargetPreview);
})(globalThis);
