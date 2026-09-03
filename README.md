# 自動繪本 Autobook

給 5 歲小朋友的中文認字／英語啟蒙 PWA，主要在 iPad 13 吋使用。目前版本 **v1.25.0**。

- 線上版（GitHub Pages，push `main` 自動部署）：https://kishoujpjp.github.io/autobook/
- 純前端 ES modules、無 build step；AI 走使用者自備的 Gemini API Key（存本機）。
- **iOS 原生殼（Capacitor，v1.19.0 起）**：`com.kishou.autobook`，免費開發者帳號簽名直接裝在 iPad 上。
  - 為什麼：PWA 在 iPadOS 上用 `speechSynthesis` 後，系統音訊 session 常卡在「被壓低」狀態（聲音突然變很小，要開 YouTube 才恢復）。原生殼在 `ios/App/App/AppDelegate.swift` 把 `AVAudioSession` 固定為 `.playback` 並在回前景／中斷結束／路由改變時重設，根治此問題；`js/sfx.js` 另有 JS 端緩解（語音結束即重建 AudioContext），PWA 版也受益。
  - 手動建置：`npm run ios:device`（= `scripts/ios-device-install.sh force`：`node --check` → `npm run build`（純複製到 `dist/`）→ `cap sync` → `xcodebuild` → `devicectl install`）。
  - **自動部署**（抄自 mg-zukan2）：`scripts/com.kishou.autobook.deploy.plist` 裝進 `~/Library/LaunchAgents/`，commit 到 `main` 即觸發、每 30 分鐘輪詢、每 5 天自動重簽（免費簽名 7 天到期）。紀錄在 `~/.autobook-deploy/deploy.log`。安裝當下 iPad 要解鎖、USB 或同 Wi-Fi。
  - 注意：app 的資料（API Key、字表、書架）與 Safari PWA 是**不同的 origin**，不共用；第一次用 app 請在 PWA「設定 → 備份」匯出再於 app 匯入。
- **核心事實是繁體**：AI 一律生成繁體、資料存繁體、讀音以臺灣華語為準；簡體只是顯示時的換皮。

## 分頁總覽

| 分頁 | 內容 |
|---|---|
| 📖 故事 | AI 用認字表生成繪本＋插圖，點讀吹散迷霧 |
| 🎈 遊戲 | 聽音認字／認字卡／認詞彙（教具卡） |
| 🎤 跟讀 | 英語單字短句跟讀，本機發音評分 |
| 🗂️ 字表 | 認字表管理＋熟悉度紅綠標記 |
| ⚙️ 設定 | 語系、API Key、診斷、帳號、備份、版本 |

## 功能明細

### 故事
- 生成前可勾選必用字（最近新加優先）、「今日新字」欄（直接入字表並必用）、文字或語音輸入追加條件。
- **故事元素比例雷達圖**（生成面板）：溫馨／有趣／衝突／悲傷／犯錯五軸 0~10 可拖，附 🎲 隨機鈕；設定記在 `settings.storyMix`。注入提示詞時不給數字比例（模型跟隨度差），改為「檔位（低/中/高）→ 具體寫作指令」＋「氛圍比重由重到輕排序」；另有寫死保底「內容適合 5 歲、結局溫暖正向」。
- **生成插圖 toggle**（生成面板，`settings.genImage`）：關閉時跳過出圖，連提示詞的 image_prompt 要求與 schema 欄位也一併拿掉。
- **插圖風格 5 選 1 隨機**（`IMAGE_STYLES`）：柔和水彩／蠟筆手繪／剪紙拼貼／扁平卡通／色鉛筆繪本，每次出圖隨機選一種注入（生成 log 會顯示選中的風格）；故事的 image_prompt 只描述場景不指定畫風。
- 故事幾乎只用認字表的字（**表外新字 ≤5**，前端驗證超標自動帶回饋重試 3 次），約 **150～180 字**；認字表注入提示詞前**每輪嘗試都亂數洗牌**。**一律生成繁體**（提示詞寫死），簡體介面顯示時才轉換。
- **通順優先**：提示詞明定「不可為避開表外字而省略字/硬拆詞，必要時直接用表外字（計入上限）」；temperature 0.9；三次重試都超標時採用**最後一次**（經回饋修正通常最通順），而非表外字最少的一次（那往往句子最扭曲）。
- **兩種點讀模式**（設定記憶，「閱讀設定」面板切換）：
  - **高亮模式**（小孩自讀）：點字高亮，再點取消。
  - **標註模式**（親子共讀）：點字循環 白→綠→紅→白，**直接寫入認字卡的熟悉度**（見「熟悉度打通」）。紅綠都算已讀、都會散開迷霧。
  - 兩種模式的紀錄各自獨立、互不干擾；**都依帳號分開**。
- **長按單字只發音**（0.5 秒，不改標記）；多音字播「所屬詞」的音以取得正確讀音。
- **點字發音開關**（閱讀設定內，`storySpeak`）；發音規則：高亮時發音、**標綠（學會）不發音、標紅發音一次**幫忙複習、清除不發音。
- **生成視窗進度 log**：生成中即時顯示各階段（撰寫第幾次、插圖、API 層自動重試…，帶時間戳）；失敗時視窗不自動關，完整過程留在 log 裡好除錯（gemini.js `setLogListener`）。
- **追加新字到字表**（閱讀設定內，v1.19.0）：列出本篇內文「轉繁體後不在字表」的字（每次重算，不用過期的 `newChars`），預設全選、可點掉、有全選鈕；確定後以**繁體**加入字表（走 `addWords` 的跨繁簡去重與衝突提醒），並重算本篇新字標示。
- 「清除標記」清掉本帳號在這一本、當前模式的標記（**不動認字卡紀錄**），方便重複練習。
- **直接完成 / 狀態重置**（v1.22.0，閱讀設定「閱讀進度」區）：
  - **✅ 直接完成**（已讀完就不顯示）：把這一輪還沒標的字一次補滿，之後走跟真的讀完**一模一樣**的路徑——進度滿 → 計一次讀完（`readsBy` +1）→ 揭曉特效（迷霧散開／圖片框彈出）→ 已打開 +1。按下先關面板特效才看得到。**刻意不寫認字卡的紅綠與點讀次數**：這是大人用的捷徑，不是小孩真的認得這些字。作法是 render 時把這次的完成動作掛在模組變數 `completeNow`，讓閱讀設定面板能呼叫到當次 render 的 `updateProgress()`。
  - **♻️ 狀態重置**（要確認）：這本、這個帳號回到「還沒讀過」——兩種模式的標記與 `readsBy` 一起清掉，圖片／影片回到第 1 個，方便從第一遍重讀。**認字卡的紅綠紀錄一樣不動**。
- 插圖固定不捲動；**閱讀中迷霧不打開**（只推進度條），**全部讀完才揭曉**：迷霧分批散開（配階梯音）→ 圖片放大回彈＋魔法星星＋彩帶＋完成音。已完成的書重開直接亮圖、不重播動畫；**完成後點插圖可重播特效**（1.5 秒冷卻）——**目前這一組是影片就不給重播**，免得把播放中的影片打斷（兩種版面都一樣）。
- **防誤觸原則（v1.21.0）**：兩種版面都讓「緊鄰翻頁鈕的東西永遠是不可點的進度條」（`.progress-track` 設 `pointer-events:none`），功能鈕一律排在它的另一側——專注版面靠左右拉開、並排版面靠上下堆疊。小孩戳翻頁鈕不會掃到功能區。
- **自動翻頁**（v1.21.0，閱讀設定內，`settings.autoPage`，預設關）：目前這一頁的漢字全部點過就等 **2 秒**自動翻下一頁（最後一頁不翻）。每點一次字都重新評估（先取消已排的倒數，條件還成立才重排），所以取消標記也會跟著取消倒數；手動翻頁同樣取消。判斷「哪些字在這一頁」用字塊相對 `.story-scroll` 的 `getBoundingClientRect()`，不依賴 `offsetParent`。
- **兩種閱讀版面**（v1.20.0，閱讀設定內，`settings.storyLayout`）：
  - `side` **圖文並排**（舊版）：插圖蓋著迷霧放在旁邊，讀完迷霧散開。圖卡由上而下＝插圖／動作鈕／本篇新字／進度條，進度條墊在最下面隔開翻頁鈕。
  - `focus` **專注閱讀**（v1.21.0 重排）：**書名就是文字框的第一行**（不另外佔一列，內文從第二行開始；整行高度由 JS 鎖成一個字塊高，翻頁的整行對齊才不會跑掉，書名那行置中排列，內文靠左，一眼看得出差別，不另外加線或底色）。**書名的字跟內文一樣是可點會唸的字塊**（v1.21.1，高亮／標註規則完全共用，大小預設同內文、書名太長就等比縮到排得下），但**索引用負的（-1, -2…）跟內文分開，不計進度**——點不點書名都不影響「讀完整本」，舊書的進度紀錄意義也不變；`doneCount()` 與書架的 `shelfStats()` 都會濾掉負索引，自動翻頁的「這一頁讀完了沒」也不看書名，下面一條頁尾——上排是**不可點的進度條**（提示與 `已讀 N/總數` 直接印在條上，省掉一整行），下排**左邊擺功能**（已打開 pill、🖼 再看一次、🔁 再讀一遍、本篇新字方塊）、**右邊擺翻頁鈕**，兩群左右拉開；**讀完才用特效打開圖片框**——星星階梯音 → 童話金框從中央彈出（四角 ✦ 閃爍）＋魔法星星＋彩帶＋完成音。框蓋在整頁上、尺寸放到最大（`min(1100px, 100%, (82vh-130px)×4/3)`），按「收起來」或點框外收起，之後可用「🖼 再看一次」重播。**點框可以再放一次特效**（1.5 秒冷卻，只放大回彈不旋轉）。舞台掛在 `#page-story` 底下，切分頁時跟著隱藏。進場 `.story-frame.in` 與重播 `.story-frame.pop` 分開兩個 class，切換時不會把對方的動畫重跑一次。
- **一本書可以放多組圖片／影片**（v1.20.0）：清單順序＝解鎖順序，**讀完第 1 遍看第 1 個、第 2 遍看第 2 個**…讀完最後一個之後固定用最後一個。高亮讀完或標註讀完**都算一次**（`story.readsBy['帳號id']`，依帳號分開）。讀完的當下不換圖（`reads` 加 1 與 `completed` 同時變動，索引不動），下次重開這本才換下一個。讀完後出現「🔁 再讀一遍（還有 N 個沒打開）」，一鍵清掉本帳號在當前模式的紀錄重讀。
- **影片支援**（v1.20.0）：上傳檔案（原檔存 IndexedDB）或貼連結。直接檔案網址用 `<video loop muted playsinline>`，**揭曉特效跑完才開始循環播放**（iOS 不給沒手勢的有聲自動播放，所以先靜音，角落有 🔇/🔊 鈕；迷霧沒散開前不露出）；YouTube／Vimeo 連結自動轉成 `embed` 網址（`autoplay=1&mute=1&loop=1`），iframe 也是揭曉時才建立，收起來時移除。
- **圖片／影片管理面板**（閱讀設定的「🖼 管理圖片／影片」，書架 ✏️ 編輯視窗裡也有）：列出每一組（第 N 遍／類型／來源／縮圖），可 ⬆⬇ 換順序、🗑 刪除（連 IndexedDB blob 一起刪）；新增方式有上傳圖片（可多選，縮到 1280 JPEG）、上傳影片、貼連結（自動猜圖片/影片，可手動改）、「✨ AI 再畫一張」（用生成時存下的 `story.imagePrompt`，沒有就拿內文開頭當場景）。每個動作直接存檔，關掉面板才重繪故事頁。
- 高亮模式音效用極輕的 tick/tock（sfx.js），不蓋過親子唸讀；高亮字色 `--hl-ink` 加深（#7A4504）提高黃底辨識度。
- **書架編輯視窗底部顯示這本的插圖**（媒體清單裡第一張圖片），改文字時捲下去可對照畫面；同一個視窗也能進「🖼 管理圖片／影片」。
- **手動加入繪本**：生成面板的「📝 手動加入」，自己輸入書名/內文＋上傳插圖（縮到最長邊 1280 JPEG），一樣算新字、進書架、可點讀。
- **文字區完全靠翻頁鈕控制**：禁手滑捲動、無捲軸，頁高由 JS 鎖成整行倍數，字不會被切半或溢出。（v1.19.0）卡片剩餘高度平均攤進行距（每行最多 +24px），不再留一整行空白；`.story-scroll` 用 `clip-path` 裁掉上緣內距，翻頁後上一行的陰影不透出；文字卡掛 ResizeObserver，任何版面變動（安全區、插圖載入）都重算頁高。
- 版面（圖文空間最大化）：橫向＝左欄標題＋圖＋翻頁鈕（**下一頁在左、上一頁在右**），右欄整欄給文字；直向＝圖上字下，最下排翻頁鈕列。
- **故事書架（v1.19.0 書本形卡片）**：每本書一張 3:4 書本卡（素色書脊＋一層書頁邊），點封面打開；**讀完（目前帳號×目前點讀模式全部點過）且有插圖才顯示插圖**，且以雙層（底層模糊＋上層放射遮罩）做成中央約 70% 清晰、四周模糊；未讀完封面＝書名首字＋依 id 輪換的漸層。封面底邊綠色進度條。pill：`新字 N`（未入字表或已入字表但標紅的字數，0 不顯示）固定；`✓ 讀完`／`讀到 N%` 視情況。排序「最新／有新字／還沒讀完」記在 `settings.shelfSort`。家長帳號有 ✏️🗑＋最後一張「＋ 做一本新繪本」；小孩帳號只有「📖 打開」。上方顯示「共 N 本・讀完 M 本」。
- 故事書架保存歷史（含插圖離線重讀）。
- **書架編輯**：每本書的 ✏️ 可改書名與內文；編輯框固定用繁體（資料核心是繁體，簡體介面顯示時自動轉換）。儲存後重算表外新字、清空該本的點讀/標註紀錄與多音字快取（索引式紀錄隨內文失效，下次開啟重新偵測多音字）。

### 遊戲（三入口＋不熟模式開關）
- **聽音認字**：10 題二選一，出題加權（答錯多／沒練過優先，依帳號×語系紀錄），開始前預快取語音；計分星星結算。
- **認字卡／認詞彙**：親子面對面大字卡（單字 58vh、詞卡自動縮放不溢出）；詞彙由內建 8000 常用詞離線詞庫拼出（不用 AI，含幼教不當詞黑名單）；挑選順序＝最近 3 天新字 → 標紅/沒練過 → 出現次數少；詞卡同字同步變色；可選二字詞/三字詞/不限。**點擊有 450ms 防誤觸間隔**。
- **認字卡出題範圍**：點「認字卡」先出選單（直接開始／選字出題）。選字頁列出全部未入庫字卡，點按或滑動複選（同字表整理模式手勢），支援最不熟/最新/最少用/最常用排序＋全選/清除；開始後**只出選中的字**（指定範圍不受綠字冷卻與不熟模式限制），間隔複習照常運作。
- **間隔複習（本回合內，flash.js 狀態機）**：白字第一次出現就標綠 → 直接歸入熟悉群（綠 3 天冷卻、順位下降）；**標紅 → 隔 2 張重出**，重出沒改仍紅 → 再隔 2 張；**紅轉綠 → 隔 3 張出「確認卡」**，確認卡沒被標紅＝學會（歸熟悉群），被標紅則回到紅循環。
- **不熟模式**：開啟後三種遊戲只出紅字與白字；練完提示可一鍵關閉。入庫的字一律不出題。

### 跟讀（英語）
- 以**練習組**為單位練習；題庫池支援搜尋、tag 過濾、單字/句子過濾、「未分組」視圖、批次選取（加組／打 tag／刪除）。
- AI 出題 → 預覽增刪 → 確認存成新練習組（自動帶主題 tag）；「AI 補足」一鍵補齊缺少的配圖與語音；AI 生成期間有阻斷式星星動畫。
- 練習：大圖（懶生成快取）＋TTS 示範發音（點圖/點字/喇叭都會唸）；麥克風常駐可重錄刷分；左右邊緣箭頭＋滑動換題（本輪沒分數不可往前）；分數為純色圓章（紅黃綠）。
- **發音判定全本機**（Web Speech API 零延遲）：音素層比對（內嵌 CMUdict×常用萬詞音素庫）＋辨識信心值加權＋多唸扣分；嚴格度三段。
- 結算頁：左成績單＋右大獎盃大星星（階梯音效依序入場）；點獎盃彩蛋。

### 字表
- （v1.19.0）「補齊發音」按鈕已移除（單字交給 Gemini TTS 容易唸錯，暫不使用）；設定頁的「清除語音快取」「載入示範字表」改為先跳確認框。
- 批次貼上加字；**跨繁簡去重**：僅「雙向一對一」等價字（貓⇄猫）略過，多對應字（发↔發/髮）保留＋顯示衝突提醒；絕不刪改既有字。
  - `SELF_HANT` 例外集（23 對）：`游/遊`、`后/後`、`里/裏`、`台/臺` 等**簡體側字形本身也是合法繁體字**的字對，一律各自保留。（對照表主對應會誤判它們為等價，見「其他技術備註」）
- 熟悉度紅綠：點字卡輪換 白→綠→紅（同時發音），**依帳號×語系分開記錄**；統計；排序含「最不熟」。
- **鎖定 toggle**：鎖定後點字只發音、不改紅綠（防小孩亂按），設定會記住。
- **小孩帳號也看得到字表**，但固定鎖定唯讀：沒有新增/整理/補齊發音/鎖定鈕，只能點字聽發音（保留統計與排序）。
- **家長檢視小孩紀錄**：有小孩帳號時字表頂端出現頭像切換列（我自己＋各小孩），切到小孩後統計與紅綠都顯示該小孩的紀錄，點字直接改**該小孩**的標記（此時不受鎖定影響）。
- 整理模式：點按或滑動複選 → 批次刪除／**入庫**（反灰排最後、不進遊戲、仍可用於故事）／出庫。
- 「補齊發音」批次生成 AI 語音——**現在是純加分項**（見「發音架構」），失敗也不影響使用。
- 內建示範字表 269 字（`DEMO_WORDS`，v1.14.1 起含「沒送按農民伯敢巴」）。

### 帳號與設定
- 本地帳號：家長/小孩身分（小孩看不到設定；字表看得到但鎖定唯讀；切回家長要過個位數加減算術門，可在設定的帳號區塊用「切回家長要算術確認」toggle 關閉）；右上角頭像（84px）切換；頭像可選 10 個內建向量小動物或上傳照片。
- 設定：繁/簡語系、Gemini API Key、選填 TTS 專用 Key、點字發音開關、模型/語音角色（進階）、示範字表、清除全部資料、版本號。
- **連線診斷**（「測試連線」）：逐項測 文字／故事 JSON 結構輸出／插圖／語音 四項，即時 ✅❌＋失敗原因＋白話對策。**四項都走與實際功能相同的程式路徑**，避免「診斷過但實際失敗」。
- **錯誤紀錄**：自動記錄最近 30 筆 API 失敗（時間｜階段｜模型｜訊息），可一鍵複製回報。
- **下載全部發音（離線用）**：一次抓完 1,288 個音節 mp3（約 25MB）進持久快取，可中斷續抓。
- **測試內建語音**：純同步觸發，用來分辨裝置/PWA 是否禁用 speechSynthesis。
- **完整備份**：匯出單一 JSON（全部 localStorage＋IndexedDB 圖片/語音/頭像），iOS 分享面板存「檔案」；不含 API Key；匯入完整覆蓋（保留本機金鑰）後自動重載。

### 通用
- 全介面與圖示自繪（SVG），禁用 iOS 長按選字與雙擊縮放；音效全部 WebAudio 合成零素材。
- 沒填 API Key 時為示範模式（示範字表＋示範故事，示範故事配內建插圖 `icons/demo-cat.svg`）。
- **小孩帳號的權限邊界（v1.23.0）**：`store.isKid()` 是全站唯一判斷點。小孩帳號只能翻頁、點字、開書、再讀一遍、玩遊戲、跟讀；故事頁的「新故事」「閱讀設定」（含編輯／重置／媒體管理）、跟讀頁的「AI 補足」「題庫」「評分嚴格度」、遊戲頁的「不熟模式」、設定分頁一律不顯示，`main.js` 的分頁切換也在程式面擋設定分頁。
- **救援層 `js/rescue.js`（v1.23.0）**：非 module 的傳統 script，在 `main.js` 之前載入。啟動完成前（`window.__autobookReady` 尚未為 true）的任何錯誤——含 module 語法錯、壞資料讓 store.js 求值失敗——會顯示最小救援畫面（重新載入／匯出資料／重設全部資料／先繼續使用）；啟動完成後的錯誤只寫進 `autobook.errlog`，不打擾小孩。`main.js` 各分頁 init 各自 try/catch，一個分頁壞掉不拖垮其他分頁。
- **資料層防護（v1.23.0）**：`store.load()` 對壞 JSON、`"null"`、型別不對的資料一律回預設值，原始內容先留在 `<key>.bad`（救援層匯出會帶上）；陣列型資料逐筆驗證必要欄位。`save()` 包 try/catch，寫入失敗（配額滿、私密模式）不炸呼叫端，改發 `autobook:savefail` 事件由 UI toast 提醒備份；`flushSaves` 逐 key 隔離，失敗的留在佇列。
- **書架上限（`MAX_STORIES` 24 本）不再靜默淘汰**：做新書（AI 或手動）前先用 `shelfVictim()` 檢查，滿了跳確認框說明會丟掉哪一本，不同意就不做、也不花 API。
- **內嵌影片加固**：YouTube 走 `youtube-nocookie.com` 並關掉控制列／鍵盤／全螢幕／註解，Vimeo 關掉標題／作者／頭像並 `dnt=1`；iframe 加 `sandbox="allow-scripts allow-same-origin allow-presentation"`（不給跳頁與彈窗），上面再蓋一層透明 `.media-shield` 吃掉點擊，小孩點影片不會跳出 App。
- **家長 PIN（v1.24.0）**：設定頁帳號區可設 4 位數 PIN（`settings.parentPin`）。「切回家長要確認」開關開著時：有 PIN 用 PIN 鍵盤，沒有就用個位數算術題（改 4 選 1）；通過後 5 分鐘內不再問；PIN 錯 3 次鎖 30 秒、之後每多錯一次加倍（鎖定寫在 `autobook.gateLock`，重開也還在）。關掉開關＝直接切換。
- **隱私說明（v1.24.0）**：設定頁最下方有「隱私說明」卡（哪些內容送 Google／Apple、免費層可能被用來改善產品、資料只在本機、備份含照片）；**第一次填 API Key 會先跳同一份說明要求「我知道了」**（`settings.privacyAck`）才存 Key。備份匯出的「準備好了」視窗也提醒檔案含小孩照片。iOS 殼補 `NSCameraUsageDescription`／`NSPhotoLibraryUsageDescription`（`<input type=file>` 在 WKWebView 會出現拍照選項）與 `PrivacyInfo.xcprivacy`（不追蹤、不收集；宣告 UserDefaults／FileTimestamp）。
- **備份匯入原子化（v1.24.0）**：先把整包「解析＋白名單過濾＋逐鍵型別驗證＋全部 base64 解碼」做完（檔案 ≤400 MB、單一 blob ≤80 MB），確認沒問題才開始寫；寫入前記下 localStorage 舊值，中途失敗就回復並提示。以前是邊驗證邊覆蓋，壞檔會留下三方不一致。
- **清除乾淨（v1.24.0）**：`clearAll()` 改為清所有 `BACKUP_KEYS`（含題庫、練習組）＋錯誤紀錄＋`.bad` 副本＋家長門鎖定；`removeAccount()` 連帶刪掉該帳號在字表 `cards`、故事 `hlBy/marksBy/readsBy`、題目 `stats` 裡的紀錄。
- **長流程可停止（v1.24.0）**：生成故事、準備發音、AI 補足、下載音節的視窗都有「⏹ 停止」；`gemini.js` 的 `call()`／`callStream()` 接受 `opts.signal`，停止時丟 `CANCELLED`（不重試、不進錯誤紀錄）。串流路徑本身沒動（行動 Safari 的 Load failed 對策照舊）。
- **串流回應被擋時講真因（v1.24.0）**：`callStream()` 記下 `promptFeedback.blockReason` 與 `finishReason`，什麼都沒回且原因不是 STOP 就丟 `BLOCKED：<原因>`（對策 `hint_blocked`），不再變成「不是有效的 JSON」重試三次。插圖對 401/403/429/BLOCKED 不再退一步重打。多音字偵測失敗（空陣列）不再永久存成 `polys: []`。
- **背景競態（v1.24.0）**：遊戲與跟讀各有 `viewSeq` 畫面世代；準備語音、懶生成配圖、延遲示範發音回來時若世代已變（使用者切走）一律放棄，不會在別的分頁出聲或蓋畫面。生成面板的語音輸入在面板關閉時 `abort()`，最長只收 30 秒。跟讀配圖、頭像、上傳預覽的 blob URL 在圖片解碼後即釋放。
- **CSP（v1.24.0）**：`index.html` 加 `Content-Security-Policy` meta（script 只准自家；connect 只到 Gemini；img／media 允許 https 連結與 blob；frame 只准 youtube-nocookie 與 Vimeo）與 `referrer=no-referrer`。**動到外部資源時記得同步改 CSP**。Capacitor 殼內若發現資源被擋，先查 Safari Web Inspector 的 CSP 訊息。
- **品質閘門（v1.24.0）**：`npm run lint`（ESLint flat config，`eslint.config.js`；資料表不檢查）與 `npm test`（`node:test`，`tests/`：壞資料回退、addWords 去重、shelfVictim、findNewChars、joinB64、errHintKey、pickWrong、scoreAttempt）。GitHub Actions 改為 **check（lint → test → build）→ deploy**，只發佈 `dist/`（不再把 `scripts/`、`ios/`、`tools/` 放上 Pages）。Capacitor 殼內隱藏「下載全部發音」（沒有 SW，抓了也讀不到）。
- **設計系統（v1.25.0，Phase 2）**：`css/app.css` 全面 token 化——色票（`--primary/--mint/--sky/--berry` 深色變體做硬邊陰影；`--ok/--no/--new/--warn` 學習狀態四色全站唯一一套；`--danger` 紅描邊只給刪除／清除／重置，且單獨成列 `.danger-row`）、型階 11 階、圓角 `--r-1/2/3/pill`、動效 `--t-press/switch/reward`、尺寸 `--tap-kid 64`／`--tap-parent 48`（`.btn` 小孩鈕、`.btn.small` 家長鈕）。彩色鈕全部白字對比 ≥3:1，黃底一律深字。
- **學習字改楷體（v1.25.0）**：`fonts/tw-kai-trad.woff2`（Big5 常用 5401＋詞庫，3.2 MB）＋ `fonts/tw-kai-simp.woff2`（簡體專有 1795 字，0.6 MB，`unicode-range` 按需載入），由 `tools/make_fonts.py` 從全字庫正楷體 TW-Kai 子集化（需 `pip install fonttools brotli`；原檔快取在 `tools/.cache/`）。只套在字塊、字卡、詞卡、選字、新字方塊、書架封面（`.zi .nc-zi .pick-zi .word-chip .w .fc-zi .choice-card .bk-art.plain`），`font-weight:400`＋`-webkit-text-stroke:.6px`，不合成粗體。授權標示在設定頁隱私卡（`kai_credit`）。字表外的罕用字會退回 PingFang。
- **標點附著（v1.25.0）**：故事字塊每個字包一層 `.zg`，後面的標點塞進同一個群組，flex 換行不會再出現行首標點；書名列同理。
- **✓✗ 角標（v1.25.0）**：`.mk-g/.mk-r/.fc-zi.g/.fc-zi.r` 的 `::after` 用 CSS mask 畫勾叉，紅綠色弱也分得出。
- **SVG 圖示庫（v1.25.0）**：`js/icons.js`（48 viewBox、圓頭粗線、currentColor，約 70 顆），`icon(name)` 回傳 `<svg class="ic">`；分頁列、頁首、按鈕、modal 標題（`openModal(title, { icon })`）全部改用，介面與 i18n 字串內不再放 emoji（只留故事內容與家長端生成 log）。
- **夜間模式（v1.25.0）**：設定頁「夜間模式（睡前共讀）」開關（`settings.theme`），`js/theme.js` 在 CSS 之前把 `data-theme="dark"` 寫到 `<html>`（不閃亮底），`:root[data-theme="dark"]` 整套 token 換色，`theme-color` meta 同步。
- **翻頁鈕方向（v1.25.0）**：改為左 ◀ 上一頁／右 ▶ 下一頁，橫直向一致（推翻 v1.1 的「下一頁在左」；防誤觸靠進度條隔離）。
- **a11y 基礎（v1.25.0）**：分頁列 `role=tablist/tab`＋`aria-selected`、modal `role=dialog aria-modal`、開關 `role=switch aria-checked`（`switchEl()`）、toast `aria-live`、圖示鈕全部 `aria-label`、`:focus-visible` 焦點環、`prefers-reduced-motion` 關動畫。`.page` 上緣避開瀏海、內容最寬 1280px 置中、插圖寬度有 160px 下限。
- **聽音認字的干擾項改 `pickWrong()`**：從「其他未入庫字」過濾後隨機取，只剩一個字時回 null 並略過該題（舊寫法 `while (wrong === ch)` 在只剩一個未入庫字時會無限迴圈凍住 iPad）；開始前檢查的是「未入庫字數 ≥ 4」而非字表總數。

## 發音架構（重要）

**`js/voice.js` 是統一入口**，優先序：

| 順位 | 來源 | 特性 |
|---|---|---|
| 1 | **AI 語音快取**（IndexedDB `audio`） | 音質最自然；生成不穩定，有多少算多少 |
| 2 | **音節庫** `syl/*.mp3` | App 自帶靜態檔，臺灣讀音、離線、**永不失敗** |
| 3 | **裝置內建語音** `speakNative()` | 最後保底；也負責音節庫沒有的輕聲字與多音字整詞 |

- **音節庫**：1,288 個「拼音音節」mp3（不是一字一檔——全中文字共用約 1,300 個音節）＋ `js/readings.js` 的 26,367 字對照表。**加新字不需要任何下載**，查表即得。
- 授權：[davinfifield/mp3-chinese-pinyin-sound](https://github.com/davinfifield/mp3-chinese-pinyin-sound)，**Unlicense（公有領域）**；讀音來源 Unicode Unihan `kMandarin`，**兩讀音時取臺灣讀音**。
- **音節庫不受「清除語音快取」影響**（那顆只清 IndexedDB），也不受 App 版本更新影響（獨立持久快取 `autobook-syl-1`）。
- **決策必須同步**：iOS 要求聲音在使用者手勢的同步呼叫堆疊中觸發，所以用 `hasAudioCached()`（開站載入的同步索引）判斷走哪條路，**不能先 await 查 IndexedDB**。
- 多音字：故事頁「準備發音」時由文字模型偵測本篇多音字＋所屬詞（存 `story.polys`），TTS 以整詞快取（key `w:詞`）；缺快取時用內建語音唸整詞（會依詞境自動選對讀音）。

## 本地開發

```bash
python3 tools/devserver.py 8123
```

開 `http://localhost:8123`（devserver 帶 no-cache 標頭，避免開發時吃到舊檔）。

## 部署

push `main` → GitHub Actions 自動部署 Pages（`.github/workflows/pages.yml`）。iPad Safari 開網址 → 分享 → 加入主畫面。

⚠️ **刪除主畫面 PWA 圖示會連同本機資料一起刪**——刪之前先到設定頁匯出完整備份。

## Gemini 設定

[Google AI Studio](https://aistudio.google.com/apikey) 取得 API Key 貼進設定頁；一把 key 可呼叫全部模型，選填的 TTS 專用 Key 供配額隔離。Key 只存裝置 localStorage，瀏覽器直連 Google API。

| 用途 | 預設模型（設定頁「進階」可改） | 端點 |
|---|---|---|
| 故事/多音字偵測 | `gemini-3-flash-preview` | **串流** `streamGenerateContent` |
| 插圖 | `gemini-2.5-flash-image` | **串流** `streamGenerateContent` |
| 語音 | `gemini-2.5-flash-preview-tts`（角色 `Leda`） | 一般 `generateContent` |
| 跟讀出題／測試連線 | `gemini-3-flash-preview` | 一般 `generateContent` |

## 資料結構

- localStorage：`autobook.settings` / `words` / `stories` / `accounts` / `currentAccount` / `phrases` / `repGroups` / `errlog`（API 錯誤紀錄，最多 30 筆）。
- `word`：`{ ch, addedAt, usedCount, readCount, archived, cards }`；熟悉度在 `cards['帳號id|語系']`。
- `story`：`{ id, title, text, lang, createdAt, newChars, hasImage, imagePrompt, demo, hlBy, marksBy, readsBy, media, polys }`
  - `hlBy['帳號id'] = [索引]`（高亮模式）、`marksBy['帳號id'] = { 索引: 'green'|'red' }`（標註模式）——**都依帳號分開**；舊版全域 `highlights` 會自動遷移給第一個開啟的帳號。
  - `readsBy['帳號id'] = 讀完整本的次數`（高亮／標註都算），決定這一遍要打開哪一組媒體。
  - `media = [{ id, kind: 'image'|'video', url? }]`：`url` 有值＝外部連結，沒有＝blob 存在 IndexedDB `images`（key＝`m.id`）。**沒有 `media` 欄位的舊資料**由 `storyMedia()` 相容轉換成 `hasImage ? [{ id: 故事id, kind:'image' }] : []`，不做寫入式遷移；`hasImage` 仍同步維護（書架封面在看）。
  - `polys = [{ char, word }]`（多音字，每本偵測一次）。
- IndexedDB `autobook`（v2）：`images`（故事 id、故事媒體 `故事id|m…`、`ph|題目id`）、`audio`（中文按字、多音字詞 `w:詞`、英文 `en|小寫句子`）、`avatars`（帳號 id）。**影片也放 `images` store**（就是個 blob KV，不另開 store 免得動 DB 版本）；備份匯出是照 store 逐鍵掃的，所以影片會一起匯出——長片建議改用連結。
- Cache Storage：`autobook-v<版本>`（app shell，換版清除）、**`autobook-syl-1`（音節音檔，換版不清）**。
- 版本升級的資料遷移一律就地進行，不清資料。

## 生成檔與工具腳本（`tools/`）

| 腳本 | 產物 | 說明 |
|---|---|---|
| `make_icons.py` | `icons/icon2-*.png` | 向量兔子 icon。**改 icon 必須換檔名**破 iOS 快取，並同步改 index.html/manifest/sw.js |
| `make_wordbank.py <資料目錄>` | `js/wordbank.js` | 8000 常用詞（jieba × CC-CEDICT，含幼教黑名單）。需 `jieba_dict.txt`、`cedict.u8` |
| `make_phonemes.py <資料目錄>` | `js/phonemes.js` | 8660 詞音素庫（CMUdict × google-10000）。需 `cmudict.dict`、`common10k.txt` |
| `make_syllabank.py <mp3目錄> <Unihan_Readings.txt>` | `syl/*.mp3`＋`js/readings.js` | 音節庫。mp3 來源見「發音架構」；讀音取 Unihan `kMandarin` 臺灣讀音。**個別字讀音要修改，改腳本裡的 `TW_OVERRIDES` 重跑** |
| （手動流程） | `js/zhconv.js` | OpenCC 生成的繁簡單字表（主要對應、僅 BMP） |

## 改版流程

1. 改 `js/store.js` 的 `VERSION` ＋ `sw.js` 的 `CACHE`（兩者必須同步，否則客戶端不換快取）＋ `package.json` 的 `version` ＋ `ios/App/App.xcodeproj/project.pbxproj` 的 `MARKETING_VERSION`（兩處）。
2. 新增 JS 檔要加進 `sw.js` 的 `SHELL` 清單。
3. push 前先跑 `npm run lint && npm test`（CI 沒過就不會部署）。
3. commit → push `main` → 等 Actions 綠燈 → iPad 重開 PWA（SW network-first，線上自動拿新版）。
4. 動到音節庫檔案內容才需要改 `SYL_CACHE` 版本（會讓使用者重抓 25MB，非必要別動）。

## 其他技術備註

- **標註寫入是延遲合併的**（store.js `scheduleSave`）：點讀/標紅綠每一下都「存檔」，同步 stringify＋寫 localStorage 連點會卡，改為閒置 400ms 才落盤；`pagehide`/切背景強制 flush；備份匯出前呼叫 `flushSaves()`、匯入與清除資料呼叫 `cancelPendingSaves()`（否則 reload 前的 flush 會把舊資料蓋回去）。
- 故事頁的 `resize` 監聽每次 render 前先移除上一個（曾經每次 render 累加一個、抓著舊 DOM 不放，越用越卡）。
- 迷霧為 canvas 疊層，以故事 id 做種子決定揭開順序；`Fog.revealAll()` 負責完讀揭曉的分批散開。
- 故事/出題走 JSON schema 輸出＋前端驗證重試。
- 跟讀評分：`repeat.js scoreAttempt()`，嚴格度參數表 `STRICT_CFG`；音素比對 `phonemesOf()`。
- **熟悉度打通**：故事標註、認字卡、字表三個入口共用同一份 `word.cards` 紀錄，**以最後一次標註為準**（`store.setMark()` / `cycleMark()`）。

### 踩過的坑（別再踩）

- **iOS 手勢限制**：`speechSynthesis` 必須在使用者手勢的**同步**呼叫堆疊中觸發。點擊後先 `await` 查 IndexedDB 再發音會**默默無聲**（不報錯）。→ 用同步索引 `hasAudioCached()` 決策。相關保險：首次觸控用空 utterance 解鎖、保留 utterance 引用防 GC、`speak()` 後補 `resume()`、監聽 `voiceschanged`。
- **行動 Safari 砍長請求**：單一請求久無回應（約 60 秒）會被砍，錯誤是 `Load failed`。故事與插圖生成最容易中獎 → **改走串流端點**，資料持續流動就不會被判定逾時。串流圖片的 base64 可能分段，`joinB64()` 同時處理「各段獨立編碼」與「同一段被切開」兩種情形。
- **行動網路偶發斷線自動重試**：`call()` 與 `callStream()` 遇網路錯誤（含串流讀到一半斷線）自動重試 2 次（1 秒、3 秒退避）；逾時不重試。讀流中斷一律包成「網路錯誤」讓 `generateStory` 的三輪嘗試能正確接手。
- **思考壓最低（Load failed 主因對策）**：會思考的模型收到請求後可能沉默 30~60 秒才吐第一個字，SSE 沒有資料流動時行動 Safari 會砍閒置連線。故事/多音字/診斷 JSON 一律帶 `thinkingConfig`（gemini-3 → `thinkingLevel:'low'`；gemini-2.5 → `thinkingBudget:0`），讓首批字幾秒內就到；模型不吃這參數（HTTP 400）會自動拿掉重試並記住（`thinkUnsupported`）。
- **Gemini TTS 不是傳統 TTS**，是「被要求只出聲音的 LLM」：
  - 單字直接送會被當成聊天訊息 → 想用文字回答 → HTTP 400 或 200 但無音訊。→ 一定要加明確朗讀指示。
  - 單一漢字會讓它猜錯語言（玉→tama、田→tan 是日語訓讀）→ 指示中明確指定臺灣華語正式讀音。
  - 即使如此**成功率仍只有約 35%**（`finishReason=OTHER`），flash 與 pro 都一樣 → 這就是導入音節庫的原因。AI 語音現在只是錦上添花。
- **繁簡同形字**：簡體模式下 `髮`/`發` 都顯示成 `发`。所有快取 key、TTS 送出的字、對照表查詢**一律用儲存的原字形**（繁體），不能用顯示字形——否則兩個字會共用同一份音。
- **繁簡對照表的陷阱**：`zhconv.js` 對「一簡對多繁」只取主對應，且取的是非自身的那個（`s2t(游)=遊`、`s2t(后)=後`），會讓 `游/遊`、`后/後` 被誤判為等價字而去重。→ `store.js` 的 `SELF_HANT` 例外集處理。
