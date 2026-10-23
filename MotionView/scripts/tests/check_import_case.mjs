import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, extname, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const names = new Set(
  execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      cwd: root,
      encoding: "utf8",
    },
  )
    .split("\0")
    .filter(Boolean),
);

const canonical = new Map([...names].map((name) => [name.toLowerCase(), name]));
const failures = [];

for (const name of names) {
  if (
    !/^(MotionView\/src|MotionView\/scripts)\//.test(name) ||
    ![".ts", ".js", ".mjs"].includes(extname(name))
  ) continue;

  const source = readFileSync(resolve(root, name), "utf8");
  const imports =
    /(?:from\s*|import\s*\(|ssrLoadModule\s*\()\s*["']([./][^"']+)["']/g;

  for (const match of source.matchAll(imports)) {
    const specifier = match[1];
    const base = specifier.startsWith("/")
      ? "MotionView/src"
      : posix.dirname(name);
    const target = posix.normalize(
      posix.join(
        base,
        specifier.startsWith("/") ? specifier.slice(1) : specifier,
      ),
    );

    const candidates = [
      target,
      `${target}.ts`,
      `${target}.js`,
      `${target}.mjs`,
      `${target}/index.ts`,
    ];

    if (candidates.some((candidate) => names.has(candidate))) continue;
    const actual = candidates
      .map((candidate) => canonical.get(candidate.toLowerCase()))
      .find(Boolean);

    if (actual) failures.push(`${name}: ${specifier} must match ${actual}`);
  }
}
if (failures.length)
  throw new Error(
    `Import filename casing does not match Git:\n${failures.join("\n")}`,
  );

console.log("Import filename casing matches Git.");
