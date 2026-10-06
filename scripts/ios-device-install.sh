#!/bin/bash
# ─────────────────────────────────────────────────────────────
# 實機自動部署（抄自 mg-zukan2/scripts/ios-device-install.sh）
# 用法：
#   ios-device-install.sh auto   … launchd 用。裝置連線＋（HEAD 變了 or 滿 5 天）才執行
#   ios-device-install.sh force  … 手動用（npm run ios:device）。不管條件立刻執行
# 流程：node --check 全部 js（品質閘門）→ build dist + cap sync → 逐台（xcodebuild 簽名、
#       目標指名該台的 id、build number＝commit 數 → devicectl install）→ 通知＋寫紀錄
# 前提：iPad 用 USB 或同一 Wi-Fi（首次接線時已勾 Connect via network），
#       安裝當下需解鎖（失敗會在下個週期自動重試）
# 免費開發者帳號簽名 7 天到期 → 每 5 天自動重簽重裝一次
# ─────────────────────────────────────────────────────────────
set -u

REPO="/Users/kishoujpjp/Databases/Scripts/TempBuilding/Autobook"
# 目標裝置（udid|顯示名）。新增裝置：接線信任＋開發者模式後加一行就好，
# 建置本身會帶 -allowProvisioningDeviceRegistration 自動登錄到描述檔。
DEVICES=(
  "773F74E2-B275-5B55-AD68-9E2C9F4FBA30|KipadPro12.9"
)
STATE_DIR="$HOME/.autobook-deploy"
LOG="$STATE_DIR/deploy.log"        # 狀態在 state.<udid>（第 1 行 commit／第 2 行 epoch）
LOCK="$STATE_DIR/lock"
RESIGN_SECS=$((5 * 24 * 3600))
APP_OUT="$REPO/ios/App/build-device/Build/Products/Debug-iphoneos/App.app"

[ -d /Applications/Xcode-beta.app ] && export DEVELOPER_DIR=/Applications/Xcode-beta.app
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export LANG=zh_TW.UTF-8 LC_ALL=zh_TW.UTF-8

mkdir -p "$STATE_DIR"
ts()     { date "+%F %T"; }
log()    { echo "$(ts) $*" >> "$LOG"; }
notify() { osascript -e "display notification \"$2\" with title \"自動繪本 部署\" subtitle \"$1\"" >/dev/null 2>&1 || true; }

MODE="${1:-auto}"
cd "$REPO" || exit 1

# ── 單一執行鎖（超過 2 小時的殘骸直接搶） ──
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +120 2>/dev/null)" ]; then
    rmdir "$LOCK" 2>/dev/null; mkdir "$LOCK" 2>/dev/null || exit 0
  else
    exit 0
  fi
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

HEAD_HASH=$(git rev-parse HEAD 2>/dev/null) || exit 1
HEAD_SUBJ=$(git log -1 --format=%s 2>/dev/null | head -c 60)

# ── 逐裝置判斷要不要裝（連線中且「HEAD 變了 or 滿 5 天」） ──
# 新版 Xcode 預設 Identifier 顯示 UDID；加上全部欄位才保留既有 CoreDevice UUID。
CONNECTED=$(xcrun devicectl list devices --columns '*' 2>/dev/null)
NEEDY=()
for D in "${DEVICES[@]}"; do
  UDID="${D%%|*}"; NAME="${D##*|}"
  echo "$CONNECTED" | grep "$UDID" | grep -qE "connected|available" || continue
  if [ "$MODE" = "force" ]; then NEEDY+=("$D|手動執行"); continue; fi
  ST="$STATE_DIR/state.$UDID"; INST_HASH=""; INST_AT=0
  [ -f "$ST" ] && { INST_HASH=$(sed -n 1p "$ST"); INST_AT=$(sed -n 2p "$ST"); }
  AGE=$(( $(date +%s) - ${INST_AT:-0} ))
  if [ "$HEAD_HASH" != "$INST_HASH" ]; then NEEDY+=("$D|新版 ${HEAD_HASH:0:7}")
  elif [ "$AGE" -ge "$RESIGN_SECS" ]; then NEEDY+=("$D|5天重簽"); fi
done
if [ ${#NEEDY[@]} -eq 0 ]; then
  for D in "${DEVICES[@]}"; do
    UDID="${D%%|*}"; NAME="${D##*|}"
    ST="$STATE_DIR/state.$UDID"; INST_HASH=""
    [ -f "$ST" ] && INST_HASH=$(sed -n 1p "$ST")
    [ "$HEAD_HASH" != "$INST_HASH" ] && log "· $NAME 落後中（${INST_HASH:0:7}→${HEAD_HASH:0:7}）但不在線＝等待"
  done
  exit 0
fi

log "── 部署開始（${#NEEDY[@]} 台）$HEAD_SUBJ"

# ── 品質閘門：任一 js 語法錯就不部署 ──
for f in js/*.js tools/*.mjs; do
  if ! node --check "$f" >> "$LOG" 2>&1; then
    log "✗ $f 語法錯誤 → 中止"; notify "中止" "$f 語法錯誤"; exit 1
  fi
done

# ── web 資產 → 原生殼 ──
if ! npm run build >> "$LOG" 2>&1 || ! npx cap sync ios >> "$LOG" 2>&1; then
  log "✗ build/cap sync 失敗"; notify "中止" "web build 失敗"; exit 1
fi

# ── 逐台建置＋安裝（需解鎖；失敗的裝置下個週期再試） ──
# 建置目標一定指名這台的 id，不用 generic/platform=iOS：免費帳號的描述檔一次只放得下
# 一台，用 generic 重簽時會被別台（例如同一個 Apple ID 的 iPhone）頂掉，iPad 那邊就會
# 收到 0xe8008012 This provisioning profile cannot be installed on this device。
# -allowProvisioningDeviceRegistration 讓沒登錄過的裝置在這時候自動加進描述檔。
BUILD_NO=$(git rev-list --count HEAD)
FAIL=0
for E in "${NEEDY[@]}"; do
  UDID=$(echo "$E" | cut -d'|' -f1); NAME=$(echo "$E" | cut -d'|' -f2); REASON=$(echo "$E" | cut -d'|' -f3)

  if ! xcodebuild -project ios/App/App.xcodeproj -scheme App \
      -destination "platform=iOS,id=$UDID" -configuration Debug \
      -derivedDataPath ios/App/build-device \
      -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
      CURRENT_PROJECT_VERSION="$BUILD_NO" build >> "$LOG" 2>&1; then
    log "✗ $NAME xcodebuild 失敗 → 下個週期重試"
    notify "中止：$NAME" "實機建置失敗（看 log）"
    FAIL=1; continue
  fi

  OUT="$STATE_DIR/last-install.$UDID.txt"
  if xcrun devicectl device install app --device "$UDID" "$APP_OUT" > "$OUT" 2>&1; then
    cat "$OUT" >> "$LOG"
    printf "%s\n%s\n" "$HEAD_HASH" "$(date +%s)" > "$STATE_DIR/state.$UDID"
    log "✓ $NAME 部署完成 build#$BUILD_NO ${HEAD_HASH:0:7}（${REASON}）"
    notify "完成：$NAME" "build#$BUILD_NO ${HEAD_HASH:0:7} $HEAD_SUBJ"
  else
    cat "$OUT" >> "$LOG"
    # 通知寫 iPad 回的真正原因，不要猜「可能未解鎖」
    # RecoverySuggestion 才有錯誤碼（0xe8008012 之類），FailureReason 通常只有一句籠統的話
    WHY=$(grep -m1 'NSLocalizedRecoverySuggestion' "$OUT" | sed -E 's/^[[:space:]]*NSLocalized[A-Za-z]+ = //')
    [ -z "$WHY" ] && WHY=$(grep -m1 'NSLocalizedFailureReason' "$OUT" | sed -E 's/^[[:space:]]*NSLocalized[A-Za-z]+ = //')
    [ -z "$WHY" ] && WHY=$(grep -m1 -E '^[[:space:]]*ERROR:' "$OUT" | sed -E 's/^[[:space:]]*//')
    [ -z "$WHY" ] && WHY="原因不明，看 $LOG"
    WHY=$(echo "$WHY" | tr -d '\\"' | cut -c1-150)
    log "✗ $NAME install 失敗：$WHY → 下個週期重試"
    notify "保留：$NAME" "$WHY"
    FAIL=1
  fi
done
exit $FAIL
