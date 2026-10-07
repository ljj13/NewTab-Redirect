/**
 * Welcome 首启页：一屏完成首次设置。
 *
 * - “开始使用”：保存 URL 并标记 welcome.done，随后按已保存配置跳转。
 * - “跳过”：仅标记 welcome.done，进入默认 Dashboard。
 * 完成后不再自动弹出（仅全新安装且未完成时由 background 打开）。
 */

import { applyI18n, t } from "../js/lib/i18n.js";
import { normalizeRedirectUrl, performRedirect } from "../js/lib/redirect.js";
import { applyTheme, watchSystemTheme } from "../js/lib/theme.js";
import { getSettings, saveSettings } from "../js/lib/storage.js";

const selfOrigin = `chrome-extension://${chrome.runtime.id}`;

function statusFor(norm) {
  if (norm.ok) return { key: "urlOk", valid: true, empty: false };
  if (norm.error === "empty") return { key: "urlEmpty", valid: true, empty: true };
  const keyByError = {
    loop: "urlLoop",
    forbidden: "urlForbidden",
    unsupported: "urlUnsupported",
  };
  return { key: keyByError[norm.error] ?? "urlInvalid", valid: false, empty: false };
}

function renderStatus() {
  const input = document.querySelector("#url-input");
  const el = document.querySelector("#url-status");
  const startBtn = document.querySelector("#btn-start");
  const norm = normalizeRedirectUrl(input.value, { selfOrigin });
  const s = statusFor(norm);

  input.classList.toggle("invalid", !s.valid);
  el.classList.toggle("success-text", s.valid && !s.empty);
  el.classList.toggle("danger-text", !s.valid);
  el.textContent = t(s.key);
  startBtn.disabled = !s.valid;
}

async function finishAndGo(settings) {
  // 跳到 chrome://newtab：有配置则经新标签页完成跳转，无配置则落在 Dashboard
  if (settings.redirectUrl.trim() !== "") {
    const result = await performRedirect(settings, { selfOrigin });
    if (result.redirected) return;
  }
  try {
    await chrome.tabs.update({ url: "chrome://newtab" });
  } catch (e) {
    console.error("[NTR4] welcome finish failed:", e);
  }
}

async function main() {
  applyI18n();
  const settings = await getSettings();
  applyTheme(settings.appearance.theme);
  watchSystemTheme(() => settings.appearance.theme);

  const input = document.querySelector("#url-input");
  input.value = settings.redirectUrl;
  renderStatus();

  input.addEventListener("input", renderStatus);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !document.querySelector("#btn-start").disabled) {
      document.querySelector("#btn-start").click();
    }
  });

  document.querySelector("#btn-start").addEventListener("click", async () => {
    const norm = normalizeRedirectUrl(input.value, { selfOrigin });
    if (!norm.ok) {
      renderStatus();
      return;
    }
    const saved = await saveSettings({
      redirectUrl: norm.error === "empty" ? "" : input.value.trim(),
      welcome: { done: true },
    });
    await finishAndGo(saved);
  });

  document.querySelector("#btn-skip").addEventListener("click", async () => {
    const saved = await saveSettings({ welcome: { done: true } });
    await finishAndGo(saved);
  });
}

void main();
