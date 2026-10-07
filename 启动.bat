@echo off
chcp 65001 >nul
REM 星月占卜 - 一键启动(使用旁侧免安装版 Node.js)
REM 同时启动:语音代理(识别/播报,端口 3000)+ Vite 前端(端口 5173)
cd /d "%~dp0"
set "PATH=D:\星月\node-v22.23.3-win-x64;%PATH%"
start "星月-语音代理" cmd /k "title 星月-语音代理 && node tts-proxy.cjs"
echo 星月占卜正在启动,浏览器打开后请访问: http://localhost:5173/
echo 按 Ctrl+C 可停止前端服务(语音代理窗口需单独关闭)。
start "" "http://localhost:5173/"
npm run dev
pause
