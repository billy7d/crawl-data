#!/bin/bash
# Ăn Dặm Radar — chạy app trên macOS (và Linux). Nhấp đúp file này trong Finder, hoặc: ./chay-app.command
# Lần đầu tự cài thư viện, chạy server và mở trình duyệt khi app sẵn sàng. Đóng cửa sổ Terminal
# (hoặc bấm Ctrl+C) để tắt app. NO_BROWSER=1 ./chay-app.command để không mở trình duyệt.

cd "$(dirname "$0")" || exit 1
printf '\033]0;Ăn Dặm Radar\007'

pause() {
  echo
  read -r -p "  Nhấn Enter để đóng cửa sổ này..." _
}

open_url() {
  [ -n "$NO_BROWSER" ] && return
  if command -v open >/dev/null 2>&1; then open "$1"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$1" >/dev/null 2>&1
  fi
}

# Finder mở .command bằng shell không đọc ~/.zshrc: thêm các chỗ cài Node phổ biến vào PATH
# (Homebrew Apple Silicon / Intel, bộ cài nodejs.org, nvm, Volta, fnm).
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
  command -v fnm >/dev/null 2>&1 && eval "$(fnm env)"
fi

# --- Kiểm tra Node.js (cần bản 22.13 trở lên: app dùng SQLite tích hợp của Node) ---
if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Chưa cài Node.js."
  if command -v brew >/dev/null 2>&1; then
    echo "  Cài bằng Homebrew:  brew install node"
  else
    echo "  Đang mở trang tải về — hãy cài bản LTS (file .pkg) rồi nhấp đúp lại file này."
    open_url "https://nodejs.org/"
  fi
  pause
  exit 1
fi
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)'; then
  echo
  echo "  Node.js $(node -v) đã cũ — app cần Node 22.13 trở lên."
  if command -v brew >/dev/null 2>&1; then echo "  Cập nhật:  brew upgrade node"
  else echo "  Tải bản LTS mới tại https://nodejs.org/ rồi chạy lại."; open_url "https://nodejs.org/"
  fi
  pause
  exit 1
fi

# --- Lần đầu chạy (hoặc sau khi cập nhật thư viện): cài thư viện ---
if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  echo "  Đang cài thư viện (lần đầu mất khoảng 1 phút)..."
  if ! npm install --no-fund --no-audit; then
    echo "  Cài thư viện thất bại. Kiểm tra kết nối mạng rồi chạy lại."
    pause
    exit 1
  fi
  touch node_modules
fi

# --- Cổng: mặc định 3000, hoặc PORT trong file .env ---
PORT=3000
if [ -f .env ]; then
  P=$(grep -E '^PORT=' .env | tail -n 1 | cut -d= -f2- | tr -d '"'"'"' \r')
  [ -n "$P" ] && PORT="$P"
fi
URL="http://localhost:$PORT"
export PORT

# --- App đã chạy sẵn ở cửa sổ khác: chỉ mở trình duyệt ---
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "  App đang chạy sẵn — mở $URL"
  open_url "$URL"
  sleep 2
  exit 0
fi

# --- Mở trình duyệt khi server sẵn sàng (chạy ngầm) ---
if [ -z "$NO_BROWSER" ]; then
  (
    for _ in $(seq 1 60); do
      if curl -fs -o /dev/null --max-time 2 "$URL/api/meta"; then open_url "$URL"; break; fi
      sleep 0.5
    done
  ) &
fi

echo
echo "  Đang khởi động Ăn Dặm Radar tại $URL"
echo "  Giữ cửa sổ này mở trong lúc dùng. Bấm Ctrl+C hoặc đóng cửa sổ để tắt app."
echo
node server.js
echo
echo "  App đã dừng."
pause
