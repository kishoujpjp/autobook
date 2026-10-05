# 私人故事收件匣

Cloudflare Worker 提供帶憑證的 API，R2 存故事與圖片。App 開啟／回前景／恢復網路時檢查，保持前景時每分鐘再檢查。App 關閉或離線時，故事保留在雲端等候；不依賴 Mac 持續開機。

## 部署一次

先在自己的 [Cloudflare 控制台](https://dash.cloudflare.com/) 啟用 R2；帳單設定由帳號持有人確認。以下命令在專案根目錄執行，需要 Node.js 22 以上。Wrangler 透過瀏覽器登入自己的 Cloudflare 帳號，不要把帳號密碼貼進對話。

```sh
node tools/inbox-upload.mjs init
node tools/inbox-upload.mjs secrets
npx wrangler@4 login
npx wrangler@4 r2 bucket create autobook-inbox
npx wrangler@4 deploy --config cloud/inbox/wrangler.jsonc
npx wrangler@4 secret bulk .inbox/secrets.json --config cloud/inbox/wrangler.jsonc
```

請確認 `wrangler whoami` 顯示的是要部署的帳號；多帳號時在部署命令設定 `CLOUDFLARE_ACCOUNT_ID`。bucket 保持私人，**不啟用 Public Access**。公開的是 Worker 網址；故事與圖片仍須 Authorization 憑證才能讀取。沒有秘密的 Worker 回 503，不會公開內容。

正式網址使用 `https://autobook-inbox.daizukan.app`。Wrangler 部署會設定此獨立子網域的 Worker 路由與 HTTPS：

```sh
node tools/inbox-upload.mjs set-url https://autobook-inbox.daizukan.app
node tools/inbox-upload.mjs pair
```

`.inbox/pairing.txt` 是 App 的配對碼，在「家長 → 設定 → 故事收件匣 → 配對收件匣」貼上。App 會先驗證連線與讀取憑證再儲存。Safari 與 iOS App 各自配對；第一台裝置收到後，其他裝置還有七天可接收。

`.inbox/config.json` 保存 Mac 的讀取與寫入憑證，`.inbox/secrets.json` 供部署秘密使用，整個 `.inbox/` 不進 Git。App 僅取得讀取／回條憑證；寫入憑證只在 Mac。完整備份不含讀取憑證，換裝置後要重新配對。輪替憑證時修改本機 config、重跑 secrets / secret bulk / pair；既有書與接收紀錄不受影響。

`ALLOWED_ORIGINS` 已涵蓋 GitHub Pages、Capacitor 與本機 8123 開發網址。若改 App origin，必須同步更新它。接受 `autobook-inbox.daizukan.app` 與 workers.dev 正式網址。其他自訂網域需要同步調整 `inboxUrl()` 與 index.html CSP，不能只改設定。

## 從對話送一本故事

將故事存為 JSON（id 可省略，上傳工具會生成並存回原檔，確保重試不重複）：

```json
{
  "title": "小貓的新朋友",
  "lang": "zh-Hant",
  "text": "小貓走到公園，看見一隻小狗。小狗說：「我們一起玩吧！」",
  "imagePrompt": "小貓和小狗在公園一起玩"
}
```

```sh
node tools/inbox-upload.mjs upload /absolute/path/story.json /absolute/path/image.png
node tools/inbox-upload.mjs status STORY_ID
```

上傳成功回「雲端已收到」。App 把所有圖片與故事存好才發接收回條；status 有回條後才能回報「App 已匯入」。回條代表接收時已落盤，並不代表故事後來未被使用者刪除。

書名最多 40 字、內文最多 1500 字；需含中文。圖片 1～8 張，每張最多 4 MB，合計最多 20 MB。只接受 PNG / JPEG / WebP / GIF 真正的圖片檔，App 解碼並縮至最長邊 1280 JPEG（GIF 第一幀、透明區域為白底）。多圖沿用既有「每讀完一遍解鎖下一張」方式。

資料一律繁體保存：來源 `lang: "zh-Hant"` 保留原文；`lang: "zh-Hans"` 使用離線 OpenCC 詞組轉成臺灣繁體。不填 lang 時相容舊格式，以簡體專有字判斷（皇后／公里／干涉本身不會觸發）；全共用字形的簡體內容請明確標示 zh-Hans。Worker 輸出固定 `lang: "zh-Hant", textPolicy: 1`，App 接收端直接保存，不再重複簡轉繁；沒有標記的舊 manifest 走一次明確詞組修復，保留原文備份。

故事 id 與內容不可變：重傳相同 id 與相同內容回成功；相同 id 搭配不同內容回 409。修改後要送成另一個 id 的新故事，保留既有閱讀紀錄。故事以手動加入的書保存，表外新字會計算；不自動加進認字表。書架已滿時停止接收並提示家長，不會自動淘汰舊書。

## 替既有繪本追加插圖（App v1.37.0）

追加是獨立封包，不重傳或改寫原書。先以原書 JSON 的 `id` 作為 `targetId`，將追加請求存成另一份 JSON：

```json
{
  "targetId": "existing_story_id"
}
```

```sh
node tools/inbox-upload.mjs append /absolute/path/append.json /absolute/path/image2.png
node tools/inbox-upload.mjs append-status APPEND_ID
```

工具首次會生成追加 `id` 並存回 append.json；重試務必用同一份檔案、同一組圖片，不刪除 id。每次 1～8 張，大小及圖片校驗規則同新故事。相同追加 id／內容重試不重複加入，同 id 換圖片或原書回 409。每份追加有獨立雲端及本機回條；`append-status` 明確區分等待接收、已追加、以及原書已刪除而略過。

App 先收原書，再按追加封包的上傳時間（同毫秒以 id 排序）將圖片加到該書現有媒體清單末尾。保留原圖、影片、書名、內文、全部帳號點讀／標註／已讀次數、指定讀音、字表使用次數；書架滿也可追加。下載期間新增的媒體仍保留；正在閱讀的圖片不會突然切換，下一次打開繪本沿用已讀次數解鎖圖片。

未收到原書的裝置保留待收並提示 `target_missing`，不建立空書或額外副本；可先收到原書，或從另一裝置匯入完整備份。原書曾收到但已刪除時不下載、不復活，回報 `skipped_deleted`。手動刪除已追加的圖片後，同一追加封包也不會重新補回。若原書不是經此收件匣匯入，不能只憑同名書追加。

原書雲端內容清理後仍能靠其小型 id 校驗紀錄接受追加；裝置仍需保有原書。追加經任一裝置回報已處理七天後獨立清理，雲端原書及其他追加不受影響；未處理的追加保留。去重紀錄與回條隨完整備份保存，追加圖片納入既有 IndexedDB 備份。

發布順序：先更新 Worker，再發布網頁與覆蓋安裝 iPad App，沿用既有 R2、秘密與配對，最後送追加封包並查回條。舊 App 只查 `/v1/stories`，忽略新的追加清單；新版 App 遇到舊 Worker 的追加清單 404 時仍可收新書。`/health` 的 `capabilities` 包含 `append-illustrations` 才表示服務提供新接口；協定版本仍是 1。

雲端發布採用 R2 條件寫入，圖片先存、封包最後發布，並行相同 id 只會生效一份。API 行為見 [Cloudflare R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)。

刪掉收到的書後，接收紀錄仍保留，不會下次又出現。要重新送這本書，可改用新 id。接收紀錄隨完整備份保存；裝置身份不在備份中，新的 App origin 會回自己的接收回條。

**第一台裝置確認收好後七天，雲端故事與圖片會自動刪除。** Worker 每小時第 17 分鐘執行清理，每次最多三本；大量到期時會在後續排程繼續。尚未收到的故事不自動到期。回條重送不延後期限；App 中已收到的書與圖片不受雲端清理影響。小型接收回條與 id／內容校驗值仍保留，供查詢與防止同 id 重傳復活；它們也會佔少量儲存額度。

清理只依雲端回條，不接受 App 的刪書同步。清理中斷時保留工作以便下次重試，並同時移除該故事的孤立圖片。沒有成功發布故事的中斷上傳仍可能留下孤立圖片，可由帳號持有人在 R2 手動清理。每次檢查只列 manifest；已收到的內容不重複下載圖片。

## 接口

憑證以 `Authorization: Bearer …` 傳送，不放 query string。所有回應 `Cache-Control: no-store`。

| 接口 | 權限 | 用途 |
|---|---|---|
| `GET /health` | 無 | 協定版本，不含內容 |
| `POST /v1/stories` | 寫入 | multipart：`story` JSON + 重複的 `images` 檔案欄位 |
| `GET /v1/stories?cursor=…` | 讀取或寫入 | 列出 50 個 id 與下一頁 cursor |
| `GET /v1/stories/:id` | 讀取或寫入 | 內容與圖片校驗值 |
| `GET /v1/stories/:id/images/:index` | 讀取或寫入 | 私人圖片 |
| `POST /v1/stories/:id/receipts` | 讀取或寫入 | `{ "deviceId": "…" }`，App 儲存完成回條 |
| `GET /v1/stories/:id/receipts?cursor=…` | 寫入 | 分頁接收狀態，`receipts` 與下一頁 cursor |
| `POST /v1/illustrations` | 寫入 | multipart：`update` JSON（id、targetId）+ 重複 `images` |
| `GET /v1/illustrations?cursor=…` | 讀取或寫入 | 獨立追加清單，50 筆分頁 |
| `GET /v1/illustrations/:id` | 讀取或寫入 | 追加封包與圖片校驗值 |
| `GET /v1/illustrations/:id/images/:index` | 讀取或寫入 | 私人追加圖片 |
| `POST /v1/illustrations/:id/receipts` | 讀取或寫入 | deviceId 與 outcome（applied／skipped_deleted） |
| `GET /v1/illustrations/:id/receipts?cursor=…` | 寫入 | 分頁裝置追加結果；清理後仍可查詢 |

## 驗證與上線

```sh
npm run lint
npm test
npm run build
npx wrangler@4 deploy --dry-run --config cloud/inbox/wrangler.jsonc --outdir /tmp/autobook-inbox-worker
```

先部署 Worker、設定秘密與配對碼，再發布 App 更新。第一次更新後，用一篇短故事與一張圖，在 iPad 收到後切離線重開驗證點讀／揭曉；重傳同 id 不能多一本。PWA 與原生殼分別配對測試。帳號未啟用 R2 或未授權 Wrangler 時，保留程式與測試成果，待帳號準備好才部署。
