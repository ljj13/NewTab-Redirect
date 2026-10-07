/** 调试：检查 SW 状态与手动触发 welcome 打开。 */

import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EXT = resolve(import.meta.dirname, "..", "..");
const PORT = 9455;

const profile = await mkdtemp(join(tmpdir(), "ntr-dbg-"));
const proc = spawn(
  CHROME,
  [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    `--load-extension=${EXT}`,
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ],
  { stdio: "ignore" }
);

const sleep = (ms) => delay(ms);
async function list() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const json = await res.json();
      return json;
    } catch {
      await sleep(250);
    }
  }
  return [];
}
let targets = [];
for (let i = 0; i < 40; i++) {
  targets = await list();
  const swFound = targets.find((t) => t.type === "service_worker" && !t.url.includes("nkeimhogjdpnpccoofpliimaahmaaome"));
  if (swFound) break;
  await sleep(250);
}
const sw = targets.find((t) => t.type === "service_worker" && !t.url.includes("nkeimhogjdpnpccoofpliimaahmaaome"));
console.log("targets:", targets.map((t) => `[${t.type}] ${t.url}`));
if (!sw) {
  proc.kill();
  process.exit(1);
}

const ws = new WebSocket(sw.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const pending = new Map();
const consoleLogs = [];
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    p(msg);
  }
  if (msg.method === "Runtime.consoleAPICalled") {
    consoleLogs.push(msg.params.type + ": " + msg.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
  }
  if (msg.method === "Runtime.exceptionThrown") {
    consoleLogs.push("EXC: " + JSON.stringify(msg.params.exceptionDetails).slice(0, 500));
  }
});
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

await send("Runtime.enable");
await delay(1000);
console.log("--- SW console so far:");
for (const l of consoleLogs) console.log("  ", l);

const evalSw = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
  return r.result?.value ?? r;
};

console.log("--- storage:", JSON.stringify(await evalSw(`chrome.storage.local.get(null)`)));
console.log("--- manifest version:", await evalSw(`chrome.runtime.getManifest().version`));

// 手动重放 onInstalled 逻辑，看 welcome 打开是否报错
const res = await evalSw(`
  (async () => {
    const s = await import(chrome.runtime.getURL("js/lib/storage.js"));
    const settings = await s.migrateSettings();
    const tab = await chrome.tabs.create({ url: chrome.runtime.getURL("pages/welcome.html") });
    return { settings, tabId: tab.id };
  })()
`);
console.log("--- manual:", JSON.stringify(res).slice(0, 400));
await delay(1500);
console.log("--- SW console after:");
for (const l of consoleLogs) console.log("  ", l);
const t2 = await list();
console.log("targets now:", t2.map((t) => `[${t.type}] ${t.url}`));
proc.kill();
await delay(500);
process.exit(0);
