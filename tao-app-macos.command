#!/bin/bash
# Tạo "Ăn Dặm Radar.app" trong ~/Applications: mở như ứng dụng bình thường (Launchpad, Spotlight, kéo vào Dock).
# App chỉ là lối tắt — nó mở Terminal và chạy chay-app.command của thư mục dự án này, nên cập nhật code
# (git pull) không cần tạo lại app. Chuyển thư mục dự án sang chỗ khác thì chạy lại file này.

cd "$(dirname "$0")" || exit 1
DIR="$(pwd)"
APP="$HOME/Applications/Ăn Dặm Radar.app"

if [ "$(uname)" != "Darwin" ]; then
  echo "  File này chỉ dùng trên macOS."
  exit 1
fi

chmod +x "$DIR/chay-app.command"
mkdir -p "$HOME/Applications"
rm -rf "$APP"

# Đường dẫn được đặt trong dấu nháy cho AppleScript lẫn shell (thư mục có dấu cách, tiếng Việt).
ESCAPED=$(printf '%s' "$DIR/chay-app.command" | sed 's/\\/\\\\/g; s/"/\\"/g')
osacompile -o "$APP" -e "tell application \"Terminal\"
  activate
  do script quoted form of \"$ESCAPED\"
end tell" || { echo "  Không tạo được app."; read -r -p "  Nhấn Enter để đóng..." _; exit 1; }

echo
echo "  Đã tạo: $APP"
echo "  Mở bằng Launchpad / Spotlight (gõ \"Ăn Dặm Radar\"), hoặc kéo app vào Dock."
open -R "$APP"
read -r -p "  Nhấn Enter để đóng cửa sổ này..." _
