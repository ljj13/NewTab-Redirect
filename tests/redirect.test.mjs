/**
 * redirect.js 的 Node 单元测试。
 * 覆盖任务 P10 回归项 2–9：无 scheme、http/https、about:blank、
 * chrome://、file://、data:、非法输入、死循环防护。
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeRedirectUrl } from "../js/lib/redirect.js";

const SELF_ORIGIN = "chrome-extension://abcdefghijklmnop";

const okHttp = (raw, opts) => {
  const r = normalizeRedirectUrl(raw, opts);
  assert.deepEqual({ ok: r.ok, mode: r.mode }, { ok: true, mode: "http" }, `${raw}`);
  return r.url;
};
const okSpecial = (raw, opts) => {
  const r = normalizeRedirectUrl(raw, opts);
  assert.deepEqual({ ok: r.ok, mode: r.mode }, { ok: true, mode: "special" }, `${raw}`);
  return r.url;
};
const err = (raw, error, opts) => {
  const r = normalizeRedirectUrl(raw, opts);
  assert.equal(r.ok, false, `${raw} 应被拒绝`);
  assert.equal(r.error, error, `${raw} 期望错误 ${error}，实际 ${r.error}`);
};

test("无 scheme 输入默认补 https://", () => {
  assert.equal(okHttp("example.com"), "https://example.com/");
  assert.equal(okHttp("example.com/a?b=c"), "https://example.com/a?b=c");
  assert.equal(okHttp("localhost"), "https://localhost/");
});

test("显式 http/https", () => {
  assert.equal(okHttp("https://example.com"), "https://example.com/");
  assert.equal(okHttp("http://example.com"), "http://example.com/");
  assert.equal(okHttp("HTTPS://EXAMPLE.COM/PATH"), "https://example.com/PATH");
  assert.equal(okHttp("https://example.com:8443/x#y"), "https://example.com:8443/x#y");
});

test("// 开头补 https", () => {
  assert.equal(okHttp("//example.com/x"), "https://example.com/x");
});

test("about: 仅支持 about:blank", () => {
  assert.equal(okSpecial("about:blank"), "about:blank");
  assert.equal(okSpecial("about:BLANK"), "about:blank");
  err("about:config", "unsupported");
  err("about:version", "unsupported");
});

test("chrome:// 特殊页面支持", () => {
  // WHATWG URL 对非特殊 scheme 不追加尾斜杠，href 保持原样
  assert.equal(okSpecial("chrome://downloads"), "chrome://downloads");
  assert.equal(okSpecial("chrome://extensions/"), "chrome://extensions/");
  assert.equal(okSpecial("chrome://history"), "chrome://history");
  assert.equal(okSpecial("chrome://settings"), "chrome://settings");
});

test("chrome://newtab 与 new-tab-page 死循环防护", () => {
  err("chrome://newtab", "loop");
  err("chrome://newtab/", "loop");
  err("chrome://new-tab-page", "loop");
  err("chrome://new-tab-page/", "loop");
});

test("chrome-extension:// 指向自身时拒绝，指向其他扩展允许", () => {
  err(`${SELF_ORIGIN}/pages/newtab.html`, "loop", { selfOrigin: SELF_ORIGIN });
  const other = okSpecial("chrome-extension://zzzzzzzz/home.html", { selfOrigin: SELF_ORIGIN });
  assert.equal(other, "chrome-extension://zzzzzzzz/home.html");
});

test("file:// 支持", () => {
  assert.equal(okSpecial("file:///C:/pages/start.html"), "file:///C:/pages/start.html");
  assert.equal(okSpecial("file:///home/user/nt.html"), "file:///home/user/nt.html");
  okSpecial("file:///");
  okSpecial("file://server/share/doc.html"); // UNC 形式合法
  okSpecial("file:");
});

test("data: 一律拒绝（现代 Chrome 阻止顶层 data 导航）", () => {
  err("data:text/html,<h1>hi</h1>", "unsupported");
  err("data:text/plain,hello", "unsupported");
  err("data:image/png;base64,AAAA", "unsupported");
});

test("javascript: 拒绝；未知 scheme 拒绝；透传 scheme 允许", () => {
  err("javascript:alert(1)", "forbidden");
  err("ftp://example.com", "unsupported");
  err("mailto:someone@example.com", "unsupported");
  okSpecial("view-source:https://example.com");
  okSpecial("devtools://devtools/bundled/inspector.html");
});

test("空输入与垃圾输入", () => {
  err("", "empty");
  err("   ", "empty");
  err(null, "empty");
  err(undefined, "empty");
  err("foo bar", "invalid");
  err("https://", "invalid");
  err("chrome://", "invalid");
  err("http://", "invalid");
  err("::::", "invalid");
});

test("首尾空白被忽略", () => {
  assert.equal(okHttp("  https://example.com  "), "https://example.com/");
});

test("normalize 不抛异常（非法输入都返回结果对象）", () => {
  for (const raw of ["\u0000", "%", "\\", "http://[", "chrome://[bad", 123, {}, []]) {
    assert.doesNotThrow(() => normalizeRedirectUrl(raw));
  }
});
