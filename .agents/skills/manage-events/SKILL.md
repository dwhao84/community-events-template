---
name: manage-events
description: 用對話直接新增活動（場次、收費、名額、報名表、封面），或隱藏／取消隱藏活動，不必打開後台。AI 先產生 SQL 檔，在本機預覽確認後，經使用者同意再寫進正式網站的資料庫。當使用者說「新增一個活動」「幫我加一場課程」「上架活動預告」「把 XX 活動隱藏」「活動先不要顯示」「把活動重新顯示」時使用。改既有場次的時間、地點、名額，或刪除活動，請主辦方用後台操作。
---

# 新增、隱藏活動

你是協助社區主辦方（多半不是工程師）管理活動的助理。用繁體中文、白話說明每一步；要寫入正式網站前一定先停下來取得同意。開始前先讀 `AGENTS.md`，全部規範都適用。

## 先知道的事

- 這些操作也都能在後台完成：「活動與場次 → 新增活動」精靈，以及活動列表的「隱藏」按鈕。用這個 skill 是為了讓主辦方用一句話完成，規則和後台相同。
- 活動資料**不寫成 migration**。`migrations/` 只放資料庫結構，以後從模板更新時才不會撞號。這裡是用 `scripts/event-sql.mjs` 產生 SQL 檔，存到 `.local/data-changes/`（不會提交，也不含個資），再用 `wrangler d1 execute` 執行。
- **隱藏**（`events.hidden=1`）：前台看不到活動和連到它的首頁 Banner；已報名的人不受影響，提醒信照常寄出，主辦方仍可在後台代填報名。隱藏不是取消活動。要通知參加者活動取消，請到後台把場次改成「已取消」。
- 時間一律以台灣時間跟使用者確認，腳本會換成資料庫用的 UTC 格式。
- **不得**在正式網站建立測試報名。

## 新增活動

### 1. 問清楚內容（沒講的就問，不要猜）

| 項目 | 說明 |
| --- | --- |
| 活動名稱、介紹 | 必填 |
| 場次 | 每場的日期、開始與結束時間（台灣時間）；可以有多場 |
| 地點、名額 | 還不確定就寫「待定」、名額 0 |
| 收費 | `free`（免費）、`paid`（每人 N 元，可加備註，例如「含材料費」）、`tbd`（待定） |
| 每筆報名最多幾人 | 預設 10 |
| 主辦方聯絡方式 | 要開放報名就必填 |
| 是否開放報名 | 開放需要：名額大於 0、地點與收費都已確定、有聯絡方式 |
| 封面（選用） | PNG 或 JPEG 原圖與縮圖（寬 800 左右）。macOS 可用 `sips -Z 800 原圖 --out 縮圖`。含文字的海報不要裁切 |

報名表預設和後台精靈相同（姓名、Email、電話、參加人數）。要加題目時，照 `src/lib.js` 的 `validateFields` 格式寫 `fields`，姓名與 Email 必須保留。

### 2. 寫 spec、產生 SQL

把內容寫成 JSON，放在 `.local/`：

```json
{
  "title": "手機防詐小教室",
  "description": "……",
  "notes": "請攜帶手機。",
  "contact": "社區管理中心 02-1234-5678",
  "sessions": [
    {"date": "2027-01-10", "start": "14:00", "end": "15:30", "location": "社區活動中心 1 樓",
     "capacity": 30, "fee_type": "free", "max_seats_per_registration": 4, "registration_open": true}
  ],
  "cover": {"file": ".local/cover.png", "thumbnail": ".local/cover-thumb.png", "caption": "手機防詐小教室海報"}
}
```

可選欄位：`status`（預設 `published`；只想先存草稿可填 `draft`）、場次的 `end_date`（跨日）、`fee_amount`、`fee_note`、`supplies`（攜帶物品）、`opens_at`／`closes_at`（`"2026-12-20 09:00"`）、`reminder_time`（預設 `09:00`，前一天寄提醒）。

```sh
node scripts/event-sql.mjs add .local/<spec>.json --print   # 先看 SQL
node scripts/event-sql.mjs add .local/<spec>.json           # 寫入 .local/data-changes/，並印出檔名、活動 id、要上傳的圖片
```

腳本會沿用後台的收費、人數上限與報名表規則檢查。內容不合格時會直接報錯，照錯誤訊息跟使用者確認後修正。

### 3. 本機預覽

```sh
npx wrangler d1 execute DB --local --file .local/data-changes/<檔名>.sql
npx wrangler r2 object put <bucket>/<key> --file <檔案> --content-type <mime> --local   # 有封面時，依腳本輸出的 r2_uploads 逐一上傳
npm run dev
```

`<bucket>` 是 `wrangler.jsonc` 裡 `r2_buckets[0].bucket_name` 的值。請使用者打開 http://localhost:8787 用手機和電腦寬度確認：活動卡片、日期時間、收費標示、封面完整，以及報名按鈕狀態符合預期。

### 4. 寫入正式網站（先取得同意）

跟使用者說明「要把這個活動加到正式網站」，同意後再執行：

1. 備份：`npx wrangler d1 export DB --remote --output .local/backups/before-<檔名>.sql`（備份含報名個資，只留在 `.local/`）。
2. 要開放報名的話，先確認營運設定已開啟，否則前台不會收報名：
   `npx wrangler d1 execute DB --remote --command "SELECT value FROM settings WHERE key='operating_ready'"`
   結果不是 `true` 時，請主辦方先到後台「營運設定」完成個資告知並開啟。
3. 有封面就先上傳圖片：同上面的 `r2 object put` 指令，把 `--local` 換成 `--remote`。
4. `npx wrangler d1 execute DB --remote --file .local/data-changes/<檔名>.sql`
5. 驗證：`curl -s <SITE_URL>/api/public`（`SITE_URL` 見 `wrangler.jsonc`；沒有的話問使用者網址）應出現新活動，時間和收費正確。請使用者用手機打開首頁看一次。

同一個新增檔**不要重複執行**；重跑會因為 id 重複而失敗，不會多建一份。

## 隱藏或取消隱藏

1. 列出活動，請使用者確認是哪一個（只查活動和人數，不查個資）：

   ```sh
   npx wrangler d1 execute DB --remote --command "SELECT e.id,e.title,e.status,e.hidden,(SELECT MIN(starts_at) FROM event_sessions s WHERE s.event_id=e.id) first_session,(SELECT COUNT(*) FROM registrations r JOIN event_sessions s ON s.id=r.session_id WHERE s.event_id=e.id AND r.status IN('pending','confirmed','waitlisted')) active_regs FROM events e WHERE e.deleted_at IS NULL ORDER BY e.created_at DESC"
   ```

   還在本機操作時，把 `--remote` 換成 `--local`。

2. 有人報名（`active_regs > 0`）時提醒使用者：隱藏只是前台看不到，這些人**不會**收到通知，活動照常進行。如果其實是要取消活動，請改到後台取消場次。
3. 產生 SQL：`node scripts/event-sql.mjs hide <活動 id>`（取消隱藏用 `show`）。
4. 經使用者同意後：備份（同上），再執行 `npx wrangler d1 execute DB --remote --file .local/data-changes/<檔名>.sql`。
5. 驗證 `<SITE_URL>/api/public` 已經沒有（或重新出現）該活動。隱藏的 SQL 重複執行也沒關係。

## 回報

- 告訴使用者：活動名稱與 id、做了什麼（新增／隱藏／取消隱藏）、是否已寫入正式網站、備份檔位置，以及實際確認過的項目。
- 如何復原：新增的活動可在後台「刪除」（之後也能復原）；隱藏的活動可在後台按「取消隱藏」，或用 `show` 指令。
- 不需要 `npm run deploy`，這些操作只改資料，不改程式。
