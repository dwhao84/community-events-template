# 人工介接清單：哪些事要由人來做

這份文件寫給兩種讀者：

- **主辦方（人）**：想知道架站與營運時，哪些事必須自己動手、要準備什麼、大概花多少時間。
- **AI 助理（agent）**：Claude Code、Codex、Gemini CLI 等。用來判斷哪些事自己做完、哪些要停下來交給人，以及交接時要說什麼、拿回什麼、怎麼確認。

網站大部分的設定 AI 都能代勞。但有些事 AI 做不到或不該做，例如：登入你的 Cloudflare 或 Google 帳號、收你信箱的驗證碼、決定個資告知的內容、在活動現場幫人簽到。這份清單把這些事全部列出來。

完整的設定步驟寫在 `.agents/skills/community-setup/SKILL.md`。本文件只整理「需要人」的部分。

---

## 怎麼讀這份文件

**主辦方**：先看「[開始前請準備](#開始前請準備)」和「[建議順序與一覽表](#建議順序與一覽表)」。之後 AI 每交一件事給你，再翻到對應的編號，只看「**你要做**」和「**完成的樣子**」即可，程式指令可以跳過。

**AI 助理**：先讀「[給 AI 助理的規則](#給-ai-助理的規則)」，再依一覽表的順序推進。每一項的「**AI 會做**」寫了指令與要寫入的位置，「**怎麼確認**」寫了驗證方法。

每一項都用同樣的格式：

| 欄位 | 意思 |
| --- | --- |
| 一句話說明 | 這是什麼、為什麼需要 |
| 必要性 | 必要／強烈建議／選用 |
| 大約時間 | 人實際操作的時間；等待（例如 DNS 生效）另外註明 |
| 你要做 | 主辦方的操作步驟 |
| AI 會做 | AI 事前準備與事後接手的部分 |
| 完成的樣子 | 做好之後會看到什麼，以及 AI 怎麼確認 |
| 沒做的話 | 略過的影響 |

---

## 名詞解釋

| 名詞 | 白話說明 |
| --- | --- |
| Cloudflare | 放網站的服務。網站、資料庫、圖片都放在這裡，小型社區通常在免費額度內。 |
| Cloudflare 儀表板 | Cloudflare 的管理網頁：<https://dash.cloudflare.com>。 |
| Worker | 網站程式本身。 |
| D1 | 存活動、報名資料的資料庫。 |
| R2 | 存照片、Banner 等圖片的空間。 |
| wrangler | AI 用來部署與管理 Cloudflare 的指令工具。 |
| 部署 | 把改好的程式放上網路，讓大家看到。 |
| 後台 | 網站的管理頁 `<你的網址>/admin/`，用來建活動、看報名名單。 |
| Cloudflare Access | 保護後台的登入關卡。只有你允許的 Email 能進入，登入時會寄驗證碼到信箱。 |
| Turnstile | Cloudflare 的「確認您是真人」小方框，防止有人用程式灌假報名。 |
| Resend | 寄 Email 通知的服務（報名收件、名額確認、行前提醒）。 |
| GA4 | Google Analytics 4，網站流量分析，選用。 |
| `SITE_URL` | 網站的正式網址，例如 `https://events.example.org`。 |
| **秘密（secret）** | 像密碼一樣的值。**不能貼到對話裡、不能寫進檔案**，只能用指令輸入，例如 `npx wrangler secret put 名稱`。 |
| **公開值** | 不怕別人看到的設定值，例如 Turnstile 的 Site Key、GA4 的 `G-` 開頭 ID。可以直接告訴 AI。 |

---

## 開始前請準備

主辦方先把下列東西準備好，整個流程會順很多：

- [ ] **一個能收信的管理員 Email**：登入後台時會寄驗證碼到這裡，第一次登入時要能立刻收信。
- [ ] **Cloudflare 帳號**（沒有的話，流程中會帶你註冊，免費）。第一次啟用 R2 圖片儲存時，Cloudflare 可能要求**綁定信用卡等付款方式**；在免費額度內不會收費。
- [ ] **電腦的系統管理權限**：如果需要安裝 Node.js 等軟體。
- [ ] **社區內容**：想好社區名稱、網站名稱、參加者身分選項、關於我們的介紹與聯絡方式。不用填檔案，AI 會一題一題問你。
- [ ] **自訂網域的註冊商登入資料**（選用，例如 `events.example.org`；沒有網域也能先用免費網址）。
- [ ] **圖片**：網站圖示（正方形、512×512 以上）、首頁 Banner（1920×640 或 1920×1080）、活動封面（1600×900）。尺寸說明見 `docs/costs-and-images.md`。
- [ ] **正式的個資告知文字**：AI 可以幫忙起草，但內容要由主辦方確認並負責。
- [ ] 要寄 Email 的話：**寄件網域的 DNS 管理權限**。
- [ ] 要用 GA4 的話：**Google Analytics 帳戶的編輯權限**。

---

## 建議順序與一覽表

依這個順序做最順。「卡住什麼」是指這一項沒完成時，哪些功能不能用。

| 順序 | 編號 | 項目 | 必要性 | 人的時間 | 卡住什麼 |
| --- | --- | --- | --- | --- | --- |
| 1 | A1 | 填社區內容、做決定 | 必要 | 20–40 分鐘 | 網站文字 |
| 2 | A2 | 安裝 Node.js、sqlite3 | 缺少時才需要 | 5–10 分鐘 | AI 無法在本機檢查 |
| 3 | A3 | Cloudflare 帳號與授權 | 必要 | 5 分鐘 | 所有部署 |
| 4 | A4 | GitHub（看部署方式） | 看情況 | 5–10 分鐘 | 一鍵部署、程式備份 |
| — | B1 | 同意每次對外動作 | 必要 | 每次幾秒 | 部署、修改正式資料 |
| 5 | B2 | 自訂網域 | 選用（建議） | 10 分鐘＋等待生效 | 後台保護較完整 |
| 6 | B3 | 指定第一位管理員 Email | 必要 | 1 分鐘 | 第一次登入 |
| 7 | C1 | 後台登入保護（Access） | 必要 | 15 分鐘 | 整個後台 |
| 8 | C2 | 第一次登入後台 | 必要 | 3 分鐘 | 後台操作 |
| 9 | C3 | 報名防護（Turnstile） | 強烈建議 | 10 分鐘 | 防灌報名、防濫發信 |
| 10 | E1 | 個資告知與營運開關 | 必要 | 15–30 分鐘 | 開放報名 |
| 11 | E2 | 外觀、關於我們、Banner | 建議 | 20–40 分鐘 | 首頁內容 |
| 12 | D1 | Email 通知（Resend） | 選用 | 20 分鐘＋等待 DNS | 所有通知信、課程回饋 |
| 13 | D2 | 網站分析（GA4） | 選用 | 30 分鐘 | 流量分析 |
| 14 | E3 | 上線前檢查 | 必要 | 10 分鐘 | 對外宣布 |
| — | C4 | 新增其他管理員 | 需要時 | 5 分鐘 | 多人管理 |
| — | F | 日常營運判斷 | 持續 | — | 見 F 節 |
| — | G | 維護、備份、出狀況時 | 需要時 | — | 見 G 節 |

時間都是大約值，依個人熟悉程度不同。

---

## 給 AI 助理的規則

1. **先做完能做的，再交給人。** 交接前把檔案、指令、預填值都準備好，讓人只需要做那一個動作。
2. **一次只交一件事。** 用繁體中文白話說明，給完整的網頁路徑（例如「Cloudflare 儀表板 → Turnstile → Add widget」）、要填什麼、做完要回報什麼。說明時引用本文件的編號，方便人對照。
3. **等回覆再繼續。** 不要猜人在儀表板上做了什麼；拿到回報後，用「完成的樣子」裡的方法確認。
4. **秘密不經過對話。**
   - AI 自己產生的秘密（`RATE_SALT`、`FEEDBACK_TOKEN_SECRET`）：用管線直接傳給 `wrangler secret put`，不要印出來。
   - 第三方產生的秘密（`TURNSTILE_SECRET_KEY`、`RESEND_API_KEY`、`RESEND_WEBHOOK_SECRET`）：**請人自己在終端機執行** `npx wrangler secret put <名稱>` 再貼上。在 Claude Code 裡，可以請對方在輸入框打 `! npx wrangler secret put <名稱>`。**絕不請人把秘密貼進對話。**
   - 公開值（Turnstile Site Key、Access AUD、團隊網域、GA4 衡量 ID）可以在對話中拿，由 AI 寫進 `wrangler.jsonc`。
5. **對外動作每次都要同意。** 部署、遠端 migration、寫入正式 D1、`wrangler secret put`、`git push`、建立或刪除雲端資源，都要先說明影響並等同意。上一次的同意不適用於下一次。
   - 有腳本的階段（第一次部署 `npm run deploy:first`、報名防護 `npm run setup:turnstile`）可以**一次同意整個階段**：先用 `--plan` 列出全部項目原樣給人看，同意後才加 `--yes` 執行。清單以外的事要另外問。
6. **AI 進不了後台。** 正式站的 `/admin/` 和 `/api/admin/` 由 Cloudflare Access 保護，AI 沒有登入憑證，**不得嘗試繞過**。只能在後台做的事一律交給人。活動與場次可以改用 `manage-events`、`update-sessions` skill，經同意後寫入 D1。
7. **不在正式站測試。** 不送測試報名、不寄測試通知給住戶。功能測試一律在本機 `npm run dev` 進行。
8. **記錄進度。** 把每一項的狀態記在 `.local/handoff-status.md`（`.local/` 不會被提交），狀態分為：未開始／等待人／已完成並確認／人說完成但尚未確認／使用者決定略過。不得記錄秘密值或個資。
9. **回報要誠實。** 「已部署並確認」和「人說做好了但還沒確認」要分開說；沒驗證過的不能說已完成。

---

## A. 帳號與前置

### A1. 填社區內容、做決定

> 社區名稱、身分選項、聯絡方式、關於我們等，都是主辦方的決定，AI 不會自己編。

- **必要性**：必要｜**大約時間**：20–40 分鐘

#### 你要做

- AI 問你問題時回答即可（一次 2–4 題，每題有範例），也可以說「用預設」，之後在後台再改。不用自己打開或填寫任何檔案。

#### AI 會做

- 依開站問卷（`scripts/setup-questions.mjs`）發問，格式不對（網址不是 https、身分選項超過 50 字、標誌字不只一個字）會當場請你重答。
- 答案存在你的電腦（`.local/setup-answers.json`，不會上傳），複述給你確認後，用 `npm run setup -- apply` 寫入 `site.config.json` 與 `public/site.webmanifest`。

#### 完成的樣子

- AI 執行 `node scripts/check.mjs` 通過。
- AI 在本機開網站（`npm run dev`），請你看一次首頁和「關於我們」的文字是否正確。

**沒做的話**：可以先用預設值部署，但上線前（E3）要再確認一次。

### A2. 安裝 Node.js 22.13 以上與 sqlite3

> AI 需要這兩個工具，才能在你的電腦上檢查、預覽網站。

- **必要性**：電腦裡沒有時才需要｜**大約時間**：5–10 分鐘

#### 你要做

- 執行 AI 給你的安裝指令（例如 macOS：`brew install node sqlite`）。可能會要求輸入電腦密碼，這一步只能你自己做。

#### AI 會做

- 先執行 `node -v`、`sqlite3 --version` 判斷缺什麼，再依作業系統提供一條安裝方式。不得自行使用 `sudo`。

**完成的樣子**：AI 再查一次版本號，接著 `npm install` 與 `node scripts/check.mjs` 都成功。

### A3. Cloudflare 帳號與授權

> 網站放在 Cloudflare。你要授權 AI 的指令工具代你部署。

- **必要性**：必要｜**大約時間**：5 分鐘

#### 你要做

1. 沒有帳號：到 <https://dash.cloudflare.com/sign-up> 註冊（免費方案即可）。
2. AI 執行 `npx wrangler login` 後，瀏覽器會跳出授權頁，按 **Allow**。
3. 如果你有多個 Cloudflare 帳號，告訴 AI 要部署到哪一個。
4. 第一次部署時，如果 AI 回報 R2 需要先啟用：到 Cloudflare 儀表板 → **R2**，依畫面啟用，必要時綁定付款方式（免費額度內不收費），完成後告訴 AI。

#### AI 會做

- 先用 `npx wrangler whoami` 檢查是否已登入、登入的是哪個帳號。
- 這個指令會顯示帳號 Email 與 ID，屬於個人資料，不寫進任何會提交的檔案。

**完成的樣子**：`npx wrangler whoami` 顯示正確的帳號。

### A4. GitHub（看部署方式）

> 兩種部署方式擇一。AI 會說明差異，請你選。

- **必要性**：看部署方式｜**大約時間**：5–10 分鐘

| 方式 | 適合 | 你要做 |
| --- | --- | --- |
| **Deploy to Cloudflare 按鈕** | 想要以後改程式、push 就自動更新 | 在瀏覽器按 README 上的按鈕，依畫面授權 Cloudflare 與 GitHub，並在秘密欄位填值 |
| **命令列部署** | 最簡單，由 AI 全程操作 | 不一定需要 GitHub；要把程式放上 GitHub 時，執行 `gh auth login` 授權 |

#### AI 會做

- 按鈕方式：之後在 Cloudflare 幫你建立的**新 repo** 裡修改並 push（每次 push 前取得同意）。
- 命令列方式：用 `npm run deploy` 部署；需要時經同意建立 repo 並 push。

**完成的樣子**：`gh auth status` 顯示已登入，`git remote -v` 指向你的 repo（命令列方式且不用 GitHub 時可略過）。

---

## B. 部署

### B1. 同意每次對外動作

> AI 每次要動到正式網站或你的帳號前，都會先說明並等你同意。

- **必要性**：必要｜**大約時間**：每次幾秒

#### 你要做

- 讀 AI 的說明（會影響什麼、能不能復原），回覆「同意」或「先不要」。

**需要同意的動作**：部署（`npm run deploy`、`npm run deploy:first`）、修改正式資料庫結構（遠端 migration）、寫入正式資料庫、設定秘密、`git push`、建立或刪除 Cloudflare 資源、把網站退回舊版本。

#### AI 會做

- 部署前記錄目前版本（`npx wrangler deployments list`），部署後記錄新版本與網址。`deploy:first` 與 `setup:turnstile` 會自動寫進 `.local/deploy-log.md`。
- 第一次部署用 `npm run deploy:first`：先 `--plan` 列出清單（建立 Worker／D1／R2、遠端 migration、寫入秘密、回填 `SITE_URL`、標頭檢查），你同意一次後連續做完。帳號裡已有同名網站時它會停下，不會覆蓋。
- 依 `AGENTS.md`「部署與回復」檢查頁面、公開 API 與安全標頭。

### B2. 自訂網域（選用，建議）

> 用自己的網址（例如 `events.example.org`）取代免費網址。也比較容易設定後台保護（C1）。

- **必要性**：選用，建議｜**大約時間**：10 分鐘，加上等待生效（幾分鐘到幾小時）

#### 你要做

1. 告訴 AI 想用的網址，例如 `events.example.org`。
2. 如果網域還沒交給 Cloudflare 管理：Cloudflare 儀表板 → **Add a site** → 依畫面到你的網域註冊商，把 nameserver 改成 Cloudflare 提供的兩個值。
3. 等儀表板顯示 **Active** 後告訴 AI。

#### AI 會做

- 在 `wrangler.jsonc` 加上 `"routes": [{"pattern": "<網域>", "custom_domain": true}]`，把 `SITE_URL` 設為 `https://<網域>`，可把 `workers_dev` 改為 `false`；經同意後部署。

**完成的樣子**：用瀏覽器打開新網址看得到網站。AI 用 `curl -sI https://<網域>` 確認回 200，且有 `Content-Security-Policy` 標頭。

**沒做的話**：網站可以先用 `https://<名稱>.<子網域>.workers.dev`，但後台保護可能無法只套用在特定路徑上（見 C1）。

### B3. 指定第一位管理員 Email

> 第一個登入後台的人會自動成為管理員，所以要先指定是誰。

- **必要性**：必要｜**大約時間**：1 分鐘

#### 你要做

- 告訴 AI 第一位管理員的 Email。**必須和 C1 允許登入的 Email 相同。**

#### AI 會做（經同意；不需要你輸入任何值）

- 第一次部署時執行 `npm run deploy:first -- --admin-email <管理員 Email>`，它會連同隨機產生的 `RATE_SALT`、`FEEDBACK_TOKEN_SECRET` 一起寫入秘密，不會顯示在畫面上。
- 不用腳本時，手動做法見 [`setup-guide.md` 步驟 9](setup-guide.md#步驟-9設定秘密)。

**完成的樣子**：`npx wrangler secret list` 列出這三個名稱。這個指令只顯示名稱，不會顯示值。

---

## C. 安全與登入

### C1. 後台登入保護（Cloudflare Access）

> 沒有這一步，後台完全無法使用。設定好之後，只有你允許的 Email 能進後台，登入時會寄驗證碼到信箱。

- **必要性**：必要｜**大約時間**：15 分鐘

#### 你要做（AI 會一步一步帶，每做完一步回報一次）

1. Cloudflare 儀表板 → **Zero Trust**。第一次進入會要求取一個團隊名稱，選免費方案。
2. **Access → Applications → Add an application → Self-hosted**。
3. 網域填網站網址，**新增兩條路徑**：`admin` 和 `api/admin`。
4. Policy：Action 選 **Allow**，Include 選 **Emails**，填管理員 Email。登入方式用預設的 One-time PIN。
5. 存檔後，把兩個值告訴 AI（都是公開值，可以直接貼在對話裡）：
   - 應用程式 Overview 頁的 **Application Audience (AUD) Tag**
   - 團隊網域，形如 `<團隊>.cloudflareaccess.com`（在 Settings → Custom Pages 可以找到）

#### AI 會做

- 把兩個值寫入 `wrangler.jsonc` 的 `ACCESS_AUD`、`ACCESS_TEAM_DOMAIN`，經同意後部署。

#### 完成的樣子

- 打開 `<網址>/admin/` 會跳到 Cloudflare 的登入頁。
- AI 用 `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' <SITE_URL>/admin/` 確認會被導向 `*.cloudflareaccess.com`。
- 如果 `<SITE_URL>/api/admin/me` 直接回 401 JSON，表示 Access 沒有保護到這條路徑；回 503「管理登入尚未設定」表示 `ACCESS_*` 沒填或格式錯誤。

**沒做的話**：後台打不開，不能對外宣布上線。

### C2. 第一次登入後台

> 驗證碼寄到管理員信箱，只有你收得到。

- **必要性**：必要｜**大約時間**：3 分鐘

#### 你要做

1. 用 B3 指定的 Email 打開 `<網址>/admin/`。
2. 輸入信箱收到的驗證碼。
3. 看到後台選單就成功了；告訴 AI 結果。

#### AI 會做

- 經同意後唯讀查詢正式資料庫，確認權限已建立：
  ```sh
  npx wrangler d1 execute DB --remote --command "SELECT module FROM admin_permissions"
  ```
  應有 8 個模組。只回報數量，不要在對話中重複管理員的 Email。

**完成的樣子**：你看得到後台全部選單，AI 確認有 8 個模組。

**看到「尚未授予管理權限」時**：通常是 Email 拼字和 B3 不同，或系統裡已經有其他管理員。告訴 AI，請它幫你比對。

### C3. 報名防護（Cloudflare Turnstile）

> 報名不需要登入。沒有這一步，任何人都能用程式灌假報名把名額佔滿，或借網站寄「報名收件通知」給陌生人。

- **必要性**：強烈建議｜**大約時間**：5–10 分鐘

AI 會先執行 `npm run setup:turnstile -- --plan` 給你看清單，你同意後它試著用 Cloudflare API 自動建立 widget、寫入兩把鑰匙並重新部署；成功的話**你不用做下面任何一步**，只要做「完成的樣子」的手機檢查。API 權限不足時，才需要你做：

#### 你要做（自動建立失敗時）

1. Cloudflare 儀表板 → **Turnstile** → **Add widget**（腳本會印出直接的連結和要填的網域）。
   - 主機名稱：網站網址的網域部分（例如 `events.example.org`）。
   - Widget Mode：**Managed**。
2. 把 **Site Key**（公開值）貼給 AI。
3. **Secret Key 是秘密，不要貼給 AI。** 自己在終端機執行下面的指令，畫面要求時貼上（在 Claude Code 裡，可以在輸入框先打 `!`、空一格再接指令）：
   ```sh
   npx wrangler secret put TURNSTILE_SECRET_KEY
   ```

#### AI 會做

- 執行 `npm run setup:turnstile -- --site-key <Site Key> --yes`：把 Site Key 寫入 `wrangler.jsonc`、確認 Secret Key 已設定，再部署並檢查 CSP。

#### 完成的樣子

- 用手機打開報名表，送出按鈕上方會出現「確認您是真人」的小方框。**只要看到就好，不要送出報名。**
- AI 確認 `npx wrangler secret list` 有 `TURNSTILE_SECRET_KEY`，且 `curl -sI <SITE_URL> | grep -i content-security-policy` 包含 `challenges.cloudflare.com`。

#### 注意

- Site Key 和 Secret Key 必須兩個都設定。只設一個時，系統會暫停報名並顯示「報名防護設定不完整」，這是刻意的保護。
- 本機測試可以用 `.dev.vars.example` 裡的 Cloudflare 測試金鑰；測試金鑰放到正式站會被拒絕。

**沒做的話**：網站照常運作，但沒有防護。AI 回報時會把它列為「尚未完成的安全設定」。

### C4. 新增其他管理員

> 後台目前沒有新增管理員的畫面，要分兩步做。

- **必要性**：需要時｜**大約時間**：5 分鐘

#### 你要做

1. Zero Trust → **Access → Applications** → 你的應用程式 → **Policy**，在 Emails 加入新管理員的 Email，讓對方能登入。
2. 告訴 AI 要給對方哪些權限：

   | 權限名稱 | 可以用的功能 |
   | --- | --- |
   | `events` | 活動與場次、統計、關於我們 |
   | `registrations` | 報名名單 |
   | `checkin` | 現場報到 |
   | `photos` | 活動照片、首頁 Banner |
   | `notifications` | 通知中心 |
   | `export` | 匯出 CSV |
   | `feedback` | 課程回饋 |
   | `admins` | 營運設定、網站外觀、管理員 |

   **請注意**：有 `registrations` 或 `notifications` 權限，就能看到報名者的完整個資。單獨拿掉 `export` 並不會限制個資存取。

#### AI 會做（經同意）

```sh
npx wrangler d1 execute DB --remote --command "INSERT INTO admin_permissions VALUES ('<email>','events'),('<email>','checkin')"
```

**完成的樣子**：新管理員登入 `/admin/` 後，只看到被授權的選單。

---

## D. 選用功能

### D1. Email 通知（Resend）

> 寄報名收件、名額確認、行前提醒、課程回饋邀請等信件。

- **必要性**：選用｜**大約時間**：20 分鐘，加上等待 DNS 驗證（幾分鐘到幾小時）

#### 你要做

1. 到 <https://resend.com> 註冊，新增你的寄件網域（例如 `mail.example.org`）。
2. 依 Resend 畫面，到 DNS（Cloudflare 或註冊商）新增它列出的紀錄，等 Resend 顯示 **Verified**。
3. 在 Resend 建立 **API Key**。這是秘密，自己執行：
   ```sh
   npx wrangler secret put RESEND_API_KEY
   ```

4. 在 Resend 新增 **Webhook**：
   - 網址：`<你的網址>/api/webhooks/resend`
   - 事件：勾選 email delivered、bounced、failed
   - 把 **Signing secret** 用下面的指令輸入（也是秘密）：
     ```sh
     npx wrangler secret put RESEND_WEBHOOK_SECRET
     ```

5. 告訴 AI 寄件人名稱與地址（例如 `幸福社區活動 <notify@mail.example.org>`）、回覆信箱。

#### AI 會做

- 在 `wrangler.jsonc` 設定 `MAIL_MODE: "resend"`、`MAIL_FROM`、`MAIL_REPLY_TO`，經同意後部署。
- `MAIL_CC` 會讓**每一封寄給住戶的信都副本給該地址**。只在你明確要求、且個資告知已說明時才設定。

**完成的樣子**：你在後台「通知中心 → 寄測試信」寄給自己，收得到，而且寄送紀錄顯示已送達。**不要寄給住戶測試。**

**沒做的話**：報名照常運作，住戶在畫面上會拿到報名編號，但不會收到任何信，也無法寄課程回饋。

### D2. 網站分析（GA4）

> 了解多少人來看、從哪裡來、報名到哪一步離開。只有訪客同意後才會啟用。

- **必要性**：選用｜**大約時間**：30 分鐘（另有上線後的驗收）

**你要做**：依 `docs/analytics.md` 的「啟用」與「GA4 報表設定」操作，重點是：

1. 在 Google Analytics 建立資源（時區台灣、幣別 TWD）與網站串流（網址填正式網址）。
2. **關閉「加強型評估」的全部選項**，並維持 Google Signals、廣告個人化關閉。
3. 把衡量 ID（`G-` 開頭，公開值）告訴 AI。
4. 上線後依 `docs/analytics.md`「驗收」的正式環境人工項目，用 Tag Assistant 與 DebugView 檢查。

#### AI 會做

- 寫入 `wrangler.jsonc` 的 `GA4_MEASUREMENT_ID`，確認 `SITE_URL` 已填，經同意後部署。

**完成的樣子**：AI 用 `curl -s <SITE_URL>/analytics-config` 確認回傳你的 ID；你完成 Tag Assistant 驗收。驗收前，AI 不會宣稱 GA4 已上線。

---

## E. 上線前（都在後台，AI 進不去）

### E1. 個資告知與營運開關

> 個資告知與參與聲明涉及法律責任，內容必須由主辦方決定並負責。完成前，所有場次都不能開放報名。

- **必要性**：必要｜**大約時間**：15–30 分鐘

#### 你要做

1. 審閱並修改 AI 起草的告知文字，或使用你自己的版本。
2. 後台 → **營運設定**：
   - 貼上正式的個資告知與參與聲明（不能含「【草稿」字樣）。
   - 換一個新的版本號（例如 `2026-12-v1`）。
   - 勾選「**可允許場次開放報名**」，儲存。
3. 告訴 AI 已完成。

#### AI 會做

- 依網站實際收集的資料（姓名、Email、電話、手寫簽名、參加者身分、活動照片）起草告知文字，並清楚標示「草稿，需主辦方確認，不構成法律意見」。

**完成的樣子**：後台儲存成功，場次可以設定為開放報名。AI 不會在正式站送報名來測試。

**沒做的話**：活動看得到，但不能報名。

### E2. 網站外觀、關於我們、Banner 與圖片

> 圖片只能從後台上傳，所以要由你來做。

- **必要性**：建議｜**大約時間**：20–40 分鐘

#### 你要做（後台）

1. **網站外觀**：選配色，上傳正方形網站圖示（512×512 以上）。
2. **關於我們頁面**：貼上或調整 AI 起草的內容。
   - **自訂頁面**（選用）：想多一個分頁放社區公約、垃圾清運、交通資訊等，在後台「自訂頁面」填頁面名稱（就是選單上的分頁名稱）、編排內容，勾選「在網站選單顯示這個分頁」後儲存，立即生效。
3. **活動與場次**：在活動編輯畫面上傳封面（建議 1600×900）。
4. **首頁 Banner**：上傳海報（建議 1920×640 或 1920×1080），填替代文字（一句話描述圖片內容），連到活動。

#### AI 會做

- 提醒各位置的建議尺寸（`docs/costs-and-images.md`）。
- 起草關於我們文字與每張圖的替代文字。
- 經同意用 `manage-events` skill 建立第一個活動（不含圖片）。

**完成的樣子**：首頁看得到 Banner 和活動。AI 用 `curl -s <SITE_URL>/api/public` 確認活動與 Banner 的數量（只看數量與標題，不輸出其他資料）。

### E3. 上線前檢查

> 對外宣布前的最後確認。

- **必要性**：必要｜**大約時間**：10 分鐘

#### 你要做（用自己的手機）

1. 打開首頁，看主視覺和活動卡片是否正常。
2. 打開一個活動的報名表，確認欄位與個資說明正確。**不要送出。**
3. 按「加入行事曆」，確認能下載。

#### AI 會做

- `curl -sI <SITE_URL>`：確認有 `Content-Security-Policy`、`Strict-Transport-Security`、`X-Content-Type-Options`。
- 確認 `/api/public`、`/site-config.json`、一張公開圖片、`/api/sessions/<id>/form` 都正常回應。
- 確認 `/admin/` 會被導向 Access 登入頁。

#### AI 的回報格式

- 網站網址、後台網址
- 已完成並確認的項目
- 你說做好了、但 AI 還沒確認的項目
- 你決定略過的項目（例如 Turnstile、Email、GA4、自訂網域），以及略過的影響

---

## F. 日常營運：需要人判斷的事

網站上線後，下列事情都要由主辦方決定，並在後台操作。AI 可以提醒、統計、起草文字，但不會代你決定或按下送出。

| 什麼時候 | 你要做 | 為什麼要人 | AI 可以幫忙 |
| --- | --- | --- | --- |
| 有人報名 | 在「報名名單」確認名額、改候補或遞補 | 「收到報名」不等於「已確認名額」 | 用 `event-report` 統計人數；提醒名額增加時，候補**不會**自動轉正 |
| 有人用電話或紙本報名 | 後台「＋ 新增報名者」代填 | 你要確認已取得當事人同意 | 說明操作位置 |
| 改時間、地點或取消場次 | 修改後，到「通知中心」寄「活動資訊更新」或「活動取消通知」 | 系統不會自動寄這兩種信 | 用 `update-sessions` 經同意修改，完成後提醒你寄通知 |
| 有通知的寄送結果「不明」 | 到 Resend 後台查實際結果，回到通知中心填入 | 只有你能登入 Resend | 指出是哪幾筆 |
| 活動當天 | 在「現場報到」幫參加者報到、簽名 | 在現場、用工作人員的裝置 | 前一天提醒確認報到人員有 `checkin` 權限 |
| 活動結束後上傳照片 | 填好照片說明後再發布 | 要確認說明內容，以及肖像是否取得同意 | 說明新照片預設隱藏 |
| 寄課程回饋 | 在「課程回饋」確認名單與信件後寄出 | 寄出前需要二次確認 | 起草提醒，不代按寄送 |
| 引用回饋意見 | 自己挑選並刪去可辨識個人的內容 | 涉及個資 | `event-report` 只列意見則數 |
| 有人要求刪除個資 | 先「取消報名」，再「永久刪除個資」 | 刪除後無法復原 | 說明流程 |
| 宣傳活動 | 決定在哪裡、什麼時候發布 | 你的社群、你的決定 | 用 `event-promo` 起草 LINE、Facebook、公布欄文字 |

---

## G. 維護、備份與出狀況時

| 情況 | 你要做 | AI 會做 |
| --- | --- | --- |
| 程式更新需要修改資料庫結構 | 同意，並接受短暫影響 | 先說明影響哪些資料；備份（`npx wrangler d1 export DB --remote --output .local/backup-<日期>.sql`，備份檔不得提交）；記錄目前版本後再套用 |
| 部署後網站出問題 | 同意退回上一版 | 用記錄的版本執行 `npx wrangler rollback <版本>`；並說明退回程式**不會**還原資料庫、圖片或已寄出的信 |
| 想備份照片 | 決定備份位置與頻率 | 說明資料庫備份不包含 R2 圖片，提供備份方法 |
| 更換秘密 | 同意，並了解影響 | `RATE_SALT` 可以隨時換。`FEEDBACK_TOKEN_SECRET` 換了之後，已寄出的回饋連結仍可使用；之後若再寄提醒，新信會換新連結，舊連結隨之失效 |
| 正式網址確定、HTTPS 穩定之後 | 確認網址不會再換 | 把 `src/worker.js` 的 `Strict-Transport-Security` 從 1 天（`max-age=86400`）調高，依一般流程檢查與部署 |
| 擔心費用 | 在 Cloudflare 儀表板設定帳單通知，決定是否升級方案 | 依 README「費用」估算用量 |
| 管理員離職 | 從 Access 政策移除對方 Email | 經同意刪除對方的權限資料；確認至少保留一位有 `admins` 權限的管理員 |
| 疑似被濫用（大量假報名、異常寄信） | 決定是否暫停報名；在 Cloudflare 儀表板開啟 Turnstile（C3），或建立 WAF 速率限制規則 | 用統計數字說明狀況（不輸出個資）；說明 WAF 規則要怎麼設定（路徑 `/api/sessions/*/registrations`） |
