# Changelog

本文件从 v4.0.0 开始维护。更早的历史变更继承自原项目
[jimschubert/NewTab-Redirect](https://github.com/jimschubert/NewTab-Redirect)
（原 `changes.txt`，v3.1.6 之前的历史请查阅上游仓库与 `docs/BASELINE.md`）。

## 4.0.0 (2026-10-08)

基于 v3.1.6（commit `422858b`）的完整现代化重构。

### 移除

- AngularJS 全套（vendor、controllers / services / directives / filters、
  `ng-*`、`$scope`、`$q`、deferred bootstrap）；
- jQuery 1.10.2；
- Font Awesome 字体图标体系；
- 旧 Chrome Apps Dashboard（含 App 卸载/启动）及对应的 `management` 权限；
- 旧四 Tab 设置页（URL / Permissions / Contact / Donate）与旧滑动教程 Welcome 页；
- 旧截图、XCF 源文件、examples、upgraded 升级页；
- `tabs` 可选权限（原仅用于“新窗口打开 App”）；
- Donate / Twitter / Patreon 等入口。

### 新增

- 原生 HTML + CSS + ES Modules 重写的全部页面（无运行时框架、无远程代码）；
- 集中式设置存储层（schema v2：`redirectUrl` / `redirectMode` / `syncEnabled` /
  `dashboard` / `appearance` / `welcome`），带版本守卫与默认值合并；
- `normalizeRedirectUrl()`：无 scheme 默认补 `https://`；支持 `file://`、
  `chrome://`、`about:blank`；拒绝 `data:`（现代 Chrome 已阻止顶层 frame
  导航到 data: URL，实测 `tabs.update` 假成功会导致白屏，故不再延续上游
  2015 年加入的该特性）、`javascript:` 与未知 scheme；`chrome://newtab`
  等自指地址死循环防护；跳转加 3 秒兜底显影防白屏；
- 默认新标签页轻量仪表盘（Top Sites + 书签栏 + 设置入口，可选、按需请求权限）；
- Welcome 一屏首启设置；
- 简体中文 / English 全量 i18n（`_locales`）；
- 浅色 / 深色 / 跟随系统主题；
- Node 内置 test runner 单元测试（31 用例）、静态检查脚本与
  Playwright 真实浏览器端到端回归（34 项 × 中英双语）；
- ESLint / Prettier 开发工具链与 GitHub Actions（lint + test + check + 打包）。

### 修复

- `background.js`：修复对 `chrome.storage.local.get()` 返回对象直接
  `JSON.parse()` 导致的 TypeError（重新启用扩展时初始化失败）；
- `background.js`：修复 `syncOptions == "false"` 永假比较导致的错误同步镜像；
- Options 与 background 对 `syncOptions` 未定义时语义相反的问题
  （统一为仅 `=== true` 视为开启）；
- 跳转改用 `location.replace()`，不再额外产生历史记录；
- `redirect.js` 不再只读 local（镜像逻辑修复后 sync 用户读到正确值）。

### 变更

- Manifest v3.1.6 → v4.0.0；`minimum_chrome_version` 89 → 104（`favicon` 权限要求）；
- `host_permissions` 收敛为 `file:///*`（保留 Chrome 118 file:// 跳转修复，
  移除无效写法 `file:///`、`file://` 与非必需的 `*://*`）；
- 页面迁移至 `pages/`，样式与脚本按职责拆分至 `css/`、`js/lib/`；
- 图标标准化为 16 / 32 / 48 / 128。
