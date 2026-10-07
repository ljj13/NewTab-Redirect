/**
 * 轻量 i18n 工具：页面中所有用户可见文本统一走 _locales。
 *
 * HTML 用法：
 *   <span data-i18n="save"></span>               → textContent
 *   <input data-i18n-ph="urlPlaceholder">        → placeholder
 *   <button data-i18n-title="testOpen">          → title
 *   <button data-i18n-aria="openSettings">       → aria-label
 */

export function t(key, substitutions) {
  let msg;
  try {
    msg = chrome.i18n.getMessage(key, substitutions);
  } catch {
    msg = undefined;
  }
  return msg || key;
}

export function applyI18n(root = document) {
  try {
    const ui = chrome.i18n.getUILanguage?.();
    if (ui) document.documentElement.lang = ui;
  } catch {
    /* ignore */
  }
  for (const el of root.querySelectorAll("[data-i18n]")) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of root.querySelectorAll("[data-i18n-ph]")) {
    el.placeholder = t(el.dataset.i18nPh);
  }
  for (const el of root.querySelectorAll("[data-i18n-title]")) {
    el.title = t(el.dataset.i18nTitle);
  }
  for (const el of root.querySelectorAll("[data-i18n-aria]")) {
    el.setAttribute("aria-label", t(el.dataset.i18nAria));
  }
}
