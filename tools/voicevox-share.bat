@echo off
chcp 65001 > nul
title VOICEVOX 共有サーバー（スーパー編集メーカー）
cd /d "%~dp0"
echo VOICEVOX を起動してから使ってください。このウィンドウを閉じると共有が止まります。
echo.
node voicevox-share.mjs %*
echo.
pause
