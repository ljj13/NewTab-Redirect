/**
 * 打包扩展 ZIP（Node，无第三方依赖）。
 * 产物：dist/newtab-redirect-v<version>.zip
 */

import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");

const INCLUDE = [
  "manifest.json",
  "LICENSE",
  "pages/",
  "js/",
  "css/",
  "_locales/",
  "icons/",
];

async function listFiles(rel) {
  const full = join(ROOT, rel);
  const s = await stat(full);
  if (s.isFile()) return [rel];
  const out = [];
  for (const entry of await readdir(full, { withFileTypes: true })) {
    const child = join(rel, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(child)));
    else out.push(child);
  }
  return out;
}

const files = [];
for (const item of INCLUDE) files.push(...(await listFiles(item)));
files.sort();

await mkdir(DIST, { recursive: true });

// 优先使用系统 zip（保留目录结构）；否则回退到 PowerShell Compress-Archive
const version = JSON.parse(await readFile(join(ROOT, "manifest.json"), "utf8")).version;
const zipName = `newtab-redirect-v${version}.zip`;
const zipPath = join(DIST, zipName);

let used;
try {
  execFileSync("zip", ["-q", "-r", zipPath, ...files], { cwd: ROOT });
  used = "zip";
} catch {
  // Windows 回退：PowerShell Compress-Archive 需要一个暂存目录（避免夹带 dist 自身）
  const stage = join(DIST, "stage");
  await mkdir(stage, { recursive: true });
  for (const rel of files) {
    const dest = join(stage, rel);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, await readFile(join(ROOT, rel)));
  }
  execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path (Join-Path '${stage.replace(/'/g, "''")}' '*') -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
    ],
    { stdio: "inherit" }
  );
  await rm(stage, { recursive: true, force: true });
  used = "powershell";
}

console.log(`packaged ${files.length} files -> ${zipPath} (via ${used})`);
