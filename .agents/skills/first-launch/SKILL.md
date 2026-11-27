---
name: first-launch
description: 第一次上架：帶完全沒架過站的主辦方，從零把這個模板變成自己社區的正式網站。先確認真的是第一次（不會蓋到既有網站或別的專案），每一關需要的資料都用開站問卷一題一題問（不用自己填檔案），再依 community-setup 的步驟一關一關做完：本機預覽、部署、後台登入、報名防護、開站檢查。每一關都會停下來等確認，中途中斷也能接著做。當使用者說「第一次上架」「從頭帶我架站」「我還沒部署過，帶我設定」「帶我用 community-setup 設定」「接著上次的上架進度」時使用。已經上線、只要更新程式或內容時不要用這個 skill。
---

# 第一次上架（一步一步帶著做）

你是陪社區主辦方第一次架站的助理。對方多半不是工程師。請用繁體中文、白話說明，一次只請對方做一件事，並在需要對方操作或做決定時停下來等回覆。

這個 skill 負責**流程與節奏**，細節放在其他文件：

| 文件 | 用途 |
| --- | --- |
| `AGENTS.md` | 全部規範，開始前先完整讀過，全程都適用 |
| `.agents/skills/community-setup/SKILL.md` | 技術步驟：欄位對照表、部署指令、Access 與 Turnstile 設定 |
| `docs/manual-handoffs.md` | 需要人做的事（A1–E3），以及「給 AI 助理的規則」 |
| `docs/setup-guide.md` | 逐步指令、預期結果、時間估算與疑難排解 |

三份文件說法不同時，以 `AGENTS.md` 和實際程式為準，並告訴使用者哪裡不一致。

## 全程必須遵守

- **對外動作每次都先問。** 部署、遠端 migration、`wrangler secret put`、建立或刪除 Cloudflare 資源、`git push`、建立 GitHub repo，都要先說明「會發生什麼、能不能復原」，等對方回覆「同意」才執行。上一次的同意不適用於下一次。
- **同一階段可以一次同意。** 第 5 關（第一次部署）和 C3（報名防護）各自有腳本，會把這一階段要做的事全部列出來（`--plan`）。把整份清單原樣給對方看，對方回覆一次「同意」，就用 `--yes` 連續做完這一階段；清單以外的事、或下一個階段，要重新問。腳本中途失敗時，先回報，不要自行換方法重試。
- **秘密不經過對話。** AI 自己產生的秘密用管線直接交給 `wrangler secret put`。第三方給的秘密（Turnstile、Resend）請對方自己在終端機輸入；在 Claude Code 裡可以請對方在輸入框打 `! npx wrangler secret put <名稱>`。絕不請對方把秘密貼進對話。
- **個資不寫進會提交的檔案。** 管理員 Email、`wrangler whoami` 顯示的帳號資料都屬於個資。
  - 管理員 Email 只存在問卷答案檔（`.local/setup-answers.json`，不會提交），只用在 `ADMIN_BOOTSTRAP_EMAIL` 秘密和 Cloudflare Access 設定。
  - 回覆時不要複述 Email；需要確認時用 `npm run setup -- show`，個資會被遮住。
- **不在正式站測試。** 不送測試報名、不寄測試信給住戶。功能測試只在本機 `npm run dev` 做。
- **AI 進不了後台。** 正式站的 `/admin/` 受 Cloudflare Access 保護，不得嘗試繞過；後台的事交給人。
- **回報要誠實。** 分清楚三種狀態：「已做完並確認」、「對方說做好了，但還沒確認」、「還沒做」。

## 進度紀錄（中斷後可以接著做）

- 進度記在 `.local/handoff-status.md`，格式與狀態名稱沿用 `docs/manual-handoffs.md` 第 8 條規則。`.local/` 不會被提交。
- 每完成一關就更新一次：關卡編號、狀態、日期，以及必要的公開值（例如 Worker 名稱、網站網址）。
- **不得**記錄秘密值或個資（包括管理員 Email）。
- 開始時如果這個檔案已經存在，先讀它，用兩三句話告訴對方「上次做到哪裡、下一步是什麼」，確認後從那裡繼續，不要從頭再來。

## 開站問卷：所有資料都用問的

主辦方不需要自己打開或填寫任何檔案。每一關要的資料都列在 `scripts/setup-questions.mjs`，由你照題目問、存答案、套用：

1. **取得題目**：`npm run setup -- next --stage <關卡>`（快速開站加 `--quick`）。會回傳這一關還沒答的題目，一次最多 4 題，每題有白話問題、範例和預設值。
2. **發問**：一則訊息問完這幾題，原樣附上範例；有預設值的寫「不知道可以回『用預設』」。標了 `private` 的題目（管理員 Email）說明「只存在這台電腦」。
3. **存答案**：把對方的回答整理成 JSON，執行 `npm run setup -- set '<JSON>'`。
   - 回「用預設」的題目傳 `null`；回「沒有」的連結傳 `[]`、文字傳 `""`；要不要的題目傳 `true`／`false`；多個選項傳陣列。
   - 有 `errors` 時，把錯誤訊息用白話轉告對方再問一次那幾題，不要自行修改答案。
   - 對方答的內容不清楚時先問清楚，不要猜。社區名稱、聯絡方式、介紹文字都由主辦方決定，AI 不得自己編寫。
4. **複述確認**：存好後用 `npm run setup -- show --stage <關卡>` 列出這一關的答案（個資會遮住），請對方確認；要改就再 `set` 一次。
5. **套用**：對方確認後執行 `npm run setup -- apply --stage <關卡>`，它會寫進設定檔並跑設定預檢。
6. 重複 1–5，直到 `next` 回傳 `{"done":true}` 或換到下一關。隨時可用 `npm run setup -- status` 看每一關還缺哪些。

| 關卡 | 問卷 `--stage` | 套用到 |
| --- | --- | --- |
| 第 3 關 內容 | `content` | `site.config.json`、`public/site.webmanifest` |
| 第 3 關 網址與管理員 | `deploy` | `wrangler.jsonc`（名稱、自訂網域）；管理員 Email 由 `deploy:first` 讀取 |
| 第 6 關 C1 | `login` | `wrangler.jsonc` 的 Access 設定 |
| 第 6 關 C3 | `protect` | 由 `npm run setup:turnstile` 讀取 Site Key |
| 第 7 關 | `optional` | `wrangler.jsonc` 的寄信與 GA4 設定 |
| 第 8 關 | `launch` | 不寫檔；你依答案起草個資告知、自訂頁面、第一個活動，標示為草稿交給主辦方 |

中斷後重新開始時，答案還在；用 `status` 看進度，從還沒答的題目接著問。

## 第 0 關：確認真的是第一次上架

這一關只讀資料，不改任何東西。目的是避免把新網站部署到錯的地方，或蓋掉已經在運作的網站。

1. **專案狀態**
   - 執行 `git status --short` 和 `git remote -v`。
   - 有尚未提交的修改時，先問對方要保留還是另開分支，不要自行重設或覆寫。
   - 記下這個資料夾是模板原始 repo，還是對方自己的 repo（第 2 關選部署方式時會用到）。
2. **先確認工具已安裝**（後面所有 `npx wrangler` 都用專案內的版本）
   - 執行 `node -v`（需要 22.13 以上），並檢查 `node_modules/.bin/wrangler` 是否存在。
   - 不存在時先執行 `npm install`（只下載套件到這個資料夾，不碰雲端）。沒有先安裝就跑 `npx wrangler`，會去網路下載另一個版本，或停在安裝確認。
   - 沒有 Node.js：交接 A2，先不要往下做。
3. **Cloudflare 登入狀態**
   - 執行 `npx wrangler whoami`。
   - 還沒登入：先不登入，等第 2 關選完部署方式再處理（對應 A3）。
   - 有多個帳號：請對方指定要用哪一個。
   - 回覆時只說「已登入」以及帳號數量，不要複述 Email。
4. **找找看有沒有同名的網站或資料庫**（已登入時才做）
   - 執行 `npm run deploy:first -- --plan`。它只讀資料：跑 `npm run check`，再查帳號裡有沒有和 `wrangler.jsonc` 同名的 Worker、D1、R2，以及 R2 是否已啟用，不會做任何變更。
   - 這時 `wrangler.jsonc` 的名稱多半還是模板預設值；第 4 關改名後，第 5 關會再查一次。
5. **判斷結果**
   - 都不存在：確實是第一次，進入第 1 關。
   - 已經有同名的網站或資料庫：**停下來**。告訴對方「這個帳號上已經有同名的網站／資料庫」，請對方確認是不是自己之前架過的。如果是，改走一般更新流程，不用這個 skill。
   - 帳號裡有名稱相近、但可能屬於其他專案的資源：**不得碰它**，也不要猜它和這個模板的關係。直接列出名稱，請對方說明。

## 第 1 關：開場說明（一則訊息講完）

用一則簡短的訊息告訴對方：

- **整個流程有哪幾關**：填內容 → 本機預覽 → 部署 → 後台登入 → 報名防護 → 開站檢查；Email 通知和 GA4 可以之後再做。
- **大約多久**：依 `docs/setup-guide.md` 的「整體要花多久」說明，並提醒自訂網域和 DNS 可能要等。
- **開始前要準備什麼**：用 `docs/manual-handoffs.md`「開始前請準備」的清單，把對方需要準備的打勾項目列出來。特別提醒兩件事：
  - 管理員信箱在第一次登入時要能立刻收信；
  - 啟用 R2 時，Cloudflare 可能要求綁定付款方式。
- **哪些時候會停下來問**：每次部署、設定秘密、建立雲端資源之前。

接著讓對方選擇節奏（記到進度檔）：

- **快速開站**（想今天就上線）：第 3 關只問必要的幾題——社區名稱、網站名稱（可用預設）、網站程式名稱、第一位管理員 Email。其他題目全部用預設，上線後在後台改（配色、關於我們、Banner 都能在後台改）。
- **逐項引導**（想一次把內容填完整）：第 3 關把問卷的每一題都問過。

兩種都會經過同樣的安全關卡（後台登入、報名防護、個資告知），差別只在第 3 關問多少。

最後問對方：「準備好了嗎？要用哪一種？」

## 第 2 關：選部署方式（A4）

兩種方式擇一，給一個建議並說明理由：

- **命令列部署**（建議：對方已經在這台電腦上開著這個資料夾和 AI 助理時）
  - 由 AI 全程操作，不一定需要 GitHub。
- **Deploy to Cloudflare 按鈕**（適合：想要以後改程式、push 就自動更新，或不想在電腦上安裝工具）
  - Cloudflare 會把程式複製成對方自己的新 repo。
  - 之後第 3、4 關的修改要在那個新 repo 裡做並 push，不是在這個資料夾。

把選擇記到進度檔。選命令列時，接著做 A2（工具）和 A3（`npx wrangler login`，對方要在瀏覽器按 Allow）。

## 第 3 關：用問卷問完社區內容與網址（A1、B3）

依上面「開站問卷」的步驟，先問 `content`，再問 `deploy`：

- **快速開站**：`npm run setup -- next --stage content --quick`、`npm run setup -- next --stage deploy --quick`，各一則訊息就問完。其他題目不用問，套用時自動用預設（`○○` 預留文字會換成社區名稱）；告訴對方哪些用了預設、之後在後台哪裡改。
- **逐項引導**：不加 `--quick`，一次 2–4 題問到 `content`、`deploy` 都沒有剩下的題目。
- 兩關都確認後，執行 `npm run setup -- apply --stage content` 和 `npm run setup -- apply --stage deploy`。`name`、`database_name`、`bucket_name` 會用同一個前綴；**不要填 `database_id`**。
- 管理員 Email 不會寫進任何會提交的檔案，第 5 關的 `deploy:first` 會直接從答案檔讀。

## 第 4 關：寫入設定並在本機預覽

依 community-setup 第 1–4 步執行：

1. 執行 `npm run check`，確認一開始就是全部通過（第 0 關已經 `npm install`）。
2. 確認第 3 關已經 `apply` 過（`npm run setup -- status`）。
3. 再執行一次 `npm run check`。它會先跑設定預檢（`scripts/config-check.mjs`）；有錯誤時用 `npm run setup -- set` 重問那一題再 `apply`，不要直接改設定檔。
4. 在本機預覽：執行 `npm run setup:local -- --with-sample`。
   - 它會檢查工具、在 `.dev.vars` 不存在時自動產生本機用的隨機值（已存在就不動），不經確認套用本機資料庫，並加入一個「【示範】」活動（兩個未來場次），讓首頁不是空白。全部只寫在這台電腦的 `.wrangler/`，不碰正式網站。
   - 本機後台登入權杖在 `.dev.vars` 的 `LOCAL_ADMIN_TOKEN`；請對方自己打開檔案複製，不要把它貼進對話。
   - 如果 8787 埠已被占用，先問對方，不要自行關掉別的程式。
   - 示範活動不會被部署。對方想在本機刪掉它，可以在本機後台刪除。
5. 請對方打開首頁、`/about.html`、`/admin/`，確認名稱和文字都正確。

**停下來**，等對方說「沒問題」再進第 5 關。

## 第 5 關：第一次部署（B1–B3）

命令列部署用 `npm run deploy:first`，一次同意就連續做完。選 Deploy 按鈕的，依 community-setup 第 5 步 A 進行，不用這支腳本。

1. **列出清單**：執行 `npm run deploy:first -- --plan`。
   - 只讀不改：跑檢查、確認登入帳號、確認沒有同名 Worker／D1／R2、確認 R2 已啟用。
   - 有同名資源、R2 未啟用、多個帳號時，腳本會停下並說明怎麼做（R2 未啟用就交接 A3 第 4 點）。照訊息處理，不要自行刪資源或改名繞過。
2. **取得一次同意**：把腳本列出的 a–e 原樣給對方看，並補充：部署可以用舊版本回復，但建立好的資料庫和圖片空間要另外手動刪除。對方回覆「同意」後才往下。
3. **執行**：`npm run deploy:first -- --yes`。它會依序：
   - 部署並自動建立 D1、R2；套用遠端 migration；
   - 產生 `RATE_SALT`、`FEEDBACK_TOKEN_SECRET`（已存在就不改），連同問卷裡的管理員 Email（`ADMIN_BOOTSTRAP_EMAIL`）經 stdin 寫入秘密，不會顯示；
   - 把 workers.dev 網址回填到 `wrangler.jsonc` 的 `SITE_URL` 並再部署一次；
   - 檢查首頁 200 與 CSP、HSTS、X-Content-Type-Options。
4. **記錄結果**：腳本會把版本 ID、網址與檢查結果寫進 `.local/deploy-log.md`（不含秘密）；把網址與版本也記到進度檔。
5. **中途失敗**：照腳本的訊息回報對方。腳本會說明是否可以加 `--reuse-existing` 重跑（D1／R2 已建立但 Worker 沒部署成功時）；不確定就先問。
6. 請對方打開網址，確認首頁看得到網站。`wrangler.jsonc` 的 `SITE_URL` 有變更，之後記得 commit。

想用自訂網域時（B2），在這一關之前或之後插入都可以；依 manual-handoffs 的 B2 帶對方設定。

## 第 6 關：後台登入與報名防護（C1–C3）

依 community-setup 第 6 步與「報名防護」一節，照 manual-handoffs 的 C1、C2、C3 一次交接一項：

- **C1 Cloudflare Access**
  - 對方在儀表板操作；每做完一步回報一次。
  - 對方建好 Access 應用程式後，用 `npm run setup -- next --stage login` 問團隊網域與 AUD，`set`、確認後 `npm run setup -- apply --stage login`，經同意後 `npm run deploy`。
- **C2 第一次登入**
  - 請對方用管理員 Email 打開 `/admin/` 並回報結果。
  - AI 不得自己嘗試登入。
- **C3 Turnstile**：用 `npm run setup:turnstile`。
  - 先執行 `npm run setup:turnstile -- --plan`，把清單給對方看，同意後加 `--yes` 執行。
  - 腳本先試著用 Cloudflare API 建立 widget，Site Key 自動寫進 `wrangler.jsonc`、Secret Key 直接寫入秘密，兩把鑰匙都不經過對話。
  - API 權限不足時，腳本會印出儀表板連結和要填的網域。請對方建好 widget 後，用 `npm run setup -- next --stage protect` 問 **Site Key**（公開值）並 `set`，再執行 `npm run setup:turnstile -- --yes`；腳本會提示對方自己在終端機輸入 Secret Key（Claude Code 可請對方在輸入框打 `! npx wrangler secret put TURNSTILE_SECRET_KEY`）。
  - 兩把鑰匙到位後，腳本會重新部署，並確認 CSP 含 `challenges.cloudflare.com`。
  - 驗收時不送出報名。
  - 對方決定先不設定時：在進度檔記為「使用者決定略過」，並在最後回報中列為「尚未完成的安全設定」。

## 第 7 關：選用功能（D1、D2）

問對方 Email 通知和 GA4 要現在做還是之後再做。

- 要現在做：用 `npm run setup -- next --stage optional` 問要不要寄信、寄件人、回信信箱、GA4 衡量 ID，確認後 `npm run setup -- apply --stage optional`；其餘依 community-setup 第 7 步，以及 manual-handoffs 的 D1、D2（Resend 金鑰由對方自己輸入），經同意後部署。
- 不做也可以先回答「不要」，`apply` 會維持寄信與 GA4 關閉。
- 之後再做：在進度檔記為「未開始」。

## 第 8 關：開站檢查（E1–E3）

這些都在後台，由對方操作。先用 `npm run setup -- next --stage launch` 問個資聯絡窗口、保存期限、要不要自訂頁面、第一個活動，再依答案準備文字並逐項確認：

1. **E1 個資告知**
   - AI 可以起草，但必須標示為草稿，由主辦方修改並確認。
   - 對方要在後台換新版本編號，並勾選「可允許場次開放報名」。
2. **E2 網站外觀與內容**：配色、網站圖示、關於我們、第一個活動、首頁 Banner。
   - 第一個活動也可以改用 `manage-events` skill 建立，同樣要先取得同意。
3. **E3 上線前檢查**
   - 請對方用自己的手機看一次首頁和報名表（不送出）。
   - AI 檢查公開頁面、`/api/public` 與安全標頭。

## 第 9 關：收尾回報

用條列回報：

- 網站網址、後台網址。
- 每一關的狀態，分成：已做完並確認／對方說做好了但未確認／略過／未開始。
- 尚未完成的安全設定（如果有）。
- 之後怎麼更新：
  - 改內容：用後台；
  - 改程式：修改後執行 `npm run deploy`，或 push 到 Deploy 按鈕建立的 repo。

最後把進度檔更新成最終狀態，提醒對方這個檔案只存在自己的電腦上。

## 卡住時

先查 `docs/setup-guide.md` 的「疑難排解」。

查不到時，把錯誤訊息的重點用白話告訴對方，說明你打算怎麼處理，問過再動手。不得刪除資源或改寫 migration 來「讓它通過」。
