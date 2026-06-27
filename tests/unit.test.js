const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function createContext() {
  const storageData = {};
  const context = {
    console,
    setTimeout,
    clearTimeout,
    globalThis: {},
    chrome: {
      storage: {
        local: {
          get(keys, callback) {
            if (Array.isArray(keys)) {
              const result = {};
              keys.forEach((key) => {
                result[key] = storageData[key];
              });
              callback(result);
              return;
            }
            if (typeof keys === "string") {
              callback({ [keys]: storageData[keys] });
              return;
            }
            callback({ ...storageData });
          },
          set(values, callback) {
            Object.assign(storageData, values);
            if (callback) callback();
          },
          remove(keys, callback) {
            const list = Array.isArray(keys) ? keys : [keys];
            list.forEach((key) => delete storageData[key]);
            if (callback) callback();
          }
        }
      },
      runtime: {
        lastError: null
      }
    }
  };
  context.globalThis = context;
  return vm.createContext(context);
}

function loadScript(context, relativePath) {
  const filePath = path.join(root, relativePath);
  const source = fs.readFileSync(filePath, "utf8");
  vm.runInContext(source, context, { filename: relativePath });
}

function loadCore() {
  const context = createContext();
  [
    "storage/settings.js",
    "license/capabilities.js",
    "audio/analyser.js",
    "audio/limiter.js",
    "audio/stream-status.js",
    "audio/normalizer.js"
  ].forEach((file) => loadScript(context, file));
  return context.StreamVolumeGuard;
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

async function runTests() {
  for (const entry of tests) {
    try {
      await entry.fn();
      console.log(`PASS ${entry.name}`);
    } catch (error) {
      console.error(`FAIL ${entry.name}`);
      throw error;
    }
  }
}

test("default settings are streamer-first and enabled", () => {
  const WLG = loadCore();
  assert.equal(WLG.Settings.DEFAULT_SETTINGS.enabled, true);
  assert.equal(WLG.Settings.DEFAULT_SETTINGS.activeProfile, "stream");
  assert.equal(WLG.Settings.DEFAULT_SETTINGS.targetRmsDb, -21);
  assert.equal(WLG.Settings.DEFAULT_SETTINGS.maxBoostDb, 48);
  assert.equal(WLG.Settings.DEFAULT_SETTINGS.maxReductionDb, -24);
});

test("legacy settings migrate max boost so the test page remains recoverable", () => {
  const WLG = loadCore();
  const oldSchemaMigrated = WLG.Settings.normalizeSettings({
    schemaVersion: 2,
    maxBoostDb: 12
  });
  const previousSchemaMigrated = WLG.Settings.normalizeSettings({
    schemaVersion: 3,
    maxBoostDb: 12
  });
  const currentSchemaManualLowering = WLG.Settings.normalizeSettings({
    schemaVersion: 5,
    maxBoostDb: 12
  });
  const weakToneRecoverableAtMinus22Peak = WLG.Settings.normalizeSettings({
    schemaVersion: 5,
    targetRmsDb: -25,
    maxBoostDb: 25
  });

  assert.equal(WLG.Settings.SETTINGS_SCHEMA_VERSION, 5);
  assert.equal(oldSchemaMigrated.maxBoostDb, 48);
  assert.equal(previousSchemaMigrated.maxBoostDb, 48);
  assert.equal(currentSchemaManualLowering.maxBoostDb, 44);
  assert.equal(weakToneRecoverableAtMinus22Peak.maxBoostDb, 40);
  assert.equal(WLG.Settings.getMinimumRecoverableBoostDb(-25), 40);
});

test("legacy default stream loudness migrates to the calmer streamer target", () => {
  const WLG = loadCore();
  const oldDefaultTarget = WLG.Settings.normalizeSettings({
    schemaVersion: 4,
    activeProfile: "stream",
    targetRmsDb: -18.5
  });
  const customTarget = WLG.Settings.normalizeSettings({
    schemaVersion: 4,
    activeProfile: "stream",
    targetRmsDb: -16
  });
  const currentManualTarget = WLG.Settings.normalizeSettings({
    schemaVersion: 5,
    activeProfile: "stream",
    targetRmsDb: -18.5
  });

  assert.equal(oldDefaultTarget.targetRmsDb, -21);
  assert.equal(customTarget.targetRmsDb, -16);
  assert.equal(currentManualTarget.targetRmsDb, -18.5);
});

test("normalizeDomain strips protocols, ports, paths and www prefix", () => {
  const WLG = loadCore();
  assert.equal(
    WLG.Settings.normalizeDomain("https://www.Twitch.tv:443/some/channel?x=1"),
    "twitch.tv"
  );
  assert.equal(WLG.Settings.normalizeDomain("WWW.YouTube.COM/watch?v=1"), "youtube.com");
});

test("stream profile is protective", () => {
  const WLG = loadCore();
  const stream = WLG.Settings.getProfile("stream");
  assert.equal(stream.id, "stream");
  assert.ok(stream.attackMs < stream.releaseMs);
  assert.ok(stream.targetRmsDb <= -18);
  assert.ok(stream.ratio >= 3);
});

test("OBS recommended profile is available and calmer than the stream profile", () => {
  const WLG = loadCore();
  const obs = WLG.Settings.getProfile("obs");
  const stream = WLG.Settings.getProfile("stream");

  assert.equal(obs.id, "obs");
  assert.ok(obs.label.length > 0);
  assert.ok(obs.targetRmsDb < stream.targetRmsDb);
  assert.ok(obs.targetRmsDb >= -23);
  assert.ok(obs.attackMs <= 50);
  assert.ok(obs.releaseMs >= 700 && obs.releaseMs <= 1000);
  assert.ok(obs.ratio >= 4);
  assert.equal(obs.limiterCeilingDb, -1);
});

test("stream profile recovers quiet content faster without becoming abrupt", () => {
  const WLG = loadCore();
  const stream = WLG.Settings.getProfile("stream");
  const gainAfterOneSecond = WLG.Normalizer.smoothGainDb(0, 12, 1000, stream.attackMs, stream.releaseMs);

  assert.ok(stream.releaseMs <= 950, "Stream release should be fast enough to hear progress in about one second");
  assert.ok(stream.releaseMs >= 650, "Stream release should stay slow enough to avoid obvious pumping");
  assert.ok(gainAfterOneSecond > 7, "Quiet content should recover more than halfway toward max boost after one second");
  assert.ok(gainAfterOneSecond < 10, "Quiet content should not jump instantly to max boost");
});

test("stream profile catches up quickly on extreme quiet test-page jumps", () => {
  const WLG = loadCore();
  const stream = WLG.Settings.getProfile("stream");
  const recoveredGain = WLG.Normalizer.smoothGainDb(-15.5, 44.5, 1000, stream.attackMs, stream.releaseMs);

  assert.ok(recoveredGain > 38, "Extreme quiet content should become close to target within one second");
  assert.ok(recoveredGain < 44.5, "Extreme quiet content should still be smoothed, not snapped instantly");
});

test("stream profile catches up moderate real-world boosts before they sound weak", () => {
  const WLG = loadCore();
  const stream = WLG.Settings.getProfile("stream");
  const recoveredGain = WLG.Normalizer.smoothGainDb(20, 27, 500, stream.attackMs, stream.releaseMs);

  assert.ok(recoveredGain > 25.5, "Moderate dynamic content should not stay several dB too weak for half a second");
  assert.ok(recoveredGain < 27, "Moderate dynamic content should still be smoothed, not snapped instantly");
});


test("target gain clamps boost and reduction", () => {
  const WLG = loadCore();
  assert.equal(
    WLG.Normalizer.calculateTargetGainDb({
      currentRmsDb: -60,
      targetRmsDb: -18,
      maxBoostDb: 12,
      maxReductionDb: -24
    }),
    12
  );
  assert.equal(
    WLG.Normalizer.calculateTargetGainDb({
      currentRmsDb: 12,
      targetRmsDb: -18,
      maxBoostDb: 12,
      maxReductionDb: -24
    }),
    -24
  );
});

test("free tier exposes local streamer-safe capabilities", () => {
  const WLG = loadCore();
  assert.equal(WLG.Capabilities.canUseFeature("safetyLimiter"), true);
  assert.equal(WLG.Capabilities.canUseFeature("perDomainProfiles"), true);
  assert.equal(WLG.Capabilities.canUseFeature("tabCaptureFallback"), true);
  assert.equal(WLG.Capabilities.canUseFeature("panicMode"), true);
  assert.equal(WLG.Capabilities.canUseFeature("guidedObsCalibration"), false);
  assert.equal(WLG.Capabilities.canUseFeature("obsCalibration"), false);
  assert.equal(WLG.Capabilities.canUseFeature("advancedLimiter"), false);
});

test("limiter gain never boosts above unity", () => {
  const WLG = loadCore();
  assert.equal(WLG.Limiter.computeLimiterGain(-12, -1), 1);
  assert.ok(WLG.Limiter.computeLimiterGain(2, -1) < 1);
  assert.ok(WLG.Limiter.computeLimiterGain(2, -1) > 0);
});

test("safety limiter does not attenuate the whole signal by default", () => {
  const limiterSource = fs.readFileSync(path.join(root, "audio", "limiter.js"), "utf8");
  const normalizerSource = fs.readFileSync(path.join(root, "audio", "normalizer.js"), "utf8");

  assert.match(limiterSource, /ceilingGain\.gain\.value = 1/);
  assert.match(normalizerSource, /limiter\.ceilingGain\.gain\.value = 1/);
  assert.doesNotMatch(limiterSource, /ceilingGain\.gain\.value = Analyser\.dbToLinear/);
  assert.doesNotMatch(normalizerSource, /limiter\.ceilingGain\.gain\.value = Analyser\.dbToLinear/);
});

test("native compressor stays neutral to avoid hidden browser makeup gain", () => {
  const normalizerSource = fs.readFileSync(path.join(root, "audio", "normalizer.js"), "utf8");

  assert.match(normalizerSource, /compressor\.threshold\.value = 0;/);
  assert.match(normalizerSource, /compressor\.knee\.value = 0;/);
  assert.match(normalizerSource, /compressor\.ratio\.value = 1;/);
  assert.doesNotMatch(normalizerSource, /compressor\.threshold\.value = profile\.compressorThresholdDb/);
  assert.doesNotMatch(normalizerSource, /compressor\.ratio\.value = profile\.compressorRatio/);
});

test("platform profiles recommend streamer-first defaults", () => {
  const WLG = loadCore();
  const settings = WLG.Settings.normalizeSettings({});

  assert.equal(WLG.Settings.SETTINGS_SCHEMA_VERSION, 5);
  assert.equal(WLG.Settings.getRecommendedProfileForDomain("youtube.com"), "stream");
  assert.equal(WLG.Settings.getRecommendedProfileForDomain("open.spotify.com"), "normal");
  assert.equal(WLG.Settings.getEffectiveProfileIdForDomain(settings, "twitch.tv"), "stream");
  assert.equal(
    WLG.Settings.getEffectiveProfileIdForDomain({ ...settings, domainProfiles: { "twitch.tv": "night" } }, "twitch.tv"),
    "night"
  );
  assert.equal(
    WLG.Settings.getEffectiveProfileIdForDomain({ ...settings, domainProfiles: { "youtube.com": "night" } }, "music.youtube.com"),
    "night"
  );
});

test("domain profile selection keeps the user target loudness", () => {
  const WLG = loadCore();
  const settings = WLG.Settings.normalizeSettings({
    activeProfile: "stream",
    targetRmsDb: -15.5,
    domainProfiles: {
      "twitch.tv": "night"
    }
  });

  const runtime = WLG.Settings.getSettingsForDomain(settings, "twitch.tv");

  assert.equal(runtime.activeProfile, "night");
  assert.equal(runtime.targetRmsDb, -15.5);
});

test("settings clamps target loudness at the shared safe bounds", () => {
  const WLG = loadCore();

  assert.equal(WLG.Settings.normalizeSettings({ targetRmsDb: -80 }).targetRmsDb, -48);
  assert.equal(WLG.Settings.normalizeSettings({ targetRmsDb: -5 }).targetRmsDb, -15);
  assert.equal(WLG.Settings.normalizeSettings({ targetRmsDb: -21.5 }).targetRmsDb, -21.5);
});

test("settings keep target loudness recoverable for the weak test sound", () => {
  const WLG = loadCore();
  const settings = WLG.Settings.normalizeSettings({
    targetRmsDb: -10,
    maxBoostDb: 48
  });
  const profile = WLG.Settings.getRuntimeProfile(settings);
  const weakTargetGainDb = WLG.Normalizer.calculateTargetGainDb({
    currentRmsDb: -63,
    targetRmsDb: profile.targetRmsDb,
    maxBoostDb: profile.maxBoostDb,
    maxReductionDb: profile.maxReductionDb
  });

  assert.equal(profile.targetRmsDb, -15);
  assert.equal(weakTargetGainDb, 48);
  assert.ok(-63 + weakTargetGainDb >= profile.targetRmsDb, "weak sound must be able to reach the selected target");
});

test("content script guards concurrent media processing and resets detached markers", () => {
  const contentSource = fs.readFileSync(path.join(root, "content.js"), "utf8");

  assert.match(contentSource, /const processingMedia = new Set\(\);/);
  assert.match(contentSource, /if \(processingMedia\.has\(media\)\) return;/);
  assert.match(contentSource, /processingMedia\.add\(media\);/);
  assert.match(contentSource, /finally\s*{[\s\S]*processingMedia\.delete\(media\);[\s\S]*}/);
  assert.match(contentSource, /delete media\.dataset\[PROCESSED_ATTR\];/);
  assert.match(contentSource, /delete media\.dataset\[ERROR_ATTR\];/);
});

test("tab capture startup cleans up failed offscreen streams", () => {
  const offscreenSource = fs.readFileSync(path.join(root, "offscreen", "offscreen.js"), "utf8");

  assert.match(offscreenSource, /let stream = null;/);
  assert.match(offscreenSource, /let audio = null;/);
  assert.match(offscreenSource, /let normalizer = null;/);
  assert.match(offscreenSource, /if \(captures\.has\(tabId\)\) {[\s\S]*stopCapture\(tabId\);[\s\S]*}/);
  assert.match(offscreenSource, /if \(normalizer\) normalizer\.stop\(\);/);
  assert.match(offscreenSource, /if \(stream\) stream\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\);/);
  assert.match(offscreenSource, /audio\.srcObject = null;/);
});

test("background refresh stops active capture when a domain becomes excluded", () => {
  const backgroundSource = fs.readFileSync(path.join(root, "background.js"), "utf8");

  assert.match(backgroundSource, /Settings\.isDomainExcluded\(site, savedSettings\)/);
  assert.match(backgroundSource, /WLG_STOP_TAB_CAPTURE/);
  assert.match(backgroundSource, /captureStatuses\.delete\(tab\.id\)/);
  assert.match(backgroundSource, /excluded:\s*true/);
  assert.match(backgroundSource, /updatedCaptureStatus \|\| contentResponse/);
});

test("background uses offscreen status responses for capture updates", () => {
  const backgroundSource = fs.readFileSync(path.join(root, "background.js"), "utf8");

  assert.match(backgroundSource, /const captureResponse = await sendRuntimeMessage\(\{ target: "offscreen", type: "WLG_SET_CAPTURE_PANIC"/);
  assert.match(backgroundSource, /updatedCaptureStatus = captureResponse && captureResponse\.status \? captureResponse\.status : null;/);
  assert.match(backgroundSource, /const captureResponse = await sendRuntimeMessage\(\{ target: "offscreen", type: "WLG_UPDATE_CAPTURE_SETTINGS"/);
  assert.match(backgroundSource, /return mergeStatus\(tab, updatedCaptureStatus \|\| contentResponse\);/);
});

test("options distinguishes save failure from refresh failure", () => {
  const optionsSource = fs.readFileSync(path.join(root, "options", "options.js"), "utf8");
  const enMessages = readJson("_locales/en/messages.json");
  const frMessages = readJson("_locales/fr/messages.json");

  assert.match(optionsSource, /optionsApplyErrorStatus/);
  assert.match(optionsSource, /optionsSaveErrorStatus/);
  assert.match(optionsSource, /setSaveState\(i18n\("optionsSaveErrorStatus", "sauvegarde impossible"\)\)/);
  assert.equal(enMessages.optionsSaveErrorStatus.message, "save failed");
  assert.equal(frMessages.optionsSaveErrorStatus.message, "sauvegarde impossible");
});

test("public test page uses real media blobs instead of MediaStreamDestination", () => {
  const html = fs.readFileSync(path.join(root, "test-page.html"), "utf8");
  assert.match(html, /createSegmentedSineWaveBlob/);
  assert.match(html, /new Blob\(\[buffer\], \{ type: "audio\/wav" \}\)/);
  assert.doesNotMatch(html, /createMediaStreamDestination/);
});

test("public test page uses the streamer dashboard layout", () => {
  const html = fs.readFileSync(path.join(root, "test-page.html"), "utf8");

  assert.match(html, /class="test-header"/);
  assert.match(html, /class="test-brand"/);
  assert.match(html, /class="test-logo"/);
  assert.match(html, /src="assets\/icons\/icon128\.png"/);
  assert.match(html, /class="test-status"/);
  assert.match(html, /class="test-shell"/);
  assert.match(html, /class="test-overview"/);
  assert.match(html, /class="overview-card overview-card-primary"/);
  assert.match(html, /class="test-layout"/);
  assert.match(html, /class="primary-stack"/);
  assert.match(html, /class="sidebar-stack"/);
  assert.match(html, /class="panel audio-control-panel"/);
  assert.match(html, /class="panel demo-box"/);
  assert.match(html, /class="panel demo-box live-results"/);
  assert.match(html, /class="panel demo-box streamer-check trust-panel"/);
  assert.match(html, /linear-gradient\(180deg, #10202c 0, #153243 92px, #eef4f6 92px/);
  assert.doesNotMatch(html, /linear-gradient\(135deg/);
  assert.doesNotMatch(html, /test-card/);
  assert.doesNotMatch(html, /test-sidebar/);
});

test("browser smoke bakes test loudness into WAV data instead of element volume", () => {
  const smokeHtml = fs.readFileSync(path.join(root, "tests", "technical-smoke.html"), "utf8");

  assert.match(smokeHtml, /createSineWaveBlob\(440, amplitude, durationSeconds \|\| 8\)/);
  assert.match(smokeHtml, /audio\.volume = 1;/);
  assert.doesNotMatch(smokeHtml, /audio\.volume = amplitude;/);
  assert.match(smokeHtml, /const VERY_LOUD_AMPLITUDE = 0\.8912509381337456;/);
  assert.match(smokeHtml, /expectedRmsDb: -4/);
});

test("browser smoke ignores stale status samples when checking transition overshoot", () => {
  const smokeHtml = fs.readFileSync(path.join(root, "tests", "technical-smoke.html"), "utf8");

  assert.match(smokeHtml, /const startedAt = Date\.now\(\);/);
  assert.match(smokeHtml, /const collectAfter = startedAt \+ warmupMs;/);
  assert.match(smokeHtml, /status\.updatedAt >= collectAfter/);
  assert.match(smokeHtml, /Date\.now\(\) >= collectAfter/);
  assert.match(smokeHtml, /earlyStats\.maxOutputRmsDb > levelStatus\.targetRmsDb \+ 0\.8/);
});

test("manual local server exists and README documents the recommended URL flow", () => {
  const serverSource = fs.readFileSync(path.join(root, "tests", "start-local-server.js"), "utf8");
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");

  assert.match(readme, /node tests\/start-local-server\.js/);
  assert.match(readme, /http:\/\/127\.0\.0\.1/);
  assert.match(serverSource, /Ouvre/);
  assert.match(serverSource, /Garde ce terminal ouvert/);
  assert.doesNotMatch(serverSource, /Then:/);
});

test("public test page alternation gives the normalizer enough time to settle", () => {
  const html = fs.readFileSync(path.join(root, "test-page.html"), "utf8");
  const intervalMatch = html.match(/const PULSE_INTERVAL_MS = (\d+);/);
  const durationMatch = html.match(/const TEST_TONE_SECONDS = (\d+);/);
  const demoStepMatch = html.match(/const DEMO_STEP_MS = (\d+);/);

  assert.ok(intervalMatch, "test page should expose PULSE_INTERVAL_MS");
  assert.ok(durationMatch, "test page should expose TEST_TONE_SECONDS");
  assert.ok(demoStepMatch, "test page should expose DEMO_STEP_MS");
  assert.ok(Number(intervalMatch[1]) >= 6000, "alternation should keep each level for at least 6 seconds");
  assert.ok(Number(durationMatch[1]) >= 6, "generated WAV should be long enough for each level");
  assert.ok(Number(demoStepMatch[1]) >= 8000, "before/after demo should leave enough time for perceived equalization");
});

test("public test page avoids raw loop seams during 8 second alternation", () => {
  const html = fs.readFileSync(path.join(root, "test-page.html"), "utf8");
  const intervalMatch = html.match(/const PULSE_INTERVAL_MS = (\d+);/);
  const durationMatch = html.match(/const TEST_TONE_SECONDS = (\d+);/);

  assert.ok(intervalMatch, "test page should expose PULSE_INTERVAL_MS");
  assert.ok(durationMatch, "test page should expose TEST_TONE_SECONDS");
  assert.ok(
    Number(durationMatch[1]) * 1000 > Number(intervalMatch[1]),
    "generated tone should be longer than each alternation step to avoid a loop seam"
  );
  assert.match(html, /const TONE_EDGE_FADE_MS = \d+;/);
  assert.match(html, /edgeFadeSamples/);
  assert.match(html, /edgeFade/);
});

test("public test page alternation cycles through quiet loud and very loud", () => {
  const html = fs.readFileSync(path.join(root, "test-page.html"), "utf8");
  const pulseHandler = html.match(/document\.getElementById\("pulseButton"\)[\s\S]*?document\.getElementById\("stopButton"\)/);

  assert.ok(pulseHandler, "pulse button handler should exist");
  assert.match(pulseHandler[0], /alternationSequence/);
  assert.match(pulseHandler[0], /QUIET_AMPLITUDE/);
  assert.match(pulseHandler[0], /LOUD_AMPLITUDE/);
  assert.match(pulseHandler[0], /VERY_LOUD_AMPLITUDE/);
  assert.match(pulseHandler[0], /label: "son très fort"/);
  assert.match(pulseHandler[0], /\$\{step\.label\} - attendre 8 s/);
});

test("public test page alternation displays a decreasing countdown", () => {
  const html = fs.readFileSync(path.join(root, "test-page.html"), "utf8");
  const pulseHandler = html.match(/document\.getElementById\("pulseButton"\)[\s\S]*?document\.getElementById\("stopButton"\)/);

  assert.ok(pulseHandler, "pulse button handler should exist");
  assert.match(html, /let countdownTimer;/);
  assert.match(pulseHandler[0], /function updateAlternationCountdown/);
  assert.match(pulseHandler[0], /Math\.ceil\(remainingMs \/ 1000\)/);
  assert.match(pulseHandler[0], /remainingSeconds/);
  assert.match(pulseHandler[0], /clearInterval\(countdownTimer\)/);
  assert.match(pulseHandler[0], /setInterval\(updateAlternationCountdown, 250\)/);
});

test("public test page includes a very loud stress tone", () => {
  const html = fs.readFileSync(path.join(root, "test-page.html"), "utf8");

  assert.match(html, /id="veryLoudButton"/);
  assert.match(html, /Son très fort/);
  assert.match(html, /const VERY_LOUD_AMPLITUDE = 0\.8912509381337456;/);
});

test("public test page uses requested single-button loudness controls", () => {
  const html = fs.readFileSync(path.join(root, "test-page.html"), "utf8");

  assert.match(html, /const QUIET_AMPLITUDE = 0\.001;/);
  assert.match(html, /const LOUD_AMPLITUDE = 0\.01001186529700907;/);
  assert.match(html, /const VERY_LOUD_AMPLITUDE = 0\.8912509381337456;/);
  assert.doesNotMatch(html, /MEDIUM_AMPLITUDE/);
  assert.match(html, />Démarrer</);
  assert.match(html, />Son faible</);
  assert.match(html, />Son fort</);
  assert.match(html, />Son très fort</);
  assert.match(html, />Alternance</);
  assert.match(html, /playLevel\(audio, QUIET_AMPLITUDE, "son faible"\)/);
  assert.match(html, /playLevel\(audio, LOUD_AMPLITUDE, "son fort"\)/);
  assert.match(html, /playLevel\(audio, VERY_LOUD_AMPLITUDE, "son très fort/);
  assert.doesNotMatch(html, /button-group-title/);
  assert.doesNotMatch(html, />Faible brut</);
  assert.doesNotMatch(html, />Fort brut</);
  assert.doesNotMatch(html, />Faible traité</);
  assert.doesNotMatch(html, />Fort traité</);
});

test("public test page tones match requested dB targets", () => {
  const html = fs.readFileSync(path.join(root, "test-page.html"), "utf8");

  function rmsDbFor(name) {
    const match = html.match(new RegExp("const " + name + "_AMPLITUDE = ([0-9.]+);"));
    assert.ok(match, name + "_AMPLITUDE should exist");
    return 20 * Math.log10(Number(match[1]) / Math.SQRT2);
  }

  const quietRmsDb = rmsDbFor("QUIET");
  const loudRmsDb = rmsDbFor("LOUD");
  const veryLoudRmsDb = rmsDbFor("VERY_LOUD");
  assert.ok(Math.abs(quietRmsDb - -63) <= 0.1, "quiet should be -63 dB RMS");
  assert.ok(Math.abs(veryLoudRmsDb - -4) <= 0.1, "very loud should keep -1 dBFS headroom");
  assert.ok(Math.abs(loudRmsDb - -43) <= 0.1, "loud should be -43 dB RMS");
  assert.ok(Math.abs(loudRmsDb - quietRmsDb - 20) <= 0.1, "loud should stay 20 dB above quiet");
  assert.ok(Math.abs(veryLoudRmsDb - loudRmsDb - 39) <= 0.1, "very loud should stay clearly above loud with peak headroom");
});

test("public test page locks the approved test sound levels", () => {
  const html = fs.readFileSync(path.join(root, "test-page.html"), "utf8");

  const approvedLevels = {
    QUIET: { amplitude: 0.001, rmsDb: -63 },
    LOUD: { amplitude: 0.01001186529700907, rmsDb: -43 },
    VERY_LOUD: { amplitude: 0.8912509381337456, rmsDb: -4.010299956639812 }
  };

  Object.entries(approvedLevels).forEach(([name, expected]) => {
    const match = html.match(new RegExp("const " + name + "_AMPLITUDE = ([0-9.]+);"));
    assert.ok(match, `${name}_AMPLITUDE should exist`);
    const amplitude = Number(match[1]);
    const rmsDb = 20 * Math.log10(amplitude / Math.SQRT2);

    assert.equal(amplitude, expected.amplitude);
    assert.ok(Math.abs(rmsDb - expected.rmsDb) <= 0.1, `${name} RMS should stay locked`);
  });
});
test("public test page reuses media elements while seeking inside one continuous test tone", () => {
  const html = fs.readFileSync(path.join(root, "test-page.html"), "utf8");
  const playLevelBody = html.match(/async function playLevel\(media, amplitude, label, keepPulse\) \{([\s\S]*?)\n\n      async function playDemoSequence/);

  assert.ok(playLevelBody, "playLevel should exist");
  assert.match(html, /function ensureContinuousMediaSource\(media\)/);
  assert.match(html, /async function seekMediaToLevel\(media, amplitude\)/);
  assert.match(html, /function rampMediaVolume\(media, targetVolume/);
  assert.match(playLevelBody[1], /ensureContinuousMediaSource\(media\)/);
  assert.match(playLevelBody[1], /await seekMediaToLevel\(media, amplitude\)/);
  assert.match(playLevelBody[1], /await rampMediaVolume\(media, 1\)/);
  assert.doesNotMatch(playLevelBody[1], /media = document\.createElement/);
  assert.doesNotMatch(playLevelBody[1], /stopMedia\(media\)/);
});

test("public test page de-clicks manual level changes with a short volume ramp", () => {
  const html = fs.readFileSync(path.join(root, "test-page.html"), "utf8");

  assert.match(html, /const VOLUME_RAMP_MS = 45;/);
  assert.match(html, /const MAX_VOLUME_RAMP_MS = \d+;/);
  assert.match(html, /const VOLUME_RAMP_DB_FOR_MAX_MS = \d+;/);
  assert.match(html, /const volumeRampTimers = new WeakMap\(\);/);
  assert.match(html, /function rampMediaVolume\(media, targetVolume/);
  assert.match(html, /requestAnimationFrame\(step\)/);
  assert.match(html, /Math\.cos\(Math\.PI \* progress\)/);
  assert.doesNotMatch(html, /media\.volume = amplitude;/);
});

test("public test page uses a longer ramp for large loudness jumps", () => {
  const html = fs.readFileSync(path.join(root, "test-page.html"), "utf8");

  assert.match(html, /function calculateVolumeRampDuration\(startVolume, targetVolume\)/);
  assert.match(html, /20 \* Math\.log10\(safeTarget \/ safeStart\)/);
  assert.match(html, /MAX_VOLUME_RAMP_MS - VOLUME_RAMP_MS/);
  assert.match(html, /durationMs = calculateVolumeRampDuration\(startVolume, targetVolume\)/);
});

test("public test page resolves canceled volume ramps before starting another", () => {
  const html = fs.readFileSync(path.join(root, "test-page.html"), "utf8");

  assert.match(html, /function cancelVolumeRamp\(media\)/);
  assert.match(html, /previousRamp\.resolve\(\);/);
  assert.match(html, /volumeRampTimers\.set\(media, rampState\);/);
  assert.match(html, /volumeRampTimers\.get\(media\) === rampState/);
});

test("public test page prepares media volume before playback to avoid raw clicks", () => {
  const html = fs.readFileSync(path.join(root, "test-page.html"), "utf8");
  const playLevelBody = html.match(/async function playLevel\(media, amplitude, label, keepPulse\) \{([\s\S]*?)\n\n      async function playDemoSequence/);

  assert.ok(playLevelBody, "playLevel should exist");
  assert.match(html, /function prepareMediaVolumeBeforePlay\(media\)/);
  assert.match(playLevelBody[1], /prepareMediaVolumeBeforePlay\(media\);/);
  assert.ok(
    playLevelBody[1].indexOf("prepareMediaVolumeBeforePlay(media);") <
      playLevelBody[1].indexOf("await media.play();"),
    "volume should be prepared before playback starts"
  );
});

test("public test page fades out media before pausing to avoid stop clicks", () => {
  const html = fs.readFileSync(path.join(root, "test-page.html"), "utf8");
  const stopMediaBody = html.match(/function stopMedia\(media\) \{([\s\S]*?)\n      \}/);

  assert.ok(stopMediaBody, "stopMedia should exist");
  assert.match(html, /function fadeOutAndPause\(media\)/);
  assert.match(stopMediaBody[1], /fadeOutAndPause\(media\);/);
  assert.doesNotMatch(stopMediaBody[1], /media\.pause\(\);/);
});

test("public test page bakes loudness into one continuous WAV to avoid source-switch crackle", () => {
  const html = fs.readFileSync(path.join(root, "test-page.html"), "utf8");
  const playLevelBody = html.match(/async function playLevel\(media, amplitude, label, keepPulse\) \{([\s\S]*?)\n\n      async function playDemoSequence/);

  assert.ok(playLevelBody, "playLevel should exist");
  assert.match(html, /let continuousToneUrl = null;/);
  assert.match(html, /const TEST_TONE_SEGMENTS = \[/);
  assert.match(html, /function getContinuousToneUrl\(\)/);
  assert.match(html, /function createSegmentedSineWaveBlob\(frequency, segments\)/);
  assert.match(html, /createSegmentedSineWaveBlob\(440, TEST_TONE_SEGMENTS\)/);
  assert.doesNotMatch(html, /createSineWaveBlob\(440, 1, TEST_TONE_SECONDS\)/);
  assert.doesNotMatch(html, /const toneUrls = new Map\(\);/);
  assert.match(playLevelBody[1], /await seekMediaToLevel\(media, amplitude\);/);
  assert.match(playLevelBody[1], /await rampMediaVolume\(media, 1\);/);
  assert.doesNotMatch(playLevelBody[1], /await rampMediaVolume\(media, amplitude\);/);
});

test("public test page fades before seeking to another baked segment", () => {
  const html = fs.readFileSync(path.join(root, "test-page.html"), "utf8");
  const playLevelBody = html.match(/async function playLevel\(media, amplitude, label, keepPulse\) \{([\s\S]*?)\n\n      async function playDemoSequence/);

  assert.ok(playLevelBody, "playLevel should exist");
  const fadeIndex = playLevelBody[1].indexOf("await rampMediaVolume(media, 0);");
  const sourceIndex = playLevelBody[1].indexOf("await seekMediaToLevel(media, amplitude);");

  assert.ok(fadeIndex >= 0, "playLevel should fade out before seeking");
  assert.ok(sourceIndex >= 0, "playLevel should seek to the requested level");
  assert.ok(fadeIndex < sourceIndex, "fade out should happen before seeking");
});

test("public test page seeks to prepared segment offsets without changing src per click", () => {
  const html = fs.readFileSync(path.join(root, "test-page.html"), "utf8");
  const seekBody = html.match(/async function seekMediaToLevel\(media, amplitude\) \{([\s\S]*?)\n      \}/);
  const playLevelBody = html.match(/async function playLevel\(media, amplitude, label, keepPulse\) \{([\s\S]*?)\n\n      async function playDemoSequence/);

  assert.ok(seekBody, "seekMediaToLevel should exist");
  assert.ok(playLevelBody, "playLevel should exist");
  assert.match(html, /function waitForMediaReady\(media\)/);
  assert.match(seekBody[1], /media\.pause\(\);/);
  assert.match(seekBody[1], /media\.currentTime = segment\.startSeconds;/);
  assert.match(seekBody[1], /await waitForMediaSeek\(media\);/);
  assert.doesNotMatch(seekBody[1], /media\.src =/);
  assert.doesNotMatch(seekBody[1], /media\.load\(\);/);
  assert.match(playLevelBody[1], /await seekMediaToLevel\(media, amplitude\);/);
  assert.ok(
    playLevelBody[1].indexOf("await seekMediaToLevel(media, amplitude);") <
      playLevelBody[1].indexOf("await media.play();"),
    "segment seek should finish before playback"
  );
});

test("public test page cancels stale level changes during rapid clicks", () => {
  const html = fs.readFileSync(path.join(root, "test-page.html"), "utf8");
  const playLevelBody = html.match(/async function playLevel\(media, amplitude, label, keepPulse\) \{([\s\S]*?)\n\n      async function playDemoSequence/);

  assert.ok(playLevelBody, "playLevel should exist");
  assert.match(html, /let playRequestId = 0;/);
  assert.match(playLevelBody[1], /const requestId = \+\+playRequestId;/);
  assert.match(playLevelBody[1], /if \(requestId !== playRequestId\) return;/);
  assert.match(html, /playRequestId \+= 1;/);
});
test("public test page reports the selected level before awaiting playback", () => {
  const html = fs.readFileSync(path.join(root, "test-page.html"), "utf8");
  const playLevelBody = html.match(/async function playLevel\(media, amplitude, label, keepPulse\) \{([\s\S]*?)\n\n      async function playDemoSequence/);

  assert.ok(playLevelBody, "playLevel should exist");
  const statusIndex = playLevelBody[1].indexOf("status.textContent = label");
  const playIndex = playLevelBody[1].indexOf("await media.play()");

  assert.ok(statusIndex >= 0, "playLevel should update the visible status");
  assert.ok(playIndex >= 0, "playLevel should still attempt media playback");
  assert.ok(statusIndex < playIndex, "status should update before media.play can reject");
  assert.match(playLevelBody[1], /catch \(error\)/);
});

test("public test page generated PCM keeps requested quiet loud and very loud dB order", () => {
  const html = fs.readFileSync(path.join(root, "test-page.html"), "utf8");

  function amplitudeFor(name) {
    const match = html.match(new RegExp("const " + name + "_AMPLITUDE = ([0-9.]+);"));
    assert.ok(match, name + "_AMPLITUDE should exist");
    return Number(match[1]);
  }

  function generatedPcmStats(amplitude) {
    const sampleRate = 44100;
    let squareSum = 0;
    let peak = 0;

    for (let index = 0; index < sampleRate; index += 1) {
      const sample = Math.sin((2 * Math.PI * 440 * index) / sampleRate);
      const value = Math.max(-1, Math.min(1, sample * amplitude));
      const pcm = Math.trunc(value * 32767) / 32767;
      squareSum += pcm * pcm;
      peak = Math.max(peak, Math.abs(pcm));
    }

    return {
      peak,
      rmsDb: 20 * Math.log10(Math.sqrt(squareSum / sampleRate))
    };
  }

  const quiet = generatedPcmStats(amplitudeFor("QUIET"));
  const loud = generatedPcmStats(amplitudeFor("LOUD"));
  const veryLoud = generatedPcmStats(amplitudeFor("VERY_LOUD"));

  assert.ok(quiet.peak < loud.peak, "generated quiet PCM peak should stay below loud PCM peak");
  assert.ok(loud.peak < veryLoud.peak, "generated loud PCM peak should stay below very loud PCM peak");
  assert.ok(Math.abs(quiet.rmsDb - -63) <= 0.2);
  assert.ok(Math.abs(veryLoud.rmsDb - -4) <= 0.1);
  assert.ok(Math.abs(loud.rmsDb - -43) <= 0.2);
});

test("public test page keeps the raw demo outside the extension pipeline", () => {
  const html = fs.readFileSync(path.join(root, "test-page.html"), "utf8");
  const contentSource = fs.readFileSync(path.join(root, "content.js"), "utf8");

  assert.match(html, /id="rawDemoAudio"/);
  assert.match(html, /data-stream-volume-guard-bypass="true"/);
  assert.match(html, /rawAudio/);
  assert.match(html, /playDemoSequence\(rawAudio,/);
  assert.match(html, /playDemoSequence\(audio,/);
  assert.match(contentSource, /const BYPASS_ATTR = "streamVolumeGuardBypass"/);
  assert.match(contentSource, /media\.dataset\[BYPASS_ATTR\] !== "true"/);
});

test("public test page requested levels are recoverable by the stream profile", () => {
  const html = fs.readFileSync(path.join(root, "test-page.html"), "utf8");
  const WLG = loadCore();
  const settings = WLG.Settings.normalizeSettings({});
  const profile = WLG.Settings.getRuntimeProfile(settings);

  function targetGainFor(name) {
    const match = html.match(new RegExp("const " + name + "_AMPLITUDE = ([0-9.]+);"));
    assert.ok(match, name + "_AMPLITUDE should exist");
    const amplitude = Number(match[1]);
    const rmsDb = 20 * Math.log10(amplitude / Math.SQRT2);
    return WLG.Normalizer.calculateTargetGainDb({
      currentRmsDb: rmsDb,
      targetRmsDb: profile.targetRmsDb,
      maxBoostDb: profile.maxBoostDb,
      maxReductionDb: profile.maxReductionDb
    });
  }

  assert.ok(targetGainFor("QUIET") < profile.maxBoostDb, "quiet level should remain recoverable below max boost");
  assert.ok(targetGainFor("QUIET") > 40, "quiet level should be recoverable even from -63 dB");
  assert.ok(targetGainFor("LOUD") > 20, "middle level should be boosted toward target");
  assert.ok(targetGainFor("LOUD") < profile.maxBoostDb, "middle level should stay below max boost");
  assert.ok(targetGainFor("VERY_LOUD") < 0, "very loud level should trigger reduction");
  assert.ok(targetGainFor("VERY_LOUD") > profile.maxReductionDb, "very loud reduction should stay inside max reduction");
});

test("public test page displays live extension status when available", () => {
  const html = fs.readFileSync(path.join(root, "test-page.html"), "utf8");

  assert.match(html, /id="extensionResults"/);
  assert.match(html, /id="extensionTarget"/);
  assert.match(html, /id="extensionGain"/);
  assert.match(html, /id="extensionMaxBoost"/);
  assert.match(html, /id="extensionRisk"/);
  assert.match(html, /id="extensionOutputRms"/);
  assert.match(html, /Boost max/);
  assert.match(html, /Moyenne RMS traitée/);
  assert.match(html, /WLG_TEST_PAGE_STATUS/);
  assert.match(html, /addEventListener\("message"/);
  assert.match(html, /toFixed\(1\)/);
});

test("public test page exposes a guided streamer readiness check", () => {
  const html = fs.readFileSync(path.join(root, "test-page.html"), "utf8");

  assert.match(html, /id="streamerTestButton"/);
  assert.match(html, /id="streamerTestResult"/);
  assert.match(html, /async function runStreamerReadinessTest\(\)/);
  assert.match(html, /STREAMER_TEST_STEPS/);
  assert.match(html, /waitForExtensionStatus/);
  assert.match(html, /outputDeltaDb <= 0\.7/);
  assert.match(html, /OK pour live/);
  assert.match(html, /À régler avant live/);
});

test("public docs use current test page button labels", () => {
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const quickstart = fs.readFileSync(path.join(root, "docs", "streamer-quickstart-60s.md"), "utf8");

  [readme, quickstart].forEach((docs) => {
    assert.match(docs, /Avec extension/);
    assert.match(docs, /Avant brut/);
    assert.doesNotMatch(docs, /Après équilibrage/);
  });
});

test("stream status helper classifies safe, warning and risky peaks", () => {
  const context = createContext();
  loadScript(context, "audio/analyser.js");
  loadScript(context, "audio/stream-status.js");

  const StreamStatus = context.StreamVolumeGuard.StreamStatus;
  assert.equal(StreamStatus.classifyRisk({
    predictedPeakDb: -8,
    ceilingDb: -1,
    rmsDb: -21,
    targetRmsDb: -18
  }).level, "safe");
  assert.equal(StreamStatus.classifyRisk({
    predictedPeakDb: -3,
    ceilingDb: -1,
    rmsDb: -15,
    targetRmsDb: -18
  }).level, "warning");
  assert.equal(StreamStatus.classifyRisk({
    predictedPeakDb: 1,
    ceilingDb: -1,
    rmsDb: -10,
    targetRmsDb: -18
  }).level, "risky");
});

test("stream status reacts immediately to loud incoming peaks", () => {
  const context = createContext();
  loadScript(context, "audio/analyser.js");
  loadScript(context, "audio/stream-status.js");

  const StreamStatus = context.StreamVolumeGuard.StreamStatus;
  const risk = StreamStatus.classifyRisk({
    peakDb: -1.8,
    predictedPeakDb: -8,
    ceilingDb: -1,
    rmsDb: -24,
    targetRmsDb: -18
  });

  assert.equal(risk.level, "risky");
  assert.equal(risk.reason, "incoming-peak");
});

test("stream status keeps short risky hold so streamers can see a spike", () => {
  const context = createContext();
  loadScript(context, "audio/analyser.js");
  loadScript(context, "audio/stream-status.js");

  const StreamStatus = context.StreamVolumeGuard.StreamStatus;
  const first = StreamStatus.nextRiskState({
    peakDb: -1.8,
    predictedPeakDb: -8,
    ceilingDb: -1,
    rmsDb: -24,
    targetRmsDb: -18,
    nowMs: 1000,
    previousRiskUntilMs: 0
  });
  const held = StreamStatus.nextRiskState({
    peakDb: -24,
    predictedPeakDb: -24,
    ceilingDb: -1,
    rmsDb: -28,
    targetRmsDb: -18,
    nowMs: 1600,
    previousRiskUntilMs: first.riskUntilMs
  });
  const cleared = StreamStatus.nextRiskState({
    peakDb: -24,
    predictedPeakDb: -24,
    ceilingDb: -1,
    rmsDb: -28,
    targetRmsDb: -18,
    nowMs: 2200,
    previousRiskUntilMs: first.riskUntilMs
  });

  assert.equal(first.level, "risky");
  assert.equal(first.riskUntilMs, 2000);
  assert.equal(held.level, "risky");
  assert.equal(held.reason, "held-risk");
  assert.equal(cleared.level, "safe");
});

test("normalizer uses held risk state and reports immediately on new risky spikes", () => {
  const source = fs.readFileSync(path.join(root, "audio", "normalizer.js"), "utf8");

  assert.match(source, /let riskUntilMs = 0;/);
  assert.match(source, /const wasRisky = riskLevel === "risky";/);
  assert.match(source, /StreamStatus\.nextRiskState\({[\s\S]*peakDb:\s*lastPeakDb,/);
  assert.match(source, /previousRiskUntilMs:\s*riskUntilMs/);
  assert.match(source, /riskUntilMs = processingEnabled \? risk\.riskUntilMs : 0;/);
  assert.match(source, /report\(\(levelJumped \|\| outputWouldOvershoot\) \|\| \(riskLevel === "risky" && !wasRisky\)\);/);
});

test("popup refreshes status frequently while open for responsive stream state", () => {
  const source = fs.readFileSync(path.join(root, "popup", "popup.js"), "utf8");

  assert.match(source, /const STATUS_REFRESH_MS = 250;/);
  assert.match(source, /let refreshTimer = null;/);
  assert.match(source, /if \(!root\.chrome \|\| !chrome\.runtime \|\| !chrome\.runtime\.sendMessage\)/);
  assert.match(source, /refreshTimer = root\.setInterval\(refresh, STATUS_REFRESH_MS\);/);
  assert.match(source, /root\.addEventListener\("unload", \(\) => root\.clearInterval\(refreshTimer\)\);/);
});

test("content refresh reconfigures existing media pipelines", () => {
  const contentSource = fs.readFileSync(path.join(root, "content.js"), "utf8");
  const normalizerSource = fs.readFileSync(path.join(root, "audio", "normalizer.js"), "utf8");

  assert.match(contentSource, /normalizer\.updateSettings\(settings\)/);
  assert.match(contentSource, /Settings\.getSettingsForDomain\(await Settings\.getSettings\(\), state\.site\)/);
  assert.match(contentSource, /targetRmsDb: settings\.targetRmsDb/);
  assert.match(contentSource, /targetRmsDb: nextState\.targetRmsDb/);
  assert.match(normalizerSource, /function updateSettings\(nextSettings\)/);
  assert.match(normalizerSource, /connectGraph\(\);/);
});

test("content refreshes when saved settings change in chrome storage", () => {
  const contentSource = fs.readFileSync(path.join(root, "content.js"), "utf8");

  assert.match(contentSource, /function startSettingsChangeListener/);
  assert.match(contentSource, /chrome\.storage\.onChanged\.addListener/);
  assert.match(contentSource, /areaName !== "local"/);
  assert.match(contentSource, /Settings\.SETTINGS_KEY/);
  assert.match(contentSource, /rescan\(\)/);
});

test("options target changes refresh injected tabs instead of the options page only", () => {
  const backgroundSource = fs.readFileSync(path.join(root, "background.js"), "utf8");
  const optionsSource = fs.readFileSync(path.join(root, "options", "options.js"), "utf8");

  assert.match(optionsSource, /id="applySettingsButton"|applySettingsButton/);
  assert.match(optionsSource, /scope:\s*"all-open-tabs"/);
  assert.match(backgroundSource, /function getAllTabs/);
  assert.match(backgroundSource, /function refreshOpenTabs/);
  assert.match(backgroundSource, /chrome\.tabs\.query\(\{\}/);
  assert.match(backgroundSource, /message\.scope === "all-open-tabs"/);
  assert.match(backgroundSource, /type: "WLG_REFRESH_SETTINGS"/);
});

test("options apply button confirms only after extension refresh response", () => {
  const optionsSource = fs.readFileSync(path.join(root, "options", "options.js"), "utf8");

  assert.match(optionsSource, /function setApplyButtonState/);
  assert.match(optionsSource, /elements\.applySettingsButton\.disabled = state === "sending"/);
  assert.match(optionsSource, /elements\.applySettingsButton\.textContent = i18n\("optionsApplySending"/);
  assert.match(optionsSource, /elements\.applySettingsButton\.textContent = i18n\("optionsApplyApplied"/);
  assert.match(optionsSource, /return new Promise\(\(resolve\) => \{/);
  assert.match(optionsSource, /chrome\.runtime\.sendMessage\(\{ type: "WLG_REFRESH_ACTIVE_TAB", scope: "all-open-tabs" \}, \(response\) => \{/);
  assert.match(optionsSource, /const refreshResult = await refreshOpenTabs\(\)/);
  assert.match(optionsSource, /setApplyButtonState\("applied"\)/);
  assert.match(optionsSource, /setApplyButtonState\("error"\)/);

  const refreshAwaitIndex = optionsSource.indexOf("const refreshResult = await refreshOpenTabs()");
  const appliedIndex = optionsSource.indexOf('setApplyButtonState("applied")');
  assert.ok(refreshAwaitIndex >= 0 && appliedIndex > refreshAwaitIndex, "button should confirm after refresh response");
});

test("options diagnostic export includes actionable streamer fields without private page data", () => {
  const optionsSource = fs.readFileSync(path.join(root, "options", "options.js"), "utf8");

  assert.match(optionsSource, /function detectBrowserFamily\(userAgent\)/);
  assert.match(optionsSource, /function buildDiagnosticQuality\(activeTab\)/);
  assert.match(optionsSource, /diagnosticQuality: buildDiagnosticQuality\(activeTab\)/);
  assert.match(optionsSource, /reason: "extension-not-active-on-current-tab"/);
  assert.match(optionsSource, /reason: "ready-for-bug-report"/);
  assert.match(optionsSource, /nextStep:/);
  assert.match(optionsSource, /streamerDiagnostics:\s*{/);
  assert.match(optionsSource, /browserFamily: detectBrowserFamily/);
  assert.match(optionsSource, /pipelineActive: activeTab\.enabled && !activeTab\.excluded && activeTab\.mediaProcessed > 0/);
  assert.match(optionsSource, /tabCaptureActive: activeTab\.sourceType === "tab-capture"/);
  assert.match(optionsSource, /permissionNeeded: activeTab\.canInject === false/);
  assert.match(optionsSource, /sourceIncompatible: activeTab\.enabled && !activeTab\.excluded && activeTab\.mediaDetected > 0 && activeTab\.mediaProcessed === 0/);
  assert.match(optionsSource, /includesFullUrl: false/);
  assert.match(optionsSource, /includesPageTitle: false/);
  assert.doesNotMatch(optionsSource, /location\.href/);
  assert.doesNotMatch(optionsSource, /document\.title/);
});

test("options platform profiles show recommended versus custom state clearly", () => {
  const optionsHtml = fs.readFileSync(path.join(root, "options", "options.html"), "utf8");
  const optionsSource = fs.readFileSync(path.join(root, "options", "options.js"), "utf8");
  const frMessages = readJson("_locales/fr/messages.json");
  const enMessages = readJson("_locales/en/messages.json");

  assert.match(optionsHtml, /id="platformProfilesList"/);
  assert.match(optionsSource, /className = `platform-profile-status/);
  assert.match(optionsSource, /platformProfileRecommendedProfile/);
  assert.match(optionsSource, /platformProfileCustomProfile/);
  assert.match(optionsSource, /platform-profile-domain-list/);
  assert.match(optionsSource, /select\.setAttribute\("aria-label"/);
  assert.equal(frMessages.platformProfileRecommendedProfile.message, "Profil recommandé");
  assert.equal(enMessages.platformProfileRecommendedProfile.message, "Recommended profile");
});

test("content publishes safe live status only to the local test page", () => {
  const contentSource = fs.readFileSync(path.join(root, "content.js"), "utf8");

  assert.match(contentSource, /function isLocalTestPage/);
  assert.match(contentSource, /state\.site === "127\.0\.0\.1"/);
  assert.match(contentSource, /state\.site === "localhost"/);
  assert.match(contentSource, /WLG_TEST_PAGE_STATUS/);
  assert.match(contentSource, /outputRmsDb: state\.outputRmsDb/);
  assert.match(contentSource, /maxBoostDb: state\.maxBoostDb/);
  assert.match(contentSource, /root\.postMessage/);
  assert.match(contentSource, /root\.location\.origin/);
  assert.doesNotMatch(contentSource, /root\.postMessage\([\s\S]*,\s*"\*"\)/);
});

test("local test page exposes post-chain output peak for OBS-style validation", () => {
  const normalizerSource = fs.readFileSync(path.join(root, "audio", "normalizer.js"), "utf8");
  const contentSource = fs.readFileSync(path.join(root, "content.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "test-page.html"), "utf8");
  const popupSource = fs.readFileSync(path.join(root, "popup", "popup.js"), "utf8");

  assert.match(normalizerSource, /let outputPeakDb = Analyser\.MIN_DB/);
  assert.match(normalizerSource, /function getEstimatedOutputPeakDb\(\)/);
  assert.match(normalizerSource, /function readOutputPeakDb\(\)/);
  assert.match(normalizerSource, /Analyser\.calculatePeakDb\(outputBuffer\)/);
  assert.match(normalizerSource, /outputPeakDb = preferEstimatedOutput \? getEstimatedOutputPeakDb\(\) : measuredOutputPeakDb/);
  assert.match(normalizerSource, /outputPeakDb: Number\(outputPeakDb\.toFixed\(2\)\)/);
  assert.match(contentSource, /outputPeakDb: state\.outputPeakDb/);
  assert.match(contentSource, /outputPeakDb: nextState\.outputPeakDb/);
  assert.match(html, /id="extensionOutputPeak"/);
  assert.match(html, /Moyenne RMS traitée/);
  assert.match(html, /const extensionOutputPeak = document\.getElementById\("extensionOutputPeak"\)/);
  assert.match(html, /extensionOutputPeak\.textContent = formatDb\(nextStatus\.outputPeakDb\)/);
  assert.match(popupSource, /outputPeakDb:/);
});

test("local test page and smoke test lock streamer equalization quality gates", () => {
  const html = fs.readFileSync(path.join(root, "test-page.html"), "utf8");
  const smokeHtml = fs.readFileSync(path.join(root, "tests", "technical-smoke.html"), "utf8");
  const browserSmokeSource = fs.readFileSync(path.join(root, "tests", "browser-smoke.js"), "utf8");

  assert.match(html, /const QUALITY_RMS_SPREAD_DB = 0\.5;/);
  assert.match(html, /const QUALITY_PEAK_SPREAD_DB = 1\.5;/);
  assert.match(html, /id="extensionEqualization"/);
  assert.match(html, /function formatEqualizationStatus\(nextStatus\)/);
  assert.match(html, /"égalisé"/);
  assert.match(html, /"en cours"/);
  assert.match(smokeHtml, /const QUALITY_RMS_SPREAD_DB = 0\.5;/);
  assert.match(smokeHtml, /const QUALITY_PEAK_SPREAD_DB = 1\.5;/);
  assert.match(smokeHtml, /alternationEndSpreadDb > QUALITY_RMS_SPREAD_DB/);
  assert.match(smokeHtml, /alternationEndPeakSpreadDb > QUALITY_PEAK_SPREAD_DB/);
  assert.match(browserSmokeSource, /equalizedOutputSpreadDb <= 0\.5/);
  assert.match(browserSmokeSource, /alternationEndSpreadDb <= 0\.5/);
  assert.match(browserSmokeSource, /alternationEndPeakSpreadDb <= 1\.5/);
  assert.match(smokeHtml, /const CALM_TARGET_RMS_DB = -25;/);
  assert.match(smokeHtml, /calmTargetPeakStats/);
  assert.match(smokeHtml, /targetRmsDb: -10/);
  assert.match(smokeHtml, /status\.targetRmsDb === -15/);
  assert.match(smokeHtml, /maxRecoverableTargetStats/);
  assert.match(smokeHtml, /maxRecoverableTargetSpreadDb > QUALITY_RMS_SPREAD_DB/);
  assert.match(smokeHtml, /function createRealWorldWaveBlob/);
  assert.match(smokeHtml, /realWorldLevelStats/);
  assert.match(smokeHtml, /quietAfterVeryLoudTransitionStats/);
  assert.match(smokeHtml, /quietTransitionPeakLimitDb = -17/);
  assert.match(browserSmokeSource, /calmTargetPeakSpreadDb <= 1/);
  assert.match(browserSmokeSource, /calmTargetVeryLoudPeakDeltaDb <= 1/);
  assert.match(browserSmokeSource, /maxRecoverableTargetSpreadDb <= 0\.5/);
  assert.match(browserSmokeSource, /realWorldLevelSpreadDb <= 1/);
  assert.match(browserSmokeSource, /realWorldVeryLoudShortfallDb <= 1/);
  assert.match(browserSmokeSource, /quietAfterVeryLoudTransitionOvershootDb <= 0/);
});

test("normalizer measures post-chain output RMS separately from raw RMS", () => {
  const normalizerSource = fs.readFileSync(path.join(root, "audio", "normalizer.js"), "utf8");

  assert.match(normalizerSource, /let outputRmsDb = Analyser\.MIN_DB/);
  assert.match(normalizerSource, /let outputAnalyser = null;/);
  assert.match(normalizerSource, /outputAnalyser = Analyser\.createAnalyserNode\(context, 2048\);/);
  assert.match(normalizerSource, /outputGain\.connect\(outputAnalyser\);[\s\S]*outputAnalyser\.connect\(context\.destination\);/);
  assert.match(normalizerSource, /function readOutputRmsDb\(\)/);
  assert.match(normalizerSource, /Analyser\.getAnalyserRmsDb\(outputAnalyser, outputBuffer\)/);
  assert.match(normalizerSource, /outputRmsDb: Number\(outputRmsDb\.toFixed\(2\)\)/);
});

test("normalizer includes a measured output trim to prevent quiet content overshoot", () => {
  const normalizerSource = fs.readFileSync(path.join(root, "audio", "normalizer.js"), "utf8");

  assert.match(normalizerSource, /let outputTrimGain = null;/);
  assert.match(normalizerSource, /let currentOutputTrimDb = 0;/);
  assert.match(normalizerSource, /const OUTPUT_TRIM_DEADBAND_DB = 0\.06;/);
  assert.match(normalizerSource, /outputAnalyser\.smoothingTimeConstant = 0\.15;/);
  assert.match(normalizerSource, /function updateOutputTrim\(measuredOutputRmsDb, elapsedMs, targetGainDb\)/);
  assert.match(normalizerSource, /Math\.abs\(correctionDb\) < OUTPUT_TRIM_DEADBAND_DB/);
  assert.match(normalizerSource, /const remainingBoostHeadroomDb = Math\.max\(0, profile\.maxBoostDb - targetGainDb\);/);
  assert.match(normalizerSource, /const highBoostSignal = targetGainDb >= 24;/);
  assert.match(normalizerSource, /const allowUpwardTrim = !highBoostSignal \|\| remainingBoostHeadroomDb >= 1\.5;/);
  assert.match(normalizerSource, /const maxTrimDb = highBoostSignal \? Math\.min\(0\.9, remainingBoostHeadroomDb\) : 3;/);
  assert.match(normalizerSource, /const minTrimDb = targetGainDb > 0 && targetGainDb < 24 \? -1\.5 : -12;/);
  assert.match(normalizerSource, /correctionDb > 0 && allowUpwardTrim[\s\S]*Analyser\.clamp\(correctionDb \* 0\.55, 0, 4\)/);
  assert.match(normalizerSource, /correctionDb < 0[\s\S]*Analyser\.clamp\(correctionDb \* 0\.35, -2\.5, 0\)/);
  assert.match(normalizerSource, /Analyser\.clamp\(currentOutputTrimDb \+ correctionStepDb, minTrimDb, maxTrimDb\)/);
  assert.match(normalizerSource, /if \(!allowUpwardTrim && targetTrimDb > 0\) \{/);
  assert.match(normalizerSource, /targetTrimDb = 0;/);
  assert.doesNotMatch(normalizerSource, /allowDownwardTrim/);
  assert.doesNotMatch(normalizerSource, /currentOutputTrimDb \+ correctionDb/);
  assert.match(normalizerSource, /const outputTooWeak = correctionDb > 1;/);
  assert.match(normalizerSource, /outputTooWeak && allowUpwardTrim[\s\S]*\? \(highBoostSignal \? 220 : 120\)/);
  assert.match(normalizerSource, /wetGain\.connect\(outputTrimGain\);[\s\S]*outputTrimGain\.connect\(outputGain\);/);
  assert.match(normalizerSource, /outputTrimGain\.gain\.setTargetAtTime/);
});

test("normalizer resets stale state and snaps gain on large input level jumps", () => {
  const normalizerSource = fs.readFileSync(path.join(root, "audio", "normalizer.js"), "utf8");

  assert.match(normalizerSource, /const TRANSITION_DUCK_GAIN = 0\.03;/);
  assert.match(normalizerSource, /const TRANSITION_DUCK_RAMP_SECONDS = 0\.01;/);
  assert.match(normalizerSource, /const TRANSITION_RECOVER_DELAY_SECONDS = 0\.018;/);
  assert.match(normalizerSource, /const TRANSITION_RECOVER_TIME_CONSTANT = 0\.032;/);
  assert.match(normalizerSource, /const OUTPUT_ESTIMATE_HOLD_MS = 1000;/);
  assert.match(normalizerSource, /let previousInputRmsDb = Analyser\.MIN_DB;/);
  assert.match(normalizerSource, /let outputTrimHoldUntilMs = 0;/);
  assert.match(normalizerSource, /let preferEstimatedOutputUntilMs = 0;/);
  assert.match(normalizerSource, /function resetOutputTrim\(timeConstant, snap\)/);
  assert.match(normalizerSource, /function handleLevelJump\(nextRmsDb\)/);
  assert.match(normalizerSource, /Math\.abs\(nextRmsDb - previousInputRmsDb\)/);
  assert.match(normalizerSource, /if \(inputJumpDb >= 12\)/);
  assert.match(normalizerSource, /resetOutputTrim\(0\.012, true\)/);
  assert.match(normalizerSource, /outputTrimHoldUntilMs = context\.currentTime \* 1000 \+ 900/);
  assert.match(normalizerSource, /now \* 1000 < outputTrimHoldUntilMs/);
  assert.match(normalizerSource, /const predictedOutputBeforeSmoothingDb = lastRmsDb \+ currentGainDb \+ currentOutputTrimDb/);
  assert.match(normalizerSource, /predictedOutputBeforeSmoothingDb > profile\.targetRmsDb \+ 1\.2/);
  assert.match(normalizerSource, /const shouldSnapGain = outputWouldOvershoot \|\|/);
  assert.match(normalizerSource, /levelJumped && targetGainDb < currentGainDb - 1/);
  assert.match(normalizerSource, /preferEstimatedOutputUntilMs = Math\.max\(/);
  assert.match(normalizerSource, /now \* 1000 \+ OUTPUT_ESTIMATE_HOLD_MS/);
  assert.match(normalizerSource, /levelJumped \|\| outputWouldOvershoot/);
  assert.match(normalizerSource, /rampParamToValue\(autoGain\.gain, linearGain, 0\.012\)/);
  assert.match(normalizerSource, /function duckTransitionOutput\(now, shouldDuck\)/);
  assert.match(normalizerSource, /rampParamToValue\(wetGain\.gain, TRANSITION_DUCK_GAIN, TRANSITION_DUCK_RAMP_SECONDS\)/);
  assert.match(normalizerSource, /wetGain\.gain\.setTargetAtTime\(1, now \+ TRANSITION_RECOVER_DELAY_SECONDS, TRANSITION_RECOVER_TIME_CONSTANT\)/);
  assert.match(normalizerSource, /const shouldDuckTransition = processingEnabled[\s\S]*targetGainDb < currentGainDb - 1/);
  assert.match(normalizerSource, /duckTransitionOutput\(now, shouldDuckTransition\)/);
  assert.match(normalizerSource, /currentGainDb = shouldSnapGain[\s\S]*\? targetGainDb/);
  assert.match(normalizerSource, /const heldLinearGain = Analyser\.dbToLinear\(currentGainDb\)/);
  assert.match(normalizerSource, /const preferEstimatedOutput = now \* 1000 < preferEstimatedOutputUntilMs;/);
  assert.match(normalizerSource, /function getTransitionOutputRmsDb\(\)/);
  assert.match(normalizerSource, /profile\.targetRmsDb - 1\.1/);
  assert.match(normalizerSource, /profile\.targetRmsDb \+ 0\.2/);
  assert.match(normalizerSource, /outputRmsDb = preferEstimatedOutput \? getTransitionOutputRmsDb\(\) : measuredOutputRmsDb;/);
  assert.doesNotMatch(normalizerSource, /const holdCorrectionDb/);
  assert.doesNotMatch(normalizerSource, /currentGainDb \+=/);
  assert.match(normalizerSource, /rampParamToValue\(outputTrimGain\.gain, 1, 0\.012\)/);
  assert.match(normalizerSource, /const levelJumped = handleLevelJump\(lastRmsDb\)/);
  assert.doesNotMatch(normalizerSource, /currentGainDb = levelJumped[\s\S]*\? targetGainDb/);
  assert.match(normalizerSource, /currentGainDb = shouldSnapGain[\s\S]*\? targetGainDb/);
  assert.equal(
    (normalizerSource.match(/currentGainDb = shouldSnapGain/g) || []).length,
    1,
    "current gain should be smoothed once per audio tick, even during transition hold"
  );
  assert.match(normalizerSource, /function cancelScheduledValues\(param\)/);
  assert.match(normalizerSource, /cancelAndHoldAtTime/);
  assert.match(normalizerSource, /function rampParamToValue\(param, value, rampSeconds\)[\s\S]*cancelScheduledValues\(param\)/);
  assert.match(normalizerSource, /rampParamToValue\(autoGain\.gain, linearGain, 0\.012\)/);
  assert.match(normalizerSource, /report\(\(levelJumped \|\| outputWouldOvershoot\) \|\|/);
});

test("normalizer catches up weak sounds quickly enough to match louder sounds by ear", () => {
  const normalizerSource = fs.readFileSync(path.join(root, "audio", "normalizer.js"), "utf8");
  const smokeSource = fs.readFileSync(path.join(root, "tests", "browser-smoke.js"), "utf8");

  assert.match(normalizerSource, /gapDb > 24 \? 90 : currentGainDb > 12 && gapDb > 6 \? 220 : releaseMs/);
  assert.match(normalizerSource, /const safeBoostSnap = processingEnabled/);
  assert.match(normalizerSource, /targetGainDb > currentGainDb \+ 18/);
  assert.match(normalizerSource, /lastRmsDb < profile\.targetRmsDb - 18/);
  assert.match(smokeSource, /quietAfterVeryLoudSettleMs <= 1700/);
  assert.match(smokeSource, /quietAfterVeryLoudTransitionStats\.averageOutputRmsDb >= -21\.35/);
  assert.match(smokeSource, /const expectedQuietPeakDb = value\.quietAfterVeryLoudStatus\.targetRmsDb \+ 3/);
  assert.match(smokeSource, /quietPeakDeltaDb <= 1/);
});

test("normalizer de-clicks transition gain changes with short ramps", () => {
  const normalizerSource = fs.readFileSync(path.join(root, "audio", "normalizer.js"), "utf8");

  assert.match(normalizerSource, /function rampParamToValue\(param, value, rampSeconds\)/);
  assert.match(normalizerSource, /cancelScheduledValues\(param\)/);
  assert.match(normalizerSource, /if \(typeof param\.setValueAtTime === "function"\)/);
  assert.match(normalizerSource, /linearRampToValueAtTime\(value, context\.currentTime \+ rampSeconds\)/);
  assert.match(normalizerSource, /rampParamToValue\(wetGain\.gain, TRANSITION_DUCK_GAIN, TRANSITION_DUCK_RAMP_SECONDS\)/);
  assert.match(normalizerSource, /wetGain\.gain\.setTargetAtTime\(1, now \+ TRANSITION_RECOVER_DELAY_SECONDS, TRANSITION_RECOVER_TIME_CONSTANT\)/);
  assert.doesNotMatch(normalizerSource, /rampParamToValue\(wetGain\.gain, 0\.03, 0\.006\)/);
  assert.match(normalizerSource, /rampParamToValue\(autoGain\.gain, linearGain, 0\.012\)/);
  assert.match(normalizerSource, /rampParamToValue\(autoGain\.gain, heldLinearGain, 0\.012\)/);
  assert.match(normalizerSource, /rampParamToValue\(outputTrimGain\.gain, 1, 0\.012\)/);
  assert.doesNotMatch(normalizerSource, /wetGain\.gain\.setValueAtTime\(0\.18, now\)/);
});

test("normalizer keeps the limiter internal audio path connected", () => {
  const normalizerSource = fs.readFileSync(path.join(root, "audio", "normalizer.js"), "utf8");

  assert.match(normalizerSource, /limiter && limiter\.output/);
  assert.doesNotMatch(normalizerSource, /limiter && limiter\.input/);
});

test("normalizer preserves limiter output after start and settings refresh", async () => {
  const context = createContext();
  const createdNodes = [];

  class FakeAudioParam {
    constructor(value = 0) {
      this.value = value;
    }

    setTargetAtTime(value) {
      this.value = value;
    }
  }

  class FakeAudioNode {
    constructor(kind) {
      this.kind = kind;
      this.connections = [];
      createdNodes.push(this);
    }

    connect(target) {
      this.connections.push(target);
      return target;
    }

    disconnect() {
      this.connections = [];
    }

    getFloatTimeDomainData(buffer) {
      buffer.fill(0.03);
    }
  }

  class FakeAudioContext {
    constructor() {
      this.currentTime = 0.1;
      this.state = "running";
      this.destination = new FakeAudioNode("destination");
    }

    createMediaElementSource() {
      return new FakeAudioNode("source");
    }

    createAnalyser() {
      return new FakeAudioNode("analyser");
    }

    createGain() {
      const node = new FakeAudioNode("gain");
      node.gain = new FakeAudioParam(1);
      return node;
    }

    createDynamicsCompressor() {
      const node = new FakeAudioNode("compressor");
      node.threshold = new FakeAudioParam();
      node.knee = new FakeAudioParam();
      node.ratio = new FakeAudioParam();
      node.attack = new FakeAudioParam();
      node.release = new FakeAudioParam();
      return node;
    }

    resume() {
      this.state = "running";
      return Promise.resolve();
    }

    close() {
      this.state = "closed";
      return Promise.resolve();
    }
  }

  context.AudioContext = FakeAudioContext;
  context.webkitAudioContext = FakeAudioContext;
  context.requestAnimationFrame = () => 1;
  context.cancelAnimationFrame = () => {};

  [
    "storage/settings.js",
    "license/capabilities.js",
    "audio/analyser.js",
    "audio/limiter.js",
    "audio/stream-status.js",
    "audio/normalizer.js"
  ].forEach((file) => loadScript(context, file));

  const WLG = context.StreamVolumeGuard;
  const settings = {
    ...WLG.Settings.DEFAULT_SETTINGS,
    enabled: true,
    limiterEnabled: true,
    compressorEnabled: true
  };
  const normalizer = WLG.Normalizer.createMediaNormalizer({ tagName: "VIDEO" }, settings, {});
  const limiterInputsWithOutput = () => createdNodes.filter((node) => {
    return node.kind === "compressor" && node.connections.some((target) => target.kind === "gain");
  });

  await normalizer.start();
  assert.equal(limiterInputsWithOutput().length, 1);

  normalizer.updateSettings({
    ...settings,
    activeProfile: "night",
    targetRmsDb: WLG.Settings.PROFILES.night.targetRmsDb
  });
  assert.equal(limiterInputsWithOutput().length, 1);

  normalizer.stop();
});

test("activation does not steal media audio before AudioContext is running", () => {
  const contentSource = fs.readFileSync(path.join(root, "content.js"), "utf8");
  const normalizerSource = fs.readFileSync(path.join(root, "audio", "normalizer.js"), "utf8");

  assert.match(contentSource, /async function processMedia/);
  assert.match(contentSource, /await normalizer\.start\(\)/);
  assert.match(normalizerSource, /let source = null;/);
  assert.match(normalizerSource, /async function ensureContextRunning\(\)/);
  assert.match(normalizerSource, /await ensureContextRunning\(\);[\s\S]*ensureGraphStarted\(\);/);
});

test("panic mode caps the active media pipeline", () => {
  const contentSource = fs.readFileSync(path.join(root, "content.js"), "utf8");
  const normalizerSource = fs.readFileSync(path.join(root, "audio", "normalizer.js"), "utf8");

  assert.match(contentSource, /WLG_SET_PANIC/);
  assert.match(contentSource, /normalizer\.setPanic\(state\.panicActive\)/);
  assert.match(normalizerSource, /let outputGain = null;/);
  assert.match(normalizerSource, /outputGain = context\.createGain\(\)/);
  assert.match(normalizerSource, /function setPanic\(nextActive\)/);
  assert.match(normalizerSource, /runtimeSettings\.panicGainDb/);
});

test("tab capture fallback is isolated in an offscreen document", () => {
  const manifest = readJson("manifest.json");
  const backgroundSource = fs.readFileSync(path.join(root, "background.js"), "utf8");
  const offscreenHtml = fs.readFileSync(path.join(root, "offscreen", "offscreen.html"), "utf8");
  const offscreenJs = fs.readFileSync(path.join(root, "offscreen", "offscreen.js"), "utf8");

  assert.ok(manifest.permissions.includes("tabCapture"));
  assert.ok(manifest.permissions.includes("offscreen"));
  assert.match(backgroundSource, /chrome\.tabCapture\.getMediaStreamId/);
  assert.match(backgroundSource, /offscreen\/offscreen\.html/);
  assert.match(offscreenHtml, /offscreen\.js/);
  assert.match(offscreenJs, /chromeMediaSourceId/);
  assert.match(offscreenJs, /Normalizer\.createMediaNormalizer/);
});

test("tab capture respects exclusions and stops on navigation", () => {
  const backgroundSource = fs.readFileSync(path.join(root, "background.js"), "utf8");

  assert.match(backgroundSource, /Settings\.isDomainExcluded\(site, savedSettings\)/);
  assert.match(backgroundSource, /excluded:\s*true/);
  assert.match(backgroundSource, /This domain is excluded from StreamVolume Guard/);
  assert.match(backgroundSource, /captureStatuses\.has\(tabId\)[\s\S]*WLG_STOP_TAB_CAPTURE/);
});

test("manifest uses localized metadata and Guard Signal PNG icons", () => {
  const manifest = readJson("manifest.json");

  assert.equal(manifest.default_locale, "en");
  assert.equal(manifest.name, "__MSG_extensionName__");
  assert.equal(manifest.description, "__MSG_extensionDescription__");
  assert.equal(manifest.action.default_title, "__MSG_extensionName__");

  ["16", "32", "48", "128"].forEach((size) => {
    const iconPath = manifest.icons[size];
    assert.equal(iconPath, `assets/icons/icon${size}.png`);
    const icon = fs.readFileSync(path.join(root, iconPath));
    assert.equal(icon.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  });
});

test("english and french locale files contain required extension messages", () => {
  const requiredKeys = [
    "extensionName",
    "extensionDescription",
    "popupSafe",
    "popupWarning",
    "popupRisky",
    "popupContainedPeaks",
    "popupDiagnostics"
  ];

  ["en", "fr"].forEach((locale) => {
    const messages = readJson(`_locales/${locale}/messages.json`);
    requiredKeys.forEach((key) => {
      assert.equal(typeof messages[key].message, "string", `${locale} should define ${key}`);
      assert.ok(messages[key].message.length > 0, `${locale}.${key} should not be empty`);
    });
  });
});

test("popup exposes streamer safety status, contained peaks and diagnostics", () => {
  const html = fs.readFileSync(path.join(root, "popup", "popup.html"), "utf8");

  assert.match(html, /id="riskBadge"/);
  assert.match(html, /id="containedPeaksValue"/);
  assert.match(html, /id="diagnosticsList"/);
  assert.match(html, /data-i18n="popupDiagnostics"/);
});

test("popup copied diagnostic contains actionable local-safe fields", () => {
  const js = fs.readFileSync(path.join(root, "popup", "popup.js"), "utf8");

  assert.match(js, /chrome\.runtime\.getManifest/);
  assert.match(js, /extensionVersion/);
  assert.match(js, /browserLanguage/);
  assert.match(js, /excluded:/);
  assert.match(js, /canInject:/);
  assert.match(js, /canCaptureTab:/);
  assert.match(js, /gainDb:/);
  assert.match(js, /rmsDb:/);
  assert.match(js, /outputPeakDb:/);
  assert.match(js, /peakDb:/);
  assert.match(js, /predictedPeakDb:/);
  assert.match(js, /includesFullUrl:\s*false/);
  assert.match(js, /includesPageTitle:\s*false/);
  assert.match(js, /includesAudio:\s*false/);
  assert.doesNotMatch(js, /document\.title/);
});

test("popup exposes trust badges for local open-source no-tracking adoption", () => {
  const html = fs.readFileSync(path.join(root, "popup", "popup.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "popup", "popup.css"), "utf8");
  const requiredKeys = ["trustLocalOnly", "trustOpenSource", "trustNoTracking"];

  assert.match(html, /class="trust-strip"/);
  requiredKeys.forEach((key) => {
    assert.match(html, new RegExp(`data-i18n="${key}"`), `popup should expose ${key}`);
  });
  assert.match(css, /\.trust-strip/);
  assert.match(css, /\.trust-strip\s*{[\s\S]*display:\s*flex;/);
  assert.match(css, /\.trust-strip\s*{[\s\S]*justify-content:\s*center;/);
  assert.match(css, /\.trust-strip\s*{[\s\S]*width:\s*fit-content;/);
  assert.match(css, /\.trust-strip\s*{[\s\S]*margin:\s*0 auto;/);
  assert.match(css, /\.trust-strip span\s*{[\s\S]*width:\s*fit-content;/);
  assert.match(css, /\.trust-strip span\s*{[\s\S]*min-width:\s*82px;/);

  ["en", "fr"].forEach((locale) => {
    const messages = readJson(`_locales/${locale}/messages.json`);
    requiredKeys.forEach((key) => {
      assert.equal(typeof messages[key].message, "string", `${locale} should define ${key}`);
      assert.ok(messages[key].message.length > 4, `${locale}.${key} should not be empty`);
    });
  });
  assert.equal(readJson("_locales/fr/messages.json").trustLocalOnly.message, "Local");
  assert.equal(readJson("_locales/en/messages.json").trustLocalOnly.message, "Local");
});

test("popup and options avoid innerHTML for safer public builds", () => {
  const popupJs = fs.readFileSync(path.join(root, "popup", "popup.js"), "utf8");
  const optionsJs = fs.readFileSync(path.join(root, "options", "options.js"), "utf8");

  assert.doesNotMatch(popupJs, /\.innerHTML\s*=/);
  assert.doesNotMatch(optionsJs, /\.innerHTML\s*=/);
  assert.match(popupJs, /replaceChildren/);
  assert.match(optionsJs, /replaceChildren/);
});

test("popup and options expose localized help buttons for each important option", () => {
  const popupHtml = fs.readFileSync(path.join(root, "popup", "popup.html"), "utf8");
  const popupCss = fs.readFileSync(path.join(root, "popup", "popup.css"), "utf8");
  const popupJs = fs.readFileSync(path.join(root, "popup", "popup.js"), "utf8");
  const optionsHtml = fs.readFileSync(path.join(root, "options", "options.html"), "utf8");
  const optionsCss = fs.readFileSync(path.join(root, "options", "options.css"), "utf8");
  const optionsJs = fs.readFileSync(path.join(root, "options", "options.js"), "utf8");
  const requiredPopupHelp = [
    "helpStreamStatus",
    "helpContainedPeaks",
    "helpGain",
    "helpRms",
    "helpMedia",
    "helpDiagnostics",
    "helpAutoDomain"
  ];
  const requiredOptionsHelp = [
    "helpTargetRms",
    "helpMaxBoost",
    "helpMaxReduction",
    "helpCompressor",
    "helpLimiter",
    "helpAutoDomains",
    "helpExcludedDomains",
    "helpCapabilities"
  ];
  const removedObviousHelp = [
    "helpNormalization",
    "helpProfile",
    "helpActivateTab",
    "helpOptions",
    "helpOptionsProfile",
    "helpEnabled"
  ];

  requiredPopupHelp.forEach((key) => {
    assert.match(popupHtml, new RegExp(`data-help-i18n="${key}"`), `popup should expose ${key}`);
  });
  requiredOptionsHelp.forEach((key) => {
    assert.match(optionsHtml, new RegExp(`data-help-i18n="${key}"`), `options should expose ${key}`);
  });
  removedObviousHelp.forEach((key) => {
    assert.doesNotMatch(popupHtml, new RegExp(`data-help-i18n="${key}"`), `popup should not expose obvious help ${key}`);
    assert.doesNotMatch(optionsHtml, new RegExp(`data-help-i18n="${key}"`), `options should not expose obvious help ${key}`);
  });
  assert.match(popupCss, /\.help-button[\s\S]*top:\s*6px;[\s\S]*left:\s*6px;/);
  assert.match(optionsCss, /\.help-button[\s\S]*top:\s*6px;[\s\S]*left:\s*6px;/);
  assert.doesNotMatch(popupJs, /setAttribute\("title"/);
  assert.doesNotMatch(optionsJs, /setAttribute\("title"/);

  ["en", "fr"].forEach((locale) => {
    const messages = readJson(`_locales/${locale}/messages.json`);
    [...requiredPopupHelp, ...requiredOptionsHelp].forEach((key) => {
      assert.equal(typeof messages[key].message, "string", `${locale} should define ${key}`);
      assert.ok(messages[key].message.length > 12, `${locale}.${key} should explain the option`);
    });
  });
});

test("popup layout stays compact enough to avoid extension popup scrolling", () => {
  const popupCss = fs.readFileSync(path.join(root, "popup", "popup.css"), "utf8");

  assert.match(popupCss, /body\s*{[\s\S]*width:\s*340px;/);
  assert.match(popupCss, /main\s*{[\s\S]*gap:\s*7px;[\s\S]*padding:\s*8px 10px 10px;/);
  assert.match(popupCss, /\.actions\s*{[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/);
  assert.doesNotMatch(popupCss, /padding:\s*24px/);
  assert.doesNotMatch(popupCss, /padding-top:\s*22px/);
});

test("help tooltips render above inactive question mark buttons", () => {
  const popupCss = fs.readFileSync(path.join(root, "popup", "popup.css"), "utf8");
  const optionsCss = fs.readFileSync(path.join(root, "options", "options.css"), "utf8");

  assert.match(popupCss, /\.help-button\s*{[\s\S]*z-index:\s*1;/);
  assert.match(popupCss, /\.help-button::after\s*{[\s\S]*z-index:\s*2;/);
  assert.doesNotMatch(popupCss, /\.help-button\s*{[\s\S]*z-index:\s*10;/);
  assert.match(popupCss, /\.help-button:hover,\s*\.help-button:focus-visible\s*{[\s\S]*z-index:\s*30;/);
  assert.match(optionsCss, /\.help-button\s*{[\s\S]*z-index:\s*1;/);
  assert.match(optionsCss, /\.help-button:hover\s*{[\s\S]*z-index:\s*30;/);
  assert.match(optionsCss, /\.options-help-tooltip\s*{[\s\S]*z-index:\s*1000;/);
  assert.doesNotMatch(optionsCss, /\.help-button::after/);
});

test("options help tooltip hitbox stays limited to the question mark button", () => {
  const optionsCss = fs.readFileSync(path.join(root, "options", "options.css"), "utf8");
  const optionsJs = fs.readFileSync(path.join(root, "options", "options.js"), "utf8");

  assert.match(optionsCss, /\.options-help-tooltip\s*{[\s\S]*pointer-events:\s*none;/);
  assert.match(optionsCss, /\.options-help-tooltip\.is-visible\s*{[\s\S]*display:\s*block;/);
  assert.match(optionsJs, /function setupHelpTooltips\(\)/);
  assert.match(optionsJs, /button\.addEventListener\("mouseenter"/);
  assert.match(optionsJs, /button\.addEventListener\("mouseleave", hideTooltip\)/);
  assert.doesNotMatch(optionsCss, /\.help-button:focus-visible::after/);
  assert.doesNotMatch(optionsCss, /\.help-button:hover::after/);
  assert.doesNotMatch(optionsCss, /\.option-field:hover\s+\.help-button::after/);
  assert.doesNotMatch(optionsCss, /\.help-anchor:hover\s+\.help-button::after/);
});

test("popup right-column help tooltips stay inside the popup frame", () => {
  const popupCss = fs.readFileSync(path.join(root, "popup", "popup.css"), "utf8");

  assert.match(
    popupCss,
    /\.stream-status\s+\.help-anchor:nth-child\(2\)\s+\.help-button::after,\s*\.metrics\s+\.help-anchor:nth-child\(n \+ 2\)\s+\.help-button::after\s*{[\s\S]*left:\s*50%;[\s\S]*right:\s*auto;[\s\S]*transform:\s*translate\(-50%,\s*-2px\);/
  );
  assert.match(
    popupCss,
    /\.stream-status\s+\.help-anchor:nth-child\(2\)\s+\.help-button:hover::after,[\s\S]*\.metrics\s+\.help-anchor:nth-child\(n \+ 2\)\s+\.help-button:focus-visible::after\s*{[\s\S]*transform:\s*translate\(-50%,\s*0\);/
  );
  assert.doesNotMatch(popupCss, /\.stream-status div:last-child \.help-button::after/);
});

test("options page keeps inline warning badges without a redundant streamer alert panel", () => {
  const html = fs.readFileSync(path.join(root, "options", "options.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "options", "options.css"), "utf8");
  const js = fs.readFileSync(path.join(root, "options", "options.js"), "utf8");

  assert.match(html, /class="options-logo"/);
  assert.doesNotMatch(html, /warningsList/);
  assert.doesNotMatch(html, /warnings-panel/);
  assert.doesNotMatch(html, /Alertes streamer/);
  assert.match(html, /data-warning-for="targetRmsDb"/);
  assert.match(html, /data-warning-for="maxBoostDb"/);
  assert.match(html, /id="maxBoostDb" type="number" min="0" max="48" step="1"/);
  assert.match(html, /data-warning-for="compressorEnabled"/);
  assert.match(html, /data-warning-for="limiterEnabled"/);
  assert.match(html, /data-warning-for="excludedDomains"/);
  assert.match(css, /\.warning-badge/);
  assert.match(css, /\.warning-badge\.is-active/);
  assert.match(css, /\.warning-badge::after/);
  assert.match(css, /\.panel/);
  assert.match(js, /function getOptionWarnings/);
  assert.match(js, /const warningText = warning \? i18n\(warning\.key, warning\.key\) : "";/);
  assert.match(js, /badge\.dataset\.warningText = warningText;/);
  assert.doesNotMatch(js, /warningsList/);
  assert.match(js, /targetRmsDb >= -16/);
  assert.match(js, /maxBoostDb > 12/);
  assert.match(js, /limiterEnabled === false/);
});


test("options capability labels are localized and future-only items stay planned", () => {
  const optionsJs = fs.readFileSync(path.join(root, "options", "options.js"), "utf8");
  const requiredKeys = [
    "capabilitySafetyLimiter",
    "capabilityPerDomainProfiles",
    "capabilityTabCaptureFallback",
    "capabilityPanicMode",
    "capabilityDiagnosticCopy",
    "capabilityGuidedObsCalibration",
    "capabilityAdvancedLimiter",
    "capabilitySettingsSync",
    "capabilityAdvancedShortcuts",
    "capabilityActive",
    "capabilityLocked"
  ];

  assert.match(optionsJs, /guidedObsCalibration/);
  assert.equal(optionsJs.includes('["obsCalibration"'), false);
  assert.doesNotMatch(optionsJs, /"actif"s*:s*"verrouill/);

  ["en", "fr"].forEach((locale) => {
    const messages = readJson(`_locales/${locale}/messages.json`);
    requiredKeys.forEach((key) => {
      assert.equal(typeof messages[key].message, "string", `${locale} should define ${key}`);
      assert.ok(messages[key].message.length > 0, `${locale}.${key} should not be empty`);
    });
  });
});

test("options expose platform profiles with resettable local overrides", () => {
  const html = fs.readFileSync(path.join(root, "options", "options.html"), "utf8");
  const js = fs.readFileSync(path.join(root, "options", "options.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "options", "options.css"), "utf8");
  const requiredKeys = [
    "platformProfilesTitle",
    "platformProfilesDescription",
    "platformProfileRecommended",
    "platformProfileCustomized",
    "platformProfileReset",
    "platformProfileApplied"
  ];

  assert.match(html, /id="platformProfilesList"/);
  assert.match(html, /data-i18n="platformProfilesTitle"/);
  assert.match(html, /data-i18n="platformProfilesDescription"/);
  assert.match(js, /function renderPlatformProfiles/);
  assert.match(js, /Settings\.PLATFORM_PROFILE_RULES/);
  assert.match(js, /domainProfiles/);
  assert.match(js, /data-platform-domain/);
  assert.match(js, /platformProfileReset/);
  assert.match(js, /Settings\.saveSettings\(\{ domainProfiles:/);
  assert.match(css, /\.platform-profiles/);
  assert.match(css, /\.platform-profile-card/);

  ["en", "fr"].forEach((locale) => {
    const messages = readJson(`_locales/${locale}/messages.json`);
    requiredKeys.forEach((key) => {
      assert.equal(typeof messages[key].message, "string", `${locale} should define ${key}`);
      assert.ok(messages[key].message.length > 0, `${locale}.${key} should not be empty`);
    });
  });
});

test("options expose a target loudness slider with local audio preview", () => {
  const html = fs.readFileSync(path.join(root, "options", "options.html"), "utf8");
  const js = fs.readFileSync(path.join(root, "options", "options.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "options", "options.css"), "utf8");
  const requiredKeys = [
    "targetVolumeTitle",
    "targetVolumeDescription",
    "targetVolumeQuiet",
    "targetVolumeLoud",
    "targetVolumePlay",
    "targetVolumeStop",
    "targetVolumePreviewNote"
  ];

  assert.match(html, /id="targetRmsSlider"/);
  assert.match(html, /id="targetRmsSlider" type="range" min="-48" max="-15" step="0\.5"/);
  assert.match(html, /id="targetRmsDb" type="number" min="-48" max="-15" step="0\.5" inputmode="decimal"/);
  assert.match(html, /id="targetRmsDisplay"/);
  assert.match(html, /id="playTargetPreviewButton"/);
  assert.match(html, /id="stopTargetPreviewButton"/);
  assert.match(html, /id="applySettingsButton"/);
  assert.match(html, /Appliquer les réglages/);
  assert.match(html, /data-i18n="targetVolumeTitle"/);
  assert.match(js, /function syncTargetRmsControls/);
  assert.match(js, /Math\.max\(-48, Math\.min\(-15, number\)\)/);
  assert.match(js, /function startTargetPreview/);
  assert.match(js, /function stopTargetPreview/);
  assert.match(js, /createOscillator/);
  assert.match(js, /createGain/);
  assert.match(js, /targetRmsSlider\.addEventListener\("input"/);
  assert.match(js, /targetRmsDb\.addEventListener\("input"/);
  assert.match(js, /function refreshOpenTabs/);
  assert.match(js, /Settings\.saveSettings\(nextSettings\)/);
  assert.match(js, /WLG_REFRESH_ACTIVE_TAB/);
  assert.doesNotMatch(js, /saveLive/);
  assert.doesNotMatch(js, /scheduleTargetRmsSave/);
  assert.doesNotMatch(js, /flushTargetRmsSave/);
  assert.doesNotMatch(js, /Settings\.saveSettings\(\{ targetRmsDb/);
  assert.match(css, /\.target-volume-panel/);
  assert.match(css, /\.target-volume-slider/);

  ["en", "fr"].forEach((locale) => {
    const messages = readJson(`_locales/${locale}/messages.json`);
    requiredKeys.forEach((key) => {
      assert.equal(typeof messages[key].message, "string", `${locale} should define ${key}`);
      assert.ok(messages[key].message.length > 0, `${locale}.${key} should not be empty`);
    });
  });
});

test("options page keeps visible guidance and no stale required controls", () => {
  const html = fs.readFileSync(path.join(root, "options", "options.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "options", "options.css"), "utf8");
  const js = fs.readFileSync(path.join(root, "options", "options.js"), "utf8");
  const descriptionKeys = [
    "optionsProfileDescription",
    "optionsTargetDescription",
    "optionsBoostDescription",
    "optionsReductionDescription",
    "optionsAutoDomainsDescription",
    "optionsExcludedDomainsDescription",
    "optionsCapabilitiesDescription"
  ];

  descriptionKeys.forEach((key) => {
    assert.match(html, new RegExp(`data-i18n="${key}"`), `options should show ${key}`);
  });

  ["en", "fr"].forEach((locale) => {
    const messages = readJson(`_locales/${locale}/messages.json`);
    descriptionKeys.forEach((key) => {
      assert.equal(typeof messages[key].message, "string", `${locale} should define ${key}`);
      assert.ok(messages[key].message.length > 12, `${locale}.${key} should describe the setting`);
    });
  });

  assert.match(css, /\.field-description/);
  assert.doesNotMatch(js, /copyBugReportButton/);
  assert.doesNotMatch(js, /copyBugReportTemplate/);
  assert.doesNotMatch(js, /playCalibrationTone/);
});

test("options page uses a streamer dashboard layout", () => {
  const html = fs.readFileSync(path.join(root, "options", "options.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "options", "options.css"), "utf8");

  assert.match(html, /class="settings-overview"/);
  assert.match(html, /class="options-layout"/);
  assert.match(html, /class="primary-stack"/);
  assert.match(html, /class="sidebar-stack"/);
  assert.match(html, /class="panel audio-panel"/);
  assert.match(html, /class="panel trust-panel"/);
  assert.match(html, /class="trust-list"/);
  assert.match(css, /\.settings-overview/);
  assert.match(css, /\.options-layout/);
  assert.match(css, /\.sidebar-stack/);
  assert.match(css, /\.audio-grid/);
  assert.match(css, /\.trust-panel/);
  assert.doesNotMatch(css, /\.sidebar-stack\s*{[\s\S]*position:\s*sticky/);
  assert.match(css, /#153243 92px/);
  assert.match(css, /#eef4f6 92px/);
});

test("options expose a local diagnostic export without sensitive page data", () => {
  const html = fs.readFileSync(path.join(root, "options", "options.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "options", "options.css"), "utf8");
  const js = fs.readFileSync(path.join(root, "options", "options.js"), "utf8");

  assert.match(html, /class="panel diagnostics-export"/);
  assert.match(html, /id="exportDiagnosticsButton"/);
  assert.match(html, /data-i18n="optionsDiagnosticsExport"/);
  assert.match(css, /\.diagnostics-export/);
  assert.match(css, /\.diagnostic-actions/);
  assert.match(js, /function buildDiagnosticReport/);
  assert.match(js, /function safeStatus/);
  assert.match(js, /chrome\.runtime\.getManifest/);
  assert.match(js, /WLG_GET_ACTIVE_STATUS/);
  assert.match(js, /URL\.createObjectURL/);
  assert.match(js, /download = `streamvolume-guard-diagnostic-/);
  assert.match(js, /includesFullUrl:\s*false/);
  assert.match(js, /includesPageTitle:\s*false/);
  assert.match(js, /outputPeakDb:/);
  assert.doesNotMatch(js, /document\.title/);
  assert.doesNotMatch(js, /tab\.url/);
  assert.doesNotMatch(js, /status\.url/);
});

test("english and french locale files contain dynamic warning messages", () => {
  const requiredKeys = [
    "warningTargetHot",
    "warningBoostHigh",
    "warningCompressorOff",
    "warningLimiterOff",
    "warningExcludedDomains"
  ];

  ["en", "fr"].forEach((locale) => {
    const messages = readJson(`_locales/${locale}/messages.json`);
    requiredKeys.forEach((key) => {
      assert.equal(typeof messages[key].message, "string", `${locale} should define ${key}`);
      assert.ok(messages[key].message.length > 8, `${locale}.${key} should be descriptive`);
    });
  });
});

test("english and french locale files contain diagnostic export messages", () => {
  const requiredKeys = [
    "optionsDiagnosticsTitle",
    "optionsDiagnosticsPrivacy",
    "optionsDiagnosticsDescription",
    "optionsDiagnosticsExport"
  ];

  ["en", "fr"].forEach((locale) => {
    const messages = readJson(`_locales/${locale}/messages.json`);
    requiredKeys.forEach((key) => {
      assert.equal(typeof messages[key].message, "string", `${locale} should define ${key}`);
      assert.ok(messages[key].message.length > 6, `${locale}.${key} should be descriptive`);
    });
  });
});

test("public docs expose privacy policy, platform validation and release packaging", () => {
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const testerChecklist = fs.readFileSync(path.join(root, "docs", "tester-checklist.md"), "utf8");
  const roadmap = fs.readFileSync(path.join(root, "docs", "future-implementation-roadmap.md"), "utf8");
  const privacy = fs.readFileSync(path.join(root, "docs", "privacy-policy.md"), "utf8");
  const realPlatformPlan = fs.readFileSync(path.join(root, "docs", "real-platform-test-plan.md"), "utf8");
  const packageRelease = fs.readFileSync(path.join(root, "tools", "package-release.js"), "utf8");

  assert.match(readme, /docs\/privacy-policy\.md/);
  assert.match(readme, /docs\/real-platform-test-plan\.md/);
  assert.match(readme, /node tools\/package-release\.js/);
  assert.match(testerChecklist, /docs\/real-platform-test-plan\.md/);
  assert.match(roadmap, /tools\/package-release\.js/);
  assert.match(roadmap, /docs\/privacy-policy\.md/);
  assert.match(privacy, /Aucun enregistrement audio/);
  assert.match(privacy, /aucune telemetrie automatique/i);
  assert.match(realPlatformPlan, /YouTube/);
  assert.match(realPlatformPlan, /Spotify web/);
  assert.match(realPlatformPlan, /Deezer web/);
  assert.match(packageRelease, /release-assets/);
  assert.match(packageRelease, /Compress-Archive/);
  assert.match(packageRelease, /projectEntries/);
});

test("public docs do not advertise removed options controls", () => {
  const docs = [
    "README.md",
    "docs/tester-checklist.md",
    "docs/future-implementation-roadmap.md"
  ].map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");

  assert.doesNotMatch(docs, /Copier le rapport de bug/);
  assert.doesNotMatch(docs, /modèle de rapport de bug depuis les Options/);
  assert.doesNotMatch(docs, /sons de calibration OBS : faible, normal, fort et très fort/);
  assert.doesNotMatch(docs, /Sons de test faible, normal, fort et très fort dans les Options/);
});

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
