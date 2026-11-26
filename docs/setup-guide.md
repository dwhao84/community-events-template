# 逐步建置指南：從取得程式到網站上線

這份指南寫給**主辦方**和 **AI 助理**，兩者都可以照著做。從零開始，一步一步把社區活動報名網站架起來並上線。

- 每一步都標明**誰做**、**要執行的指令**和**做完應該看到什麼**。
- 需要在網頁上操作的步驟（Cloudflare、Google、Resend 等），詳細說明在 [`manual-handoffs.md`](manual-handoffs.md)，以編號對照（例如「見 C1」）。
- 不熟指令的主辦方，可以把整件事交給 AI：在專案資料夾開啟 Claude Code、Codex 或 Gemini CLI，說「請依 docs/setup-guide.md 幫我把網站架起來」。AI 會在需要你的地方停下來。

## 標記說明

| 標記 | 意思 |
| --- | --- |
| 【人】 | 只能由主辦方做（登入帳號、收驗證碼、在網頁上操作、做決定） |
| 【AI】 | AI 助理可以代勞；主辦方也可以自己執行 |
| 【需同意】 | 會影響正式網站或雲端帳號。AI 必須先說明並取得主辦方同意才能執行 |
| 【秘密】 | 輸入的值是秘密。不能貼到對話裡、不能寫進檔案 |

指令都在**專案資料夾**內執行。`<尖括號>` 內的文字要換成你自己的值。

## 總覽

| 步驟 | 內容 | 誰做 | 大約時間 |
| --- | --- | --- | --- |
| 1 | 取得程式 | 人或 AI | 5 分鐘 |
| 2 | 安裝工具 | 人 | 5–10 分鐘 |
| 3 | 安裝套件並檢查 | AI | 2 分鐘 |
| 4 | 填入社區內容 | 人決定，AI 寫入 | 20–40 分鐘 |
| 5 | 在自己電腦上預覽 | AI，人確認畫面 | 10 分鐘 |
| 6 | 登入 Cloudflare | 人 | 5 分鐘 |
| 7 | 調整部署設定 | AI | 5 分鐘 |
| 8 | 第一次部署 | AI【需同意】 | 5 分鐘 |
| 9 | 設定秘密 | AI【需同意】 | 3 分鐘 |
| 10 | 填入正式網址並重新部署 | AI【需同意】 | 3 分鐘 |
| 11 | 設定後台登入（Access） | 人，AI 接手 | 15 分鐘 |
| 12 | 第一次登入後台 | 人 | 3 分鐘 |
| 13 | 報名防護（Turnstile） | 人，AI 接手 | 10 分鐘 |
| 14 | Email 通知（選用） | 人，AI 接手 | 20 分鐘以上 |
| 15 | 網站分析（選用） | 人，AI 接手 | 30 分鐘 |
| 16 | 後台開站設定 | 人 | 30–60 分鐘 |
| 17 | 上線檢查 | AI 與人 | 15 分鐘 |

### 整體要花多久

以下由上表各步驟的時間加總而成，是粗估值。

| 範圍 | 包含步驟 | 大約時間 |
| --- | --- | --- |
| 必要流程 | 1–13、16、17 | 約 2 小時 15 分～3 小時 10 分 |
| 加上 Email 通知 | 14 | 再加 20 分鐘以上 |
| 加上網站分析 | 15 | 再加 30 分鐘 |
| 全部做完 | 1–17 | 約 3～4 小時 |

- **最花時間的是內容，不是技術設定。** 步驟 4（填社區內容）和步驟 16（個資告知、圖片、第一個活動）合計 50–100 分鐘。部署、秘密、登入保護等技術步驟交給 AI 的話，合計約 1 小時，大多是人在 Cloudflare 網頁上點選的時間。
- **事先準備好可以更快。** `MY-COMMUNITY.md` 已填好、圖片與個資告知文字已備妥、電腦已有 Node.js 時，大約 1 個半小時就能上線。準備清單見 [`manual-handoffs.md`](manual-handoffs.md#開始前請準備)。
- **另外有等待時間，不必一直守著。** 自訂網域把 nameserver 改到 Cloudflare，以及 Resend 寄件網域的 DNS 驗證，各需要幾分鐘到幾小時。要用自訂網域或寄 Email 的話，建議分兩次完成：第一次先用免費的 `workers.dev` 網址把網站架起來，等 DNS 生效後再接上網域與 Email。

---

## 步驟 1：取得程式

**誰做**：人或 AI

擇一：

- **用 GitHub 範本建立自己的 repo**：在 GitHub 上把這個專案複製成自己的 repo，再下載到電腦：

  ```sh
  git clone <你的 repo 網址>
  cd <資料夾名稱>
  ```

- **用 Deploy to Cloudflare 按鈕**：按 README 上的按鈕，由 Cloudflare 幫你建立 repo、資料庫與圖片空間並部署。這條路的步驟 6–9 改在網頁上完成；之後在新 repo 裡修改並 push，網站就會自動更新。細節見 [`manual-handoffs.md` A4](manual-handoffs.md#a4-github看部署方式)。

**做完應該看到**：資料夾裡有 `README.md`、`MY-COMMUNITY.md`、`src/`、`public/`。

## 步驟 2：安裝工具

**誰做**：【人】（可能需要輸入電腦密碼）

需要 **Node.js 22.13 以上**和 **sqlite3**。先檢查電腦裡有沒有：

```sh
node -v
sqlite3 --version
```

缺少時安裝：

```sh
# macOS（需先有 Homebrew：https://brew.sh）
brew install node sqlite

# Windows
winget install OpenJS.NodeJS.LTS
winget install SQLite.SQLite
```

**做完應該看到**：`node -v` 顯示 `v22.13` 以上；`sqlite3 --version` 顯示版本號。

## 步驟 3：安裝套件並檢查

**誰做**：【AI】

```sh
npm install
npm run check
```

**做完應該看到**：`npm run check` 最後顯示 `SQLite migrations, capacity and seat-limit triggers: ok`，而且沒有 `fail`。這代表起點是正常的。

## 步驟 4：填入社區內容

**誰做**：【人】決定內容，【AI】寫入設定檔

1. 【人】打開 `MY-COMMUNITY.md`，填寫社區名稱、網站名稱、身分選項、關於我們、管理員 Email 等。**不要在這個檔案裡填任何密碼或金鑰。**
2. 【AI】依 `.agents/skills/community-setup/SKILL.md` 第 2 步的對照表，修改 `site.config.json` 與 `public/site.webmanifest`。
3. 【AI】再檢查一次：

   ```sh
   npm run check
   ```

**做完應該看到**：檢查通過。詳細說明見 [`manual-handoffs.md` A1](manual-handoffs.md#a1-填社區內容做決定)。

## 步驟 5：在自己電腦上預覽

**誰做**：【AI】啟動，【人】看畫面

1. 建立本機設定檔：

   ```sh
   cp .dev.vars.example .dev.vars
   ```

2. 編輯 `.dev.vars`：
   - 取消註解（刪掉行首的 `#` 和後面的空格）這三行：`APP_ENV=development`、`SITE_URL=http://localhost:8787`、`LOCAL_ADMIN_TOKEN=...`。
   - 把 `LOCAL_ADMIN_TOKEN` 換成一串隨機文字，可以用這個指令產生：

     ```sh
     node -e "console.log(crypto.randomUUID())"
     ```

   - 想在本機試用報名防護的話，也取消註解兩行 Turnstile 測試金鑰（`1x000...`）。

   `.dev.vars` 只放在你的電腦上，不會被提交到 GitHub。

3. 建立本機資料庫並啟動：

   ```sh
   npm run db:local
   npm run dev
   ```

4. 【人】用瀏覽器打開：
   - 首頁：<http://localhost:8787>
   - 後台：<http://localhost:8787/admin/>，在登入畫面輸入 `.dev.vars` 裡的 `LOCAL_ADMIN_TOKEN`。

5. 【人】確認名稱與文字正確。本機資料庫一開始沒有活動，可以在後台「活動與場次 → ＋ 新增活動」建一個試試。**這裡的資料只在你的電腦上，不會影響正式網站。**

6. （選用）【AI】跑完整的報名流程測試。需要另開一個終端機，並保持 `npm run dev` 執行中；測試會在本機資料庫建立一個測試活動：

   ```sh
   TEST_ADMIN_TOKEN=<LOCAL_ADMIN_TOKEN 的值> node tests/integration.mjs
   ```

**做完應該看到**：首頁與後台在本機正常顯示。要停止預覽，在執行 `npm run dev` 的終端機按 `Ctrl + C`。

## 步驟 6：登入 Cloudflare

**誰做**：【人】

1. 沒有帳號的話，到 <https://dash.cloudflare.com/sign-up> 註冊（免費）。
2. 執行下面的指令，在跳出的瀏覽器頁面按 **Allow**：

   ```sh
   npx wrangler login
   ```

3. 確認登入的帳號：

   ```sh
   npx wrangler whoami
   ```

**做完應該看到**：`whoami` 顯示你的帳號。有多個帳號時，確認是要部署的那一個。見 [`manual-handoffs.md` A3](manual-handoffs.md#a3-cloudflare-帳號與授權)。

## 步驟 7：調整部署設定

**誰做**：【AI】

編輯 `wrangler.jsonc`：

| 設定 | 要改成 | 範例 |
| --- | --- | --- |
| `name` | 網站程式名稱（英文小寫、數字、`-`），也會成為免費網址的一部分 | `happy-events` |
| `d1_databases[0].database_name` | 資料庫名稱，和 `name` 用同一個開頭 | `happy-events` |
| `r2_buckets[0].bucket_name` | 圖片空間名稱 | `happy-events-photos` |
| `vars.APP_ENV` | 保持 `production` | `production` |
| `vars.SITE_URL` | 先留空，步驟 10 再填 | `""` |

- **不要填 `database_id`**，第一次部署時會自動建立。
- 有自訂網域時（見 [`manual-handoffs.md` B2](manual-handoffs.md#b2-自訂網域選用建議)），加上：

  ```jsonc
  "routes": [{"pattern": "<你的網域>", "custom_domain": true}],
  ```

改完再檢查一次：

```sh
npm run check
```

## 步驟 8：第一次部署

**誰做**：【AI】【需同意】

```sh
npm run deploy
```

這個指令會上傳網站程式、自動建立資料庫與圖片空間，並建立資料表。如果過程中詢問是否建立資源，回答是。

- 如果出現 R2 尚未啟用的訊息：【人】到 Cloudflare 儀表板 → **R2** 依畫面啟用。可能需要綁定付款方式，但在免費額度內不會收費。完成後再執行一次 `npm run deploy`。

確認資源已建立：

```sh
npx wrangler d1 list
npx wrangler r2 bucket list
```

**做完應該看到**：部署訊息最後有網站網址，例如 `https://happy-events.<子網域>.workers.dev`，**把這個網址記下來**。`d1 list` 和 `r2 bucket list` 列出步驟 7 取的名稱。

此時網站已經上線，但後台還不能登入、也還不能開放報名，這是正常的。

## 步驟 9：設定秘密

**誰做**：【AI】【需同意】【秘密】

前兩個秘密由電腦隨機產生，直接傳給 Cloudflare，**不會顯示在畫面上**：

```sh
node -e "console.log(crypto.randomUUID()+crypto.randomUUID())" | npx wrangler secret put RATE_SALT
node -e "console.log(crypto.randomUUID()+crypto.randomUUID())" | npx wrangler secret put FEEDBACK_TOKEN_SECRET
```

第一位管理員的 Email（必須和步驟 11 允許登入的 Email 相同）：

```sh
printf '%s' '<管理員 Email>' | npx wrangler secret put ADMIN_BOOTSTRAP_EMAIL
```

確認：

```sh
npx wrangler secret list
```

**做完應該看到**：列出 `RATE_SALT`、`FEEDBACK_TOKEN_SECRET`、`ADMIN_BOOTSTRAP_EMAIL`。這個指令只顯示名稱，不會顯示值。

## 步驟 10：填入正式網址並重新部署

**誰做**：【AI】【需同意】

1. 把步驟 8 記下的網址（或你的自訂網域）填入 `wrangler.jsonc`：

   ```jsonc
   "SITE_URL": "https://<你的網址>",
   ```

   網址結尾不要加 `/`。信件裡的連結、行事曆與課程回饋都需要這個值。

2. 重新部署：

   ```sh
   npm run deploy
   ```

3. 確認網站與安全設定：

   ```sh
   curl -sI https://<你的網址> | grep -iE "^HTTP|content-security-policy"
   ```

**做完應該看到**：`HTTP/2 200`，以及一行 `content-security-policy`。

## 步驟 11：設定後台登入（Cloudflare Access）

**誰做**：【人】在 Cloudflare 儀表板操作，【AI】接手設定

1. 【人】依 [`manual-handoffs.md` C1](manual-handoffs.md#c1-後台登入保護cloudflare-access) 建立 Access 應用程式：保護 `admin` 與 `api/admin` 兩條路徑，只允許管理員 Email。
2. 【人】把兩個值告訴 AI（都是公開值，可以貼在對話裡）：**Application Audience (AUD) Tag**，以及團隊網域 `<團隊>.cloudflareaccess.com`。
3. 【AI】填入 `wrangler.jsonc`：

   ```jsonc
   "ACCESS_TEAM_DOMAIN": "<團隊>.cloudflareaccess.com",
   "ACCESS_AUD": "<AUD Tag>",
   ```

4. 【AI】【需同意】部署並確認：

   ```sh
   npm run deploy
   curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://<你的網址>/admin/
   ```

**做完應該看到**：網址被導向 `https://<團隊>.cloudflareaccess.com/...` 的登入頁。

- 回 401：Access 沒有保護到這條路徑，回到第 1 步檢查路徑。
- 回 503：`ACCESS_*` 沒填或格式錯誤。

## 步驟 12：第一次登入後台

**誰做**：【人】

1. 用步驟 9 的管理員 Email，打開 `https://<你的網址>/admin/`。
2. 輸入信箱收到的驗證碼。
3. 看到後台選單就成功了。系統還沒有任何管理員時，這個 Email 會自動取得全部權限。

（選用）【AI】【需同意】確認權限已建立（唯讀查詢）：

```sh
npx wrangler d1 execute DB --remote --command "SELECT COUNT(*) AS modules FROM admin_permissions"
```

**做完應該看到**：`modules` 是 `8`。看到「尚未授予管理權限」時，見 [`manual-handoffs.md` C2](manual-handoffs.md#c2-第一次登入後台)。

## 步驟 13：報名防護（Cloudflare Turnstile）

**誰做**：【人】建立 widget 並輸入秘密，【AI】接手設定

強烈建議在開放報名前完成，否則有人可以用程式灌假報名。

1. 【人】Cloudflare 儀表板 → **Turnstile → Add widget**：主機名稱填網站網域，Widget Mode 選 **Managed**。
2. 【人】把 **Site Key**（公開值）告訴 AI。
3. 【人】【秘密】自己在終端機輸入 **Secret Key**（不要貼到對話裡）：

   ```sh
   npx wrangler secret put TURNSTILE_SECRET_KEY
   ```

4. 【AI】填入 `wrangler.jsonc`：

   ```jsonc
   "TURNSTILE_SITE_KEY": "<Site Key>",
   ```

5. 【AI】【需同意】部署並確認：

   ```sh
   npm run deploy
   curl -sI https://<你的網址> | grep -i content-security-policy | grep -o challenges.cloudflare.com
   ```

**做完應該看到**：`curl` 印出 `challenges.cloudflare.com`；用手機打開報名表，送出按鈕上方出現「確認您是真人」的方框。**只要看到就好，不要送出報名。** 見 [`manual-handoffs.md` C3](manual-handoffs.md#c3-報名防護cloudflare-turnstile)。

## 步驟 14：Email 通知（選用）

**誰做**：【人】在 Resend 與 DNS 操作並輸入秘密，【AI】接手設定

1. 【人】依 [`manual-handoffs.md` D1](manual-handoffs.md#d1-email-通知resend) 在 Resend 驗證寄件網域、建立 API Key 和 Webhook（網址 `https://<你的網址>/api/webhooks/resend`）。
2. 【人】【秘密】自己輸入兩個秘密：

   ```sh
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put RESEND_WEBHOOK_SECRET
   ```

3. 【AI】填入 `wrangler.jsonc`：

   ```jsonc
   "MAIL_MODE": "resend",
   "MAIL_FROM": "<寄件人名稱> <notify@你的寄件網域>",
   "MAIL_REPLY_TO": "<回覆信箱>",
   ```

4. 【AI】【需同意】部署：

   ```sh
   npm run deploy
   ```

5. 【人】後台 → **通知中心 → 寄測試信**，寄給自己。

**做完應該看到**：收到測試信，寄送紀錄顯示已送達。**不要寄給住戶測試。**

## 步驟 15：網站分析 GA4（選用）

**誰做**：【人】在 Google Analytics 操作，【AI】接手設定

1. 【人】依 [`docs/analytics.md`](analytics.md)「啟用」建立資源與網站串流，**關閉加強型評估的全部選項**。
2. 【人】把衡量 ID（`G-` 開頭，公開值）告訴 AI。
3. 【AI】填入 `wrangler.jsonc` 的 `"GA4_MEASUREMENT_ID": "G-XXXXXXX"`，經同意後執行 `npm run deploy`。
4. 【AI】確認：

   ```sh
   curl -s https://<你的網址>/analytics-config
   ```

5. 【人】依 `docs/analytics.md`「驗收」用 Tag Assistant 檢查。

**做完應該看到**：`analytics-config` 回傳你的 `G-` ID。人工驗收完成前，不要宣稱 GA4 已上線。

## 步驟 16：後台開站設定

**誰做**：【人】（AI 進不去後台，但可以幫忙起草文字）

在 `https://<你的網址>/admin/` 依序完成：

1. **營運設定**：貼上正式的個資告知與參與聲明（不能含「【草稿」字樣），換一個新的版本號，勾選「可允許場次開放報名」。見 [`manual-handoffs.md` E1](manual-handoffs.md#e1-個資告知與營運開關)。
2. **網站外觀**：選配色，上傳正方形網站圖示（512×512 以上）。
3. **關於我們頁面**：調整介紹內容。
4. **活動與場次 → ＋ 新增活動**：建立第一個活動（也可以請 AI 用 `manage-events` skill 建立）。
5. **首頁 Banner**：上傳海報（1920×640 或 1920×1080），填替代文字，連到活動。

圖片尺寸見 [`costs-and-images.md`](costs-and-images.md)。

## 步驟 17：上線檢查

**誰做**：【AI】跑指令，【人】用手機看

1. 【AI】安全標頭：

   ```sh
   curl -sI https://<你的網址> | grep -iE "content-security-policy|strict-transport-security|x-content-type-options"
   ```

   三項都應該出現。

2. 【AI】公開資料與後台保護：

   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' https://<你的網址>/api/public
   curl -s -o /dev/null -w '%{http_code}\n' https://<你的網址>/site-config.json
   curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://<你的網址>/admin/
   ```

   前兩個應為 `200`；最後一個應導向 Access 登入頁。

3. 【人】用手機打開首頁：看主視覺與活動卡片，打開報名表確認欄位與個資說明（**不要送出**），按「加入行事曆」確認能下載。

**完成**：網站可以對外宣布了。AI 回報時，要分清楚哪些已確認、哪些是你說做好但還沒確認，以及略過了哪些選用項目。

---

## 日常指令速查

| 想做的事 | 指令 | 誰做 |
| --- | --- | --- |
| 改程式後重新部署 | `npm run check`，通過後 `npm run deploy` | AI【需同意】 |
| 看目前與過去的部署版本 | `npx wrangler deployments list` | AI |
| 網站出問題、退回上一版 | `npx wrangler rollback <版本 ID>` | AI【需同意】 |
| 看即時記錄（排查錯誤） | `npx wrangler tail` | AI |
| 備份資料庫 | `npx wrangler d1 export DB --remote --output .local/backup-<日期>.sql` | AI【需同意】 |
| 列出已設定的秘密名稱 | `npx wrangler secret list` | AI |
| 更換秘密 | `npx wrangler secret put <名稱>` | 自動產生的由 AI【需同意】；第三方秘密由人輸入 |
| 新增管理員 | 先在 Access 加 Email（人），再 `npx wrangler d1 execute DB --remote --command "INSERT INTO admin_permissions VALUES ('<email>','<模組>')"` | 人＋AI【需同意】 |
| 本機預覽 | `npm run dev` | AI |
| 本機完整流程測試 | `TEST_ADMIN_TOKEN=<權杖> node tests/integration.mjs`（需開著 `npm run dev`） | AI |

注意：

- 退回程式版本**不會**還原資料庫、圖片或已寄出的信。
- 備份檔放在 `.local/`，不會被提交；資料庫備份**不包含** R2 圖片。
- 新增管理員的模組名稱與說明，見 [`manual-handoffs.md` C4](manual-handoffs.md#c4-新增其他管理員)。

## 疑難排解

| 狀況 | 可能原因 | 怎麼處理 |
| --- | --- | --- |
| `npm run check` 失敗，提到 sqlite3 | 沒裝 sqlite3 | 回到步驟 2 |
| 部署時提到 R2 | R2 尚未啟用 | 儀表板 → R2 啟用後重新部署 |
| 後台顯示「管理登入尚未設定」 | `ACCESS_TEAM_DOMAIN` 或 `ACCESS_AUD` 沒填 | 回到步驟 11 |
| 後台顯示「請透過管理登入重新驗證身分」 | Access 沒有保護到該路徑，或 AUD 填錯 | 確認 Access 應用程式包含 `admin` 與 `api/admin`，AUD 與儀表板一致 |
| 後台顯示「尚未授予管理權限」 | 登入的 Email 和 `ADMIN_BOOTSTRAP_EMAIL` 不同，或已有其他管理員 | 確認 Email 拼字；請現有管理員依速查表新增權限 |
| 報名時顯示「報名服務尚未設定」 | 沒設 `RATE_SALT` | 回到步驟 9 |
| 報名時顯示「報名防護設定不完整」 | Turnstile 只設了 Site Key 或 Secret Key 其中一個 | 回到步驟 13，兩個都要設 |
| 場次無法開放報名 | 營運設定未完成，或場次缺地點、費用、名額、聯絡方式 | 回到步驟 16 |
| 住戶沒收到信 | `MAIL_MODE` 未設為 `resend`，或寄件網域未驗證 | 回到步驟 14；在後台通知中心查看寄送紀錄 |
| 課程回饋無法寄送 | `SITE_URL` 未填，或未設定 Email | 回到步驟 10、14 |

更多規範見 [`AGENTS.md`](../AGENTS.md)；完整的人工介接說明見 [`manual-handoffs.md`](manual-handoffs.md)。
