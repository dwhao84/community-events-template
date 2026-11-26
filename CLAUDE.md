# CLAUDE.md

本檔給 Claude Code 使用。所有規範都在 AGENTS.md（Codex、Gemini CLI 讀的是同一份）：

@AGENTS.md

## 要把模板設定成自己的社區

使用 `community-setup` skill（`.claude/skills/community-setup/SKILL.md`），它會讀取 `MY-COMMUNITY.md` 並一步步完成設定與部署。

## 常用指令

本專案沒有建置步驟：`public/` 由 Workers Static Assets 直接提供，`src/` 是 Worker 程式。

- `npm run check`（等同 `node scripts/check.mjs`）：語法檢查、全部單元測試、把 migration 套用到暫存 SQLite 並確認容量與每筆人次上限觸發器。需要 PATH 上有 `sqlite3`。
- 只跑單元測試：`npm test`；單一檔案：`node --test tests/admin-tools.test.mjs`。
- 本機開發：`cp .dev.vars.example .dev.vars`，取消註解本機那三行（`APP_ENV`、`SITE_URL`、`LOCAL_ADMIN_TOKEN`），再執行 `npm run db:local`、`npm run dev`，開啟 <http://localhost:8787>；後台 `/admin/` 用 `LOCAL_ADMIN_TOKEN` 登入。
- 整合測試（`check` 不會執行）：開著 `npm run dev`，執行 `TEST_ADMIN_TOKEN=<權杖> node tests/integration.mjs`。只能對本機執行，會在本機 D1 建立一個測試活動。
- 部署：`npm run deploy`（`wrangler deploy` 後套用遠端 migration）。

## 程式風格

原始碼採精簡寫法（長的單行函式、極少空白）。修改時延續周圍的風格，不要重新排版整個檔案。居民看到的文字使用繁體中文。
