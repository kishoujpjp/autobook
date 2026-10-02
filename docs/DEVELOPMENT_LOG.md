# 自動繪本開發記錄

本檔記錄開發、驗證與發布結果，含 v1.32.0 故事收件匣起的歷程；更早功能保留於 [README](../README.md)，維護規則與交接見 [HANDOFF](HANDOFF.md)。日期／時間使用 UTC+8。v1.32.0／v1.32.1 條目於 2026-10-03 依 Git 提交與既有操作文檔補錄，不補造當時的實機測試或部署版本 ID。

## 2026-10-02 — v1.32.0：線上推送故事到 iPad

功能提交：[`15136ae`](https://github.com/kishoujpjp/autobook/commit/15136aebaee7597b362499c0da2f7fca1cbeab5b)（22:30:30）。

- 新增私人 Cloudflare Worker + R2 故事收件匣，讓 Codex 對話產生的故事與圖片可以先送到雲端，再由 iPad App 接收。Mac 與 iPad 不必同網路或同時開機；App 關閉時內容留在雲端等候。
- 新增 `tools/inbox-upload.mjs` 的設定、配對、上傳與接收狀態查詢操作，完整步驟記於 [收件匣操作文檔](../cloud/inbox/README.md)。Mac 保留寫入權限，App 只取得讀取／回條權限；私人憑證不進 Git 或完整資料備份。
- App 開啟、回前景、恢復連線時自動檢查；前景每分鐘檢查，家長設定頁亦可立即接收。這是 App 拉取雲端收件匣，並非 iOS 系統背景推播；關閉的 App 不會被喚醒。
- 故事與全部圖片落盤後才回報接收成功。圖片縮為最長邊 1280 JPEG，存 IndexedDB，離線仍可閱讀／點讀／揭曉；多圖按閱讀次數依序解鎖。
- 固定故事 id 防重傳；相同 id 和相同內容可重試，不同內容回 409。刪書後接收紀錄仍在，不會自動收回；重新送書須新 id。書架滿時停止接收並提示。
- 第一台裝置收好七天後，Worker 每小時第 17 分鐘清理雲端故事與圖片，保留回條與防重傳紀錄；未收到的故事保留，App 已落盤的書不受影響。
- 增加格式上限、檔案驗證、原子接收、失敗清理與字庫／備份整合，並新增 `tests/inbox.test.js`、`tests/inbox-store.test.js`。既有測試隨 v1.33.0 的 51 項回歸全部通過。

## 2026-10-02 — v1.32.1：收件匣正式網域修正

修正提交：[`de582cc`](https://github.com/kishoujpjp/autobook/commit/de582cc221cf836fb76722267a245eea0fe1b8bf)（22:40:12）。

- 為避開當時網路對 workers.dev 的 DNS 錯誤解析，正式入口改為 `https://autobook-inbox.daizukan.app`，增加 Worker 自訂網域路由並同步 App URL 驗證、CSP 與配對／部署操作文檔。
- 沿用同一收件匣與私人 R2；新配對使用正式網域，不需更換故事 id 或重建雲端資料。App 仍相容 workers.dev 網址，但後續操作統一使用正式網域。
- 2026-10-03 v1.33.0 發布時再次部署該入口並確認 health 正常；具體 Worker 版本與新版 App 安裝結果見下方 v1.33.0 記錄。

## 2026-10-03 — v1.33.0：繁體儲存與詞組轉換

功能提交：[`c57bd1a`](https://github.com/kishoujpjp/autobook/commit/c57bd1af37b22bf9781d67bde198c203baec28c8)。

### 問題與決策

既有逐字簡轉繁會重新轉換合法繁體，使 `吃 → 喫`、`皇后 → 皇後`、`公里 → 公裏`、`干涉 → 幹涉`、`游泳 → 遊泳`。收件匣與接收端也有重複轉換的風險。沿用「底層一律繁體，簡體僅用於顯示」的產品策略，將來源判定、入庫轉換、顯示轉換與舊資料修復分開。

### 實作

- 固定 OpenCC JS 1.4.2，離線使用完整詞組與臺灣字形規則；新增 vendor 產生腳本及授權檔，build 自動重產。
- `convertTo(..., 'zh-Hant')` 保留原文。`toStoredTraditional()` 依明確來源或簡體專有字判斷入庫；共用字形不猜語系，保護繁體人名及合法用詞。
- 手動新增／編輯加入「輸入字形」選項；全共用字形的簡體 `面包工厂后天` 明確標示後轉成 `麵包工廠後天`。繁體編輯原文未修改的欄位不再次轉換。
- 新增 `text-policy.js` 共用故事入庫、明確詞組修復、字表遷移；故事固定 `lang: 'zh-Hant', textPolicy: 1`。AI 與示範故事同樣存繁體。
- 舊故事改動前保留完整 `textBackup`，字表重寫前保留 `autobook.textBackup`，備份匯出／匯入包含兩者。字元數不變保留索引；文字變動重建多音字資訊，保留媒體、已讀次數與 IDB 原音訊。
- 字表合併保留各帳號熟悉度，紅綠取最新、計數取較大值；備份失敗不重寫字表。
- 簡體閱讀標色、點讀與音訊依底層原字識別，`發／髮` 同顯示 `发` 仍保持獨立。僅一對一字形相容舊音訊鍵。
- Worker 入庫轉一次並標記 manifest；App 保留已標記繁體，未標記舊包才修復。SW 納入新增 runtime 模組，App／套件／Xcode／SW 同步升至 v1.33.0。

### 驗證結果

| 驗證 | 結果 |
|---|---|
| ESLint | 通過 |
| `npm test` | 51 項全部通過；含 8000 常用繁體詞保留、詞境轉換、索引長度、遷移備份／配額失敗、收件匣不二次轉換 |
| `npm run build`、Capacitor sync | 通過；source／dist／iOS public 的 OpenCC vendor 一致 |
| Worker dry-run | 通過；bundle 2294.51 KiB，gzip 585.02 KiB，R2 與 origin 綁定正確 |
| 實際瀏覽器操作 | 簡體介面仍編輯繁體底層；舊字形修復、手動新增、明確簡體輸入正常；`發／髮` 顯示同字但紅綠獨立；console 無錯誤／警告 |
| `git diff --check` | 通過 |

### 上線結果

- 已 push `main`；[GitHub Actions 本次執行](https://github.com/kishoujpjp/autobook/actions/runs/37037419803) 成功（2026-10-03 00:57:57）。
- [網頁版](https://kishoujpjp.github.io/autobook/) 正式站 `js/store.js`、`sw.js`、`js/zhconv.js`、`js/text-policy.js`、`js/vendor/opencc.js` 均 HTTP 200，SHA-256 與本次 `dist/` 相同。
- Cloudflare Worker `autobook-inbox` 已部署，版本 ID `da1fd09e-99dc-4286-bb66-f43766b97d6f`；自訂網域 `autobook-inbox.daizukan.app` health 回應正常。保留既有 R2、憑證與配對，未重設秘密。
- iPad `Kipad Pro 12.9` 自動部署完成（2026-10-03 00:58:05），App `com.kishou.autobook` **v1.33.0／build 73**。安裝日誌成功，devicectl 查詢實際安裝版本與建置號一致。

### 後續維護界線

- 明確繁體來源不轉換；全共用字形的簡體需指定來源。舊逐字誤轉可能喪失詞意，修復僅覆蓋明確詞組及異體字，原文備份用於後續人工核對。
- 本次 iPad 驗證範圍為建置、安裝與版本查詢；未讀取裝置上的私人資料，實際舊資料遷移在新版載入時執行。
- 本機 `.inbox/` 與未追蹤的使用者圖片均未提交或發布。純文檔後續提交可能觸發 iPad 重簽並增加 build 號，以上 build 73 指本次功能上線的已驗證結果。

## 2026-10-03 — 交接文檔與開發記錄整理

- 新增本記錄及 `docs/HANDOFF.md`，整理 v1.33.0 的儲存／顯示規則、共用字形限制、備份與遷移、收件匣邊界、驗證方法及發布證據。
- README 首頁版號更新至 v1.33.0，補入文檔入口、字形修正摘要與資料欄位，修正改版流程序號並補上 Worker／iPad 核對要求。
- 此次僅更新 Markdown；App 版本維持 v1.33.0。
- 補錄 v1.32.0 線上故事推送與 v1.32.1 正式網域修正，交接文檔新增日常送書／回條核對流程，保留原始提交日期與可查證的證據範圍。
