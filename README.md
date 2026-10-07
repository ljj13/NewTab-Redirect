# New Tab Redirect（新标签页重定向）

让 Chrome 的每个新标签页打开你指定的网址——或者一个轻量、优雅的默认仪表盘。

**v4.0.0** 是对 [jimschubert/NewTab-Redirect](https://github.com/jimschubert/NewTab-Redirect)（基线 v3.1.6，commit `422858b`）的一次完整现代化重构：移除 AngularJS / jQuery / Font Awesome，改为原生 HTML + CSS + ES Modules；全面重做设置页、新标签页与 Welcome；支持简体中文 / English 与浅色 / 深色 / 跟随系统主题；Manifest V3，最小权限。

- English version: see below / 英文说明见下文。

---

## 主要功能

- **自定义新标签页**：打开任意 `https://` / `http://` / `file:///` / `chrome://` / `about:blank` 等地址。
- **智能规范化**：输入 `example.com` 自动按 `https://example.com` 处理（不再默认补 `http://`）。
- **两种跳转方式**：
  - *直接导航*（默认）：原地替换新标签页，不新增历史记录；
  - *标签页更新*：打开后光标停留在地址栏，方便直接输入搜索。
- **默认仪表盘**（未设置网址时）：常用网站 Top Sites + 书签栏 + 设置入口，均为可选项。
- **Chrome Sync**：可选，把扩展设置同步到你的 Google 账户。
- **中英双语**：跟随浏览器语言（`_locales`，简体中文 / English）。
- **深浅色主题**：跟随系统 / 浅色 / 深色。
- **老配置自动迁移**：v3.x 的设置（`url`、`syncOptions`、`always-tab-update`、`ntr.*`）在升级后自动迁移，不丢配置。

## 安装

### 从源码加载（开发者模式）

1. 下载本仓库（`git clone` 或下载 ZIP 解压）；
2. 打开 `chrome://extensions`，右上角开启「开发者模式」；
3. 点击「加载已解压的扩展程序」，选择本仓库目录（含 `manifest.json` 的目录）。

### Chrome Web Store

本 fork 暂未上架。原版扩展（v3.x）仍可在
[Chrome Web Store](https://chrome.google.com/webstore/detail/new-tab-redirect/icpgjfneehieebagbmdbhnlpiopdcmna)
安装。

## 使用方式

1. 安装后 Welcome 页会引导你输入网址（也可跳过直接使用仪表盘）；
2. 打开扩展设置（`chrome://extensions` → New Tab Redirect → 详细信息 → 扩展程序选项，或仪表盘右上角齿轮）：
   - **新标签页打开**：输入网址并保存，或使用快速选择（空白页 / 下载 / 历史 / 扩展管理 / Chrome 设置 / 默认仪表盘）；
   - **跳转方式**：选择直接导航或标签页更新；
   - **外观**：跟随系统 / 浅色 / 深色；
   - **默认仪表盘**：按需开启书签栏、常用网站并设置数量；
   - **Chrome Sync**：开启后设置在设备间同步。
3. 留空网址即恢复默认仪表盘。

## 本地文件 URL

要把新标签页指向本地 `file:///` 页面（例如自制起始页）：

1. 在设置里填入完整地址，如 `file:///C:/Users/you/start.html`（Windows）或 `file:///home/you/start.html`；
2. 前往 `chrome://extensions` → New Tab Redirect → 详细信息 → 开启 **「允许访问文件网址」**。

这是 Chrome 的安全要求，扩展无法替你完成这一步。若跳转本地文件失败，通常是该开关未开启。

## 权限说明

本扩展遵循最小权限原则。

| 权限 | 类型 | 用途 |
| --- | --- | --- |
| `storage` | 必需 | 保存你的设置（本地） |
| `favicon` | 必需 | 在设置页与仪表盘显示网站图标 |
| `file:///*` | 主机权限 | 允许新标签页跳转到 `file://` 地址（Chrome 118+ 的要求） |
| `bookmarks` | 可选 | 仪表盘显示书签栏，开启该功能时才请求 |
| `topSites` | 可选 | 仪表盘显示常用网站，开启该功能时才请求 |

v3.x 中的 `management`（旧 Apps 页）与 `tabs` 已在 v4 中移除。

## Chrome Sync

在设置中开启后，扩展设置会通过 Chrome 账户同步在设备间保持一致。**只同步扩展设置本身**，不同步你的浏览历史、书签或任何浏览数据。

## 隐私说明

- 无遥测、无广告、无统计、无远程配置；
- 不加载任何远程代码；
- 不收集、不上传你的 URL、书签、常用网站或浏览记录；
- 所有数据只保存在本地，或在你明确开启后经 Chrome Sync 同步到你的 Google 账户。

## 开源许可与致谢

本项目基于原项目 [New Tab Redirect!](https://github.com/jimschubert/NewTab-Redirect) by **James Schubert**，以 [MIT License](LICENSE) 发布并延续。

- 原作者：James Schubert（james.schubert@gmail.com），2009–2023；
- v3.1.6 基线：commit `422858b`（tag `upstream-3.1.6`）；
- Google、Chrome 是 Google, Inc. 的商标，本项目与 Google 无关。

历史变更见 [CHANGELOG.md](CHANGELOG.md)。

## 开发说明

无运行时依赖、无构建步骤，源码即产物。

```text
manifest.json          MV3 清单（v4.0.0）
pages/                 newtab.html / options.html / welcome.html
js/
  background.js        module service worker（迁移 + Welcome + Sync 镜像）
  lib/storage.js       设置存储层（v2 schema、旧配置迁移）
  lib/redirect.js      URL 规范化与跳转执行
  lib/i18n.js          data-i18n 声明式国际化
  lib/theme.js         主题切换
  newtab.js / options.js / welcome.js
css/                   base.css（设计令牌与组件）+ 各页面样式
_locales/              en / zh_CN 文案
icons/                 扩展图标
tests/                 Node 内置 test runner 单元测试
scripts/check.mjs      静态检查（manifest / locales / 远程代码 / 引用完整性）
```

本地开发：

```bash
npm ci        # 安装开发工具链（仅 ESLint/Prettier，不进入运行时）
npm test      # Node 单元测试（storage / redirect）
npm run check # 静态检查
npm run lint  # ESLint
```

在 Chrome 中验证：`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选择仓库根目录。

Node 仅作为开发工具链，扩展运行时不依赖 Node。

---

# English

**New Tab Redirect** opens the URL of your choice — or a clean, lightweight dashboard — in every new Chrome tab.

**v4.0.0** is a full modernization of [jimschubert/NewTab-Redirect](https://github.com/jimschubert/NewTab-Redirect) (baseline v3.1.6, commit `422858b`): AngularJS, jQuery and Font Awesome removed in favor of vanilla HTML + CSS + ES modules; Options, New Tab and Welcome pages redesigned; Simplified Chinese / English i18n; light / dark / system themes; Manifest V3 with minimal permissions.

## Features

- Set any `https://` / `http://` / `file:///` / `chrome://` / `about:blank` address as the new tab page.
- Bare domains are normalized to `https://` (`example.com` → `https://example.com`).
- Two navigation modes: *direct navigation* (replaces the tab, no extra history entry) or *tab update* (cursor stays in the address bar).
- Default dashboard when no URL is set: top sites, bookmarks bar, settings entry — all optional.
- Optional Chrome Sync for extension settings only.
- English / Simplified Chinese, light / dark / system theme.
- Automatic, idempotent migration of v3.x settings.

## Install

Load unpacked: `chrome://extensions` → Developer mode → **Load unpacked** → select this repository folder. This fork is not published to the Chrome Web Store; the original v3.x extension is available [there](https://chrome.google.com/webstore/detail/new-tab-redirect/icpgjfneehieebagbmdbhnlpiopdcmna).

## Local files

To redirect to a local `file:///` page, also enable **Allow access to file URLs** for this extension under `chrome://extensions` → Details. This is a Chrome security requirement.

## Permissions

| Permission | Kind | Purpose |
| --- | --- | --- |
| `storage` | required | Save settings locally |
| `favicon` | required | Show site icons in UI |
| `file:///*` | host | Allow new tab navigation to `file://` URLs (required by Chrome 118+) |
| `bookmarks` | optional | Dashboard bookmarks bar, requested on enable |
| `topSites` | optional | Dashboard top sites, requested on enable |

`management` and `tabs` from v3.x have been removed.

## Privacy

No telemetry, no ads, no analytics, no remote code. Nothing about your browsing is collected or uploaded. Settings live locally, or in your Google account only if you enable Chrome Sync.

## License & credits

MIT License, inherited from the original **New Tab Redirect!** by **James Schubert** (2009–2023). See [LICENSE](LICENSE) and [CHANGELOG.md](CHANGELOG.md). Google and Chrome are trademarks of Google, Inc.
