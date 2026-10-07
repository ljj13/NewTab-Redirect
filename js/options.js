/**
 * Options 设置页逻辑。
 *
 * 交互约定：
 * - URL 输入实时校验，点“保存”才写入；非法输入禁止保存。
 * - 其余控件（跳转方式 / Sync / 主题 / 仪表盘 / 数量）即改即存，轻量 Toast 反馈。
 * - 开启书签栏 / 常用网站时若无权限，当场请求 optional permission。
 */

import { applyI18n, t } from "../js/lib/i18n.js";
import { normalizeRedirectUrl } from "../js/lib/redirect.js";
import { applyTheme, watchSystemTheme } from "../js/lib/theme.js";
import {
  getSettings,
  getSyncedSettings,
  resetSettings,
  saveSettings,
} from "../js/lib/storage.js";

const $ = (sel) => document.querySelector(sel);
const selfOrigin = `chrome-extension://${chrome.runtime.id}`;

const QUICK_PICKS = [
  { key: "pickBlank", url: "about:blank" },
  { key: "pickDownloads", url: "chrome://downloads" },
  { key: "pickHistory", url: "chrome://history" },
  { key: "pickExtensions", url: "chrome://extensions" },
  { key: "pickSettings", url: "chrome://settings" },
  { key: "pickDashboard", url: "" },
];

const BOOKMARK_COUNTS = [5, 10, 15, 20, 25, 30, 35, 40];
const TOPSITE_COUNTS = [5, 10, 15, 20];

let settings = null;
let toastTimer = 0;

/* ---------- 小工具 ---------- */

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
}

function statusFor(norm) {
  if (norm.ok) return { cls: "ok", key: "urlOk", valid: true };
  switch (norm.error) {
    case "empty":
      return { cls: "empty", key: "urlEmpty", valid: true };
    case "invalid":
      return { cls: "bad", key: "urlInvalid", valid: false };
    case "unsupported":
      return { cls: "bad", key: "urlUnsupported", valid: false };
    case "forbidden":
      return { cls: "bad", key: "urlForbidden", valid: false };
    case "loop":
      return { cls: "bad", key: "urlLoop", valid: false };
    default:
      return { cls: "bad", key: "urlInvalid", valid: false };
  }
}

function renderStatus() {
  const input = $("#url-input");
  const statusEl = $("#url-status");
  const fileNote = $("#file-note");
  const norm = normalizeRedirectUrl(input.value, { selfOrigin });
  const s = statusFor(norm);
  const savedEmpty = (settings?.redirectUrl ?? "").trim() === "";

  input.classList.toggle("invalid", !s.valid);

  statusEl.classList.toggle("danger-text", !s.valid);
  statusEl.classList.toggle("success-text", s.valid && norm.ok);
  statusEl.innerHTML = "";
  const icon = document.createElement("span");
  icon.className = "status-icon";
  icon.setAttribute("aria-hidden", "true");
  if (s.valid && norm.ok) {
    icon.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8.5 6.5 12 13 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  } else if (!s.valid) {
    icon.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.6"/><path d="M8 4.8v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="11.2" r=".9" fill="currentColor"/></svg>';
  }
  const text = document.createElement("span");
  text.textContent = t(s.key);
  statusEl.append(icon, text);

  // 仅当“保存了 file: 地址但输入不再是 file:”等场景下展示 file 说明
  const showFileNote =
    /^file:/i.test(input.value.trim()) || (/^file:/i.test(settings?.redirectUrl ?? "") && input.value.trim() === "");
  fileNote.hidden = !showFileNote;
  $("#btn-save").disabled = !s.valid;
  $("#btn-save").classList.toggle("secondary", !s.valid && !(savedEmpty && input.value.trim() === ""));
  return norm;
}

/* ---------- 渲染 ---------- */

function fillSelect(select, values, current) {
  select.innerHTML = "";
  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = String(v);
    opt.textContent = String(v);
    if (v === current) opt.selected = true;
    select.append(opt);
  }
}

function hasPermission(name) {
  return chrome.permissions.contains({ permissions: [name] });
}

async function renderPermStatus() {
  const [bm, ts] = await Promise.all([hasPermission("bookmarks"), hasPermission("topSites")]);
  const bmEl = $("#perm-status-bookmarks");
  const tsEl = $("#perm-status-topsites");

  const render = (el, granted, enabled, deniedFlag) => {
    el.classList.toggle("ok", granted);
    el.classList.toggle("denied", !granted && deniedFlag && enabled);
    if (granted) el.textContent = t("permGranted");
    else if (enabled && deniedFlag) el.textContent = t("permDeniedHint");
    else el.textContent = t("permMissing");
  };

  render(bmEl, bm, settings.dashboard.bookmarks, settings.permissionDenied.bookmarks);
  render(tsEl, ts, settings.dashboard.topSites, settings.permissionDenied.topSites);
  $("#dash-bookmarks").checked = settings.dashboard.bookmarks;
  $("#dash-topsites").checked = settings.dashboard.topSites;
}

function renderSettingsJson() {
  $("#settings-json").textContent = JSON.stringify(settings, null, 2);
}

function renderAll() {
  $("#url-input").value = settings.redirectUrl;
  document.querySelector(`input[name="redirect-mode"][value="${settings.redirectMode}"]`).checked = true;
  $("#sync-switch").checked = settings.syncEnabled;
  document.querySelector(`input[name="theme"][value="${settings.appearance.theme}"]`).checked = true;
  fillSelect($("#count-bookmarks"), BOOKMARK_COUNTS, settings.dashboard.bookmarkCount);
  fillSelect($("#count-topsites"), TOPSITE_COUNTS, settings.dashboard.topSiteCount);
  renderStatus();
  renderPermStatus();
  renderSettingsJson();
}

/* ---------- 事件 ---------- */

async function commit(patch) {
  settings = await saveSettings(patch);
  renderAll();
  showToast(t("toastSaved"));
}

function wireEvents() {
  const urlInput = $("#url-input");
  urlInput.addEventListener("input", renderStatus);
  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("#btn-save").click();
  });

  $("#btn-save").addEventListener("click", async () => {
    const norm = renderStatus();
    if (!norm.ok) {
      showToast(t("toastSaveInvalid"));
      urlInput.focus();
      return;
    }
    await commit({ redirectUrl: norm.url === "" ? "" : urlInput.value.trim() });
  });

  $("#btn-test").addEventListener("click", async () => {
    const norm = normalizeRedirectUrl(urlInput.value, { selfOrigin });
    if (!norm.ok) {
      showToast(t("toastTestFailed"));
      return;
    }
    try {
      await chrome.tabs.create({ url: norm.url, active: true });
      showToast(t("toastTestOpened"));
    } catch {
      showToast(t("toastTestFailed"));
    }
  });

  $("#quick-picks").addEventListener("click", async (e) => {
    const chip = e.target.closest(".chip[data-url]");
    if (!chip) return;
    const url = chip.dataset.url;
    $("#url-input").value = url;
    renderStatus();
    settings = await saveSettings({ redirectUrl: url });
    renderAll();
    showToast(t("toastSaved"));
  });

  for (const radio of document.querySelectorAll('input[name="redirect-mode"]')) {
    radio.addEventListener("change", () => commit({ redirectMode: radio.value }));
  }

  $("#sync-switch").addEventListener("change", (e) => commit({ syncEnabled: e.target.checked }));

  $("#btn-sync-restore").addEventListener("click", async () => {
    const remote = await getSyncedSettings();
    if (!remote) {
      showToast(t("syncRestoreNone"));
      return;
    }
    settings = await saveSettings(remote);
    renderAll();
    applyTheme(settings.appearance.theme);
    showToast(t("syncRestored"));
  });

  for (const radio of document.querySelectorAll('input[name="theme"]')) {
    radio.addEventListener("change", () => {
      applyTheme(radio.value);
      commit({ appearance: { theme: radio.value } });
    });
  }

  $("#count-bookmarks").addEventListener("change", (e) =>
    commit({ dashboard: { bookmarkCount: Number(e.target.value) } })
  );
  $("#count-topsites").addEventListener("change", (e) =>
    commit({ dashboard: { topSiteCount: Number(e.target.value) } })
  );

  // 开关：无权限时先请求（用户手势内），拒绝则回退并记录 denied 状态
  $("#dash-bookmarks").addEventListener("change", async (e) => {
    const enable = e.target.checked;
    if (enable && !(await hasPermission("bookmarks"))) {
      const granted = await chrome.permissions.request({ permissions: ["bookmarks"] }).catch(() => false);
      if (!granted) {
        e.target.checked = false;
        await commit({ permissionDenied: { bookmarks: true } });
        return;
      }
    }
    await commit({ dashboard: { bookmarks: enable }, permissionDenied: { bookmarks: false } });
  });

  $("#dash-topsites").addEventListener("change", async (e) => {
    const enable = e.target.checked;
    if (enable && !(await hasPermission("topSites"))) {
      const granted = await chrome.permissions.request({ permissions: ["topSites"] }).catch(() => false);
      if (!granted) {
        e.target.checked = false;
        await commit({ permissionDenied: { topSites: true } });
        return;
      }
    }
    await commit({ dashboard: { topSites: enable }, permissionDenied: { topSites: false } });
  });

  // 危险操作：重置（<dialog> 确认）
  const dialog = $("#reset-dialog");
  $("#btn-reset").addEventListener("click", () => dialog.showModal());
  $("#reset-cancel").addEventListener("click", () => dialog.close());
  $("#reset-confirm").addEventListener("click", async () => {
    dialog.close();
    settings = await resetSettings();
    renderAll();
    applyTheme(settings.appearance.theme);
    showToast(t("toastReset"));
  });

  $("#link-extensions").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: "chrome://extensions" });
  });

  // 权限被外部变更（chrome://extensions 撤销）时刷新状态
  chrome.permissions.onAdded.addListener(renderPermStatus);
  chrome.permissions.onRemoved.addListener(renderPermStatus);
}

function renderQuickPicks() {
  const wrap = $("#quick-picks");
  wrap.innerHTML = "";
  const icons = {
    pickBlank:
      '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="2.7" y="2.7" width="10.6" height="10.6" rx="2" stroke="currentColor" stroke-width="1.5"/></svg>',
    pickDownloads:
      '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 2.5v7m0 0 3-3m-3 3-3-3M3 12.5h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    pickHistory:
      '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.5V8l2.4 1.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    pickExtensions:
      '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="2.5" y="2.5" width="4.6" height="4.6" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="8.9" y="2.5" width="4.6" height="4.6" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="2.5" y="8.9" width="4.6" height="4.6" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="8.9" y="8.9" width="4.6" height="4.6" rx="1" stroke="currentColor" stroke-width="1.4"/></svg>',
    pickSettings:
      '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2.2" stroke="currentColor" stroke-width="1.5"/><path d="M8 1.8v2m0 8.4v2m6.2-6.2h-2M3.8 8h-2m10.66-3.66-1.42 1.42M5.16 10.84l-1.42 1.42m8.52 0-1.42-1.42M5.16 5.16 3.74 3.74" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    pickDashboard:
      '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M2.5 6.5h11M6.5 6.5v7" stroke="currentColor" stroke-width="1.5"/></svg>',
  };
  for (const pick of QUICK_PICKS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.dataset.url = pick.url;
    btn.innerHTML = icons[pick.key] ?? "";
    const label = document.createElement("span");
    label.textContent = t(pick.key);
    btn.append(label);
    wrap.append(btn);
  }
}

/* ---------- 启动 ---------- */

async function main() {
  applyI18n();
  settings = await getSettings();
  applyTheme(settings.appearance.theme);
  watchSystemTheme(() => settings?.appearance.theme ?? "system");

  $("#version").textContent = `${t("footerVersion")} ${chrome.runtime.getManifest().version}`;
  renderQuickPicks();
  renderAll();
  wireEvents();
}

void main();
