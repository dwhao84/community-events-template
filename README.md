# 社區活動報名模板

給社區、青創戶與社宅團隊使用的活動報名網站。住戶在手機上就能看活動、報名、加入行事曆；主辦方在後台建活動、管名單、現場報到、看統計。網站架在 Cloudflare 上，一般社區的用量通常落在免費額度內。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/dwhao84/community-events-template)

## 可以做什麼

**住戶端**

- 活動列表：日期、時間、地點、剩餘名額，以及「免費／收費／待定」標示。
- 線上報名：可一次替家人報名；報名表會依人數算出應繳金額（本網站不收款，繳費方式由主辦方說明）。
- 加入行事曆：iPhone／Outlook（.ics）或 Google 日曆，在活動卡片、報名成功頁和通知信都有。
- 首頁輪播 Banner、「關於我們」頁、防詐知識頁。

**主辦方後台**

- 新增活動精靈：一次填好活動、第一個場次、收費與報名表，按一下就開放報名。
- 活動可以複製、隱藏（暫時不公開，已報名的人不受影響）、刪除（可復原）。
- 報名名單：確認、候補、取消；可手動新增電話或紙本報名的人，也可永久刪除已取消的報名資料。
- 名額依「參加人數」計算，可設定每筆最多幾人，額滿自動候補；資料庫層會再檢查一次，不會超收。
- 現場報到、手寫簽名、可列印的簽到單。
- 活動統計：報名、確認、候補與實際出席人次，可依年份篩選並匯出 CSV。
- 網站外觀：10 組預設配色（海洋藍、森林綠、湖水青、暖陽橘、櫻花粉、薰衣草紫、磚紅、大地棕、夜空藍、沉穩灰），也可以自訂五個顏色，有即時預覽與文字對比檢查；可上傳網站圖示（瀏覽器分頁與手機主畫面）。
- 首頁 Banner 管理：上傳、排序、上架／下架、設定期間、刪除。
- 「關於我們」頁編輯器：主標題、文字、卡片（2／3／4 欄）、圖文並排、連結、聯絡資訊等區塊，可自由排序並調整底色與對齊。
- Email 通知（選用）：收件、確認、行前提醒、取消；課程回饋問卷。
- 權限分模組：活動、報名、報到、照片、通知、匯出、回饋、管理員。

## 開始使用

需要準備：
- **Cloudflare 帳號**（免費）。第一次啟用 R2 圖片儲存時，Cloudflare 可能要求綁定付款方式，免費額度內不會收費。
- **GitHub 帳號**。
- 選用：Resend 帳號與一個網域，用來寄 Email 通知。

### 方法一：交給 AI 助理（建議）

用 Claude Code、Codex 或 Gemini CLI 開啟這個資料夾：

1. 填好 [`MY-COMMUNITY.md`](MY-COMMUNITY.md)（社區名稱、管理員 Email、身分選項……）。
2. 對 AI 說：

   > 請依 community-setup skill，讀取 MY-COMMUNITY.md，幫我把這個模板設定好並部署。

AI 會依 [`.agents/skills/community-setup/SKILL.md`](.agents/skills/community-setup/SKILL.md) 的步驟操作：填設定、在你的電腦上預覽、部署、設定後台登入，最後帶你完成開站檢查。每次要部署或建立雲端資源之前，AI 都會先問你。

- Claude Code 讀 `CLAUDE.md`，Codex 讀 `AGENTS.md`，Gemini CLI 讀 `GEMINI.md`，三者內容相同。
- skill 同時放在 `.claude/skills/` 與 `.agents/skills/`。

### 方法二：Deploy to Cloudflare 按鈕

1. 按上方按鈕，依畫面登入 Cloudflare 與 GitHub。Cloudflare 會：
   - 把程式複製到你的 GitHub；
   - 建立資料庫（D1）與圖片儲存（R2）；
   - 請你填入秘密值，並完成部署。
2. 秘密欄位：
   - `RATE_SALT`、`FEEDBACK_TOKEN_SECRET`：各填一串 32 字以上的隨機文字。
   - `ADMIN_BOOTSTRAP_EMAIL`：第一位管理員的 Email。
   - `RESEND_*`：沒有要寄信可以留空。
3. 部署完成後，在你自己的 repo：
   - 修改 `site.config.json`，換成你的社區名稱、標語、連結與身分選項；
   - 在 `wrangler.jsonc` 填入 `SITE_URL`（剛拿到的網址）。

   push 後會自動重新部署。
4. 繼續下面的「設定後台登入」。

### 設定後台登入（兩種方法都需要）

後台用 Cloudflare Access 保護。只有你指定的 Email 能進入，登入時會寄驗證碼到信箱。

1. Cloudflare 儀表板 → Zero Trust → Access → Applications → Add an application → Self-hosted。
2. 網域填你的網站網址，保護兩個路徑：`admin` 和 `api/admin`。
3. Policy 選 Allow，Include → Emails，填管理員 Email。
4. 複製兩個值，填入 `wrangler.jsonc` 後重新部署：
   - Application Audience (AUD) Tag → `ACCESS_AUD`
   - 團隊網域 `<團隊>.cloudflareaccess.com` → `ACCESS_TEAM_DOMAIN`
5. 用 `ADMIN_BOOTSTRAP_EMAIL` 那個信箱開啟 `/admin/`，第一次登入會自動成為管理員。

若 `workers.dev` 網址無法設定路徑型 Access，請改用交給 Cloudflare 管理的自訂網域。

### 開站前，在後台完成

1. **營運設定**：寫正式的個資告知，換新版本號，勾選「可允許場次開放報名」。
2. **關於我們頁面**：介紹你的社區。
3. **網站外觀**：選配色、上傳網站圖示。
4. **活動與場次 → ＋ 新增活動**：建立第一個活動。
5. **首頁 Banner**：上傳活動海報，並連到活動。

## 之後怎麼改

| 想改的東西 | 在哪裡改 |
| --- | --- |
| 活動、場次、報名表、名單 | 後台 |
| 網站配色、網站圖示 | 後台「網站外觀」 |
| 首頁 Banner、「關於我們」、個資告知、通知信範本 | 後台 |
| 網站名稱、標語、社區連結、參加者身分選項、信件署名 | `site.config.json`（改完要部署） |
| Email、GA4、網址、後台登入 | `wrangler.jsonc` 的 `vars` 與 Cloudflare 秘密 |
| 吉祥物 | `public/assets/` |

## 給開發者

- 沒有建置步驟：`public/` 是靜態檔，`src/worker.js` 是單一 Worker；資料在 D1，圖片在 R2。
- 本機開發：
  1. `cp .dev.vars.example .dev.vars`，取消註解本機設定；
  2. `npm run db:local`；
  3. `npm run dev`。
- 檢查：`npm run check`（語法、單元測試、migration 與觸發器）。
- 整合測試：開著 `npm run dev`，執行 `TEST_ADMIN_TOKEN=<權杖> node tests/integration.mjs`。
- 部署：`npm run deploy`（`wrangler deploy` 後套用遠端 migration）。
- 規範、架構與驗收清單見 [`AGENTS.md`](AGENTS.md)；GA4 見 [`docs/analytics.md`](docs/analytics.md)。
- 資料庫異動請新增編號接續的 migration，不要改舊檔。容量、狀態與每筆人數上限由 D1 觸發器強制執行。

## 限制

- 時區固定為台灣（Asia/Taipei）。
- 不做線上金流；收費只顯示金額與說明。
- 後台登入需要手動設定 Cloudflare Access 一次。

本模板改寫自一個實際運作中的社區活動報名網站。
