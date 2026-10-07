/**
 * 静态检查脚本（Node，无第三方依赖）：
 * 1. manifest.json：JSON 合法、MV3 必需字段、__MSG__ 本地化键存在、引用文件存在。
 * 2. _locales：en / zh_CN 键集合一致、无空 message。
 * 3. 页面/脚本：data-i18n 与 t("...") 引用的键都存在；本地资源引用可解析。
 * 4. 安全：不加载任何远程 JS/CSS/font/图片；无 AngularJS/jQuery/FontAwesome 残留。
 *
 * 任何问题以非零码退出。
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;

const fail = (msg) => {
  failures++;
  console.error("  ✗ " + msg);
};
const pass = (msg) => console.log("  ✓ " + msg);

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/* ---------- manifest ---------- */
console.log("[manifest.json]");
const manifest = readJson(join(ROOT, "manifest.json"));

if (manifest.manifest_version === 3) pass("manifest_version = 3");
else fail("manifest_version must be 3");

for (const key of ["name", "version", "default_locale", "background", "icons"]) {
  if (manifest[key] !== undefined) pass(`field "${key}" present`);
  else fail(`field "${key}" missing`);
}

if (typeof manifest.version === "string" && /^\d+(\.\d+){1,3}$/.test(manifest.version)) {
  pass(`version = ${manifest.version}`);
} else fail(`invalid version: ${manifest.version}`);

if (manifest.background?.service_worker) pass(`service_worker = ${manifest.background.service_worker}`);
else fail("background.service_worker missing");

const msgRefRe = /^__MSG_(.+?)__$/;
for (const field of ["name", "short_name", "description"]) {
  const m = msgRefRe.exec(manifest[field]);
  if (!m) continue;
  if (manifest.default_locale) pass(`${field} localized via ${m[1]}`);
  else fail(`${field} uses __MSG_ but default_locale missing`);
}

const referencedFiles = [
  manifest.background?.service_worker,
  manifest.options_ui?.page,
  manifest.chrome_url_overrides?.newtab,
  ...Object.values(manifest.icons ?? {}),
].filter(Boolean);

for (const rel of referencedFiles) {
  if (existsSync(join(ROOT, rel))) pass(`referenced file exists: ${rel}`);
  else fail(`referenced file missing: ${rel}`);
}

if (manifest.host_permissions?.includes("file:///*")) {
  pass("host_permissions keeps file:///* (Chrome 118 file redirect fix)");
} else fail("host_permissions must keep file:///* (Chrome 118 regression)");

const forbiddenPerms = (manifest.permissions ?? []).filter((p) => ["tabs", "management", "history", "bookmarks", "topSites"].includes(p));
if (forbiddenPerms.length === 0) pass("required permissions minimal (storage/favicon only)");
else fail(`unexpected required permissions: ${forbiddenPerms.join(", ")}`);

/* ---------- _locales ---------- */
console.log("[_locales]");
const en = readJson(join(ROOT, "_locales/en/messages.json"));
const zh = readJson(join(ROOT, "_locales/zh_CN/messages.json"));
const enKeys = Object.keys(en).sort();
const zhKeys = Object.keys(zh).sort();

const onlyEn = enKeys.filter((k) => !zhKeys.includes(k));
const onlyZh = zhKeys.filter((k) => !enKeys.includes(k));
if (onlyEn.length === 0 && onlyZh.length === 0) pass(`key parity ok (${enKeys.length} keys)`);
else {
  if (onlyEn.length) fail(`keys missing in zh_CN: ${onlyEn.join(", ")}`);
  if (onlyZh.length) fail(`keys missing in en: ${onlyZh.join(", ")}`);
}

for (const [locale, dict] of [["en", en], ["zh_CN", zh]]) {
  const empty = Object.entries(dict).filter(([, v]) => !v?.message?.trim());
  if (empty.length === 0) pass(`${locale}: no empty messages`);
  else fail(`${locale}: empty messages: ${empty.map(([k]) => k).join(", ")}`);
}

const allKeys = new Set(enKeys);

// manifest __MSG__ 键存在性
for (const field of ["name", "short_name", "description"]) {
  const m = msgRefRe.exec(manifest[field]);
  if (m && !allKeys.has(m[1])) fail(`manifest ${field} references missing key: ${m[1]}`);
}

/* ---------- 页面与脚本 ---------- */
console.log("[pages & scripts]");
const htmlFiles = ["pages/options.html", "pages/newtab.html", "pages/welcome.html"];
const jsFiles = [
  "js/background.js",
  "js/lib/storage.js",
  "js/lib/redirect.js",
  "js/lib/i18n.js",
  "js/lib/theme.js",
  "js/options.js",
  "js/newtab.js",
  "js/welcome.js",
];

// 1) HTML 中引用的本地资源存在；data-i18n 键存在；无远程资源
for (const file of htmlFiles) {
  const full = join(ROOT, file);
  if (!existsSync(full)) {
    fail(`missing html: ${file}`);
    continue;
  }
  const html = readFileSync(full, "utf8");

  // 只检查真正会加载资源的标签（a[href] 是用户点击的导航链接，不算远程加载）
  const loadRe = /<(script|link|img|source|iframe|embed|track|use)\b[^>]*?\b(?:src|href)="([^"]*)"/gi;
  for (const m of html.matchAll(loadRe)) {
    const ref = m[2];
    if (!ref) continue;
    if (/^https?:\/\//i.test(ref)) fail(`${file}: remote resource <${m[1]}> ${ref}`);
    else if (!existsSync(join(ROOT, dirname(file), ref.split("?")[0].split("#")[0]))) {
      fail(`${file}: unresolved local reference ${ref}`);
    }
  }
  // CSS 内联远程引用
  for (const m of html.matchAll(/style="[^"]*url\(\s*['"]?https?:/gi)) {
    fail(`${file}: remote css url() reference`);
  }

  for (const m of html.matchAll(/data-i18n(?:-ph|-title|-aria)?="([^"]+)"/g)) {
    if (!allKeys.has(m[1])) fail(`${file}: data-i18n key missing: ${m[1]}`);
  }
  pass(`${file}: resources & i18n keys ok`);
}

// 2) JS 中的 t("key") 引用存在；无远程加载；无 Angular 残留
for (const file of jsFiles) {
  const full = join(ROOT, file);
  if (!existsSync(full)) {
    fail(`missing js: ${file}`);
    continue;
  }
  const src = readFileSync(full, "utf8");
  for (const m of src.matchAll(/\bt\(\s*"([^"]+)"/g)) {
    if (!allKeys.has(m[1])) fail(`${file}: t() key missing: ${m[1]}`);
  }
  pass(`${file}: i18n keys ok`);
}

// 3) 远程代码与遗留库检查（HTML + 新 JS + CSS）
console.log("[security & leftovers]");
const remoteRe = /(?:src|href|url\()\s*["'(]?https?:\/\//i;
const angularRe = /\b(angular|ng-app|ng-controller|ng-repeat|ng-model|\$scope|\$q\b|jquery)/i;
const faRe = /font-awesome|fontawesome|FontAwesome\.otf/i;

let clean = true;
for (const file of [...htmlFiles, ...jsFiles, "css/base.css", "css/options.css", "css/newtab.css", "css/welcome.css"]) {
  const full = join(ROOT, file);
  if (!existsSync(full)) continue;
  const content = readFileSync(full, "utf8");
  if (remoteRe.test(content)) {
    fail(`${file}: contains remote URL reference`);
    clean = false;
  }
  if (angularRe.test(content)) {
    fail(`${file}: contains AngularJS/jQuery leftover`);
    clean = false;
  }
  if (faRe.test(content)) {
    fail(`${file}: contains Font Awesome reference`);
    clean = false;
  }
}
if (clean) pass("no remote code, no Angular/jQuery/FontAwesome in new sources");

// 4) 旧入口不再被 manifest 引用
console.log("[legacy entries]");
for (const legacy of ["main.html", "options.html", "welcome.html", "js/redirect.js"]) {
  if (existsSync(join(ROOT, legacy))) {
    console.log(`  ! legacy file still present (cleanup commit removes it): ${legacy}`);
  } else pass(`legacy removed: ${legacy}`);
}

if (failures > 0) {
  console.error(`\nFAILED: ${failures} problem(s)`);
  process.exit(1);
}
console.log("\nAll static checks passed.");
