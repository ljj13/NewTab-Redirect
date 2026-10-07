# 原版基线记录（upstream v3.1.6）

本文件封存 `jimschubert/NewTab-Redirect` v3.1.6（commit `422858b`）的行为基线，
供 v4 重构回归对照。基线 tag：`upstream-3.1.6`（不改写、不移动）。

## 仓库关系

- 本仓库 `ljj13/NewTab-Redirect` 的 `master` 分支 HEAD 即 `422858b`，
  与上游 `jimschubert/NewTab-Redirect` 的 v3.1.6 发布状态一致（MV3 迁移完成后）。
- 关键上游历史：
  - `0efa8d0` migrate to manifest v3
  - `e52db8d` (#220) Chrome 118 修复：新增 `host_permissions`（file:// 相关）——
    Chrome 118 起新标签页导航到 `file://` 需要主机权限，**该修复不可删除**
  - `f22217d` 将无效 pattern `:///*` 改为 `*://*`
  - `13b19fd` 允许 `data:` URI 作为新标签页地址

## 基线 manifest（v3.1.6）

- `manifest_version: 3`，`version: "3.1.6"`，`minimum_chrome_version: "89"`
- `permissions: ["storage", "favicon"]`
- `host_permissions: ["file:///", "file://", "*://*"]`
- `optional_permissions: ["tabs", "topSites", "management", "bookmarks"]`
- `background.service_worker: js/background.js`
- `options_page: options.html`
- `chrome_url_overrides.newtab: main.html`
- `incognito: "split"`

## 基线行为

### Redirect（js/redirect.js）

1. 读取 `chrome.storage.local` 的 `url`、`tab.selected`、`always-tab-update`（**只读 local**）。
2. `url` 非空时：
   - 不以 `about:`、`data:` 开头且不含 `://` → 补 `http://` 前缀（v4 改为 `https://`）。
   - 若为 `http(s)` 且 `always-tab-update !== true` → `document.location.href = url`（留历史记录）。
   - 否则（chrome://、file://、data:、about: 或 tab update 模式）→
     `chrome.tabs.getCurrent` + `chrome.tabs.update(tabId, {url, highlighted})`。
3. `url` 为空 → `angular.resumeBootstrap()` 渲染默认 Apps Dashboard。
4. 任何异常 → fallback 到 Apps Dashboard。

### Options（options.html + options_controller.js）

- 四个老式 Tab：URL / Permissions / Contact / Donate。
- `Save` 将 `{url, always-tab-update}` 写入 local（sync 关）或 sync（sync 开）。
- `syncOptions` 开关本身永远写在 **local**（`changeSync`）。
- `always-tab-update` 开关本身永远写在 **local**（`changeRedirect`）——注意
  Save 又会把它写进 sync/local，行为不一致。
- `getSyncedUrl` 按钮从 sync 拉取 `url` 并保存。
- 快速保存列表：popularPages（Facebook/Twitter 等）+ internalPages（chrome:// 页面）。

### 默认 New Tab（main.html，未配置 URL 时）

- Apps 页面（需 optional `management` 权限）：列出/过滤/启动/卸载 Chrome Apps。
- 书签栏行（optional `bookmarks`，5–40 个，仅书签栏 id=1 的直接子项、且含 url 的项）。
- Top Sites 条（optional `topSites`，5–20 个）。
- `tabs` optional 权限用于“在新窗口打开 App”。
- 隐藏功能：`chrome.storage.local.set({'tab.selected': false})` 可让 tabs.update 不高亮。

### Welcome（welcome.html）

- 四页滑动教程（Welcome/Intro/Contact/FAQ）+ 左右巨型箭头 + 截图 hover 预览。
- 展示时机（background.js onInstalled）：install 或 update 时，若
  `showWelcome !== false` 且距上次安装 >6 个月且 >500s buffer，`install` 时打开。
  `chrome_update` 不展示。

### 存储键（迁移前，必须兼容）

| 键 | 区域 | 类型 | 含义 |
| --- | --- | --- | --- |
| `url` | local 或 sync | string | 重定向 URL（空串/未设 = Apps Dashboard） |
| `syncOptions` | local | boolean | 是否把 url 同步到 Chrome Sync |
| `always-tab-update` | local 或 sync | boolean | 用 tabs.update 而非 location 导航 |
| `tab.selected` | local | boolean/undefined | tabs.update 时是否保持高亮（隐藏功能） |
| `usingStorageApi` | local | boolean | 历史遗留，仅初始化写入 |
| `lastInstall` | local + sync | number | 上次安装时间戳（welcome 6 个月逻辑） |
| `showWelcome` | local | boolean | 是否还展示 Welcome |
| `upgrade_3.1` | local | boolean | v3.1 升级提示已展示 |
| `ntr.enable_bookmarks` | sync | boolean | Dashboard 书签栏开关（未设默认 true） |
| `ntr.enable_top` | sync | boolean | Dashboard Top Sites 开关（未设默认 true） |
| `ntr.bookmark_count` | sync | number | 书签数量（5–40，默认 10） |
| `ntr.top_count` | sync | number | Top Sites 数量（5–20，默认 10） |

### 基线发现的 bug（v4 修复）

1. `background.js:27`：`JSON.parse(arr)` —— `chrome.storage.local.get('syncOptions')`
   返回的是对象 `{syncOptions: ...}`，直接 `JSON.parse(对象)` 必然抛 TypeError。
   触发条件：已存在 `syncOptions` 键时再次执行 `saveInitial()`（如停用后重新启用）。
2. `background.js:126`：`items.syncOptions == "false"` —— `syncOptions` 存的是
   boolean，`false == "false"` 为 `false`，该分支永假；导致 sync 关闭时 sync→local
   的镜像仍然发生。
3. `redirect.js` 只读 local 的 `url`/`always-tab-update`，若镜像逻辑失效
   （受 bug 2 影响的边界），sync 用户的新标签页可能读到旧值。
4. `document.location.href` 导航会多留一条历史记录。
5. `options_controller.js:17`：`result.syncOptions || result.syncOptions !== false`
   —— 未设（undefined）时为 true（sync 视为开），与 background 的默认（false）相反。
6. `getSyncedUrl` 中 `result !== ""` 对对象恒真，逻辑无效但无害。
7. manifest `icons` 使用 `"200"` 非标准尺寸；`host_permissions` 中 `file:///`、
   `file://`、`*://*` 均非规范写法（规范为 `file:///*`）。

## v4 迁移承诺

- 老键全部迁移到新 schema（`version: 2`），自动、幂等、不丢配置。
- 未显式设置过的 `ntr.enable_*` 按当前实际权限决定新默认（有权限 = 开）。
- 迁移成功后清理老键；版本守卫保证不会二次迁移破坏数据。
