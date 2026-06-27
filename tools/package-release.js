// Creates the release ZIP files from the current dist folders without npm dependencies.
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const releaseAssetsDir = path.join(root, "release-assets");

const extensionPackages = [
  ["dist/chromium/*", "streamvolume-guard-chromium"],
  ["dist/firefox/*", "streamvolume-guard-firefox"],
  ["dist/firefox-android/*", "streamvolume-guard-firefox-android"],
  ["dist/safari-source/*", "streamvolume-guard-safari-source"]
];

const projectEntries = [
  ".gitignore",
  "AGENTS.md",
  "CHANGELOG.md",
  "README.md",
  "_locales",
  "assets",
  "audio",
  "background.js",
  "content.js",
  "dist",
  "docs",
  "license",
  "manifest.json",
  "offscreen",
  "options",
  "popup",
  "storage",
  "store",
  "test-page.html",
  "tests",
  "tools"
];

function runPowerShell(script) {
  childProcess.execFileSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script
  ], {
    cwd: root,
    stdio: "inherit"
  });
}

function quote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function compressArchive(sourcePath, destinationPath) {
  runPowerShell(`
    $ErrorActionPreference='Stop'
    $destination=${quote(destinationPath)}
    if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Force }
    $source=${quote(sourcePath)}
    for ($attempt = 1; $attempt -le 3; $attempt += 1) {
      try {
        Compress-Archive -Path $source -DestinationPath $destination -CompressionLevel Optimal
        break
      } catch {
        if ($attempt -eq 3) { throw }
        Start-Sleep -Milliseconds 500
      }
    }
  `);
}

function copyProjectEntry(sourcePath, destinationRoot) {
  const targetPath = path.join(destinationRoot, path.basename(sourcePath));
  const stat = fs.statSync(sourcePath);
  if (stat.isDirectory()) {
    fs.cpSync(sourcePath, targetPath, { recursive: true });
    return;
  }
  fs.copyFileSync(sourcePath, targetPath);
}

function packageProject(version) {
  const tempDir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "streamvolume-guard-project-"));
  try {
    for (const entry of projectEntries) {
      const sourcePath = path.join(root, entry);
      if (fs.existsSync(sourcePath)) {
        copyProjectEntry(sourcePath, tempDir);
      }
    }
    compressArchive(path.join(tempDir, "*"), path.join(releaseAssetsDir, `streamvolume-guard-project-${version}.zip`));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function packageRelease(version = "0.1.3") {
  fs.mkdirSync(releaseAssetsDir, { recursive: true });

  for (const [sourceGlob, packageName] of extensionPackages) {
    const zipName = `${packageName}-${version}.zip`;
    compressArchive(path.join(root, sourceGlob), path.join(releaseAssetsDir, zipName));
  }

  packageProject(version);
}

if (require.main === module) {
  packageRelease(process.argv[2] || "0.1.3");
  console.log("Zips de release generes dans release-assets/");
}

module.exports = {
  packageRelease,
  projectEntries
};
