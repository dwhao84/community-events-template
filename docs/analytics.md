# GA4 網站分析（選用）

## 啟用

網站端已支援 GA4，預設關閉。沿用 Google tag，不額外安裝 Firebase SDK，避免重複初始化。建立 GA4 資源與報表需要該 Google Analytics 帳戶的編輯權限；本專案不會自動建立或修改 Google 帳戶。

1. 在 Google Analytics 建立資源，報表時區選「台灣」，幣別 TWD；建立網站串流，網址填你的 `SITE_URL`。
2. 在該串流關閉「加強型評估」全部選項，包含頁面歷史變更、捲動、外連、站內搜尋、影片、下載及表單互動。本網站自行送出 page_view、表單與外連事件，避免誤收、重複及不必要資料。維持 Google Signals、廣告個人化與使用者提供資料收集關閉。
3. 把串流衡量 ID（G- 開頭，公開設定，非密鑰）填入 `wrangler.jsonc` 的 `vars.GA4_MEASUREMENT_ID`，並確認 `SITE_URL` 已填，執行既有檢查及部署。
4. 在正式網址使用分析偏好選擇「允許分析」，以 Tag Assistant 開啟測試，再在 DebugView 與即時報表驗證。不要在正式設定永久開啟 debug_mode。清除瀏覽器分析同意即可重測首次訪問。
5. 完成下列 GA4 設定與人工驗收後再開始營運讀數。撤回方式是將衡量 ID 清空後重新部署；既有訪客下次載入即停用。

若程式未部署或未填入 ID，應只視為網站端準備完成，不應宣稱 GA4 已上線。Realtime、DebugView 及 Google 報表設定目前需在帳戶內完成。

## 事件與參數

| 事件 | 時機 | 參數 |
| --- | --- | --- |
| page_view | 同意後，每次頁面載入一次 | 固定標題、去除 query/hash 的 page_location 與 page_referrer |
| section_view | safety、activities、about 區塊 50% 可見連續 1 秒 | section_name |
| cta_click | 主導覽與兩張主視覺的連結 | entry_point、section_name |
| event_view | 活動卡片 50% 可見連續 1 秒 | event_id |
| registration_open | 表單成功載入 | event_id、activity_session_id、entry_point |
| registration_start | 開表後第一次 input/change，包含勾選同意 | 同上 |
| registration_submit | 實際發送 API 前；重試可再計 | 同上 |
| registration_success | API 成功，同一提交識別碼每頁最多一次 | 同上、registration_status、participant_count |
| registration_error | 表單載入或提交失敗 | 同上、error_type |
| photo_view | 開啟活動照片 | event_id |
| mascot_open | 開啟吉祥物面板 | 無 |
| mascot_action | 吉祥物操作／外連 | action |
| outbound_click | LINE、叮咚網站 | destination、entry_point |

使用 `activity_session_id` 表示活動場次，避免與 GA4 自身的工作階段 session_id 混淆。entry_point 為 navigation、hero_safety、hero_ai、activity_card、mascot；destination 為 line、dingdong；error_type 為 form_changed、rate_limited、conflict、validation、server、network。不傳原始錯誤文字。

曝光以每次頁面、每個活動／區塊去重；切到背景分頁會中斷 1 秒計時，活動重新整理不重計已曝光項目。開表失敗不算 registration_open。沒有後端 Measurement Protocol、使用者識別碼或跨裝置身分比對。

## 同意、資料與失敗行為

- localStorage 的 `dn_analytics_consent` 保存 granted/denied 與 180 天到期日。無選擇、拒絕或過期時，不載入 Google tag，也不傳 cookieless ping；同意之前的操作不補送。
- 拒絕後可由頁尾重新選擇；分析同意與報名的個資同意彼此獨立。
- 撤回會即時設 ga-disable、停止本模組、清除本站可存取的 `_ga`／`_ga_*` Cookie 並重新載入。已送往 Google 的歷史資料不會因此刪除。
- 撤回時如報名視窗開啟或正在送出，立即停用追蹤並保留當前頁面與答案；關閉報名視窗且請求完成後才重新載入。不再把表單答案暫存至 sessionStorage。瀏覽器儲存空間被停用時，同樣保留填寫內容。
- 後台不載入模組；設定端點僅在 production、主機等於 `SITE_URL`（未設定時為目前網址）且不是本機位址時回傳有效 ID，本機開發不追蹤。公開頁面的 CSP 僅增加必要 Google 端點，後台與 API 維持原本限制。
- 追蹤只接受事件及參數白名單，不傳姓名、Email、電話、表單答案、報名編號、提交識別碼、照片說明或完整 LINE 邀請網址。
- page_location 和 page_referrer 去除 query/hash。來源僅取 utm_source、utm_medium、utm_campaign、utm_id、utm_term、utm_content，值限制英數、底線及連字號（1–100 字）；不接受其餘網址參數。推廣連結不得在 UTM 中放個資。廣告自動標記參數不納入本版本。
- Google 程式被阻擋或設定無效時，報名照常運作。GA4 僅涵蓋同意且可追蹤的訪客，實際人數、筆數與確認狀態以後台為準。

## GA4 報表設定

- 將 `registration_success` 設為關鍵事件，計算方式選「每次事件」，不要使用「每個工作階段一次」，以保留同次造訪的不同報名。
- 建立事件範圍自訂維度：event_id（活動）、activity_session_id（場次）、entry_point（入口）、registration_status（報名狀態）、section_name（區塊）、action（操作）、destination（外連）、error_type（錯誤分類）。
- 建立事件範圍自訂指標 participant_count（參加人數，標準單位）；只在 registration_success 上加總。
- 流量開發報表依「工作階段來源／媒介」及「工作階段廣告活動」比較工作階段、互動工作階段、registration_success 與關鍵事件率。
- 建立漏斗探索：event_view → registration_open → registration_start → registration_success；使用間接後續步驟。各場次各自建立已篩選的探索（所有報名步驟 activity_session_id 相同；曝光步驟 event_id 篩選所屬活動），不把不同場次混成同一條漏斗。曝光是活動層級，並非場次曝光。
- 嚴格「同一工作階段、同一場次」完成率，使用工作階段區隔限定該場次的 start 與 success 依序發生；分子為符合成功序列的工作階段數，分母為該場次有 start 的工作階段數。GA4 漏斗預設的使用者計數不要直接命名為此工作階段完成率。
- 依場次或 entry_point 比較漏斗。報名成功的 pending／waitlisted 是收件結果，不等於 confirmed 或實際出席；LINE 外連只代表點擊，無法證明加入群組。
- UTM 範例：`https://<你的網址>/?utm_source=line&utm_medium=social&utm_campaign=handcraft_202612`。上線至少兩週後建立基準，暫不指定轉換率目標。

## 驗收

自動：`node scripts/check.mjs`（亦為 `npm run check` 內容）驗證語法、分析隔離／同意／白名單／CSP、既有測試與 SQLite migration 及名額觸發器。

正式環境人工：

1. 首次未選及拒絕：Network 不得出現 googletagmanager、google-analytics 或 collect 請求；瀏覽與報名正常。
2. 允許／再次造訪：每次載入只有一筆 page_view；錨點、輪播、開表不增加瀏覽量。同意前點擊不補送。
3. 曝光不足 50%、不足 1 秒或分頁隱藏時不計；達標後每頁只記一次，活動成功刷新亦不重計。
4. 分別從活動卡及吉祥物開表，確認場次、活動及入口一致；第一次修改一次 start，重複修改不重計。
5. 一般及候補成功各測一次，狀態與人數正確；快速雙擊只產生一個 API 請求及成功事件。驗證失敗後重試、表單版本更新及載入錯誤只送固定錯誤類型。
6. 填表中撤回後，Cookie 清除、無新 collect、開啟中的表單維持原樣；關閉後才重載。另測請求進行中撤回時不重載、不丟失表單。
7. 外部連結、照片及吉祥物事件正確；請求中無表單內容、完整邀請網址、敏感 query/hash。
8. 阻擋 Google 請求時仍可報名；後台、本機、staging 不追蹤。用手機檢查提示按鈕、頁尾入口與報名視窗可正常操作。

官方參考：[事件](https://developers.google.com/analytics/devguides/collection/ga4/events)、[page_view](https://developers.google.com/analytics/devguides/collection/ga4/views)、[加強型評估](https://support.google.com/analytics/answer/9216061)、[CSP](https://developers.google.com/tag-platform/security/guides/csp)。

