# 自動繪本開發記錄

本檔記錄開發、驗證與發布結果，含 v1.32.0 故事收件匣起的歷程；更早功能保留於 [README](../README.md)，維護規則與交接見 [HANDOFF](HANDOFF.md)。日期／時間使用 UTC+8。v1.32.0／v1.32.1 條目於 2026-10-03 依 Git 提交與既有操作文檔補錄，不補造當時的實機測試或部署版本 ID。

## 2026-10-07 — v1.38.1：iPad 橫向字／詞卡遮擋修正

- 使用者實機回報詞語卡在 iPad 橫向遮擋 UI。重現二字詞在 1366×1024 點字放大時，上緣跨過頁首、下緣壓入翻卡列；原版字卡只以整個 viewport 的 vh／vw 定尺寸，未扣除固定 UI、安全區或放大回饋。
- 卡區增加 size container 與內距，字／詞卡改用 cqh／cqw 與字數計算上限；保留原大字與放大效果，預留 1.14 倍縮放、陰影和焦點環。頁首、翻卡列保持原尺寸，卡片間距跟隨卡區寬度。未變動字表、熟悉度、複習、計數、語音或鍵盤控制。
- `tools/flash-layout-audit.mjs` 用合成資料在隔離 Chromium 檢查 240 組：6 個 viewport（含 1366×1024／1366×980／1194×834／1024×768 橫向）、家長／小孩、0／24px 安全區、1–5 字、正常／放大。直接量測卡片完整性、與 UI 的交集、可用按鈕實際點擊對象，另驗證同張字卡旋轉不換題；無 pageerror。主機無 Playwright WebKit 執行檔，不將 Chromium 當作實機視覺驗證。
- lint、79／79 自動測試、build、cap sync 及 diff 檢查通過；App／SW／package／lock／Xcode 版號同步為 v1.38.1。正式發布與實際 iPad 版本由當次發布結果另行記錄。

## 2026-10-06 — v1.38.0：鍵盤控制（本機待發布）

- 閱讀、認字卡與詞語卡可用 ←／→、Page Up／Page Down 前後翻；閱讀增加 Home／End 首末頁、Esc 返回書架，字／詞卡增加空白鍵／S 與頁首「聽一次」、Esc 返回遊戲首頁。喇叭只朗讀，保留熟悉度、複習排程與出題次數。空白鍵／Enter 仍啟動有焦點的按鈕。
- `keyboard.js` 共用單一 document 監聽、目前頁面與已連接舞台檢查；重繪替換動作，遊戲首頁清除舊字卡動作。輸入、選單、contenteditable、IME、修飾鍵與重複按住不觸發快捷動作；背景故事／字卡不穿透 modal 或揭曉舞台。
- 可關閉的 modal 支援 Esc，只收最上層；確認／不可關閉面板仍需原按鈕。揭曉舞台沿用原焦點與 Esc。繁簡快捷鍵提示、ARIA keyshortcuts 與 README 操作表一起補上。
- lint、79／79 自動測試、build、cap sync 與 diff 檢查通過；8 個 runtime／SW 的 source、dist 與 iOS 靜態資產 SHA-256 一致。store／SW／package／lock／Xcode 版號同步為 1.38.0；音節快取版號不變。
- `tools/keyboard-audit.mjs` 使用隔離 Chromium 與合成資料驗證 8 組閱讀配置（直橫向 × focus／side × small／big），首頁／末頁邊界、字／詞卡新題與歷史計數、朗讀不改熟悉度、原生按鈕焦點、按住、輸入／組字／面板保護、重新進入與 Esc。長篇 Home／End 等平滑捲動完成再讀頁碼；不以固定短等待判定。正式站與私人資料未參與測試。
- [鍵盤回歸結果](verification/keyboard-2026-10-06/report.json)、[詞卡橫向](verification/keyboard-2026-10-06/word-card-1366.png)與[詞卡直向](verification/keyboard-2026-10-06/word-card-1024.png)均使用合成資料；字／詞卡頁首未溢出。
- 本次未 commit／push／發布網站／安裝 iPad。cap sync 只準備原生靜態資產；實體 iPad 外接鍵盤操作與實際聲音尚未驗證。

## 2026-10-06 — 發布與安裝 v1.38.0

- 依使用者「部署上線，我實機測試」授權完成發布。功能提交 `10e7d2c3054c2404927831a9cb470acae1b8f526`、裝置辨識修正 `32d40a79bd82af8331aefd2977402cfe855edff3` 均已 push main。兩次 Pages Actions 分別為 [功能版](https://github.com/kishoujpjp/autobook/actions/runs/37489886819)與[目前功能／腳本版](https://github.com/kishoujpjp/autobook/actions/runs/37490130041)，完整 head SHA 正確、conclusion=success。
- 發布前再通過 lint、79／79 自動測試、build、cap sync 與 diff 檢查；既有鍵盤瀏覽器回歸結果沿用上述紀錄。無關的未追蹤私人 PNG 未提交；收件匣 Worker 無改動，未重部署。
- 目前只安裝正式版 Xcode，使用 `/Applications/Xcode.app/Contents/Developer`。舊 Xcode-beta 路徑已不存在；沙盒內 CoreDeviceService 初始化逾時後，於已授權的本機裝置環境重試成功。
- 新版 devicectl 的預設 Identifier 欄改顯示 UDID，原腳本只比對 CoreDevice UUID，因而誤判 iPad 離線。改 `list devices --columns '*'` 保留既有 ID，`bash -n` 與實際裝置清單驗證通過；沿用原目標 iPad，未重新配對或使用 generic destination。
- 2026-10-06 23:47:38，既有自動部署完成 iPad v1.38.0 build 84 覆蓋安裝；devicectl 實際查詢 `com.kishou.autobook` version=1.38.0、bundleVersion=84，簽名包 Info.plist 一致。未解除安裝、清除或操作私人閱讀資料。
- 正式站 8 個 runtime／SW 以 no-cache 與完整 SHA 查詢參數下載，SHA-256 與 source、dist、iPad 簽名包完全一致；[發布校驗結果](verification/keyboard-2026-10-06/release-report.json)。實際外接鍵盤與聲音由使用者接續實機測試。
- 純文檔提交會再觸發 Pages 與 iPad 自動部署，build 號可能遞增；本條記錄上述已確認的功能／腳本版發布結果，App 功能版本維持 v1.38.0。

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


## 2026-10-04 — v1.34.0：字表搜尋（本機與 iPad）

依已審核設計加入四個入口的繁簡／拼音搜尋；已選字保留於同一字格，沒有獨立選字區塊，不採用 mock 的熟悉度小字。沿用原字卡尺寸、使用次數與故事選字格。紅綠背景與藍色選框共存，排序保留選取；「全選結果／取消結果選取」僅操作真正匹配項。必用字 8 字上限增加提示。

- 新增共用比對及搜尋工具列；中文組字完成後才更新，搜尋時不重繪輸入框。拖選期間字格不重排，放手才移出取消的非符合字。
- 固定 Unihan 17.0.0 讀音搜尋索引（下載 ZIP SHA-256 `f7a48b2b545acfaa77b2d607ae28747404ce02baefee16396c5d2d7a8ef34b5e`），包含資料授權及可重產工具；不變更既有語音預設。搜尋三個 runtime 模組加入 SW SHELL。
- `npm run lint`、`npm test`（60／60）、build、Capacitor 同步與 `git diff --check` 通過。
- `tests/word-search-browser.html` 以獨立 localhost 測試資料驗證 9 組互動：繁簡／聲調、IME、整理模式、拖選、匹配批次操作、發髮身份、必用字上限／重開、追加確認與學習紀錄保留。瀏覽器 iPad 尺寸直橫向均通過，尚未在 iPad 上操作鍵盤／拖選驗證。
- 2026-10-04 16:00:31 以既有腳本覆蓋安裝 `Kipad Pro 12.9`，裝置查詢確認 v1.34.0 build 75，安裝包 public 的八個修改檔與目前原始碼 SHA-256 一致；未解除安裝或清除資料。建置號依現有 HEAD 提交數產生，本次工作尚未 commit，部署日誌的 HEAD `58a7257` 不代表本次變更已提交。
- 本次未 push／發布 GitHub Pages，未改動或重新部署故事收件匣 Worker。未追蹤的使用者圖片保留原狀。


## 2026-10-04 — v1.34.1：認字表資訊層級與空間配置

使用者回饋字表上方配置雜亂。將常駐新增輸入框改為「新增字」面板，四張統計卡缩成一列；頁首、帳號／統計、搜尋與字卡形成三個層級。排序改為有標籤的單一選單，一般及整理模式分別只顯示該模式需要的工具；新增明確返回入口。保留原字卡尺寸、使用次數、紅綠、拖選及篩選時保留已選字的行為。

- 僅改認字表及其繁簡文案、版號與測試頁；新 CSS 使用認字表專用選擇器。其他字表入口不套用此布局。
- 新增面板空白／沒有漢字時不能送出；取消不存字，確認加入後保留搜尋。小孩仍無家長新增、刪除及整理工具，鎖定仍只點讀、不改紅綠。
- lint、60／60 自動測試、build、Capacitor 同步及 diff 檢查通過；瀏覽器 12 組互動回歸通過。以實際 App 模組和頁框檢查 iPad 1024×1366、1366×1024，瀏覽器實際點按與排序選單保留搜尋及選取；畫面使用合成測試資料。
- 2026-10-04 16:13:56 完成 iPad 覆蓋安裝 v1.34.1 build 75；未解除安裝或清除資料。此次未 commit／push 或發布 Pages，未重新部署 Worker。

## 2026-10-04 — v1.34.2：小朋友適用的認字表繪本風格

- 加入微笑小書本角色、藍綠粉黃統計徽章、彩色邊條與圓角立體按鈕。SVG 內嵌於既有圖示模組，離線可用。
- 認字表字卡改為 104×116px、字級 52px；返回、新增、帳號、排序及管理按鈕至少 64px 高。字卡保留原使用次數小字、紅綠底色及藍色選框／勾號，搜尋保留已選字於同區。家長管理工具及新增面板生命週期不變。
- 樣式限定認字表及新增面板；夜間模式調亮藍色統計、返回圖示與搜尋提示。測試頁移除切換至其他入口時殘留的認字表樣式，增加夜間預覽參數。
- lint、60／60 自動測試、12 組瀏覽器互動回歸及 diff 檢查通過。以實際 App 模組和合成資料檢查 iPad 直橫向、搜尋保留紅綠／藍框及夜間配色；常用控制實際高度 64px，直向沒有水平溢出。
- build、Capacitor sync、原生建置與安裝成功。2026-10-04 17:25:12 覆蓋安裝 iPad v1.34.2 build 75；devicectl 首次查詢連線逾時，重試確認實際安裝版本與建置號一致。安裝包 public 的 CSS、words、icons、i18n、store、SW 共六個檔案與原始碼 SHA-256 一致。未清除資料，未操作裝置私人字表驗證；此次未 commit／push 或發布 Pages，未重新部署 Worker。

## 2026-10-04 — 提交 v1.34.2

- 依使用者要求將已驗證的字表搜尋、認字表布局及繪本風格合併提交本機 Git，包含離線讀音索引、測試與維護文檔。使用者圖片不納入提交。
- 未 push 或發布 Pages，未重新部署 Worker；前述安裝紀錄仍指提交前的 v1.34.2 build 75。

## 2026-10-04 — v1.35.0：四色篩選、兒童遊戲與逐字讀音

- 認字表四色統計改為 84px 高的分類按鈕，有藍框／勾號表示目前分類。依管理中的帳號篩選已學會、不熟字，依共用使用次數篩選還沒用過；搜尋與分類取交集。整理選取即使不符合分類仍保留在同一字格，紅綠與藍框共存；改標色後立即更新分類結果。重新進入預設全部、最新，遊戲選字也預設最新。
- 遊戲首頁新增耳機笑臉、字卡、朋友詞卡 SVG 大圖示與三個短標題，刪除入口說明小字；家長不熟模式保留，小孩隱藏。選字工具加大至至少 64px，返回／標題在上方、開始靠右，全選／清除配圖示；去除遊戲選字卡的使用次數，認字表原小字不變。閃卡長說明改為學會／不熟短徽章。
- 家長閱讀設定新增逐位置讀音：全文按原順序呈現，可點選同篇不同位置的同字、輸入數字或調號拼音、選建議、試聽、儲存及单獨恢復。非法或沒有錄音的音節不能儲存。`story.readings` 納入既有完整故事備份；點讀同步優先播放指定音節，繞過自動整詞／AI 音訊。修改內文清除此篇設定，單純改標題保留；字形轉換改內文也清除。
- 補充未修改的 `zhao2`（Unlicense、上游 pinned commit `aa25ecce7b7fb02757b2c2b8e3c01aa975812edc`，SHA-256 `e26a204d9ce1922f1a9c64d3c7f249549cca0925a851931599c789f9724c9998`）與 `zhe5`（教育部《國語辭典簡編本》2021，音檔 `/sound/word/4341.mp3`，CC BY-ND 3.0 TW，SHA-256 `0d2ec4e09c1d77f3bd001ae902bb64de52e25532d7608e412144d0cb40f595b4`）。完整來源／授權及教育部原說明附在 `js/vendor/`，家長面板提供連結；保留原字通用預設。
- 新模組與授權資產加入 SW SHELL；安裝時補充錄音放入持久 SYL_CACHE，設定頁的离線下載也枚舉這兩份音檔。原生 App 隨包附带。
- lint、67／67 自動測試、18 組瀏覽器互動回歸、diff 檢查通過。用實際模組和合成資料檢查 iPad 直橫向、夜間配色；實際點按兩個「著」分別保存 zhe5／zhao2、驗證播放使用指定檔案路徑。修正讀音編輯區在橫向遮住下方選字，以及原生 append(null) 讓小孩首頁出現文字的問題。未在實體 iPad 逐字操作或主觀確認播放聲音。
- build、Capacitor sync、原生建置與安裝成功。2026-10-04 18:28:57 覆蓋更新 iPad v1.35.0 build 76；devicectl 查詢實際版本一致，22 個 runtime／CSS／補充錄音／授權資產的 source、dist、App public SHA-256 一致。未解除安裝或清除資料。本次變更尚未 commit／push 或發布 Pages，未重新部署收件匣 Worker；部署日誌的 HEAD `f12fd24` 是前一版提交，不是此次變更。

## 2026-10-04 — 提交、推送與公開發布 v1.35.0

- 依使用者「commit push」授權建立功能提交 `321ee44f29c570684e87925573e6659c6987fab2`，推送 `main`；前一個尚未推送的 `f12fd24` 也一起發布。未追蹤的個人圖片保持原狀。
- 發布前 lint、67／67 自動測試、build 與 diff 檢查通過；先前 18 項實際瀏覽器互動結果沿用，沒有修改已驗證的程式。
- [本次 GitHub Actions](https://github.com/kishoujpjp/autobook/actions/runs/37198401588) 的 head SHA 與功能提交一致，完成且 conclusion=success（2026-10-04 19:21:07 UTC+8）。
- 正式 Pages 的 22 個 runtime／CSS／補充錄音／授權檔使用提交 SHA 查詢參數避開舊快取，下載成功，SHA-256 與本機 dist、iOS 安裝包 public 完全一致。新版 v1.35.0 確認公開發布；本次未修改或部署 Worker。
- 2026-10-04 19:21:13，main 提交觸發既有自動部署，iPad 覆蓋更新至 v1.35.0 build 77；devicectl 查詢確認實際版本一致。資料未清除。此次發布紀錄另以純文檔提交補錄，App 版號不變，自動部署的 build 號可能再次遞增。


## 2026-10-05 — v1.36.0：5 歲幼兒視覺與音效精修（本機待發布）

- 閱讀／通用卡片改為柔和紙張陰影，按鈕和字塊縮短底邊與按壓位移；保留字塊、文字卡內距、大小字和分頁計算。遊戲入口與對話框減輕厚重邊框。
- 完成舞台改用奶油色紙框、淡化背景、短暫彩色星星；框內圖片採 contain 完整顯示。保留完成／重看／點圖重播／再讀一遍／多媒體依遍數解鎖。收起或切頁立即清除彩帶，系統減少動態效果時省略彩帶與飛散星星；補鍵盤 Escape 與焦點往返。
- 書架未讀完封面加入 SVG 花園與書頁層次，維持書名首字及未讀完不顯圖。底部分頁新繪四個彩色 SVG，保持現有入口與權限。
- 四色篩選移除藍色選框與勾，改用同色短底線、浮起與圖示放大；原配色、分類／搜尋交集、已選字保留不變。
- 所有效果音改為較圓潤的正弦音／輕泛音，答錯改兩個低音；獨立效果音壓縮器、45ms 重複事件合併、播放結束斷開節點。語音與音節錄音未改，保留 iOS 語音後 AudioContext 重建。

### 驗證

- `npm run lint`、67 項 `npm test`、`npm run build`、`npx cap sync ios`、`git diff --check` 全部通過。
- `tools/visual-polish-audit.mjs` 使用獨立 Chromium context 與合成帳號／故事：iPad 1366×1024、1024×1366 × 日夜 × focus／side × 大小字，共 16 組、全部 42 頁；沒有裁字或頁面橫向溢出，進度條維持不可點。
- 四色分類得到 18／18／14／54 字，選中狀態僅一個。完成只計一遍；重看不增加完成數；再讀清掉當前高亮，第二遍解鎖第二張圖並計兩遍。圖片框、關閉鈕在 iPad 直橫向與 844×390 短螢幕內均可見；Escape／Tab 焦點、彩帶停止與 reduced-motion 檢查通過。
- 使用另一空白頁錄製的無聲合成 WebM 檢查播放、初始靜音、喇叭切換、點影片不重播特效、收起時停播；不用使用者的私人媒體。最初短暫 MediaRecorder 片段只載入 metadata，換成完整可解碼合成片段後通過，未因此修改 App 播放邏輯。
- 11 種音效與「20 次重複 tap＋完成＋星星」經 OfflineAudioContext 生成：最大峰值約 0.362，沒有削波，尾端回到 0。這是數位訊號檢查，尚未以實際 iPad 喇叭確認聽感。
- [預覽與音效](design/visual-polish-2026-10-05/index.html)／[檢查結果](design/visual-polish-2026-10-05/audit.json)留供檢視；docs 與 tools 不打包進 dist。
- 本機缺少 Playwright WebKit 執行檔，未宣稱 Safari／實際 iPad 已驗證。本次未 commit／push、發布 Pages 或安裝 iPad；只是準備本機與原生靜態資源。


## 2026-10-05 — 提交、推送、發布與安裝 v1.36.0

- 依使用者「發佈並安裝。commit push」授權建立功能提交 `0c35311d259ab743b4a91be4a7c4cb2097466b66`，push `main`；原有未追蹤的個人圖片保持未提交。
- 發布前重新通過 lint、67／67 自動測試、build 和 diff 檢查；沿用前述 16 組／42 頁瀏覽器與音效／媒體回歸，沒有修改已驗證的 runtime。
- [GitHub Actions](https://github.com/kishoujpjp/autobook/actions/runs/37245685132) 的完整 head SHA 與功能提交一致，conclusion=success，於 2026-10-05 07:59:31（UTC+8）完成。
- 正式 Pages 以完整提交 SHA 查詢參數及 no-cache 下載 9 個改版檔：index、CSS、icons、main、sfx、story、ui、store、SW；全部 SHA-256 與 dist、已安裝的 iPad 簽名包 public 一致，確認 v1.36.0 已公開。
- 既有自動部署於 2026-10-05 07:59:20 覆蓋安裝 iPad v1.36.0 build 79；devicectl 依 bundle id 查詢實際 version=1.36.0、bundleVersion=79。沒有解除安裝或清除資料，也沒有操作使用者的私人故事與字表作測試。
- 本次未修改／部署收件匣 Worker。發布證據以此純文檔提交補錄；會再觸發既有 Pages 和 iPad 自動部署，build 號可繼續增加，App 功能版號維持 v1.36.0。

## 2026-10-05 — v1.37.0：既有繪本追加插圖（本機待發布）

- 依使用者「新增插圖追加推送功能」實作獨立追加封包，保留原書不可變接口；Worker 新增私人 `/v1/illustrations` 清單、圖片、回條與獨立七天清理。原書清理後仍可憑 id 防重傳紀錄追加。
- App 先收原書，再跨分頁按上傳時間追加；最新原圖／影片、文字、所有帳號閱讀與標註、指定讀音保留。書架滿仍可替既有書收圖，未收原書保留待收，已刪原書明確略過而不復活。
- 圖片及追加去重紀錄同步落盤後才回條；斷線、回條存檔失敗與重試不重加。手動移除已追加圖後，同一封包不再補回。管理面板的上傳／重排改用最新媒體清單，避免和雲端追加並行時覆蓋新圖；正在閱讀的圖不自動切換。
- 工具新增 `append` 與 `append-status`；無 id 的追加草稿首傳存回固定 id，斷線重試沿用。狀態區分等待、已追加與原書已刪除而略過。使用原配對，不新增裝置登入或公開私人圖片。
- `npm run lint`、79／79 `npm test`（12 項新增）、`npm run ios:sync`（包含 build、cap sync）與 `git diff --check` 通過。App、SW、package／lock、iOS Debug／Release 版號對齊 1.37.0；9 個修改 runtime／SW 的 source、dist 與原生靜態資源內容一致。
- `tools/inbox-append-audit.mjs` 在全新 Chromium context 與記憶體 Worker 驗證 iPad 1366×1024、1024×1366：真實 IndexedDB 存圖、閱讀中不切換、重開依已讀次數換圖、跨分頁依序追加、回條斷線恢復、書架滿、刪書略過、新原書先收後追加、手動上傳與雲端追加並行合併、重載後六組媒體與 blob 保存。兩組無 pageerror；[瀏覽器結果](verification/inbox-append-2026-10-05/browser-report.json)。
- Wrangler 4.143.0 `deploy --dry-run` 通過，打包 2296.27 KiB／gzip 585.45 KiB；僅檢查打包與綁定，未部署或重設任何秘密。
- 本次未 commit／push、發布 Pages／Worker 或安裝 iPad，尚未執行私人追加草稿上傳；等待正式發布確認。實際 Safari／iPad 接收與原書第二張插圖需發布後查回條，不能以本機測試代替。

## 2026-10-05 — 發布、安裝 v1.37.0 並完成既有繪本追加

- 依使用者「要」的發布、安裝及追加授權，發布前再通過 lint、79／79 自動測試與 diff 檢查。功能提交 `e1566bd270ec7a0866d79e5d3ec8e9b4cc83030d` 已 push main；未追蹤個人 PNG 及 `.inbox/` 私人內容保持未提交。
- 先發布 Cloudflare Worker，版本 ID `dafe723d-7c26-4e45-ba6c-0d22530b1bf0`；正式自訂網域 health 的 capabilities 提供 `append-illustrations`。沿用既有 R2、秘密與配對，未重設憑證。
- [功能版 Pages Actions](https://github.com/kishoujpjp/autobook/actions/runs/37251041996) 的完整 head SHA 與功能提交一致，conclusion=success。正式站 9 個修改 runtime／SW 檔以完整 SHA 查詢參數和 no-cache 下載，SHA-256 與 dist、iPad 簽名包 public 完全一致。
- 2026-10-05 09:20:35（UTC+8）既有自動部署覆蓋安裝 iPad v1.37.0 build 81；devicectl 確認實際 version=1.37.0、bundleVersion=81。未解除安裝或清除資料。
- 原繪本追加前雲端有一張圖；私人追加清單上傳一張指定插圖成功，圖片 SHA-256 與本機檔一致，原繪本 manifest（包含歌詞及原圖校驗）完全未變。啟動 iPad App 後，2026-10-05 09:25:59 原裝置回報 `outcome: applied`，確認追加已落盤。故事／追加編號、裝置回條與校驗快照僅保存在忽略的 `.inbox/`，未公開到 Pages。
- 此為本次功能及追加的已驗證結果；未宣稱已逐一操作 iPad 私人閱讀 UI。後續純文檔提交會再次觸發既有部署並遞增 build 號，App 功能版本仍為 v1.37.0。
