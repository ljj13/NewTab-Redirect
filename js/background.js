/**
 * New Tab Redirect v4 — service worker（module）。
 *
 * 职责：
 * 1. 安装/启动时执行旧版配置迁移（幂等）。
 * 2. 全新安装且未完成首启设置时打开 Welcome 页。
 * 3. 开启 Chrome Sync 时把 sync 区的设置镜像回 local 工作副本。
 */

import { SETTINGS_KEY, getSettings, migrateSettings } from "./lib/storage.js";

const TAG = "[NTR4]";

chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    const settings = await migrateSettings();
    console.info(TAG, "onInstalled:", details.reason, settings);
    if (details.reason === "install" && !settings.welcome.done) {
      await chrome.tabs.create({ url: chrome.runtime.getURL("pages/welcome.html") });
    }
  } catch (e) {
    console.error(TAG, "onInstalled failed:", e);
  }
});

chrome.runtime.onStartup.addListener(async () => {
  try {
    await migrateSettings();
  } catch (e) {
    console.error(TAG, "onStartup migration failed:", e);
  }
});

// sync → local 镜像。仅当“当前本地设置”开启了同步时才镜像，
// 防止用户关闭同步后，残留的 sync 副本把旧配置灌回来。
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "sync" || !changes[SETTINGS_KEY]) return;
  try {
    const current = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];
    const incoming = changes[SETTINGS_KEY].newValue;
    if (!incoming || typeof incoming !== "object" || incoming.syncEnabled !== true) return;
    if (!current || current.syncEnabled === true) {
      await chrome.storage.local.set({ [SETTINGS_KEY]: incoming });
      console.info(TAG, "sync -> local mirrored");
    }
  } catch (e) {
    console.error(TAG, "sync mirror failed:", e);
  }
});

// 预热：SW 首次唤醒时确保迁移完成（onStartup 不覆盖浏览器常驻期间的重载场景）。
void getSettings().catch((e) => console.error(TAG, "startup getSettings failed:", e));
