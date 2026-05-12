import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const distDir = path.join(repoRoot, "dist");
const binDir = path.join(repoRoot, "src-tauri", "bin");
const bridgeBinDir = path.join(binDir, "motionview-bridge");
const pyInstallerWorkDir = path.join(repoRoot, ".pyinstaller");
const pyInstallerSpecDir = path.join(repoRoot, ".pyinstaller-spec");
const bridgeEntry = path.join(repoRoot, "src", "bridge.py");
const bridgeRequirements = path.join(repoRoot, "requirements.txt");
const prosRoot = path.join(repoRoot, "src", "pros-cli");
const prosEntry = path.join(prosRoot, "motionview_terminal_entry.py");
const prosRequirements = path.join(prosRoot, "requirements.txt");

function run(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: "inherit" });
  if (res.error) throw res.error;
  if (res.status !== 0) process.exit(res.status ?? 1);
}

function getRustTargetTriple() {
  const res = spawnSync("rustc", ["-vV"], { encoding: "utf8" });
  if (res.error || res.status !== 0) {
    throw new Error("rustc not found; needed to determine target triple");
  }
  const line = res.stdout
    .split("\n")
    .find((l) => l.startsWith("host: "));
  if (!line) throw new Error("could not determine Rust host triple");
  return line.replace("host: ", "").trim();
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function resetPath(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function copyResolvedTree(src, dest) {
  const stat = fs.lstatSync(src);
  if (stat.isSymbolicLink()) {
    const realSrc = fs.realpathSync(src);
    copyResolvedTree(realSrc, dest);
    return;
  }
  if (stat.isDirectory()) {
    ensureDir(dest);
    for (const entry of fs.readdirSync(src)) {
      copyResolvedTree(path.join(src, entry), path.join(dest, entry));
    }
    return;
  }
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

const exeExt = process.platform === "win32" ? ".exe" : "";
const outName = `motionview-py${exeExt}`;

const venvPython =
  process.platform === "win32"
    ? path.join(repoRoot, ".venv", "Scripts", "python.exe")
    : path.join(repoRoot, ".venv", "bin", "python");
const python =
  process.env.PYTHON ||
  (fs.existsSync(venvPython) ? venvPython : process.platform === "win32" ? "python" : "python3");

function installRequirements(requirementsPath) {
  if (fs.existsSync(requirementsPath)) {
    run(python, ["-m", "pip", "install", "-r", requirementsPath]);
  }
}

function removeObsoletePyInstallerPackages() {
  // Some legacy dependencies pull in the obsolete `typing` backport on Python 3,
  // which PyInstaller rejects outright. Remove it if present.
  const res = spawnSync(
    python,
    ["-m", "pip", "uninstall", "-y", "typing"],
    { stdio: "inherit" },
  );
  if (res.error) throw res.error;
  if (res.status !== 0 && res.status !== 1) process.exit(res.status ?? 1);
}

function buildPyInstaller(name, entry, extraArgs = [], { noConsole = false } = {}) {
  const oneDir = extraArgs.includes("--onedir");
  const args = [
    "-m", "PyInstaller",
    "--clean",
    "--noconfirm",
    "--distpath", distDir,
    "--workpath", path.join(pyInstallerWorkDir, name),
    "--specpath", pyInstallerSpecDir,
    oneDir ? "--onedir" : "-F",
    ...extraArgs.filter((arg) => arg !== "--onedir"),
  ];
  if (noConsole && process.platform === "win32") {
    args.push("--noconsole");
  }
  args.push("-n", name, entry);
  run(python, args);
}

function copySidecar(baseName) {
  const outName = `${baseName}${exeExt}`;
  const distExe = path.join(distDir, outName);
  if (!fs.existsSync(distExe)) {
    throw new Error(`PyInstaller output not found: ${distExe}`);
  }

  const triple = getRustTargetTriple();
  ensureDir(binDir);
  ensureDir(bridgeBinDir);

  const sidecarName = `${baseName}-${triple}${exeExt}`;
  const sidecarPath = path.join(binDir, sidecarName);
  const fallbackPath = path.join(binDir, outName);
  const bridgeSidecarPath = path.join(bridgeBinDir, sidecarName);
  const bridgeFallbackPath = path.join(bridgeBinDir, outName);

  fs.copyFileSync(distExe, sidecarPath);
  fs.copyFileSync(distExe, fallbackPath);
  fs.copyFileSync(distExe, bridgeSidecarPath);
  fs.copyFileSync(distExe, bridgeFallbackPath);
  console.log(`Copied sidecar to ${sidecarPath}`);
  console.log(`Copied updater bridge to ${bridgeFallbackPath}`);
}

function copyRuntimeDir(baseName) {
  const distRuntimeDir = path.join(distDir, baseName);
  if (!fs.existsSync(distRuntimeDir) || !fs.statSync(distRuntimeDir).isDirectory()) {
    throw new Error(`PyInstaller runtime directory not found: ${distRuntimeDir}`);
  }

  const runtimeDir = path.join(binDir, baseName);
  fs.rmSync(runtimeDir, { recursive: true, force: true });
  copyResolvedTree(distRuntimeDir, runtimeDir);
  console.log(`Copied runtime directory to ${runtimeDir}`);
}

function copyRuntimeArchive(baseName) {
  const archiveBase = path.join(binDir, baseName);
  const archivePath = `${archiveBase}.zip`;
  fs.rmSync(archivePath, { force: true });
  run(python, [
    "-c",
    [
      "import shutil, sys",
      "shutil.make_archive(sys.argv[1], 'zip', root_dir=sys.argv[2], base_dir=sys.argv[3])",
    ].join("; "),
    archiveBase,
    distDir,
    baseName,
  ]);
  console.log(`Copied runtime archive to ${archivePath}`);
}

resetPath(path.join(distDir, "motionview-py"));
resetPath(path.join(distDir, `motionview-py${exeExt}`));
resetPath(path.join(distDir, "motionview-pros"));
resetPath(path.join(distDir, `motionview-pros${exeExt}`));
resetPath(pyInstallerWorkDir);
resetPath(pyInstallerSpecDir);

// Build the bridge sidecar first from the bridge dependency set so it does not
// inherit extra PROS CLI packages that can destabilize startup.
installRequirements(bridgeRequirements);
buildPyInstaller(
  "motionview-py",
  bridgeEntry,
  [
    // ensure all lazy-loaded modules get bundled
    "--collect-all", "fastapi",
    "--collect-all", "starlette",
    "--collect-all", "pydantic",
    "--collect-all", "anyio",
    "--collect-all", "python_multipart",
    "--collect-all", "email_validator",
    "--collect-all", "jinja2",
    "--collect-all", "orjson",
  ],
  { noConsole: true },
);
copySidecar("motionview-py");

// Then install/build the bundled PROS fork.
installRequirements(prosRequirements);
removeObsoletePyInstallerPackages();
buildPyInstaller(
  "motionview-pros",
  prosEntry,
  [
    "--onedir",
    "--paths", prosRoot,
    "--add-data", `${path.join(prosRoot, "pros", "autocomplete")}${path.delimiter}pros/autocomplete`,
    "--collect-all", "pros",
    "--collect-all", "requests",
    "--collect-all", "charset_normalizer",
  ],
);
copyRuntimeDir("motionview-pros");
copyRuntimeArchive("motionview-pros");
