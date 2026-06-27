// Multi-browser build helper for ready-to-install test folders.
const fs = require("node:fs");
const path = require("node:path");

const TARGETS = [
  {
    id: "chromium",
    label: "Chromium desktop",
    store: "Chrome Web Store / Edge Add-ons / Brave",
    mobile: false,
    requiresExternalPackaging: false
  },
  {
    id: "firefox",
    label: "Firefox desktop",
    store: "addons.mozilla.org",
    mobile: false,
    requiresExternalPackaging: false
  },
  {
    id: "firefox-android",
    label: "Firefox for Android",
    store: "addons.mozilla.org",
    mobile: true,
    requiresExternalPackaging: false
  },
  {
    id: "safari-source",
    label: "Safari source",
    store: "Mac App Store / App Store through Xcode",
    mobile: true,
    requiresExternalPackaging: true
  }
];

const PACKAGE_ENTRIES = [
  "_locales",
  "assets",
  "audio",
  "license",
  "offscreen",
  "options",
  "popup",
  "storage",
  "background.js",
  "CHANGELOG.md",
  "content.js",
  "manifest.json",
  "README.md",
  "test-page.html"
];

const USER_DOC_ENTRIES = [
  "bug-report-template.md",
  "cross-browser-deployment.md",
  "privacy-policy.md",
  "real-platform-test-plan.md",
  "streamer-quickstart-60s.md",
  "tester-checklist.md"
];

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function geckoSettings(strictMinVersion) {
  return {
    id: "streamvolume-guard@local",
    strict_min_version: strictMinVersion,
    data_collection_permissions: {
      required: ["none"]
    }
  };
}

function addCrossBrowserBackgroundFallback(manifest) {
  manifest.background = {
    ...(manifest.background || {}),
    scripts: [
      "storage/settings.js",
      "license/capabilities.js",
      "background.js"
    ]
  };
}

function buildManifestForTarget(baseManifest, targetId) {
  const manifest = cloneJson(baseManifest);

  if (targetId === "chromium") {
    return manifest;
  }

  delete manifest.minimum_chrome_version;
  manifest.permissions = (manifest.permissions || []).filter((permission) => {
    return !["tabCapture", "offscreen"].includes(permission);
  });
  addCrossBrowserBackgroundFallback(manifest);

  if (targetId === "firefox") {
    manifest.browser_specific_settings = {
      gecko: geckoSettings("128.0")
    };
    return manifest;
  }

  if (targetId === "firefox-android") {
    manifest.browser_specific_settings = {
      gecko: geckoSettings("121.0"),
      gecko_android: {
        strict_min_version: "121.0"
      }
    };
    return manifest;
  }

  if (targetId === "safari-source") {
    manifest.browser_specific_settings = {
      safari: {
        strict_min_version: "15.0"
      }
    };
    return manifest;
  }

  throw new Error(`Unknown build target: ${targetId}`);
}

function copyProjectFiles(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      copyProjectFiles(sourcePath, targetPath);
      continue;
    }

    if (entry.isFile()) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function copyPackageEntries(projectRoot, targetDir, targetId) {
  fs.mkdirSync(targetDir, { recursive: true });

  for (const entry of PACKAGE_ENTRIES) {
    if (entry === "offscreen" && targetId !== "chromium") {
      continue;
    }

    const sourcePath = path.join(projectRoot, entry);
    const targetPath = path.join(targetDir, entry);

    if (!fs.existsSync(sourcePath)) {
      continue;
    }

    const stat = fs.statSync(sourcePath);
    if (stat.isDirectory()) {
      copyProjectFiles(sourcePath, targetPath);
    } else if (stat.isFile()) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }

  const docsSourceDir = path.join(projectRoot, "docs");
  const docsTargetDir = path.join(targetDir, "docs");
  for (const entry of USER_DOC_ENTRIES) {
    const sourcePath = path.join(docsSourceDir, entry);
    if (!fs.existsSync(sourcePath)) {
      continue;
    }

    fs.mkdirSync(docsTargetDir, { recursive: true });
    fs.copyFileSync(sourcePath, path.join(docsTargetDir, entry));
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function buildTarget({ projectRoot, outputRoot, target }) {
  const baseManifestPath = path.join(projectRoot, "manifest.json");
  const targetDir = path.join(outputRoot, target.id);
  const baseManifest = JSON.parse(fs.readFileSync(baseManifestPath, "utf8"));
  const targetManifest = buildManifestForTarget(baseManifest, target.id);

  fs.rmSync(targetDir, { recursive: true, force: true });
  copyPackageEntries(projectRoot, targetDir, target.id);
  writeJson(path.join(targetDir, "manifest.json"), targetManifest);

  return {
    id: target.id,
    label: target.label,
    path: targetDir,
    requiresExternalPackaging: target.requiresExternalPackaging
  };
}

function buildAllTargets(options = {}) {
  const projectRoot = options.projectRoot || path.resolve(__dirname, "..");
  const outputRoot = options.outputRoot || path.join(projectRoot, "dist");

  fs.mkdirSync(outputRoot, { recursive: true });

  return TARGETS.map((target) => buildTarget({ projectRoot, outputRoot, target }));
}

if (require.main === module) {
  const results = buildAllTargets();
  console.log("Builds multi-navigateurs générés :");
  for (const result of results) {
    const suffix = result.requiresExternalPackaging ? " (source à empaqueter avec l'outil plateforme)" : "";
    console.log(`- ${result.id}: ${result.path}${suffix}`);
  }
}

module.exports = {
  TARGETS,
  buildManifestForTarget,
  buildAllTargets
};
