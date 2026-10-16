param(
  [Parameter(Mandatory=$true)][string]$PublicOrigin,
  [Parameter(Mandatory=$true)][string]$TokenFile
)
$ErrorActionPreference='Stop'
$origin=[Uri]$PublicOrigin
if ($origin.Scheme -ne 'https' -or $origin.AbsolutePath -ne '/' -or $origin.Query -or $origin.Fragment -or $origin.UserInfo -or $origin.Host -notmatch '\.' -or $origin.Host -match '(?i)(^|\.)trycloudflare\.com$') { throw '请填写自己的 HTTPS 域名，不含路径、查询或账号。' }
$resolvedToken=(Resolve-Path -LiteralPath $TokenFile).Path
if (-not (Test-Path -LiteralPath $resolvedToken -PathType Leaf)) { throw 'Token 文件不存在。' }
$deploy='E:\AAA数据库\知序服务器'
New-Item -ItemType Directory -Path $deploy -Force | Out-Null
# The secret stays in the external token file, never in source code or command output.
@{ publicOrigin=$origin.GetLeftPart([UriPartial]::Authority); tokenFile=$resolvedToken } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $deploy 'fixed-tunnel.json') -Encoding utf8
Write-Output '固定隧道配置已写入。请先在 Cloudflare 发布该域名并指向 http://127.0.0.1:4317，再按部署指南重启知序守护进程。当前服务不会立刻切换。'
