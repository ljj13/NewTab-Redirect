/**
 * 真实浏览器端到端回归（Playwright，Chromium 有头）。
 *
 * 前置：npx playwright@1.50 install chromium
 *（品牌版 Chrome/Edge 137+ 已移除 --load-extension，必须用 Playwright 的 Chromium。）
 *
 * 覆盖：
 *  - 全新安装 → SW 迁移 + Welcome 自动打开
 *  - Welcome 流程（i18n、非法输入拦截、开始/跳过）
 *  - Dashboard 渲染（未配置 URL）
 *  - 跳转矩阵：bare/https/http/chrome://about:blank/file://data:/tabupdate/死循环/非法输入
 *  - 旧配置迁移（真实 chrome.storage，幂等）
 *  - Options：实时校验、主题持久化、Sync 写入、快速选择、重置确认、file 提示
 *  - optional 权限请求实际行为（记录）
 *  - 所有页面 console 无异常
 *
 * 用法：node scripts/dev/e2e.mjs [--lang zh-CN] [--headed=false]
 */

import { chromium } from "playwright-core";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const argOf = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const LANG = argOf("--lang", "en-US");
const EXT = resolve(import.meta.dirname, "..", "..");

/** @type {{name:string, ok:boolean, info?:string}[]} */
const results = [];
const consoleErrors = [];
function report(name, ok, info = "") {
  results.push({ name, ok, info });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  -- " + info : ""}`);
}

function watchPage(page, label) {
  page.on("pageerror", (err) => consoleErrors.push(`${label} pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`${label} console.error: ${msg.text()}`);
  });
}

const profile = await mkdtemp(join(tmpdir(), "ntr-e2e-"));
const ctx = await chromium.launchPersistentContext(profile, {
  headless: false,
  locale: LANG,
  viewport: { width: 1280, height: 900 },
  args: [`--lang=${LANG}`, `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

const screenshotDir = join(EXT, "dist", "shots");
await mkdir(screenshotDir, { recursive: true });

try {
  /* -- 1. 全新安装：service worker + Welcome 自动打开 -- */
  let sw = null;
  for (let i = 0; i < 60 && !sw; i++) {
    sw = ctx.serviceWorkers().find((w) => w.url().includes("js/background.js"));
    if (!sw) await delay(500);
  }
  report("SW: 扩展 service worker 已加载", !!sw, sw?.url() ?? "not found");
  const EXT_ID = sw ? new URL(sw.url()).host : "";
  report("SW: 扩展 ID 解析", /^[a-p]{32}$/.test(EXT_ID), EXT_ID);

  const swHealthy = sw
    ? await sw.evaluate(async () => {
        const items = await chrome.storage.local.get(null);
        return { migrated: !!items.settings, version: items.settings?.version };
      })
    : null;
  report("SW: 启动即完成 v2 迁移/初始化", swHealthy?.migrated === true && swHealthy?.version === 2, JSON.stringify(swHealthy));

  let welcome = null;
  for (let i = 0; i < 40 && !welcome; i++) {
    welcome = ctx.pages().find((p) => p.url().endsWith("/pages/welcome.html"));
    if (!welcome) await delay(500);
  }
  report("安装流: 全新安装自动打开 Welcome 页", !!welcome, welcome?.url() ?? "not found");

  /* -- 2. Welcome 页 -- */
  watchPage(welcome, "welcome");
  await welcome.waitForLoadState("load");
  await delay(500);
  const subtitle = await welcome.locator('[data-i18n="welcomeSubtitle"]').textContent();
  report(`Welcome: i18n 生效（${LANG}）`, Boolean(subtitle) && !subtitle.startsWith("welcomeSubtitle"), subtitle);

  const startEnabledEmpty = await welcome.locator("#btn-start").isEnabled();
  report("Welcome: 输入为空也可开始（落 Dashboard）", startEnabledEmpty, String(startEnabledEmpty));

  await welcome.fill("#url-input", "not a url!!");
  const invalidBlocked = !(await welcome.locator("#btn-start").isEnabled());
  report("Welcome: 非法输入禁用“开始使用”", invalidBlocked);

  await welcome.screenshot({ path: join(screenshotDir, `welcome-${LANG}.png`) });

  await welcome.fill("#url-input", "chrome://downloads");
  await welcome.click("#btn-start");
  // chrome://downloads 属特殊地址 → tabs.update 直接跳转，不经过 newtab 页
  let jumpedUrl = null;
  try {
    await welcome.waitForURL((u) => !u.href.includes("welcome.html"), { timeout: 10000 });
    jumpedUrl = welcome.url();
  } catch {
    jumpedUrl = null;
  }
  report("Welcome: “开始使用”保存并完成跳转", jumpedUrl === "chrome://downloads/", jumpedUrl ?? "URL 未变化");

  /* -- 3. Dashboard 与跳转矩阵 -- */
  const dashPage = await ctx.newPage();
  await dashPage.goto(`chrome-extension://${EXT_ID}/pages/options.html`);
  const stored = await dashPage.evaluate(() => chrome.storage.local.get("settings").then((r) => r.settings?.redirectUrl));
  report("存储: Welcome 写入 redirectUrl", stored === "chrome://downloads", String(stored));
  await dashPage.close();

  async function redirectCase(name, patch, expect, opts = {}) {
    const page = await ctx.newPage();
    watchPage(page, `case:${name}`);
    const settings = {
      version: 2,
      redirectUrl: "",
      redirectMode: "navigate",
      syncEnabled: false,
      dashboard: { bookmarks: false, topSites: false, bookmarkCount: 10, topSiteCount: 10 },
      appearance: { theme: "system" },
      welcome: { done: true },
      permissionDenied: { bookmarks: false, topSites: false },
      ...patch,
    };
    // 经 options.html 写入存储（扩展页面上下文），再进入 newtab 触发跳转
    await page.goto(`chrome-extension://${EXT_ID}/pages/options.html`);
    await page.evaluate((s) => chrome.storage.local.set({ settings: s }), settings);
    await page.goto(`chrome-extension://${EXT_ID}/pages/newtab.html`);

    let ok = false;
    let info = page.url();
    if (expect === "stay") {
      await page.waitForLoadState("load");
      await delay(600);
      ok = page.url().includes("/pages/newtab.html");
      const revealed = await page.evaluate(() => !document.body.classList.contains("boot")).catch(() => false);
      info += ` revealed=${revealed}`;
      if (opts.checkFailedMsg) {
        const failedVisible = await page
          .evaluate(() => document.querySelector("#redirect-failed")?.hidden === false)
          .catch(() => false);
        info += ` failedMsg=${failedVisible}`;
        ok = ok && revealed && failedVisible;
      } else {
        ok = ok && revealed;
      }
    } else {
      try {
        await page.waitForURL((u) => !u.href.includes("/pages/newtab.html"), { timeout: 8000 });
        ok = typeof expect === "function" ? expect(page.url()) : page.url() === expect;
      } catch {
        ok = false;
      }
      info = page.url();
    }
    report(`跳转: ${name}`, ok, info);
    await page.close();
  }

  await redirectCase("bare example.com → https", { redirectUrl: "example.com" }, "https://example.com/");
  await redirectCase("https://example.com", { redirectUrl: "https://example.com" }, "https://example.com/");
  await redirectCase("http://example.com", { redirectUrl: "http://example.com" }, "http://example.com/");
  await redirectCase("chrome://extensions", { redirectUrl: "chrome://extensions" }, "chrome://extensions/");
  await redirectCase("about:blank", { redirectUrl: "about:blank" }, "about:blank");
  await redirectCase("tabupdate 模式 https", { redirectUrl: "https://example.com", redirectMode: "tabupdate" }, "https://example.com/");
  await redirectCase("死循环 chrome://newtab 被拒", { redirectUrl: "chrome://newtab" }, "stay", { checkFailedMsg: true });
  await redirectCase("非法输入回退 Dashboard", { redirectUrl: "foo bar" }, "stay", { checkFailedMsg: true });
  await redirectCase("空 URL → Dashboard", { redirectUrl: "" }, "stay");

  const tempFile = join(profile, "ntr-file-test.html");
  await writeFile(tempFile, "<title>ntr-file-test</title>ok");
  const fileUrl = `file:///${tempFile.replace(/\\/g, "/")}`;
  await redirectCase("file:/// 跳转执行", { redirectUrl: fileUrl }, (u) => u.startsWith("file:///"));

  // data: —— Chrome 对顶层 data: 导航有限制，回退 Dashboard 不白屏即算通过
  await redirectCase("data:text/html 回退安全", { redirectUrl: "data:text/html,<h1>ok</h1>" }, "stay");

  /* -- 4. Dashboard 渲染 -- */
  {
    const page = await ctx.newPage();
    watchPage(page, "dashboard");
    await page.goto(`chrome-extension://${EXT_ID}/pages/options.html`);
    await page.evaluate(() =>
      chrome.storage.local.set({
        settings: {
          version: 2,
          redirectUrl: "",
          redirectMode: "navigate",
          syncEnabled: false,
          dashboard: { bookmarks: false, topSites: false, bookmarkCount: 10, topSiteCount: 10 },
          appearance: { theme: "system" },
          welcome: { done: true },
          permissionDenied: { bookmarks: false, topSites: false },
        },
      })
    );
    await page.goto(`chrome-extension://${EXT_ID}/pages/newtab.html`);
    await page.waitForFunction(() => !document.body.classList.contains("boot"));
    const state = await page.evaluate(() => ({
      gear: !!document.querySelector("#btn-settings"),
      enableTop: !document.querySelector("#enable-topsites").hidden,
      enableBm: !document.querySelector("#enable-bookmarks").hidden,
      topHidden: document.querySelector("#topsites-section").hidden,
      bmHidden: document.querySelector("#bookmarks-section").hidden,
    }));
    report(
      "Dashboard: 未配置 URL 渲染（设置入口 + 启用卡片，无权限区块）",
      state.gear && state.enableTop && state.enableBm && state.topHidden && state.bmHidden,
      JSON.stringify(state)
    );
    await page.screenshot({ path: join(screenshotDir, `dashboard-${LANG}.png`) });

    // optional 权限请求（自动化环境下记录实际行为：弹窗/拒绝/超时）
    const outcome = await Promise.race([
      page
        .evaluate(() => chrome.permissions.request({ permissions: ["topSites"] }))
        .then((v) => `resolved: ${v}`, (e) => `rejected: ${e?.message ?? e}`),
      delay(4000).then(() => "timeout: 弹窗阻塞自动化（真实环境需用户点击）"),
    ]);
    report("权限: topSites 请求实际行为（记录）", true, String(outcome));

    // 权限拒绝路径：denied 置位后只显示提示
    await page.evaluate(() =>
      chrome.storage.local.set({
        settings: {
          version: 2,
          redirectUrl: "",
          redirectMode: "navigate",
          syncEnabled: false,
          dashboard: { bookmarks: false, topSites: true, bookmarkCount: 10, topSiteCount: 10 },
          appearance: { theme: "system" },
          welcome: { done: true },
          permissionDenied: { bookmarks: false, topSites: true },
        },
      })
    );
    await page.reload();
    await page.waitForFunction(() => !document.body.classList.contains("boot"));
    const deniedHint = await page.evaluate(() => ({
      enableHidden: document.querySelector("#enable-topsites").hidden,
      deniedVisible: !document.querySelector("#denied-topsites").hidden,
    }));
    report(
      "Dashboard: 权限被拒后不再骚扰（隐藏启用卡、显示提示）",
      deniedHint.enableHidden && deniedHint.deniedVisible,
      JSON.stringify(deniedHint)
    );
    await page.close();
  }

  /* -- 5. 旧配置迁移（真实 chrome.storage） -- */
  {
    const page = await ctx.newPage();
    watchPage(page, "migration");
    await page.goto(`chrome-extension://${EXT_ID}/pages/options.html`);
    const m = await page.evaluate(async () => {
      await chrome.storage.local.clear();
      await chrome.storage.sync.clear();
      await chrome.storage.local.set({
        url: "example.com",
        syncOptions: false,
        "always-tab-update": true,
        showWelcome: true,
        "ntr.enable_bookmarks": true,
        "ntr.enable_top": false,
        "ntr.bookmark_count": 25,
        "ntr.top_count": 99,
      });
      const mod = await import(chrome.runtime.getURL("js/lib/storage.js"));
      const s1 = await mod.migrateSettings();
      const keys = Object.keys(await chrome.storage.local.get(null));
      const s2 = await mod.migrateSettings();
      return {
        s1: {
          url: s1.redirectUrl,
          mode: s1.redirectMode,
          bm: s1.dashboard.bookmarks,
          top: s1.dashboard.topSites,
          bmc: s1.dashboard.bookmarkCount,
          topc: s1.dashboard.topSiteCount,
          welcomeDone: s1.welcome.done,
        },
        idempotent: JSON.stringify(s1) === JSON.stringify(s2),
        legacyCleaned: !keys.some((k) => k !== "settings"),
      };
    });
    const ok =
      m.s1.url === "example.com" &&
      m.s1.mode === "tabupdate" &&
      m.s1.bm === true &&
      m.s1.top === false &&
      m.s1.bmc === 25 &&
      m.s1.topc === 20 &&
      m.s1.welcomeDone === true &&
      m.idempotent &&
      m.legacyCleaned;
    report("迁移: 旧键 → v2（值/钳制/幂等/清理）", ok, JSON.stringify(m));
    await page.close();
  }

  /* -- 6. Options 页 -- */
  {
    const page = await ctx.newPage();
    watchPage(page, "options");
    await page.goto(`chrome-extension://${EXT_ID}/pages/options.html`);
    await page.waitForLoadState("load");
    await delay(400);
    const title = await page.locator('[data-i18n="redirectTitle"]').textContent();
    report(`Options: i18n 生效（${LANG}）`, Boolean(title) && !title.startsWith("redirectTitle"), title);

    await page.fill("#url-input", "example.com");
    const okText = await page.locator("#url-status").textContent();
    await page.fill("#url-input", "javascript:alert(1)");
    await page.locator("#url-input").dispatchEvent("input");
    const badDisabled = await page.locator("#btn-save").isDisabled();
    report("Options: URL 实时校验（非法禁存）", badDisabled && okText.trim().length > 0, `ok="${okText.trim()}" saveDisabled=${badDisabled}`);

    await page.click('input[name="theme"][value="dark"]', { force: true });
    await delay(300);
    const dark = await page.evaluate(() => document.documentElement.dataset.theme);
    report("主题: 深色即时生效", dark === "dark", String(dark));
    await page.screenshot({ path: join(screenshotDir, `options-dark-${LANG}.png`) });

    const themeStored = await page.evaluate(() => chrome.storage.local.get("settings").then((r) => r.settings?.appearance?.theme));
    report("主题: 持久化", themeStored === "dark", String(themeStored));

    await page.locator("#sync-switch").click({ force: true });
    await delay(400);
    const syncCopy = await page.evaluate(() => chrome.storage.sync.get("settings").then((r) => r.settings?.syncEnabled));
    report("Sync: 开启后写入 sync 区", syncCopy === true, String(syncCopy));

    await page.click('#quick-picks .chip[data-url=""]');
    await delay(300);
    const cleared = await page.evaluate(() => chrome.storage.local.get("settings").then((r) => r.settings?.redirectUrl));
    report("Options: 快速选择“默认仪表盘”清空 URL", cleared === "", String(cleared));
    await page.screenshot({ path: join(screenshotDir, `options-${LANG}.png`) });

    await page.click("#btn-reset");
    const dialogOpen = await page.evaluate(() => document.querySelector("#reset-dialog").open);
    await page.click("#reset-cancel");
    report("Options: 重置需 <dialog> 确认", dialogOpen === true, String(dialogOpen));

    await page.fill("#url-input", "file:///C:/x/start.html");
    await page.locator("#url-input").dispatchEvent("input");
    const fileNote = await page.evaluate(() => !document.querySelector("#file-note").hidden);
    report("Options: file: 输入显示文件访问提示", fileNote === true, String(fileNote));

    // 保存 URL 流程
    await page.fill("#url-input", "https://saved.example/");
    await page.click("#btn-save");
    await delay(300);
    const saved = await page.evaluate(() => chrome.storage.local.get("settings").then((r) => r.settings?.redirectUrl));
    report("Options: 保存按钮写入设置", saved === "https://saved.example/", String(saved));
    await page.close();
  }

  /* -- 7. 汇总 console 错误 -- */
  report("Console: 所有页面无 pageerror/console.error", consoleErrors.length === 0, `${consoleErrors.length} 条`);
  for (const e of consoleErrors.slice(0, 12)) console.log("   · " + e);
} catch (err) {
  report("E2E 运行异常", false, String(err?.stack ?? err));
} finally {
  await ctx.close().catch(() => {});
  await delay(500);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

const failed = results.filter((r) => !r.ok);
console.log(`\n==== e2e (${LANG}): ${results.length - failed.length}/${results.length} passed ====`);
if (failed.length > 0) {
  for (const f of failed) console.log(`FAILED: ${f.name} -- ${f.info}`);
  process.exit(1);
}
