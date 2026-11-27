---
name: git-workflow
description: 本專案的 git 收尾流程：從最新的 main 開分支、依功能拆 commit、提交前掃描秘密與個資（repo 是公開的）、push、開 PR、等 GitGuardian 檢查通過才 merge 回 main，最後回到 main、同步並清掉已合併的分支。當使用者說「commit」「push」「開 PR」「merge 回 main」「完成後自動 commit & push 開 PR merge」「收尾」「回到 main」「把分支刪掉」時使用。部署不在這個流程內，要另外取得同意。
---

# Git 收尾流程：分支 → commit → PR → 檢查 → merge → 回到 main

開始前先讀 `AGENTS.md`，所有規範都適用。這個 repo 是**公開的**，推上去的內容任何人都看得到，也可能被快取或索引；刪掉分支也收不回來。

## 什麼時候可以動手

- 只有使用者要求時才 commit、push、開 PR、merge。
- 使用者說「完成後自動 commit & push，開 PR 自動 merge 回 main」時，就跑完整個流程。
  - 預設只適用於當次工作。
  - 使用者表示以後都這樣做（例如說「以後都這樣」，或在同一段對話中反覆要求）時，之後完成的工作也直接跑完整個流程。
  - 不確定時先問。
- 只說「commit」就只 commit；只說「push 並開 PR」就停在開完 PR。不要自動往下做。
- **merge 不等於部署。** 部署要另外取得同意，見最後一節。

## 1. 開工前

```sh
git status --short
git branch --show-current
```

- **不要直接在 `main` 上 commit。** 在 `main` 上而且有修改時，先開分支，修改會跟著帶過去：

  ```sh
  git switch -c <類型>/<簡短描述>
  ```

- 從乾淨的 `main` 開新工作時，先同步：

  ```sh
  git switch main && git pull --ff-only && git switch -c <類型>/<簡短描述>
  ```

- **分支命名**：
  - `feat/`：新功能或行為改變
  - `fix/`：修正錯誤
  - `docs/`：只改文件或截圖
  - `chore/`：工具、設定

  後面接英文小寫和 `-`，例如 `feat/home-events-by-date`、`docs/readme-about-page`。
- 有不是你改的、尚未提交的修改時，先問使用者，不得 `git reset`、`git checkout --` 或 `git stash` 掉。
- 不碰不是你建立的本機分支（例如 `local-history`）。

## 2. 提交前檢查

依修改範圍執行：

| 修改內容 | 要做的檢查 |
| --- | --- |
| `src/`、`public/`、`migrations/`、`scripts/`、`tests/` | `node scripts/check.mjs` 必須全部通過 |
| 介面或樣式 | 加做 `AGENTS.md`「修改後的驗收」的瀏覽器檢查（390／768／1280px 等） |
| 只改文件或截圖 | 不必跑程式測試 |
| skill | `.claude/skills/<名稱>/SKILL.md` 與 `.agents/skills/<名稱>/SKILL.md` 必須一模一樣：`diff -q .claude/skills/<名稱>/SKILL.md .agents/skills/<名稱>/SKILL.md` |

**檢查沒過就不要 commit。** 把失敗訊息告訴使用者，不得為了通過而改測試、觸發器或 migration。

## 3. 只加入要提交的檔案，並掃描秘密與個資

- 用路徑逐一加入，不要用 `git add -A` 或 `git add .` 把整個資料夾一起加：

  ```sh
  git add <檔案或資料夾> ...
  git status --short
  ```

- **絕不提交**：
  - `.dev.vars`、`.local/`、`.wrangler/`
  - 任何權杖、API 金鑰、`wrangler secret` 的值
  - `wrangler whoami` 的輸出

- **公開 repo 也不能出現**：
  - 真實姓名、電話
  - 個人 Email（示範資料只用 `example.com`、`.test` 網域）
  - Cloudflare 帳號 ID
  - 填了管理員 Email 的 `MY-COMMUNITY.md`

- **提交前掃描暫存區**：

  ```sh
  git diff --cached | grep -nEi '(secret|token|api[_-]?key|password)\s*[:=]|[A-Za-z0-9._%+-]+@(gmail|yahoo|hotmail|outlook|icloud)\.|BEGIN [A-Z ]*PRIVATE KEY'
  ```

  - 有結果時逐筆看。
  - 誤判（例如文件裡的變數名稱）可以繼續；真的是秘密或個資時，移出暫存區並告訴使用者。
  - 截圖也算：確認畫面上只有虛構資料。

## 4. Commit

- **一個 commit 只做一件事。** 混在一起的修改依功能拆成多個 commit。
  - 同一個檔案裡混了兩件事時，可以先產生 patch、只保留要的部分，再用 `git apply --cached` 暫存。
  - 不可使用需要互動的指令，例如 `git add -p`、`git rebase -i`。
- **訊息格式**：沿用 `git log` 的既有風格。
  - **標題**：英文、祈使句、首字大寫、不加句號，約 70 字以內。例如 `Order home page events by date, soonest first`。
  - **內文**：空一行後，用英文說明「為什麼改、行為有什麼不同」，每行約 72 字換行。
  - **署名**：最後加上你所用 AI 工具規定的署名行（例如 `Co-Authored-By:`）。工具沒有規定就不加。
- 用 heredoc 傳入訊息，避免引號問題：

  ```sh
  git commit -F - <<'EOF'
  <標題>

  <內文>
  EOF
  ```

## 5. Push 與開 PR

```sh
git push -u origin <分支>
gh pr create --base main --title "<與 commit 標題相同>" --body "<內文>"
```

- **PR 內文用繁體中文**，依序寫：
  - 改了什麼、為什麼；
  - 實際做過的驗證（跑了哪些檢查、在哪些寬度看過）；
  - 沒驗證的項目；
  - 需不需要重新部署。

  最後加上你所用 AI 工具規定的 PR 署名行（如果有）。
- 內文提到 GitHub 帳號時，除非真的要通知那個人，不要寫 `@名稱`。
- **push 被拒絕時**：不得 force push 到 `main`。
  - 自己的功能分支需要 `--force-with-lease` 時，先說明原因並取得同意。

## 6. 等檢查通過再 merge

這個 repo 的必要檢查是 **GitGuardian Security Checks**。`gh pr checks` 的結束碼：

- `0`：全部通過
- `8`：還在跑
- 其他：有失敗

macOS 沒有 `timeout` 指令，用迴圈等：

```sh
sleep 8
for i in $(seq 1 40); do gh pr checks <PR 編號> >/dev/null 2>&1; c=$?; [ $c -eq 8 ] && { sleep 5; continue; }; break; done
gh pr checks <PR 編號>; echo exit=$c
```

- **只有結束碼是 `0` 才 merge。**
- **檢查失敗**：不 merge。打開檢查連結看原因，告訴使用者。
  - 如果是秘密外洩，提醒使用者要**撤銷並更換那個秘密**。光是刪掉 commit 不夠，因為內容已經公開。
- **等太久還在跑**：停下來回報，不要直接 merge。

## 7. Merge 並回到 main

```sh
gh pr merge <PR 編號> --merge --delete-branch
git switch main
git pull --ff-only
git fetch --prune
git ls-remote --heads origin
git branch
```

- 使用 `--merge`（保留 merge commit），沿用 `git log` 裡 `Merge pull request #N` 的歷史樣式。不要改成 squash 或 rebase，除非使用者要求。
- `--delete-branch` 會刪掉遠端和本機的功能分支；`git fetch --prune` 會清掉已不存在的遠端追蹤分支。
- 確認以下三件事：
  - 遠端只剩 `main`（或使用者自己的其他分支）；
  - 本機在 `main`，而且和 `origin/main` 同步；
  - `git status --short` 是空的。
- **有衝突、無法 merge 時**：停下來，說明是哪些檔案衝突，問使用者要怎麼處理。不要自行選邊覆蓋。

## 8. 部署是另一件事

- 合併進 `main` 不代表正式網站已更新。
- 用 Deploy to Cloudflare 建立的站，會在 push 後由 Workers Builds 自動部署。其他情況要另外執行 `npm run deploy`。
- 要部署前，依 `AGENTS.md`「部署與回復」：
  - 先取得同意；
  - 記錄目前版本：`npx wrangler deployments list`；
  - 確認 `wrangler.jsonc` 的 `name` 和資料庫真的存在於使用者的帳號。不存在代表還沒上架過，改用 `first-launch` skill。
- **只改文件時不重新部署。**

## 9. 回報

用幾行告訴使用者：

- PR 網址，以及檢查結果（例如 GitGuardian 通過）；
- 已 merge 的 commit（`git log --oneline -1`）；
- 目前所在分支，以及是否與遠端同步；
- 實際做過的驗證，以及沒驗證的項目；
- 是否需要部署、有沒有部署。
