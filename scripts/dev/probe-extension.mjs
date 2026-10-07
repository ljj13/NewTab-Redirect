/**
 * CDP 探测：确认 --load-extension 在当前 Chrome 上是否可用。
 * 用法：node scripts/dev/probe-extension.mjs
 */

import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// 品牌版 Chrome/Edge（137+）已忽略 --load-extension；默认使用 Playwright 的
// Chromium（非品牌构建，支持该开关），也可用 NTR_BROWSER 覆盖。
const CHROME =
  process.env.NTR_BROWSER ??
  join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium-1243", "chrome-win64", "chrome.exe");
const EXT = resolve(import.meta.dirname, "..");
const PORT = 9333 + Math.floor(Math.random() * 300);

const profile = await mkdtemp(join(tmpdir(), "ntr-probe-"));
const args = [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  `--load-extension=${EXT}`,
  "--disable-features=DisableLoadExtensionCommandLineSwitch",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-networking",
  "--window-size=1280,900",
  "about:blank",
];

const proc = spawn(CHROME, args, { stdio: "ignore", detached: false });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(path, method = "GET") {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, { method });
  return res.json();
}

let extensionTargets = [];
for (let i = 0; i < 20; i++) {
  await sleep(500);
  try {
    const list = await http("/json/list");
    // 排除浏览器自带组件扩展（CryptoToken 等，ID 固定）
    extensionTargets = list.filter(
      (t) =>
        (t.type === "service_worker" || t.url.startsWith("chrome-extension://")) &&
        !["nkeimhogjdpnpccoofpliimaahmaaome", "fignfifoniblkonapihmkfakmlgkbkcf"].some((id) =>
          t.url.includes(id)
        )
    );
    if (extensionTargets.length > 0) break;
  } catch {
    /* 浏览器未就绪 */
  }
}

console.log("targets:");
for (const t of await http("/json/list").catch(() => [])) {
  console.log(`  [${t.type}] ${t.url}`);
}
console.log(
  extensionTargets.length > 0
    ? `EXTENSION LOADED (${extensionTargets.length} extension targets)`
    : "EXTENSION NOT LOADED -- --load-extension rejected by this Chrome"
);

proc.kill();
await sleep(500);
process.exit(extensionTargets.length > 0 ? 0 : 1);
