---
name: update-sessions
description: 用對話調整既有場次：開放或截止報名、改日期時間、地點、名額、收費、每筆人數上限、攜帶物品、報名開放與截止時間，或取消場次。規則和後台場次編輯相同，名額不會低於已報名人數；提醒信會依新時間重排；改時間地點或取消時，提醒主辦方寄通知。當使用者說「XX 活動開放報名」「報名截止」「改到下午兩點」「換到二樓教室」「名額加到 40 人」「改成每人 100 元」「這場取消」時使用。新增或隱藏整個活動用 manage-events。
---

# 調整場次

你是協助社區主辦方（多半不是工程師）的助理。用繁體中文、白話說明；寫入正式網站前一定先停下來取得同意。開始前先讀 `AGENTS.md`，全部規範都適用。

## 先知道的事

- 這些都能在後台「活動與場次」完成，這個 skill 讓主辦方用一句話完成，規則相同。
- 每次修改都會讓場次的 `revision` 加 1。資料庫會取消舊的提醒信，並依新時間重建（活動前一天寄出）。
- 名額不能少於「待確認＋已確認」的人數。腳本會先擋下，資料庫也會再擋一次。
- 名額增加時，**候補不會自動轉正**，請主辦方到後台報名名單確認。
- 改時間、地點或取消場次時，系統**不會自動寄信**。完成後請主辦方到後台「通知中心」寄「活動資訊更新」或「活動取消通知」（需要已設定 Email）。
- 取消後的場次不能再用這個 skill 修改，請到後台處理。
- 不得在正式網站建立測試報名。

## 步驟

### 1. 找到場次

```sh
npx wrangler d1 execute DB --remote --command "SELECT s.id,e.title,datetime(s.starts_at,'+8 hours') starts_tw,s.location,s.capacity,s.fee,s.status,s.registration_open FROM event_sessions s JOIN events e ON e.id=s.event_id WHERE e.deleted_at IS NULL AND s.ends_at>datetime('now') ORDER BY s.starts_at"
```

還在本機操作時，把 `--remote` 換成 `--local`（以下相同）。請使用者確認是哪一場。

### 2. 取得場次目前的資料

把 `<場次 id>` 換掉，輸出存成檔案：

```sh
npx wrangler d1 execute DB --remote --json --command "SELECT s.*,e.title,e.contact event_contact,e.status event_status,e.deleted_at,COALESCE(s.form_id,e.default_form_id) active_form_id,(SELECT value FROM settings WHERE key='operating_ready') operating_ready,(SELECT COALESCE(SUM(seats),0) FROM registrations r WHERE r.session_id=s.id AND r.status IN('pending','confirmed')) occupied,(SELECT COUNT(*) FROM registrations r WHERE r.session_id=s.id AND r.status='waitlisted') waitlisted FROM event_sessions s JOIN events e ON e.id=s.event_id WHERE s.id='<場次 id>'" > .local/session-current.json
```

這份資料只有場次設定和人數，沒有報名者個資。

### 3. 寫下要改的內容

存成 `.local/session-change.json`，只寫要改的欄位：

| 欄位 | 說明 |
| --- | --- |
| `date`、`start`、`end`、`end_date` | 台灣時間，`"2027-01-10"`、`"14:00"`；只改時間可以不寫日期 |
| `location` | 地點 |
| `capacity` | 名額（整數） |
| `fee_type`、`fee_amount`、`fee_note` | 收費：`free`、`paid`（每人金額）、`tbd`（待定） |
| `max_seats_per_registration` | 每筆報名最多幾人 |
| `supplies` | 攜帶物品 |
| `registration_open` | `true` 開放報名、`false` 截止 |
| `opens_at`、`closes_at` | 自動開放／截止時間，`"2026-12-20 09:00"`；填 `null` 代表取消設定 |
| `reminder_time`、`reminder_enabled` | 提醒信時間（預設 `"09:00"`）、是否寄提醒 |
| `cancel` | `true` 代表取消這場（同時停止報名） |

例如：`{"start": "14:00", "end": "15:30", "location": "社區活動中心 2 樓"}`

### 4. 產生 SQL

```sh
node scripts/session-sql.mjs .local/session-current.json .local/session-change.json --print   # 先看
node scripts/session-sql.mjs .local/session-current.json .local/session-change.json           # 寫入 .local/data-changes/
```

腳本會列出每個欄位修改前、修改後的值（`changed`），以及要提醒主辦方的事（`notify`、`waitlist`）。內容不合格時會說明原因，例如開放報名還缺地點、收費、名額、聯絡方式，或「營運設定」還沒開啟。這些要請主辦方到後台補上，不要繞過。

把 `changed` 用白話念給使用者確認，例如「時間從 1/17 09:00 改成 10:00，地點從活動中心改成二樓教室」。

### 5. 寫入（正式網站要先取得同意）

1. 備份：`npx wrangler d1 export DB --remote --output .local/backups/before-<檔名>.sql`
2. `npx wrangler d1 execute DB --remote --file .local/data-changes/<檔名>.sql`
3. 確認：重新執行第 2 步的查詢，`revision` 應該加 1，欄位也是新的值。如果沒變，代表有人剛在後台改過同一場次，這次更新沒有套用（SQL 有防覆蓋檢查）。請重新從第 2 步開始。
4. 打開網站首頁，確認場次卡片已更新。

## 回報

- 改了哪一場、哪些欄位（修改前 → 修改後）、是否已寫入正式網站、備份位置。
- 有 `notify` 時，明確請主辦方到後台「通知中心」寄信，並說明這次**沒有**自動通知已報名的人。
- 有 `waitlist` 時，請主辦方到後台處理候補。
- 這些操作只改資料，不需要 `npm run deploy`。
