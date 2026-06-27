// Distribution package checks for every browser target.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const distRoot = path.join(root, "dist");

const targets = [
  {
    id: "chromium",
    expectedBackgroundScripts: false,
    expectedSettings: false
  },
  {
    id: "firefox",
    expectedBackgroundScripts: true,
    expectedSettings: "gecko"
  },
  {
    id: "firefox-android",
    expectedBackgroundScripts: true,
    expectedSettings: "gecko_android"
  },
  {
    id: "safari-source",
    expectedBackgroundScripts: true,
    expectedSettings: "safari"
  }
];

const requiredFiles = [
  "manifest.json",
  "README.md",
  "CHANGELOG.md",
  "test-page.html",
  "docs/bug-report-template.md",
  "docs/cross-browser-deployment.md",
  "docs/privacy-policy.md",
  "docs/real-platform-test-plan.md",
  "docs/streamer-quickstart-60s.md",
  "docs/tester-checklist.md",
  "_locales/en/messages.json",
  "_locales/fr/messages.json",
  "assets/icons/icon16.png",
  "assets/icons/icon32.png",
  "assets/icons/icon48.png",
  "assets/icons/icon128.png",
  "audio/analyser.js",
  "audio/limiter.js",
  "audio/normalizer.js",
  "audio/stream-status.js",
  "background.js",
  "content.js",
  "license/capabilities.js",
  "options/options.html",
  "options/options.css",
  "options/options.js",
  "popup/popup.html",
  "popup/popup.css",
  "popup/popup.js",
  "storage/settings.js"
];

const chromiumOnlyFiles = [
  "offscreen/offscreen.html",
  "offscreen/offscreen.js"
];

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function walkFiles(directoryPath) {
  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) return walkFiles(entryPath);
    return [entryPath];
  });
}

function assertNoDevFolders(targetRoot) {
  for (const folder of ["dist", "tests", "tools", ".git", ".codex", ".agents", ".docs"]) {
    assert.equal(
      fs.existsSync(path.join(targetRoot, folder)),
      false,
      `${path.basename(targetRoot)} should not include ${folder}`
    );
  }

  assert.equal(
    fs.existsSync(path.join(targetRoot, "docs", "future-implementation-roadmap.md")),
    false,
    `${path.basename(targetRoot)} should not include future implementation roadmap`
  );
}

function assertRequiredFiles(targetRoot, targetId) {
  for (const file of requiredFiles) {
    assert.equal(
      fs.existsSync(path.join(targetRoot, file)),
      true,
      `${path.basename(targetRoot)} should include ${file}`
    );
  }

  for (const file of chromiumOnlyFiles) {
    assert.equal(
      fs.existsSync(path.join(targetRoot, file)),
      targetId === "chromium",
      `${path.basename(targetRoot)} should ${targetId === "chromium" ? "include" : "exclude"} ${file}`
    );
  }
}

function assertManifest(target) {
  const manifest = readJson(path.join(distRoot, target.id, "manifest.json"));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, "__MSG_extensionName__");
  assert.equal(manifest.description, "__MSG_extensionDescription__");
  assert.equal(manifest.action.default_popup, "popup/popup.html");
  assert.equal(manifest.options_page, "options/options.html");
  assert.equal(manifest.icons["128"], "assets/icons/icon128.png");
  assert.ok(manifest.permissions.includes("activeTab"));
  assert.ok(manifest.permissions.includes("scripting"));
  assert.ok(manifest.permissions.includes("storage"));
  if (target.id === "chromium") {
    assert.ok(manifest.permissions.includes("tabCapture"));
    assert.ok(manifest.permissions.includes("offscreen"));
  } else {
    assert.equal(manifest.permissions.includes("tabCapture"), false);
    assert.equal(manifest.permissions.includes("offscreen"), false);
  }
  assert.deepEqual(manifest.optional_host_permissions, ["<all_urls>"]);

  if (target.expectedBackgroundScripts) {
    assert.deepEqual(manifest.background.scripts, [
      "storage/settings.js",
      "license/capabilities.js",
      "background.js"
    ]);
  } else {
    assert.equal(manifest.background.scripts, undefined);
  }

  if (target.expectedSettings === false) {
    assert.equal(manifest.browser_specific_settings, undefined);
  }
  if (target.expectedSettings === "gecko") {
    assert.equal(manifest.browser_specific_settings.gecko.id, "streamvolume-guard@local");
  }
  if (target.expectedSettings === "gecko_android") {
    assert.equal(manifest.browser_specific_settings.gecko.id, "streamvolume-guard@local");
    assert.equal(manifest.browser_specific_settings.gecko_android.strict_min_version, "121.0");
  }
  if (target.expectedSettings === "safari") {
    assert.equal(manifest.browser_specific_settings.safari.strict_min_version, "15.0");
  }
}

function assertJavaScriptSyntax(targetRoot) {
  const jsFiles = walkFiles(targetRoot).filter((filePath) => filePath.endsWith(".js"));

  for (const filePath of jsFiles) {
    const source = fs.readFileSync(filePath, "utf8");
    assert.doesNotThrow(
      () => new Function(source),
      `${path.relative(root, filePath)} should be parseable JavaScript`
    );
  }
}

test("published dist folders exist for every supported target", () => {
  for (const target of targets) {
    assert.equal(fs.existsSync(path.join(distRoot, target.id)), true, `${target.id} should exist`);
  }
});

test("published dist folders contain only installable extension packages", () => {
  for (const target of targets) {
    const targetRoot = path.join(distRoot, target.id);
    assertRequiredFiles(targetRoot, target.id);
    assertNoDevFolders(targetRoot);
    assertManifest(target);
  }
});

test("published dist JavaScript files are syntactically valid", () => {
  for (const target of targets) {
    assertJavaScriptSyntax(path.join(distRoot, target.id));
  }
});
