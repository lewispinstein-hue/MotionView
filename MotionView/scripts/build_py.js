import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const entry = path.join(repoRoot, "src", "bridge.py");
const distDir = path.join(repoRoot, "dist");
const binDir = path.join(repoRoot, "src-tauri", "bin");

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

const exeExt = process.platform === "win32" ? ".exe" : "";
const outName = `motionview-py${exeExt}`;

const venvPython = path.join(repoRoot, ".venv", "bin", "python");
const python =
  process.env.PYTHON ||
  (fs.existsSync(venvPython) ? venvPython : "python3");

const pyInstallerArgs = ["-m", "PyInstaller", "-F", "--noconsole"];
if (process.platform === "win32") {
  // pyInstallerArgs.push("--noconsole");
}
pyInstallerArgs.push("-n", "motionview-py", entry);
run(python, pyInstallerArgs);

const distExe = path.join(distDir, outName);
if (!fs.existsSync(distExe)) {
  throw new Error(`PyInstaller output not found: ${distExe}`);
}

const triple = getRustTargetTriple();
ensureDir(binDir);

const sidecarName = `motionview-py-${triple}${exeExt}`;
const sidecarPath = path.join(binDir, sidecarName);
const fallbackPath = path.join(binDir, outName);

fs.copyFileSync(distExe, sidecarPath);
fs.copyFileSync(distExe, fallbackPath);

console.log(`Copied sidecar to ${sidecarPath}`);
