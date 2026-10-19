@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "ZHIXU_PYTHONW=C:\Users\28058\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\pythonw.exe"
if exist "%ZHIXU_PYTHONW%" (
  start "" "%ZHIXU_PYTHONW%" "%~dp0scripts\public_publish.py" --auto
  exit /b 0
)
echo 未找到 Python，请运行 scripts\install-publisher.ps1 -PythonPath 指定 pythonw.exe 路径。
pause
