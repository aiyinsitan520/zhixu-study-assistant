param([string]$PythonPath)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
if (-not $PythonPath) {
  $candidates=@(
    'C:\Users\28058\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\pythonw.exe',
    (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python313\pythonw.exe')
  )
  $PythonPath=$candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $PythonPath -or -not (Test-Path -LiteralPath $PythonPath)) { throw '未找到 Python。请使用 -PythonPath 指定带 tkinter 的 pythonw.exe 路径。' }
$desktop=[Environment]::GetFolderPath('Desktop')
$shell=New-Object -ComObject WScript.Shell
$shortcut=$shell.CreateShortcut((Join-Path $desktop '知序一键发布.lnk'))
$shortcut.TargetPath=(Resolve-Path -LiteralPath $PythonPath).Path
$shortcut.Arguments='"'+(Join-Path $PSScriptRoot 'public_publish.py')+'" --auto'
$shortcut.WorkingDirectory=$projectRoot
$shortcut.Description='检查并恢复知序网站，获取已验证的最新公网 HTTPS 链接'
$shortcut.IconLocation='C:\Windows\System32\shell32.dll,14'
$shortcut.Save()
Write-Output (Join-Path $desktop '知序一键发布.lnk')
