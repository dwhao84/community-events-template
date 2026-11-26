---
name: community-setup
description: 把「社區活動報名模板」設定成某個社區自己的網站並部署到 Cloudflare：讀取 MY-COMMUNITY.md，填寫 site.config.json 與 wrangler.jsonc，本機預覽，部署 Worker／D1／R2，設定秘密、後台登入（Cloudflare Access）與第一位管理員，最後帶主辦方完成開站檢查。當使用者說「幫我把模板設定成我的社區」「依 MY-COMMUNITY.md 建起來」「部署這個報名網站」「設定後台登入」時使用。
---

# 社區活動報名模板：設定與部署

你是協助社區主辦方（多半不是工程師）把這份模板變成自己網站的助理。用繁體中文、白話說明每一步，並在需要對方操作網頁或做決定時停下來等回覆。

開始前先完整閱讀 `AGENTS.md`（全部規範都適用），再讀 `MY-COMMUNITY.md`。

## 必須遵守

- **秘密不落地**：`RATE_SALT`、`FEEDBACK_TOKEN_SECRET`、`RESEND_API_KEY`、`RESEND_WEBHOOK_SECRET` 只能用 `wrangler secret put` 或 Deploy 按鈕的秘密欄位輸入，不得寫進任何會提交的檔案、不得印在回覆裡。`.dev.vars` 只放本機值，且已在 `.gitignore`。
- **對外動作先確認**：`wrangler deploy`、遠端 migration、建立 GitHub repo、`git push`、刪除任何雲端資源前，先向使用者說明會發生什麼並取得同意。
- **不在正式站做測試報名**：功能測試在本機（`npm run dev`）進行。
- **不改觸發器與 migration 來繞過限制**：新增欄位或規則一律新增編號接續的 migration。
- 使用者沒填、或填得不合理的欄位（例如網址不是 https、身分選項超過 50 字），先問清楚再寫入。

## 步驟

### 1. 檢查環境

- 確認有 Node.js 22.13 以上（`node -v`）與 `sqlite3`（`sqlite3 --version`，跑檢查需要）。沒有的話告訴使用者如何安裝，不要自行用 sudo。
- 執行 `npm install`（或 `npx pnpm@10 install`），然後 `node scripts/check.mjs`，確認起點是綠的。

### 2. 寫入在地內容

依 `MY-COMMUNITY.md` 修改 `site.config.json`，欄位對照：

| MY-COMMUNITY.md | site.config.json |
| --- | --- |
| 社區名稱 | `communityName` |
| 網站中文／英文名稱 | `brand`／`englishBrand` |
| 標誌字 | `brandMark`（一個字） |
| 標語、簡介 | `tagline`、`description` |
| 網站配色 | `theme`：`ocean`、`forest`、`teal`、`sunset`、`sakura`、`lavender`、`brick`、`earth`、`night`、`graphite` 其一（見 `src/themes.js`）；後台存過配色後以後台為準 |
| 對外連結 | `links`：`[{label,note,url}]`，url 必須 https |
| 身分選項 | `identities`：字串陣列，每個最多 50 字 |
| 關於我們 | `about`：`{title,paragraphs:[...],contact}`（只是預設；後台可改） |
| 信件署名、回饋信主辦單位 | `emailSignoff`、`feedbackOrganizer` |

也同步更新 `public/site.webmanifest` 的 `name`、`short_name`。不要把社區名稱寫進 HTML 或 JS（AGENTS.md「模板與在地內容」）。

### 3. 調整部署設定 `wrangler.jsonc`

- `name`：使用者想要的 Worker 名稱（小寫英數與 `-`）。
- `d1_databases[0].database_name`、`r2_buckets[0].bucket_name`：用同一個前綴，例如 `happy-events`、`happy-events-photos`。**不要填 `database_id`**，部署時會自動建立。
- `vars`：`APP_ENV` 保持 `production`。`SITE_URL` 等部署後知道網址再填。要寄信：`MAIL_MODE` 改 `resend`，填 `MAIL_FROM`、`MAIL_REPLY_TO`。要 GA4：填 `GA4_MEASUREMENT_ID`。
- 有自訂網域時加上 `"routes": [{"pattern": "<網域>", "custom_domain": true}]`，並可把 `workers_dev` 改為 `false`。

完成後再跑一次 `node scripts/check.mjs`。

### 4. 本機預覽

```sh
cp .dev.vars.example .dev.vars   # 取消註解 APP_ENV、SITE_URL、LOCAL_ADMIN_TOKEN，並填入本機用的隨機值
npm run db:local
npm run dev                      # http://localhost:8787
```

請使用者打開首頁、`/about.html`、`/admin/`（用 `LOCAL_ADMIN_TOKEN` 登入），確認名稱與文字正確。可用 `TEST_ADMIN_TOKEN=<權杖> node tests/integration.mjs` 做一次完整報名流程（只寫入本機 D1）。

### 5. 部署（擇一，先取得同意）

**A. 用 Deploy to Cloudflare 按鈕**（README 上的按鈕）：Cloudflare 會把程式複製到使用者自己的 GitHub、建立 D1／R2、詢問秘密並部署。之後在使用者自己的 repo 修改並 push，就會自動重新部署。這條路的步驟 2–3 改在那個新 repo 裡完成並 push。

**B. 用命令列**：

```sh
npx wrangler login
npm run deploy                         # wrangler deploy（自動建立 D1、R2）後套用遠端 migration
npx wrangler secret put RATE_SALT      # 值用：node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"
npx wrangler secret put FEEDBACK_TOKEN_SECRET
npx wrangler secret put ADMIN_BOOTSTRAP_EMAIL   # 第一位管理員 Email
```

秘密值由你產生後直接用管線傳給 `wrangler secret put`，不要顯示在回覆中。

部署完成後記下網址（`https://<name>.<子網域>.workers.dev` 或自訂網域），把它填入 `wrangler.jsonc` 的 `SITE_URL` 並再部署一次；信件中的連結、行事曆與課程回饋都需要它。

### 6. 後台登入（Cloudflare Access）— 需要使用者在網頁上操作

一步一步帶使用者做，等對方回報每一步結果：

1. Cloudflare 儀表板 → **Zero Trust**（第一次會要求建立團隊名稱，免費方案即可）。
2. **Access → Applications → Add an application → Self-hosted**。
3. 網域填網站網址，路徑加兩條：`admin` 與 `api/admin`（都保護）。
4. Policy：Action 選 **Allow**，Include → **Emails** → 填管理員 Email。登入方式可用預設的 One-time PIN（寄驗證碼到信箱）。
5. 存檔後，在應用程式的 Overview 複製 **Application Audience (AUD) Tag**；團隊網域在 Settings → Custom Pages，形如 `<團隊>.cloudflareaccess.com`。
6. 把兩個值填入 `wrangler.jsonc` 的 `ACCESS_AUD`、`ACCESS_TEAM_DOMAIN`，部署。

若 Access 無法加在 `workers.dev` 網址上的特定路徑，請建議使用者把網域交給 Cloudflare 管理並改用自訂網域，再回到第 3 步。

7. 請使用者用管理員 Email 開 `/admin/`：因為 `ADMIN_BOOTSTRAP_EMAIL` 相符且還沒有任何管理員，系統會自動授予全部權限。之後可在「營運設定」新增其他管理員。

### 7. Email 通知（選用）

1. 在 Resend 新增並驗證寄件網域（依畫面加 DNS 紀錄）。
2. 建 API Key → `npx wrangler secret put RESEND_API_KEY`。
3. 新增 Webhook：網址 `<SITE_URL>/api/webhooks/resend`，事件勾選 email.* 送達相關事件，把 signing secret 存為 `RESEND_WEBHOOK_SECRET`。
4. `MAIL_MODE` 改 `resend`，填 `MAIL_FROM`、`MAIL_REPLY_TO`，部署。後台「通知中心 → 寄測試信」寄給使用者自己確認。

### 8. 開站前檢查（帶主辦方在後台完成）

1. **營運設定**：寫正式的個資告知（不能含「【草稿」）、換新版本編號、勾選「可允許場次開放報名」。
2. **網站外觀**：選配色（或自訂五個顏色，對比不足無法儲存），上傳網站圖示。
3. **關於我們頁面**：新增或調整區塊、排序、底色與對齊。
4. **活動與場次 → 新增活動**：用精靈建立第一個活動（收費方式、名額、每筆人數上限）。
5. **首頁 Banner**：上傳活動海報（尺寸與製作方式見 `docs/costs-and-images.md`），填替代文字，連到活動。
6. 用手機打開首頁看過一次；確認「加入行事曆」能下載。
7. 檢查安全標頭：`curl -sI <SITE_URL> | grep -i content-security-policy` 應有輸出。

### 9. 回報

用條列告訴使用者：網站網址、後台網址、完成了哪些設定、還沒做的選用項目（Email、GA4、自訂網域），以及之後怎麼改內容（後台）與改程式（改 repo → push 或 `npm run deploy`）。明確區分「已部署並驗證」與「尚未驗證」。
