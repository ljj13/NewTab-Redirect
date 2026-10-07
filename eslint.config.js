import js from "@eslint/js";

const browserGlobals = {
  document: "readonly",
  window: "readonly",
  console: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  requestAnimationFrame: "readonly",
  fetch: "readonly",
  navigator: "readonly",
  location: "readonly",
  URL: "readonly",
};

const nodeGlobals = {
  console: "readonly",
  process: "readonly",
  URL: "readonly",
  structuredClone: "readonly",
};

export default [
  {
    ignores: ["node_modules/**", "dist/**", "*.zip"],
  },
  js.configs.recommended,
  {
    // 扩展页面脚本：浏览器 + Chrome 扩展 API 环境
    files: ["js/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...browserGlobals, chrome: "readonly" },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      eqeqeq: ["error", "smart"],
      "prefer-const": "error",
    },
  },
  {
    // 开发工具链：Node 环境
    files: ["tests/**/*.mjs", "scripts/**/*.mjs", "eslint.config.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: nodeGlobals,
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // 浏览器自动化脚本：evaluate 回调运行在页面上下文，需浏览器全局
    files: ["scripts/dev/**/*.mjs"],
    languageOptions: {
      globals: { ...browserGlobals, chrome: "readonly", WebSocket: "readonly", fetch: "readonly" },
    },
  },
];
