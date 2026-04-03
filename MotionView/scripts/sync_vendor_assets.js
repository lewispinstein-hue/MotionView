import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");

const chartSrc = path.join(repoRoot, "node_modules", "chart.js", "dist", "chart.umd.min.js");
const vendorDir = path.join(repoRoot, "src", "assets", "vendor");
const chartDest = path.join(vendorDir, "chart.umd.min.js");

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function syncChartJs() {
  if (!fs.existsSync(chartSrc)) {
    throw new Error(`Chart.js vendor source missing: ${chartSrc}. Run "pnpm install" first.`);
  }
  ensureDir(vendorDir);
  fs.copyFileSync(chartSrc, chartDest);
  console.log(`Synced Chart.js vendor asset to ${chartDest}`);
}

syncChartJs();
