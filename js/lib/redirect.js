/**
 * 新标签页跳转核心：URL 规范化 + 跳转执行。
 *
 * normalizeRedirectUrl() 为纯函数（Node 测试可直接导入）；
 * performRedirect() 依赖浏览器环境（window / chrome.tabs）。
 */

/** 不适合 location.replace、必须走 chrome.tabs.update 的 scheme。 */
const PASS_THROUGH_SCHEMES = new Set(["devtools", "view-source", "chrome-untrusted"]);

/** 会导致与 New Tab Override 死循环的 chrome:// 页面。 */
const LOOP_NTP_PATHS = /^(newtab|new-tab-page)\/?$/i;

/**
 * 规范化用户输入的重定向 URL。
 *
 * 规则：
 * - 空输入 → { error: "empty" }（调用方据此展示默认 Dashboard）。
 * - 无 scheme → 补 https://（例：example.com → https://example.com）。
 * - http/https/file/chrome 等 → 用 URL 解析校验。
 * - about: 仅支持 about:blank。
 * - data: 被拒绝：现代 Chrome 阻止顶层 frame 导航到 data: URL（实测
 *   tabs.update 会假成功导致白屏），因此不再支持上游 2015 年加入的该特性。
 * - chrome://newtab、chrome://new-tab-page 及指向本扩展自身的
 *   chrome-extension:// 页面会再次触发 New Tab Override → 判定为 loop 拒绝。
 * - javascript: 及其余未知 scheme → 拒绝。
 *
 * @returns {{ok: true, url: string, mode: "http"|"special"}|
 *           {ok: false, error: "empty"|"invalid"|"unsupported"|"forbidden"|"loop", scheme?: string}}
 */
export function normalizeRedirectUrl(raw, { selfOrigin = "" } = {}) {
  if (raw === undefined || raw === null) return { ok: false, error: "empty" };

  const input = String(raw).trim();
  if (input === "") return { ok: false, error: "empty" };

  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(input);
  const scheme = schemeMatch ? schemeMatch[1].toLowerCase() : "https";

  // URL 中不允许空白字符
  if (/\s/.test(input)) {
    return { ok: false, error: "invalid", scheme };
  }

  let candidate = input;
  if (!schemeMatch) {
    candidate = input.startsWith("//") ? "https:" + input : "https://" + input;
  }

  switch (scheme) {
    case "http":
    case "https": {
      let url;
      try {
        url = new URL(candidate);
      } catch {
        return { ok: false, error: "invalid", scheme };
      }
      if (!url.hostname) return { ok: false, error: "invalid", scheme };
      return { ok: true, url: url.href, mode: "http" };
    }

    case "file": {
      let url;
      try {
        url = new URL(candidate);
      } catch {
        return { ok: false, error: "invalid", scheme };
      }
      return { ok: true, url: url.href, mode: "special" };
    }

    case "about":
      return /^about:blank\/?$/i.test(input)
        ? { ok: true, url: "about:blank", mode: "special" }
        : { ok: false, error: "unsupported", scheme };

    case "chrome": {
      let url;
      try {
        url = new URL(candidate);
      } catch {
        return { ok: false, error: "invalid", scheme };
      }
      if (!url.hostname) return { ok: false, error: "invalid", scheme };
      // WHATWG URL 会把 chrome://newtab 解析为 host=newtab、pathname 为空，
      // 因此用 host+pathname 做死循环判断
      if (LOOP_NTP_PATHS.test(url.hostname + url.pathname)) return { ok: false, error: "loop", scheme };
      return { ok: true, url: url.href, mode: "special" };
    }

    case "chrome-extension": {
      let url;
      try {
        url = new URL(candidate);
      } catch {
        return { ok: false, error: "invalid", scheme };
      }
      if (!url.hostname) return { ok: false, error: "invalid", scheme };
      // 非特殊 scheme 的 origin 为 "null"，需手动拼 origin 再比较
      const origin = `${url.protocol}//${url.host}`;
      if (selfOrigin && origin === selfOrigin) return { ok: false, error: "loop", scheme };
      return { ok: true, url: url.href, mode: "special" };
    }

    case "javascript":
      return { ok: false, error: "forbidden", scheme };

    case "data":
      // 现代 Chrome 阻止顶层 frame 导航到 data: URL（tabs.update 会静默失败），
      // 保留此分支是为了给出明确的 unsupported 语义而不是掉进未知 scheme 分支
      return { ok: false, error: "unsupported", scheme };

    default:
      if (PASS_THROUGH_SCHEMES.has(scheme)) return { ok: true, url: candidate, mode: "special" };
      return { ok: false, error: "unsupported", scheme };
  }
}

/**
 * 执行跳转。
 *
 * - http(s) 且 redirectMode 为 "navigate"：window.location.replace()（不新增历史记录）。
 * - 其余（chrome://、file://、about:blank、data: 等）或 "tabupdate" 模式：
 *   chrome.tabs.update()。
 * - 任何失败都返回 { redirected: false }，调用方回退到默认 Dashboard，
 *   保证非法配置不会造成白屏或死循环。
 */
export async function performRedirect(settings, { selfOrigin = "" } = {}) {
  const raw = settings?.redirectUrl;
  if (typeof raw !== "string" || raw.trim() === "") {
    return { redirected: false, reason: "empty" };
  }

  const norm = normalizeRedirectUrl(raw, { selfOrigin });
  if (!norm.ok) return { redirected: false, reason: norm.error, detail: norm };

  try {
    if (norm.mode === "http" && settings.redirectMode !== "tabupdate") {
      globalThis.window?.location?.replace(norm.url);
      return { redirected: true, via: "location.replace", url: norm.url };
    }
    await globalThis.chrome.tabs.update({ url: norm.url });
    return { redirected: true, via: "tabs.update", url: norm.url };
  } catch (e) {
    return { redirected: false, reason: "error", detail: String(e) };
  }
}
