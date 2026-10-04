# 自動繪本維護交接

更新日期：2026-10-04（UTC+8）。目前本機 App 版本 v1.34.2；字表搜尋及認字表繪本風格已實裝、覆蓋安裝至 iPad，並依使用者要求提交本機 Git。尚未 push 或發布 Pages。上次線上功能提交仍是 `c57bd1af37b22bf9781d67bde198c203baec28c8`。歷次功能說明見 [README](../README.md)，測試與安裝證據見 [開發記錄](DEVELOPMENT_LOG.md)。

## 本次本機更新

- 四個字表入口共用 `word-search.js`／`word-search-ui.js`，離線多音索引 `search-readings.js`。新增 runtime 模組均已加入 SW SHELL。
- 搜尋只篩选既有字卡；匹配結果和已選字在同一字格，原字鍵、帳號 × 語系標記及使用次數不變。字表切換排序不再清空選取；拖選期間延後隱藏／排列，放手才更新。
- 認字表 v1.34.1 將新增移至面板、統計縮為資訊列、排序改單一選單，搜尋與管理操作集中於字卡區。樣式只作用於認字表。
- v1.34.2 增加小書本 SVG 角色與多彩徽章、104×116px 字卡和至少 64px 高的常用控制；夜間模式文字與圖示使用對應亮色。搜尋／熟悉度／選取規則沿用。
- 新增拼音單元測試與合成資料的瀏覽器回歸頁；60 項自動測試、12 組介面回歸與 iPad 尺寸直橫向檢查通過。
- iPad 安裝紀錄：2026-10-04 17:25:12，v1.34.2 build 75；未讀取裝置私人故事／字表作互動測試。下方是上次公開上線紀錄，不能當作 v1.34.2 已公開發布的證據。

## 上次公開上線紀錄（2026-10-03）

| 目標 | 本次確認結果 |
|---|---|
| [GitHub Pages](https://kishoujpjp.github.io/autobook/) | v1.33.0；本次 SHA 的 Actions 成功，正式站五個關鍵 JS 檔與本機 dist 的 SHA-256 一致 |
| [故事收件匣](https://autobook-inbox.daizukan.app/health) | Worker `autobook-inbox` 已部署；版本 ID `da1fd09e-99dc-4286-bb66-f43766b97d6f`，health 正常 |
| iPad「自動繪本」 | `com.kishou.autobook` v1.33.0，build 73；安裝成功，已用 devicectl 查詢裝置實際版本 |

這是上述日期的部署紀錄，後續維護須重新查詢當次結果。`/health` 的 `version: 1` 是收件匣協定版本，不是 App 版號，也不能單憑 health 判定 Worker 程式版本。安裝成功不等於裝置上的資料遷移已完成；遷移於新版 App 載入時執行，本次未讀取 iPad 的私人故事與字表驗證遷移。

## 架構與維護入口

- 前端為原生 ES modules。`npm run build` 先產生固定版本 OpenCC vendor，再將靜態資源複製到 `dist/`；Pages 與 Capacitor 均使用該產物。
- `js/store.js` 管 localStorage、IndexedDB、版本與儲存邊界；`js/story.js` 管閱讀、編輯、手動新增；`js/words.js` 與 `js/game.js` 管字表與遊戲；`js/voice.js` 是統一發音入口。
- `js/zhconv.js` 管字形轉換；`js/text-policy.js` 管故事入庫與舊資料修復，為 App 和 Worker 共用的純函式模組。
- `cloud/inbox/worker.js` + 私人 R2 保存傳入故事；`js/inbox-format.js` 管格式，`js/inbox-transfer.js` 管接收，`js/inbox.js` 管配對與自動檢查。部署及送書操作見 [收件匣 README](../cloud/inbox/README.md)。
- App 資料與 Safari PWA 分屬不同 origin。資料同步須用設定頁完整匯出／匯入；故事收件匣的配對亦各自獨立。

## 字形規則：繁體為底層事實

不可將已知繁體原文再次送入簡轉繁。舊逐字表曾把 `吃／皇后／公里／干涉／游泳` 改成 `喫／皇後／公裏／幹涉／遊泳`。詞組判斷與明確輸入語系是此次修正的核心。

| 入口或用途 | 必須遵守的規則 |
|---|---|
| `convertTo(text, 'zh-Hant')` | 原文直接返回，用於繁體顯示；不做再次正規化 |
| `convertTo(text, 'zh-Hans')` / `t2s()` | 使用完整 OpenCC tw → cn 規則轉換顯示副本；不回寫底層 |
| `toStoredTraditional(text, 'zh-Hant')` | 明確繁體來源保留原文 |
| `toStoredTraditional(text, 'zh-Hans')` / `s2t()` | 明確簡體來源，以 OpenCC cn → tw 的詞組及臺灣字形規則轉繁體 |
| `toStoredTraditional(text, 'auto')` | 只偵測簡體專有字；`后／里／干／游／厂` 等共用字形不據此猜語系 |
| 新故事儲存 | `prepareStoredStory()` 設 `lang: 'zh-Hant', textPolicy: 1`，重算表外新字；AI、手動新增、示範及收件匣皆須遵守 |
| 標色、點讀、讀音與快取 | 以底層原字及原文索引識別；簡體畫面的 `发` 不得把 `發／髮` 的熟悉度或音訊合併 |

`面包／工厂／后天` 這類全由共用字形組成的簡體無法保守自動辨識；手動新增／編輯請選「輸入字形 → 簡體中文」，外部送書標 `lang: 'zh-Hans'`。未修改的編輯欄位保持原文，即使切換來源選項也不重新轉換。

`unambiguousTraditional()` 與 `audioKeysFor()` 只允許一對一字形共用；`貓／猫` 可相容舊快取，`發／髮／发` 不共用。`SHARED_HAN` 保護合法繁體共用字形；字表既有 `SELF_HANT` 字對亦各自保留。

OpenCC 固定 `opencc-js@1.4.2`。`tools/vendor-opencc.mjs` 產生 `js/vendor/opencc.js` 和三份授權／第三方文件，`npm run build` 自動重產；不要手改 vendor。舊 BMP 對照表僅供字型工具及 `legacyS2T()` 修復對照，不可回接到一般繁體顯示或入庫。

## 舊資料遷移與備份

- `store.js` 載入資料時，先處理既有字卡遷移，再套用 v1.33.0 字形政策。`textPolicy: 1` 的故事不重跑舊資料修復。
- 舊故事先按來源轉繁體，再執行 `repairLegacyText()`：只用明確詞組表修復錯詞，再以 OpenCC t → tw 正規化繁體異體字。禁止全域 `後 → 后`、`幹 → 干`、`裏 → 里`，以免改壞合法內容。
- 文字變動或原來源為簡體的舊故事，其完整原紀錄存於該故事 `textBackup`；字表重寫前先將完整原字表存於 localStorage `autobook.textBackup`。兩者納入完整備份的匯出／匯入。
- 標題和內文的 Unicode 字元數皆未變時保留點讀／標註索引；任一長度變動才清除索引式紀錄。文字變動移除 `polys`，下次重新偵測；IndexedDB 原音訊不刪，媒體與 `readsBy` 保留。
- 字表僅將簡體專有字正規化成繁體鍵；相同鍵合併時，紅綠取較新 `markedAt`、次數取較大值、入庫取聯集、各帳號卡片保留，舊字形記入 `sourceChars`。
- 字表備份寫入失敗時不重寫字表；儲存失敗保留磁碟原資料，後續載入可重試。不要為排除遷移問題清除 localStorage、IndexedDB 或移除 App。
- 自動修復不能保證重建所有舊逐字誤轉的原意。新增修復詞組前，需同時測試合法繁體詞不被改壞，並沿用原文備份。

## 收件匣轉換邊界

來源可標 `lang: 'zh-Hant'`、`'zh-Hans'` 或省略。Worker 入庫只轉一次，manifest 固定 `lang: 'zh-Hant', textPolicy: 1`；新版接收端直接保存已標記的繁體原文。未標記的舊 manifest 才走舊資料修復並保留原文備份。已測試 `苎 → 苧` 傳到 App 後保持 `苧`，不再被二次轉成 `苧 → 薴`。

沿用既有 Worker、R2、憑證與配對。更新 Worker 不需重跑 init、secret bulk 或配對；`.inbox/` 為本機私密資料，不可提交、貼入文檔或發布到 Pages。雲端收到與 App 收到是不同狀態，送書後須以接收回條確認 App 已落盤。

## 日常線上推送故事到 iPad

此功能於 v1.32.0 引入，v1.32.1 改用正式自訂網域；原始提交與功能歷程見 [開發記錄](DEVELOPMENT_LOG.md)。完整初次部署、配對與 API 規格見 [收件匣操作文檔](../cloud/inbox/README.md)。已有憑證與配對時，每次送書不必重部署 Worker 或重裝 App。

1. 將對話產生的故事存為 JSON（`title`、`text`、明確 `lang`，可選 `imagePrompt`），準備 1～8 張圖片。故事書名最多 40 字、內文最多 1500 字；每圖最多 4 MB，圖片合計最多 20 MB。
2. 在 Mac 執行上傳；id 省略時工具會產生並寫回原故事檔，重試須保留該 id。

   ```sh
   node tools/inbox-upload.mjs upload /absolute/path/story.json /absolute/path/image.png
   node tools/inbox-upload.mjs status STORY_ID
   ```

3. 上傳成功先代表「雲端已收到」。iPad 打開 App、回前景或恢復連線時自動接收；前景每分鐘檢查，亦可在「家長 → 設定 → 故事收件匣」立即接收。Mac 可離線，兩台不必同網路。
4. `status` 查到該裝置回條後，才回報「App 已匯入」。回條在故事與全部圖片落盤後才送出；裝置收好後可離線閱讀，圖片按閱讀次數依序解鎖。回條不保證故事日後未被使用者刪除。
5. 相同 id／相同內容可重試且不多一本；相同 id 改內容回 409，修改或重新送已刪故事須換新 id。書架滿時 App 停止接收，先由家長整理書架；Safari 與原生 App 各自配對與回報。
6. 第一台裝置接收七天後，每小時排程清理雲端故事與圖片；尚未收到的故事保留。App 中已落盤的故事不受雲端清理影響。

「推送」使用雲端收件匣加 App 主動檢查；沒有 iOS 系統背景推播，App 關閉時不會被喚醒。沒有回條時先核對 App 是否在線／已配對、書架是否已滿與設定頁錯誤訊息，不可僅因 upload 成功就宣稱 iPad 收到了。

## 驗證與發布

一般修正執行：

```sh
npm run lint
npm test
npm run build
npx cap sync ios
git diff --check
```

字形回歸重點：繁體 `吃／皇后／公里／干涉／游泳` 原文不變、簡體詞境轉換、8000 詞繁體保留、顯示字元數與原文索引一致、`發／髮` 分別標色與發音、Worker 到 App 不二次轉換、遷移備份／配額失敗及帳號紀錄保留。實際頁面也要驗證簡體介面下編輯框仍顯示底層繁體，手動新增和明確簡體來源能正確保存。

Worker 改動時先 dry-run，再使用既有登入部署（操作見收件匣 README）；App 隨後 push `main`，等**本次完整 SHA** 的 Actions 成功。公開檔案與 `dist/` 比對；health 正常僅確認服務可用，程式版本以 Wrangler 部署版本 ID 記錄。

iPad 目標 `Kipad Pro 12.9`，裝置 ID `773F74E2-B275-5B55-AD68-9E2C9F4FBA30`。`npm run ios:device` 使用既有安裝腳本；main 提交也會觸發 launchd 自動安裝，先看 `~/.autobook-deploy/lock` 與 `deploy.log`，避免重複建置。腳本在鎖已被占用或裝置不在線時可能退出 0，仍須核對安裝日誌和 `devicectl device info apps` 的實際版本。

`xcodebuild` 必須指定實機 ID，免費帳號不可使用 generic destination，否則 provisioning profile 可能被另一台裝置替換。使用 `/Applications/Xcode-beta.app/Contents/Developer`；本次系統預設 Xcode 的 devicectl 初始化逾時，指定此 DEVELOPER_DIR 後查詢成功。免費簽名有效七天，既有排程每五天重簽。

App 改版同步更新 `js/store.js`、`sw.js`、`package.json`／lockfile、Xcode 兩處 MARKETING_VERSION；新增 runtime JS 同步加入 SW SHELL。純文檔更新不升版，不需重部署 Worker。推送 main 仍會觸發既有 Pages 與 iPad 自動部署，建置號可能因此遞增，版本號以當次改版檔案為準。
