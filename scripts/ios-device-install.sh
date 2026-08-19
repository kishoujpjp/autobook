#!/bin/bash
# ─────────────────────────────────────────────────────────────
# 實機自動部署（抄自 mg-zukan2/scripts/ios-device-install.sh）
# 用法：
#   ios-device-install.sh auto   … launchd 用。裝置連線＋（HEAD 變了 or 滿 5 天）才執行
#   ios-device-install.sh force  … 手動用（npm run ios:device）。不管條件立刻執行
# 流程：node --check 全部 js（品質閘門）→ build dist + cap sync → xcodebuild（簽名、
#       build number＝commit 數）→ devicectl install → 通知＋寫紀錄
# 前提：iPad 用 USB 或同一 Wi-Fi（首次接線時已勾 Connect via network），
#       安裝當下需解鎖（失敗會在下個週期自動重試）
# 免費開發者帳號簽名 7 天到期 → 每 5 天自動重簽重裝一次
# ─────────────────────────────────────────────────────────────
set -u

REPO="/Users/kishoujpjp/Databases/Scripts/TempBuilding/Autobook"
# 目標裝置（udid|顯示名）。新增裝置：接線信任＋開發者模式後，先用
# -destination "platform=iOS,id=<udid>" -allowProvisioningDeviceRegistration 建置一次登錄到描述檔，再加一行。
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
CONNECTED=$(xcrun devicectl list devices 2>/dev/null)
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

# ── 實機建置（build number＝commit 數，簽名用 Xcode 已登入的 Apple ID） ──
BUILD_NO=$(git rev-list --count HEAD)
if ! xcodebuild -project ios/App/App.xcodeproj -scheme App \
    -destination "generic/platform=iOS" -configuration Debug \
    -derivedDataPath ios/App/build-device -allowProvisioningUpdates \
    CURRENT_PROJECT_VERSION="$BUILD_NO" build >> "$LOG" 2>&1; then
  log "✗ xcodebuild 失敗"; notify "中止" "實機建置失敗（看 log）"; exit 1
fi

# ── 安裝（需解鎖；失敗的裝置下個週期再試） ──
FAIL=0
for E in "${NEEDY[@]}"; do
  UDID=$(echo "$E" | cut -d'|' -f1); NAME=$(echo "$E" | cut -d'|' -f2); REASON=$(echo "$E" | cut -d'|' -f3)
  if xcrun devicectl device install app --device "$UDID" "$APP_OUT" >> "$LOG" 2>&1; then
    printf "%s\n%s\n" "$HEAD_HASH" "$(date +%s)" > "$STATE_DIR/state.$UDID"
    log "✓ $NAME 部署完成 build#$BUILD_NO ${HEAD_HASH:0:7}（$REASON）"
    notify "完成：$NAME" "build#$BUILD_NO ${HEAD_HASH:0:7} $HEAD_SUBJ"
  else
    log "✗ $NAME install 失敗（可能未解鎖）→ 下個週期重試"
    notify "保留：$NAME" "安裝失敗，請解鎖 iPad"
    FAIL=1
  fi
done
exit $FAIL
