/**
 * New Tab Dashboard。
 *
 * 职责顺序（保证跳转零闪烁）：
 * 1. 读取设置；配置了合法跳转地址 → 立即跳转（页面保持 boot 隐藏态）。
 * 2. 未配置 / 跳转失败 → 渲染轻量 Dashboard（Top Sites + 书签栏 + 设置入口）。
 *
 * 权限策略：仅在用户点击“显示/启用”时请求 optional permission；
 * 被拒绝后记录 permissionDenied，展示提示而不反复弹窗。
 */

import { applyI18n, t } from "../js/lib/i18n.js";
import { performRedirect } from "../js/lib/redirect.js";
import { applyTheme, watchSystemTheme } from "../js/lib/theme.js";
import { getSettings, mergeDefaults, saveSettings } from "../js/lib/storage.js";

const $ = (sel) => document.querySelector(sel);
const selfOrigin = `chrome-extension://${chrome.runtime.id}`;

/* ---------- favicon ---------- */

function faviconUrl(pageUrl, size = 32) {
  return `${chrome.runtime.getURL("/_favicon/")}?pageUrl=${encodeURIComponent(pageUrl)}&size=${size}`;
}

/** 基于字符串生成稳定的指纹色（用于字母 fallback）。 */
function hueOf(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}

/** favicon 图标：加载失败自动回退为域名首字母色块。 */
function faviconElement(pageUrl, size, fallbackTitle) {
  const host = (() => {
    try {
      return new URL(pageUrl).hostname;
    } catch {
      return fallbackTitle || pageUrl;
    }
  })();
  const letter = document.createElement("span");
  letter.className = "letter";
  letter.style.background = `hsl(${hueOf(host)}, 55%, 48%)`;
  letter.textContent = (fallbackTitle || host || "?").trim().charAt(0);
  letter.hidden = true;

  const img = document.createElement("img");
  img.alt = "";
  img.width = size;
  img.height = size;
  img.loading = "lazy";
  img.addEventListener("error", () => {
    img.hidden = true;
    letter.hidden = false;
  });
  img.src = faviconUrl(pageUrl, size);

  const frag = document.createDocumentFragment();
  frag.append(img, letter);
  return frag;
}

/* ---------- Top Sites ---------- */

async function hasPermission(name) {
  try {
    return (await chrome.permissions.contains({ permissions: [name] })) === true;
  } catch {
    return false;
  }
}

async function renderTopSites(settings) {
  const section = $("#topsites-section");
  const enableCard = $("#enable-topsites");
  const denied = $("#denied-topsites");
  const granted = await hasPermission("topSites");
  denied.hidden = !(settings.dashboard.topSites && settings.permissionDenied.topSites && !granted);

  if (!settings.dashboard.topSites || !granted) {
    section.hidden = true;
    enableCard.hidden = settings.dashboard.topSites && settings.permissionDenied.topSites;
    return;
  }
  enableCard.hidden = true;
  section.hidden = false;

  const grid = $("#topsites-grid");
  grid.innerHTML = "";
  let sites = [];
  try {
    sites = (await chrome.topSites.get()) ?? [];
  } catch {
    sites = [];
  }
  sites = sites.slice(0, settings.dashboard.topSiteCount);

  if (sites.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-note";
    empty.setAttribute("data-i18n", "dashTopSitesEmpty");
    empty.textContent = t("dashTopSitesEmpty");
    grid.append(empty);
    return;
  }

  for (const site of sites) {
    const a = document.createElement("a");
    a.className = "tile";
    a.href = site.url;
    a.role = "listitem";
    a.title = site.title || site.url;
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = site.title || site.url;
    a.append(faviconElement(site.url, 32, site.title));
    a.append(label);
    grid.append(a);
  }
}

/* ---------- Bookmarks ---------- */

async function renderBookmarks(settings) {
  const section = $("#bookmarks-section");
  const enableCard = $("#enable-bookmarks");
  const denied = $("#denied-bookmarks");
  const granted = await hasPermission("bookmarks");
  denied.hidden = !(settings.dashboard.bookmarks && settings.permissionDenied.bookmarks && !granted);

  if (!settings.dashboard.bookmarks || !granted) {
    section.hidden = true;
    enableCard.hidden = settings.dashboard.bookmarks && settings.permissionDenied.bookmarks;
    return;
  }
  enableCard.hidden = true;
  section.hidden = false;

  const row = $("#bookmarks-row");
  row.innerHTML = "";
  let items = [];
  try {
    const tree = await chrome.bookmarks.getSubTree("1");
    items = (tree?.[0]?.children ?? []).filter((n) => typeof n.url === "string");
  } catch {
    items = [];
  }
  items = items.slice(0, settings.dashboard.bookmarkCount);

  if (items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-note";
    empty.setAttribute("data-i18n", "dashBookmarksEmpty");
    empty.textContent = t("dashBookmarksEmpty");
    row.append(empty);
    return;
  }

  for (const node of items) {
    const a = document.createElement("a");
    a.className = "bookmark-chip";
    a.href = node.url;
    a.role = "listitem";
    a.title = node.title || node.url;
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = node.title || node.url;
    a.append(faviconElement(node.url, 16, node.title));
    a.append(label);
    row.append(a);
  }
}

/* ---------- 权限启用流程 ---------- */

async function enableFeature(feature) {
  // 必须在用户手势内调用 permissions.request
  const granted = await chrome.permissions.request({ permissions: [feature] }).catch(() => false);
  if (!granted) {
    await saveSettings({ permissionDenied: { [feature]: true } });
  } else {
    await saveSettings({ dashboard: { [feature]: true }, permissionDenied: { [feature]: false } });
  }
  await refresh();
}

async function refresh() {
  const settings = await getSettings();
  await Promise.all([renderTopSites(settings), renderBookmarks(settings)]);
}

/* ---------- 启动 ---------- */

async function main() {
  applyI18n();
  let settings;
  try {
    settings = await getSettings();
  } catch (e) {
    // 存储异常时不白屏：按默认配置渲染 Dashboard
    console.error("[NTR4] getSettings failed, falling back to defaults:", e);
    settings = mergeDefaults({});
  }
  applyTheme(settings.appearance.theme);
  watchSystemTheme(() => settings.appearance.theme);

  // 配置了跳转地址 → 直接跳转；失败则回退 Dashboard 并提示
  if (settings.redirectUrl.trim() !== "") {
    const result = await performRedirect(settings, { selfOrigin });
    if (result.redirected) {
      // 兜底：极少数情况下 tabs.update 假成功（导航被 Chrome 拒绝），
      // 页面未离开时 3 秒后自动回退显示 Dashboard，避免白屏
      setTimeout(() => {
        const failed = $("#redirect-failed");
        failed.textContent = t("dashRedirectFailed");
        failed.hidden = false;
        document.body.classList.remove("boot");
      }, 3000);
      return;
    }
    const failed = $("#redirect-failed");
    failed.textContent = t("dashRedirectFailed");
    failed.hidden = false;
  }

  $("#btn-settings").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
  $("#btn-enable-topsites").addEventListener("click", () => enableFeature("topSites"));
  $("#btn-enable-bookmarks").addEventListener("click", () => enableFeature("bookmarks"));

  // 权限在其它页面被授予/撤销时同步
  chrome.permissions.onAdded.addListener(refresh);
  chrome.permissions.onRemoved.addListener(refresh);

  try {
    await refresh();
  } catch (e) {
    console.error("[NTR4] dashboard render failed:", e);
  } finally {
    document.body.classList.remove("boot");
  }
}

void main();
