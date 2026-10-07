/**
 * storage.js 的 Node 单元测试。
 * 通过注入 fake chrome.storage / chrome.permissions 验证：
 * 全新安装初始化、旧版散键迁移（local/sync 两种权威区）、幂等性、
 * 深合并保存、计数钳制、重置、sync 恢复读取。
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SETTINGS,
  LEGACY_KEYS,
  SETTINGS_KEY,
  clampInt,
  deepMerge,
  getSettings,
  getSyncedSettings,
  mergeDefaults,
  migrateLegacySettings,
  migrateSettings,
  resetSettings,
  saveSettings,
} from "../js/lib/storage.js";

function fakeChrome({ local = {}, sync = {}, perms = {} } = {}) {
  const localData = structuredClone(local);
  const syncData = structuredClone(sync);
  const pick = (data, keys) => {
    if (keys === null || keys === undefined) return structuredClone(data);
    const out = {};
    for (const k of [].concat(keys)) if (k in data) out[k] = structuredClone(data[k]);
    return out;
  };
  const makeArea = (data) => ({
    get: async (keys) => pick(data, keys),
    set: async (obj) => void Object.assign(data, structuredClone(obj)),
    remove: async (keys) => void [].concat(keys).forEach((k) => delete data[k]),
  });
  const api = {
    storage: { local: makeArea(localData), sync: makeArea(syncData) },
    permissions: {
      contains: async ({ permissions }) => permissions.every((p) => perms[p] === true),
    },
  };
  api._local = localData;
  api._sync = syncData;
  return api;
}

function withChrome(api, fn) {
  return async (t) => {
    const prev = globalThis.chrome;
    globalThis.chrome = api;
    try {
      await fn(t);
    } finally {
      if (prev === undefined) delete globalThis.chrome;
      else globalThis.chrome = prev;
    }
  };
}

test("clampInt 钳制范围并处理非法输入", () => {
  assert.equal(clampInt(0, 5, 40, 10), 5);
  assert.equal(clampInt(999, 5, 40, 10), 40);
  assert.equal(clampInt("abc", 5, 40, 10), 10);
  assert.equal(clampInt(12.4, 5, 40, 10), 12);
  assert.equal(clampInt(undefined, 5, 20, 10), 10);
});

test("mergeDefaults 补齐缺失字段并修正非法值", () => {
  const merged = mergeDefaults({ redirectUrl: "https://x", dashboard: { topSites: true } });
  assert.equal(merged.version, 2);
  assert.equal(merged.dashboard.topSites, true);
  assert.equal(merged.dashboard.bookmarks, false);
  assert.equal(merged.dashboard.bookmarkCount, 10);
  assert.equal(merged.appearance.theme, "system");
  assert.equal(merged.welcome.done, false);
  const bad = mergeDefaults({ redirectMode: "bogus", appearance: { theme: "solarized" }, syncEnabled: "yes" });
  assert.equal(bad.redirectMode, "navigate");
  assert.equal(bad.appearance.theme, "system");
  assert.equal(bad.syncEnabled, false);
});

test("deepMerge 递归合并对象且忽略 undefined", () => {
  const base = { a: 1, dashboard: { bookmarks: false, count: 10 } };
  const out = deepMerge(base, { dashboard: { bookmarks: true }, a: undefined });
  assert.deepEqual(out, { a: 1, dashboard: { bookmarks: true, count: 10 } });
  assert.deepEqual(base.dashboard, { bookmarks: false, count: 10 }, "base 不被修改");
});

test("migrateLegacySettings: 全新安装返回默认值且 welcome 未完成", () => {
  const { settings, legacyPresent } = migrateLegacySettings({});
  assert.equal(legacyPresent, false);
  assert.deepEqual(settings, mergeDefaults(DEFAULT_SETTINGS));
  assert.equal(settings.welcome.done, false);
  assert.equal(settings.redirectUrl, "");
});

test("migrateLegacySettings: 旧键全量迁移（sync 关闭，local 为权威）", () => {
  const { settings, legacyPresent } = migrateLegacySettings({
    legacyLocal: {
      url: "example.com",
      syncOptions: false,
      "always-tab-update": true,
      showWelcome: true,
      usingStorageApi: true,
      lastInstall: 1600000000000,
      "ntr.enable_bookmarks": true,
      "ntr.enable_top": false,
      "ntr.bookmark_count": 20,
      "ntr.top_count": 7,
    },
    legacySync: { url: "https://sync.example/", "ntr.top_count": 12 },
  });
  assert.equal(legacyPresent, true);
  assert.equal(settings.redirectUrl, "example.com", "sync 关闭时以 local 的 url 为准");
  assert.equal(settings.redirectMode, "tabupdate");
  assert.equal(settings.syncEnabled, false);
  assert.equal(settings.dashboard.bookmarks, true);
  assert.equal(settings.dashboard.topSites, false);
  assert.equal(settings.dashboard.bookmarkCount, 20);
  assert.equal(settings.dashboard.topSiteCount, 7);
  assert.equal(settings.welcome.done, true, "老用户不再弹 Welcome");
  assert.equal(settings.appearance.theme, "system");
});

test("migrateLegacySettings: syncOptions 开启时 sync 区为权威", () => {
  const { settings } = migrateLegacySettings({
    legacyLocal: { url: "https://local.example/", syncOptions: true, "always-tab-update": false },
    legacySync: { url: "https://sync.example/", "ntr.enable_top": true, "ntr.top_count": 15 },
  });
  assert.equal(settings.redirectUrl, "https://sync.example/");
  assert.equal(settings.redirectMode, "navigate");
  assert.equal(settings.syncEnabled, true);
  assert.equal(settings.dashboard.topSites, true);
  assert.equal(settings.dashboard.topSiteCount, 15);
});

test("migrateLegacySettings: 未设置的 ntr.* 按当前权限决定", () => {
  const withPerm = migrateLegacySettings({
    legacyLocal: { url: "" },
    hasBookmarksPermission: true,
    hasTopSitesPermission: false,
  });
  assert.equal(withPerm.settings.dashboard.bookmarks, true);
  assert.equal(withPerm.settings.dashboard.topSites, false);

  const noPerm = migrateLegacySettings({
    legacyLocal: { url: "" },
    hasBookmarksPermission: false,
    hasTopSitesPermission: false,
  });
  assert.equal(noPerm.settings.dashboard.bookmarks, false);
  assert.equal(noPerm.settings.dashboard.topSites, false);
});

test("migrateLegacySettings: 计数越界被钳制", () => {
  const { settings } = migrateLegacySettings({
    legacyLocal: { url: "x.com", "ntr.bookmark_count": 999, "ntr.top_count": 0 },
  });
  assert.equal(settings.dashboard.bookmarkCount, 40);
  assert.equal(settings.dashboard.topSiteCount, 5);
});

test("migrateSettings: 全新安装初始化默认设置并写入 local", async (t) => {
  const api = fakeChrome({});
  await withChrome(api, async () => {
    const settings = await migrateSettings();
    assert.equal(settings.welcome.done, false);
    assert.equal(api._local[SETTINGS_KEY].version, 2);
  })(t);
});

test("migrateSettings: 旧配置迁移 + 旧键清理", async (t) => {
  const api = fakeChrome({
    local: { url: "example.com", syncOptions: true, "always-tab-update": true, "ntr.enable_top": true },
    sync: { url: "https://sync.example/", "ntr.bookmark_count": 8, showWelcome: false },
  });
  await withChrome(api, async () => {
    const settings = await migrateSettings();
    assert.equal(settings.redirectUrl, "https://sync.example/");
    assert.equal(settings.syncEnabled, true);
    assert.equal(settings.redirectMode, "tabupdate");
    // sync 区也写入 v2 副本
    assert.equal(api._sync[SETTINGS_KEY].redirectUrl, "https://sync.example/");
    // 旧键清理
    for (const key of LEGACY_KEYS) {
      assert.equal(api._local[key], undefined, `local.${key} 应被清理`);
      assert.equal(api._sync[key], undefined, `sync.${key} 应被清理`);
    }
  })(t);
});

test("migrateSettings: cleanup=false 时保留旧键（过渡态）", async (t) => {
  const api = fakeChrome({ local: { url: "example.com", "ntr.enable_top": true } });
  await withChrome(api, async () => {
    await migrateSettings({ cleanup: false });
    assert.equal(api._local.url, "example.com");
    assert.equal(api._local["ntr.enable_top"], true);
    assert.equal(api._local[SETTINGS_KEY].redirectUrl, "example.com");
  })(t);
});

test("migrateSettings: 幂等——二次迁移不覆盖用户已修改的数据", async (t) => {
  const api = fakeChrome({ local: { url: "old.example" } });
  await withChrome(api, async () => {
    await migrateSettings();
    // 用户随后修改了设置
    api._local[SETTINGS_KEY].redirectUrl = "https://user-edited.example/";
    const second = await migrateSettings();
    assert.equal(second.redirectUrl, "https://user-edited.example/");
  })(t);
});

test("migrateSettings: 无 permissions API 时不影响迁移", async (t) => {
  const api = fakeChrome({ local: { url: "example.com" } });
  delete api.permissions;
  await withChrome(api, async () => {
    const settings = await migrateSettings();
    assert.equal(settings.dashboard.bookmarks, false);
  })(t);
});

test("getSettings: 已初始化时直接返回 local 副本", async (t) => {
  const api = fakeChrome({});
  await withChrome(api, async () => {
    await saveSettings({ redirectUrl: "https://a.example/" });
    const s = await getSettings();
    assert.equal(s.redirectUrl, "https://a.example/");
    assert.equal(s.dashboard.topSiteCount, 10);
  })(t);
});

test("saveSettings: 深合并 patch 且 syncEnabled 时写入 sync", async (t) => {
  const api = fakeChrome({});
  await withChrome(api, async () => {
    await saveSettings({ dashboard: { topSites: true, topSiteCount: 12 } });
    let s = await getSettings();
    assert.equal(s.dashboard.topSites, true);
    assert.equal(s.dashboard.bookmarkCount, 10, "未涉及的子字段保留");
    assert.equal(api._sync[SETTINGS_KEY], undefined, "sync 关闭时不写 sync");

    await saveSettings({ syncEnabled: true });
    s = await getSettings();
    assert.equal(s.syncEnabled, true);
    assert.equal(api._sync[SETTINGS_KEY].dashboard.topSiteCount, 12);
  })(t);
});

test("resetSettings: 恢复默认、不弹 Welcome、清除 sync 副本", async (t) => {
  const api = fakeChrome({});
  await withChrome(api, async () => {
    await saveSettings({ redirectUrl: "https://x.example/", syncEnabled: true, welcome: { done: true } });
    assert.ok(api._sync[SETTINGS_KEY]);
    const fresh = await resetSettings();
    assert.equal(fresh.redirectUrl, "");
    assert.equal(fresh.welcome.done, true);
    assert.equal(fresh.dashboard.topSites, false);
    assert.equal(api._sync[SETTINGS_KEY], undefined);
  })(t);
});

test("getSyncedSettings: 读取 sync 区副本，缺失时返回 null", async (t) => {
  const api = fakeChrome({});
  await withChrome(api, async () => {
    assert.equal(await getSyncedSettings(), null);
    api._sync[SETTINGS_KEY] = { redirectUrl: "https://remote.example/" };
    const remote = await getSyncedSettings();
    assert.equal(remote.redirectUrl, "https://remote.example/");
    assert.equal(remote.dashboard.bookmarkCount, 10, "远端副本也补齐默认值");
  })(t);
});

test("未经 chrome 环境调用 getSettings 会抛出明确错误", async () => {
  const prev = globalThis.chrome;
  delete globalThis.chrome;
  try {
    await assert.rejects(() => getSettings(), /chrome\.storage is unavailable/);
  } finally {
    if (prev !== undefined) globalThis.chrome = prev;
  }
});
