#!/bin/bash
# Launch Chrome in debug mode for Token-Free Gateway webauth
# Supports macOS / Linux (including Deepin) / Windows (Git Bash / WSL)

echo "=========================================="
echo "  Token-Free Gateway — Chrome Debug Mode"
echo "=========================================="
echo ""

detect_os() {
  case "$(uname -s)" in
    Darwin*)  echo "mac" ;;
    MINGW*|MSYS*|CYGWIN*) echo "win" ;;
    *)
      if grep -qi microsoft /proc/version 2>/dev/null; then
        echo "wsl"
      else
        echo "linux"
      fi
      ;;
  esac
}

detect_chrome() {
  local linux_paths=(
    "/opt/apps/cn.google.chrome-pre/files/google/chrome/google-chrome"
    "/opt/google/chrome/google-chrome"
    "/usr/bin/google-chrome"
    "/usr/bin/google-chrome-stable"
    "/usr/bin/chromium"
    "/usr/bin/chromium-browser"
    "/snap/bin/chromium"
  )
  local mac_paths=(
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
  )
  local win_paths=(
    "$PROGRAMFILES/Google/Chrome/Application/chrome.exe"
    "$PROGRAMFILES (x86)/Google/Chrome/Application/chrome.exe"
    "$LOCALAPPDATA/Google/Chrome/Application/chrome.exe"
  )

  case "$OS" in
    mac)
      for p in "${mac_paths[@]}"; do
        [ -f "$p" ] && echo "$p" && return
      done
      command -v google-chrome >/dev/null 2>&1 && echo "google-chrome" && return
      ;;
    win)
      for p in "${win_paths[@]}"; do
        [ -f "$p" ] && echo "$p" && return
      done
      ;;
    wsl|linux)
      for p in "${linux_paths[@]}"; do
        [ -f "$p" ] && echo "$p" && return
      done
      for cmd in google-chrome google-chrome-stable chromium chromium-browser; do
        command -v "$cmd" >/dev/null 2>&1 && echo "$cmd" && return
      done
      ;;
  esac
  echo ""
}

detect_user_data_dir() {
  case "$OS" in
    mac)  echo "$HOME/Library/Application Support/Chrome-TFG-Debug" ;;
    win)  echo "$LOCALAPPDATA/Chrome-TFG-Debug" ;;
    *)    echo "$HOME/.config/chrome-tfg-debug" ;;
  esac
}

OS=$(detect_os)
CHROME_PATH=$(detect_chrome)
USER_DATA_DIR=$(detect_user_data_dir)

echo "System: $OS"

if [ -z "$CHROME_PATH" ]; then
  echo "✗ Chrome / Chromium not found. Please install Chrome first."
  exit 1
fi

echo "Chrome: $CHROME_PATH"
echo "User data dir: $USER_DATA_DIR"
echo ""

# Kill existing debug Chrome
if pgrep -f "chrome.*remote-debugging-port=9222" > /dev/null 2>&1; then
  echo "Closing existing debug Chrome..."
  pkill -f "chrome.*remote-debugging-port=9222" 2>/dev/null
  sleep 2
  if pgrep -f "chrome.*remote-debugging-port=9222" > /dev/null 2>&1; then
    pkill -9 -f "chrome.*remote-debugging-port=9222" 2>/dev/null
    sleep 1
  fi
  echo "✓ Closed"
  echo ""
fi

TMP_LOG="/tmp/chrome-tfg-debug.log"
[ ! -d /tmp ] && TMP_LOG="$HOME/chrome-tfg-debug.log"

echo "Starting Chrome debug mode on port 9222..."

"$CHROME_PATH" \
  --remote-debugging-port=9222 \
  --user-data-dir="$USER_DATA_DIR" \
  --no-first-run \
  --no-default-browser-check \
  --disable-background-networking \
  --disable-sync \
  --disable-translate \
  --disable-features=TranslateUI \
  --remote-allow-origins=* \
  > "$TMP_LOG" 2>&1 &

CHROME_PID=$!

echo "Waiting for Chrome startup..."
for i in {1..15}; do
  if curl -s http://127.0.0.1:9222/json/version > /dev/null 2>&1; then
    break
  fi
  echo -n "."
  sleep 1
done
echo ""

if curl -s http://127.0.0.1:9222/json/version > /dev/null 2>&1; then
  VERSION_INFO=$(curl -s http://127.0.0.1:9222/json/version | python3 -c "import sys,json;print(json.load(sys.stdin).get('Browser','unknown'))" 2>/dev/null || echo "unknown")

  echo ""
  echo "✓ Chrome debug mode started!"
  echo ""
  echo "  PID: $CHROME_PID"
  echo "  Version: $VERSION_INFO"
  echo "  CDP: http://127.0.0.1:9222"
  echo ""

  echo "Opening provider login pages..."

  WEB_URLS=(
    "https://claude.ai/new"
    "https://chatgpt.com"
    "https://chat.deepseek.com/"
    "https://www.doubao.com/chat/"
    "https://chat.qwen.ai"
    "https://www.kimi.com"
    "https://gemini.google.com/app"
    "https://grok.com"
    "https://chatglm.cn"
    "https://chat.z.ai/"
    "https://www.perplexity.ai"
    "https://aistudio.xiaomimimo.com"
  )
  for url in "${WEB_URLS[@]}"; do
    "$CHROME_PATH" --remote-debugging-port=9222 --user-data-dir="$USER_DATA_DIR" "$url" > /dev/null 2>&1 &
    sleep 0.5
  done

  echo ""
  echo "=========================================="
  echo "  Next steps:"
  echo "=========================================="
  echo "  1. Log in to each provider in the browser tabs"
  echo "  2. Run: bun run webauth"
  echo "  3. Select providers to authorize"
  echo ""
  echo "  To stop: pkill -f 'chrome.*remote-debugging-port=9222'"
  echo "=========================================="
else
  echo ""
  echo "✗ Chrome failed to start"
  echo "  Check: $TMP_LOG"
  echo "  Try: lsof -i:9222"
  exit 1
fi
