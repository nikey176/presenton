#!/usr/bin/env node
const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { path7za } = require("7zip-bin");

const VERSION = process.env.IMAGEMAGICK_VERSION || "7.1.2-18";
const PLATFORM = process.platform;
const ARCH = process.arch;
const TARGET_DIR = path.join(__dirname, "..", "resources", "imagemagick", `${PLATFORM}-${ARCH}`);
const CACHE_DIR = path.join(__dirname, "..", ".cache", "imagemagick", VERSION);
const MANIFEST_NAME = "presenton-runtime.json";

function log(message) {
  console.log(`[imagemagick] ${message}`);
}

function fail(message) {
  console.error(`[imagemagick] ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    windowsHide: true,
    ...options,
  });
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed with code ${result.status}`);
  }
  return result;
}

function capture(command, args, options = {}) {
  return spawnSync(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    windowsHide: true,
    ...options,
  });
}

function runtimeEnv(binaryPath) {
  const homeDir = fs.statSync(binaryPath).isFile()
    ? path.dirname(binaryPath)
    : binaryPath;
  const tempDir = process.env.TEMP || process.env.TMPDIR || os.tmpdir() || homeDir;
  return {
    ...process.env,
    MAGICK_HOME: path.basename(homeDir).toLowerCase() === "bin"
      ? path.dirname(homeDir)
      : homeDir,
    MAGICK_CONFIGURE_PATH: path.basename(homeDir).toLowerCase() === "bin"
      ? path.dirname(homeDir)
      : homeDir,
    MAGICK_TEMPORARY_PATH: tempDir,
    MAGICK_OCL_DEVICE: "OFF",
    APPIMAGE_EXTRACT_AND_RUN: "1",
  };
}

function versionOutput(binaryPath) {
  const result = spawnSync(binaryPath, ["-version"], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: 30000,
    env: runtimeEnv(binaryPath),
    windowsHide: true,
  });
  if (result.status !== 0) {
    const reason = result.error?.message || result.stderr || `exit ${result.status}`;
    return { ok: false, reason };
  }
  const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  return { ok: output.toLowerCase().includes("imagemagick"), output };
}

function readManifest(targetDir) {
  const manifestPath = path.join(targetDir, MANIFEST_NAME);
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return null;
  }
}

function writeManifest(targetDir, manifest) {
  fs.writeFileSync(
    path.join(targetDir, MANIFEST_NAME),
    JSON.stringify(
      {
        version: VERSION,
        platform: PLATFORM,
        arch: ARCH,
        createdAt: new Date().toISOString(),
        ...manifest,
      },
      null,
      2,
    ),
  );
}

function validateRuntime(targetDir) {
  const manifest = readManifest(targetDir);
  const binary = manifest?.binary || (PLATFORM === "win32" ? "magick.exe" : "bin/magick");
  const binaryPath = path.join(targetDir, binary);
  if (!fs.existsSync(binaryPath)) {
    return null;
  }
  if (PLATFORM !== "win32") {
    try {
      fs.chmodSync(binaryPath, 0o755);
    } catch {
      return null;
    }
  }
  const result = versionOutput(binaryPath);
  if (!result.ok) {
    log(`Runtime validation failed for ${binaryPath}: ${result.reason}`);
    return null;
  }
  return { binaryPath, output: result.output };
}

function archiveName() {
  if (PLATFORM !== "win32") {
    return null;
  }
  const archName = ARCH === "x64" ? "x64" : ARCH === "arm64" ? "arm64" : ARCH === "ia32" ? "x86" : null;
  if (!archName) {
    fail(`No bundled ImageMagick Windows asset configured for ${PLATFORM}-${ARCH}`);
  }
  return `ImageMagick-${VERSION}-portable-Q16-${archName}.7z`;
}

function linuxAppImageName() {
  if (PLATFORM !== "linux") {
    return null;
  }
  if (ARCH !== "x64") {
    fail(`No bundled ImageMagick Linux AppImage asset configured for ${PLATFORM}-${ARCH}`);
  }
  return `ImageMagick-${VERSION}-gcc-x86_64.AppImage`;
}

function downloadUrl(assetName) {
  if (process.env.IMAGEMAGICK_DOWNLOAD_URL) {
    return process.env.IMAGEMAGICK_DOWNLOAD_URL;
  }
  return `https://github.com/ImageMagick/ImageMagick/releases/download/${VERSION}/${assetName}`;
}

function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      { headers: { "User-Agent": "Presenton ImageMagick runtime fetcher" } },
      (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode || 0)) {
          const location = response.headers.location;
          if (!location) {
            reject(new Error(`Redirect from ${url} did not include Location`));
            return;
          }
          response.resume();
          downloadFile(new URL(location, url).toString(), destination).then(resolve, reject);
          return;
        }
        if (response.statusCode !== 200) {
          reject(new Error(`Download failed with HTTP ${response.statusCode}: ${url}`));
          response.resume();
          return;
        }
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        const file = fs.createWriteStream(destination);
        response.pipe(file);
        file.on("finish", () => file.close(resolve));
        file.on("error", reject);
      },
    );
    request.on("error", reject);
  });
}

function findMagickDir(root) {
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && entry.name.toLowerCase() === "magick.exe")) {
      return current;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        stack.push(path.join(current, entry.name));
      }
    }
  }
  return null;
}

async function prepareWindows() {
  if (!path7za || !fs.existsSync(path7za)) {
    fail("7zip-bin is unavailable; run npm install before preparing ImageMagick.");
  }

  const assetName = archiveName();
  const archivePath = path.join(CACHE_DIR, assetName);
  const extractDir = path.join(CACHE_DIR, "extract");
  const tempTarget = `${TARGET_DIR}.tmp`;

  if (!fs.existsSync(archivePath)) {
    const url = downloadUrl(assetName);
    log(`Downloading ${url}`);
    await downloadFile(url, archivePath);
  } else {
    log(`Using cached archive: ${archivePath}`);
  }

  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  log(`Extracting ${archivePath}`);
  run(path7za, ["x", archivePath, `-o${extractDir}`, "-y"]);

  const magickDir = findMagickDir(extractDir);
  if (!magickDir) {
    fail("Extracted archive did not contain magick.exe");
  }

  fs.rmSync(tempTarget, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(tempTarget), { recursive: true });
  fs.cpSync(magickDir, tempTarget, { recursive: true });
  writeManifest(tempTarget, {
    kind: "windows-portable",
    binary: "magick.exe",
    source: downloadUrl(assetName),
  });

  if (!validateRuntime(tempTarget)) {
    fail(`Prepared runtime failed validation at ${tempTarget}`);
  }

  fs.rmSync(TARGET_DIR, { recursive: true, force: true });
  fs.renameSync(tempTarget, TARGET_DIR);
  log(`Prepared ${path.join(TARGET_DIR, "magick.exe")}`);
}

async function prepareLinux() {
  const assetName = linuxAppImageName();
  const appImagePath = path.join(CACHE_DIR, assetName);
  const tempTarget = `${TARGET_DIR}.tmp`;

  if (!fs.existsSync(appImagePath)) {
    const url = downloadUrl(assetName);
    log(`Downloading ${url}`);
    await downloadFile(url, appImagePath);
  } else {
    log(`Using cached AppImage: ${appImagePath}`);
  }

  fs.rmSync(tempTarget, { recursive: true, force: true });
  fs.mkdirSync(path.join(tempTarget, "bin"), { recursive: true });

  const runtimeAppImage = path.join(tempTarget, assetName);
  fs.copyFileSync(appImagePath, runtimeAppImage);
  fs.chmodSync(runtimeAppImage, 0o755);

  const wrapperPath = path.join(tempTarget, "bin", "magick");
  fs.writeFileSync(
    wrapperPath,
    [
      "#!/usr/bin/env sh",
      "set -eu",
      'DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"',
      "export APPIMAGE_EXTRACT_AND_RUN=${APPIMAGE_EXTRACT_AND_RUN:-1}",
      'exec "$DIR/' + assetName + '" "$@"',
      "",
    ].join("\n"),
  );
  fs.chmodSync(wrapperPath, 0o755);
  writeManifest(tempTarget, {
    kind: "linux-appimage",
    binary: "bin/magick",
    appImage: assetName,
    source: downloadUrl(assetName),
  });

  if (!validateRuntime(tempTarget)) {
    fail(`Prepared runtime failed validation at ${tempTarget}`);
  }

  fs.rmSync(TARGET_DIR, { recursive: true, force: true });
  fs.renameSync(tempTarget, TARGET_DIR);
  log(`Prepared ${path.join(TARGET_DIR, "bin", "magick")}`);
}

function resolveCommandPath(command) {
  if (path.isAbsolute(command)) {
    return fs.existsSync(command) ? command : null;
  }
  const result = capture("which", [command]);
  const resolved = (result.stdout || "").trim().split(/\r?\n/).filter(Boolean)[0];
  return result.status === 0 && resolved ? resolved : null;
}

function resolveMacPrefixFromMagickBinary(magickPath) {
  if (!magickPath || !fs.existsSync(magickPath)) {
    return null;
  }
  const realMagick = fs.realpathSync(magickPath);
  const binDir = path.dirname(realMagick);
  const prefix = path.dirname(binDir);
  return fs.existsSync(path.join(prefix, "bin", "magick")) ? prefix : null;
}

function listBrewCandidates() {
  return [resolveCommandPath("brew"), "/opt/homebrew/bin/brew", "/usr/local/bin/brew"]
    .filter(Boolean)
    .filter((candidate, index, all) => all.indexOf(candidate) === index)
    .filter((candidate) => fs.existsSync(candidate));
}

function resolveMacPrefixFromBrew() {
  const brewCandidates = listBrewCandidates();
  const formulas = ["imagemagick", "imagemagick@6"];

  for (const brew of brewCandidates) {
    for (const formula of formulas) {
      const result = capture(brew, ["--prefix", formula]);
      const prefix = (result.stdout || "").trim();
      if (result.status !== 0 || !prefix) {
        continue;
      }
      if (fs.existsSync(path.join(prefix, "bin", "magick"))) {
        return prefix;
      }
    }
  }
  return null;
}

function ensureMacImageMagickWithBrew() {
  for (const brew of listBrewCandidates()) {
    log(`ImageMagick not found; trying to install with Homebrew (${brew} install imagemagick).`);
    const install = spawnSync(brew, ["install", "imagemagick"], {
      stdio: "inherit",
      windowsHide: true,
    });
    if (install.status === 0) {
      return true;
    }
    const reason = install.error?.message || `exit ${install.status}`;
    log(`Homebrew installation attempt failed via ${brew}: ${reason}`);
  }
  return false;
}

function resolveMacSourcePrefix() {
  const configured = process.env.IMAGEMAGICK_VENDOR_DIR?.trim();
  if (configured) {
    return path.resolve(configured);
  }

  const pathMagickPrefix = resolveMacPrefixFromMagickBinary(resolveCommandPath("magick"));
  if (pathMagickPrefix) {
    return pathMagickPrefix;
  }

  for (const magickPath of ["/opt/homebrew/bin/magick", "/usr/local/bin/magick", "/opt/local/bin/magick"]) {
    const prefix = resolveMacPrefixFromMagickBinary(magickPath);
    if (prefix) {
      return prefix;
    }
  }

  const brewPrefix = resolveMacPrefixFromBrew();
  if (brewPrefix) {
    return brewPrefix;
  }

  for (const optPrefix of ["/opt/homebrew/opt/imagemagick", "/usr/local/opt/imagemagick"]) {
    if (fs.existsSync(path.join(optPrefix, "bin", "magick"))) {
      return optPrefix;
    }
  }

  if (ensureMacImageMagickWithBrew()) {
    const installedPrefix = resolveMacPrefixFromMagickBinary(resolveCommandPath("magick"))
      || resolveMacPrefixFromBrew();
    if (installedPrefix) {
      return installedPrefix;
    }
    log("Homebrew install succeeded but ImageMagick prefix was not auto-detected; continuing with fallback checks.");
  }

  fail("Could not find a macOS ImageMagick runtime to vendor. Install ImageMagick (brew install imagemagick) and rerun, or set IMAGEMAGICK_VENDOR_DIR.");
}

function parseOtoolDeps(filePath) {
  const result = capture("otool", ["-L", filePath]);
  if (result.status !== 0) {
    fail(`otool -L failed for ${filePath}: ${result.stderr || result.status}`);
  }
  return (result.stdout || "")
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/)[0])
    .filter(Boolean)
    .filter((dep) => dep.startsWith("/"))
    .filter((dep) => !dep.startsWith("/System/Library/") && !dep.startsWith("/usr/lib/"));
}

function isMachOFile(filePath) {
  const result = capture("file", [filePath]);
  return result.status === 0 && /Mach-O/.test(result.stdout || "");
}

function relinkMacDylibs(targetDir, mainExecutable) {
  for (const tool of ["otool", "install_name_tool", "file"]) {
    if (!resolveCommandPath(tool)) {
      fail(`macOS runtime vendoring requires ${tool}.`);
    }
  }

  const libDir = path.join(targetDir, "lib");
  fs.mkdirSync(libDir, { recursive: true });

  const queue = [mainExecutable];
  const visited = new Set();
  const copiedBySource = new Map();

  while (queue.length) {
    const current = queue.shift();
    if (visited.has(current) || !fs.existsSync(current) || !isMachOFile(current)) {
      continue;
    }
    visited.add(current);

    const deps = parseOtoolDeps(current);
    for (const dep of deps) {
      const depBase = path.basename(dep);
      let vendored = copiedBySource.get(dep);
      if (!vendored) {
        vendored = path.join(libDir, depBase);
        if (!fs.existsSync(vendored)) {
          fs.copyFileSync(dep, vendored);
          fs.chmodSync(vendored, 0o755);
        }
        copiedBySource.set(dep, vendored);
        queue.push(vendored);
      }

      const replacement = current === mainExecutable
        ? `@executable_path/../lib/${depBase}`
        : `@loader_path/${depBase}`;
      run("install_name_tool", ["-change", dep, replacement, current]);
    }

    if (current !== mainExecutable) {
      run("install_name_tool", ["-id", `@loader_path/${path.basename(current)}`, current]);
    }
  }
}

async function prepareMacOS() {
  const sourcePrefix = resolveMacSourcePrefix();
  const sourceMagick = path.join(sourcePrefix, "bin", "magick");
  if (!fs.existsSync(sourceMagick)) {
    fail(`macOS ImageMagick prefix does not contain bin/magick: ${sourcePrefix}`);
  }

  const tempTarget = `${TARGET_DIR}.tmp`;
  fs.rmSync(tempTarget, { recursive: true, force: true });
  fs.mkdirSync(tempTarget, { recursive: true });
  fs.cpSync(sourcePrefix, tempTarget, {
    recursive: true,
    dereference: true,
    filter(source) {
      const base = path.basename(source);
      return base !== ".brew" && base !== "INSTALL_RECEIPT.json";
    },
  });

  const targetMagick = path.join(tempTarget, "bin", "magick");
  fs.chmodSync(targetMagick, 0o755);
  relinkMacDylibs(tempTarget, targetMagick);
  writeManifest(tempTarget, {
    kind: "macos-vendored",
    binary: "bin/magick",
    source: sourcePrefix,
  });

  if (!validateRuntime(tempTarget)) {
    fail(`Prepared runtime failed validation at ${tempTarget}`);
  }

  fs.rmSync(TARGET_DIR, { recursive: true, force: true });
  fs.renameSync(tempTarget, TARGET_DIR);
  log(`Prepared ${path.join(TARGET_DIR, "bin", "magick")}`);
}

async function main() {
  const existing = validateRuntime(TARGET_DIR);
  if (existing) {
    log(`Existing runtime OK: ${existing.binaryPath}`);
    return;
  }

  if (PLATFORM === "win32") {
    await prepareWindows();
    return;
  }
  if (PLATFORM === "linux") {
    await prepareLinux();
    return;
  }
  if (PLATFORM === "darwin") {
    await prepareMacOS();
    return;
  }

  fail(`Unsupported platform for bundled ImageMagick: ${PLATFORM}-${ARCH}`);
}

main().catch((error) => fail(error?.stack || error?.message || String(error)));
