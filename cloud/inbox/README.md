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
  "text": "小貓走到公園，看見一隻小狗。小狗說：「我們一起玩吧！」",
  "imagePrompt": "小貓和小狗在公園一起玩"
}
```

```sh
node tools/inbox-upload.mjs upload /absolute/path/story.json /absolute/path/image.png
node tools/inbox-upload.mjs status STORY_ID
```

上傳成功回「雲端已收到」。App 把所有圖片與故事存好才發接收回條；status 有回條後才能回報「App 已匯入」。回條代表接收時已落盤，並不代表故事後來未被使用者刪除。

書名最多 40 字、內文最多 1500 字；需含中文。圖片 1～8 張，每張最多 4 MB，合計最多 20 MB。只接受 PNG / JPEG / WebP / GIF 真正的圖片檔，App 解碼並縮至最長邊 1280 JPEG（GIF 第一幀、透明區域為白底）。多圖沿用既有「每讀完一遍解鎖下一張」方式。資料轉繁體保存。

故事 id 與內容不可變：重傳相同 id 與相同內容回成功；相同 id 搭配不同內容回 409。修改後要送成另一個 id 的新故事，保留既有閱讀紀錄。故事以手動加入的書保存，表外新字會計算；不自動加進認字表。書架已滿時停止接收並提示家長，不會自動淘汰舊書。

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

## 驗證與上線

```sh
npm run lint
npm test
npm run build
npx wrangler@4 deploy --dry-run --config cloud/inbox/wrangler.jsonc --outdir /tmp/autobook-inbox-worker
```

先部署 Worker、設定秘密與配對碼，再發布 App 更新。第一次更新後，用一篇短故事與一張圖，在 iPad 收到後切離線重開驗證點讀／揭曉；重傳同 id 不能多一本。PWA 與原生殼分別配對測試。帳號未啟用 R2 或未授權 Wrangler 時，保留程式與測試成果，待帳號準備好才部署。
