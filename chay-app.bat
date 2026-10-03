@echo off
chcp 65001 >nul
title Ăn Dặm Radar
cd /d "%~dp0"

rem --- Kiểm tra Node.js ---
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Chưa cài Node.js. Đang mở trang tải về - hãy cài bản LTS rồi chạy lại file này.
  start "" https://nodejs.org/
  pause
  exit /b 1
)

rem --- Lần đầu chạy: cài thư viện ---
if not exist "node_modules\" (
  echo  Lần đầu chạy: đang cài thư viện, chờ khoảng 1 phút...
  call npm install --no-fund --no-audit
  if errorlevel 1 (
    echo  Cài thư viện thất bại. Kiểm tra kết nối mạng rồi chạy lại.
    pause
    exit /b 1
  )
)

rem --- Cổng: mặc định 3000, hoặc PORT trong file .env ---
set "PORT=3000"
if exist ".env" (
  for /f "usebackq tokens=1,* delims==" %%a in (`findstr /b /c:"PORT=" ".env"`) do if not "%%~b"=="" set "PORT=%%~b"
)
set "URL=http://localhost:%PORT%"

rem --- App đã chạy sẵn ở cửa sổ khác: chỉ mở trình duyệt ---
netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul
if not errorlevel 1 (
  echo  App đang chạy sẵn - mở %URL%
  if not defined NO_BROWSER start "" "%URL%"
  ping -n 3 127.0.0.1 >nul
  exit /b 0
)

rem --- Mở trình duyệt khi server sẵn sàng (chạy ngầm). NO_BROWSER=1 để bỏ qua. ---
if not defined NO_BROWSER start "" /min powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 60;$i++){try{Invoke-WebRequest -UseBasicParsing '%URL%/api/meta' -TimeoutSec 2 | Out-Null; Start-Process '%URL%'; break}catch{Start-Sleep -Milliseconds 500}}"

echo.
echo  Đang khởi động Ăn Dặm Radar tại %URL%
echo  Giữ cửa sổ này mở trong lúc dùng. Bấm Ctrl+C hoặc đóng cửa sổ để tắt app.
echo.
node server.js

echo.
echo  App đã dừng.
pause
