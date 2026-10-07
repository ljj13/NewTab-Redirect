/**
 * 设置存储层（schema v2）。
 *
 * 存储布局：
 * - chrome.storage.local["settings"] —— 工作副本，所有读取以这里为准。
 * - chrome.storage.sync["settings"]  —— 同步镜像；syncEnabled 为 true 时与 local 保持一致。
 *
 * 旧版（v3.1.6 及更早）使用散键（url / syncOptions / always-tab-update / ntr.* 等），
 * 由 migrateSettings() 一次性迁移到 v2 schema：自动、幂等、不丢配置，成功后清理旧键。
 */

export const SETTINGS_VERSION = 2;
export const SETTINGS_KEY = "settings";

/** v3.1.6 及更早版本使用的存储键，迁移完成后清除。 */
export const LEGACY_KEYS = [
  "url",
  "syncOptions",
  "always-tab-update",
  "tab.selected",
  "usingStorageApi",
  "lastInstall",
  "showWelcome",
  "upgrade_3.1",
  "ntr.enable_top",
  "ntr.enable_bookmarks",
  "ntr.bookmark_count",
  "ntr.top_count",
];

export const DEFAULT_SETTINGS = {
  version: SETTINGS_VERSION,
  redirectUrl: "",
  /** "navigate": 页内 location.replace（不新增历史）；"tabupdate": chrome.tabs.update（地址栏可聚焦） */
  redirectMode: "navigate",
  syncEnabled: false,
  dashboard: {
    bookmarks: false,
    topSites: false,
    bookmarkCount: 10,
    topSiteCount: 10,
  },
  appearance: {
    theme: "system", // "system" | "light" | "dark"
  },
  welcome: {
    done: false,
  },
  /** 用户拒绝过权限请求后置位，避免反复弹窗骚扰。 */
  permissionDenied: {
    bookmarks: false,
    topSites: false,
  },
};

const THEMES = ["system", "light", "dark"];

export function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 深合并 patch（对象递归合并，原始值/数组直接替换，undefined 忽略）。 */
export function deepMerge(base, patch) {
  if (!isPlainObject(patch)) return isPlainObject(base) ? base : patch;
  const out = isPlainObject(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    out[key] = isPlainObject(value) && isPlainObject(out[key]) ? deepMerge(out[key], value) : value;
  }
  return out;
}

/** 用默认值补齐缺失/非法字段（向前兼容）。返回全新对象。 */
export function mergeDefaults(settings) {
  const base = deepMerge({}, DEFAULT_SETTINGS);
  if (!isPlainObject(settings)) return base;
  const out = deepMerge(base, settings);
  out.version = SETTINGS_VERSION;
  out.redirectUrl = typeof out.redirectUrl === "string" ? out.redirectUrl : "";
  out.redirectMode = out.redirectMode === "tabupdate" ? "tabupdate" : "navigate";
  out.syncEnabled = out.syncEnabled === true;
  out.dashboard.bookmarks = out.dashboard.bookmarks === true;
  out.dashboard.topSites = out.dashboard.topSites === true;
  out.dashboard.bookmarkCount = clampInt(out.dashboard.bookmarkCount, 5, 40, 10);
  out.dashboard.topSiteCount = clampInt(out.dashboard.topSiteCount, 5, 20, 10);
  out.appearance.theme = THEMES.includes(out.appearance.theme) ? out.appearance.theme : "system";
  out.welcome.done = out.welcome.done === true;
  out.permissionDenied.bookmarks = out.permissionDenied.bookmarks === true;
  out.permissionDenied.topSites = out.permissionDenied.topSites === true;
  return out;
}

/** 纯函数：把旧版散键配置合并为 v2 schema（供迁移与测试使用）。 */
export function migrateLegacySettings({
  legacyLocal = {},
  legacySync = {},
  hasBookmarksPermission = false,
  hasTopSitesPermission = false,
} = {}) {
  const local = isPlainObject(legacyLocal) ? legacyLocal : {};
  const sync = isPlainObject(legacySync) ? legacySync : {};
  const legacyPresent = LEGACY_KEYS.some((k) => local[k] !== undefined || sync[k] !== undefined);

  if (!legacyPresent) {
    // 全新安装：v2 默认值，Welcome 待展示
    return { settings: mergeDefaults({}), legacyPresent: false };
  }

  // 旧语义：syncOptions 开启时 sync 区是权威数据；否则 local 是权威数据。
  // （修复原代码 undefined 视为 true 的问题：仅 === true 视为开启。）
  const syncOpted = local.syncOptions === true;
  const pick = (key) => {
    const primary = syncOpted ? sync[key] : local[key];
    const secondary = syncOpted ? local[key] : sync[key];
    return primary !== undefined ? primary : secondary;
  };

  const url = pick("url");
  const alwaysTabUpdate = pick("always-tab-update");
  const bookmarksFlag = pick("ntr.enable_bookmarks");
  const topFlag = pick("ntr.enable_top");

  const settings = mergeDefaults({
    redirectUrl: typeof url === "string" ? url : "",
    redirectMode: alwaysTabUpdate === true ? "tabupdate" : "navigate",
    syncEnabled: syncOpted,
    dashboard: {
      // 旧版未显式设置时按当前实际权限决定，避免迁移后凭空出现权限提示
      bookmarks: typeof bookmarksFlag === "boolean" ? bookmarksFlag : hasBookmarksPermission === true,
      topSites: typeof topFlag === "boolean" ? topFlag : hasTopSitesPermission === true,
      bookmarkCount: clampInt(pick("ntr.bookmark_count") ?? 10, 5, 40, 10),
      topSiteCount: clampInt(pick("ntr.top_count") ?? 10, 5, 20, 10),
    },
    // 存在旧键 = 老用户，不再重复展示 Welcome（旧版仅全新安装展示）
    welcome: { done: true },
    permissionDenied: { bookmarks: false, topSites: false },
  });

  return { settings, legacyPresent: true };
}

function storageAreas() {
  const storage = globalThis.chrome?.storage;
  if (!storage?.local || !storage?.sync) {
    throw new Error("chrome.storage is unavailable");
  }
  return storage;
}

async function hasPermission(name) {
  try {
    return (await globalThis.chrome.permissions.contains({ permissions: [name] })) === true;
  } catch {
    return false;
  }
}

/** 读取当前生效设置（local 工作副本）；未初始化时触发迁移。 */
export async function getSettings() {
  const storage = storageAreas();
  const stored = (await storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];
  if (isPlainObject(stored)) return mergeDefaults(stored);
  return migrateSettings();
}

/** 深合并保存设置；syncEnabled 时同步写入 sync 区。返回合并后的完整设置。 */
export async function saveSettings(patch = {}) {
  const storage = storageAreas();
  const current = await getSettings();
  const next = mergeDefaults(deepMerge(current, patch));
  await storage.local.set({ [SETTINGS_KEY]: next });
  if (next.syncEnabled) {
    try {
      await storage.sync.set({ [SETTINGS_KEY]: next });
    } catch (e) {
      // sync 不可用（未登录等）不阻塞本地保存
      console.warn("[NTR4] sync save failed:", e);
    }
  }
  return next;
}

/** 重置为默认设置；不重新触发 Welcome，并尽力清除 sync 区副本。 */
export async function resetSettings() {
  const storage = storageAreas();
  const fresh = mergeDefaults({ welcome: { done: true } });
  await storage.local.set({ [SETTINGS_KEY]: fresh });
  try {
    await storage.sync.remove(SETTINGS_KEY);
  } catch {
    /* sync 不可用时忽略 */
  }
  return fresh;
}

/** 直接读取 sync 区的设置副本（供“从 Chrome Sync 恢复”使用）。 */
export async function getSyncedSettings() {
  const storage = storageAreas();
  const stored = (await storage.sync.get(SETTINGS_KEY))[SETTINGS_KEY];
  return isPlainObject(stored) ? mergeDefaults(stored) : null;
}

/**
 * 迁移旧版散键到 v2 schema。幂等：已存在 v2 数据时直接返回（仅补齐缺失字段）。
 * @param {{cleanup?: boolean, permissions?: {hasBookmarks?: boolean, hasTopSites?: boolean}}} [options]
 *   cleanup: 迁移成功后移除旧键（v4 页面就位后应保持 true）。
 */
export async function migrateSettings({ cleanup = true, permissions = {} } = {}) {
  const storage = storageAreas();
  const localAll = await storage.local.get(null);
  const stored = localAll[SETTINGS_KEY];

  if (isPlainObject(stored) && Number(stored.version) >= SETTINGS_VERSION) {
    const merged = mergeDefaults(stored);
    if (JSON.stringify(merged) !== JSON.stringify(stored)) {
      await storage.local.set({ [SETTINGS_KEY]: merged });
    }
    return merged;
  }

  let syncAll = {};
  try {
    syncAll = await storage.sync.get(null);
  } catch {
    /* sync 不可用时按空处理 */
  }

  const hasBookmarks =
    permissions.hasBookmarks !== undefined ? permissions.hasBookmarks === true : await hasPermission("bookmarks");
  const hasTopSites =
    permissions.hasTopSites !== undefined ? permissions.hasTopSites === true : await hasPermission("topSites");

  const { settings } = migrateLegacySettings({
    legacyLocal: localAll,
    legacySync: syncAll,
    hasBookmarksPermission: hasBookmarks,
    hasTopSitesPermission: hasTopSites,
  });

  await storage.local.set({ [SETTINGS_KEY]: settings });
  if (settings.syncEnabled) {
    try {
      await storage.sync.set({ [SETTINGS_KEY]: settings });
    } catch {
      /* sync 不可用时忽略 */
    }
  }

  if (cleanup) {
    const legacyLocal = LEGACY_KEYS.filter((k) => localAll[k] !== undefined);
    if (legacyLocal.length > 0) await storage.local.remove(legacyLocal);
    const legacySync = LEGACY_KEYS.filter((k) => syncAll[k] !== undefined);
    if (legacySync.length > 0) {
      try {
        await storage.sync.remove(legacySync);
      } catch {
        /* ignore */
      }
    }
  }

  return settings;
}
