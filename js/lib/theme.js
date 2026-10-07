/**
 * 主题（浅色 / 深色 / 跟随系统）。
 *
 * CSS 侧约定：
 * - 默认（html 无 data-theme）通过 prefers-color-scheme 媒体查询跟随系统；
 * - html[data-theme="light"] 强制浅色，html[data-theme="dark"] 强制深色。
 */

const DARK_QUERY = "(prefers-color-scheme: dark)";

function resolvedTheme(theme) {
  if (theme === "light" || theme === "dark") return theme;
  return globalThis.matchMedia?.(DARK_QUERY).matches ? "dark" : "light";
}

/** 应用主题，返回实际生效的 "light" | "dark"。 */
export function applyTheme(theme) {
  const mode = theme === "light" || theme === "dark" ? theme : "system";
  const resolved = resolvedTheme(mode);
  if (mode === "system") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = resolved;
  }
  return resolved;
}

/**
 * 注册跟随系统变化的监听（theme 为 "system" 时页面实时切换）。
 * 返回取消监听的函数。
 */
export function watchSystemTheme(getTheme) {
  const mq = globalThis.matchMedia?.(DARK_QUERY);
  if (!mq?.addEventListener) return () => {};
  const onChange = () => applyTheme(getTheme());
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
