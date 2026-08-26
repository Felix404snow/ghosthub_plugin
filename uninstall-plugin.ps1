# GhostHub — remover plugin do Discord
# Uso: irm "https://ghosthub.fun/uninstall-plugin.ps1" | iex
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Continue'

$MarkerStart = '/* === GhostHub inject start === */'
$MarkerEnd   = '/* === GhostHub inject end === */'
$InstallDir  = Join-Path $env:APPDATA 'GhostHub'

Write-Host ''
Write-Host '  GhostHub — removendo plugin...' -ForegroundColor Cyan

foreach ($n in @('Discord', 'DiscordCanary', 'DiscordPTB')) {
    Get-Process -Name $n -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2

$roots = @()
foreach ($b in @('Discord', 'DiscordCanary', 'DiscordPTB')) {
    $p = Join-Path $env:LOCALAPPDATA $b
    if (Test-Path $p) { $roots += $p }
}

foreach ($root in $roots) {
    Get-ChildItem -Path $root -Directory -Filter 'app-*' -ErrorAction SilentlyContinue | ForEach-Object {
        $modules = Join-Path $_.FullName 'modules'
        if (-not (Test-Path $modules)) { return }
        Get-ChildItem -Path $modules -Directory -Filter 'discord_desktop_core-*' -ErrorAction SilentlyContinue | ForEach-Object {
            $idx = Join-Path $_.FullName 'discord_desktop_core\index.js'
            $bak = $idx + '.ghosthub.bak'
            if (Test-Path $bak) {
                Copy-Item -LiteralPath $bak -Destination $idx -Force
                Write-Host "  * Restaurado: $idx" -ForegroundColor Green
            } elseif (Test-Path $idx) {
                $raw = [System.IO.File]::ReadAllText($idx)
                if ($raw.Contains($MarkerStart)) {
                    $pattern = [regex]::Escape($MarkerStart) + '[\s\S]*?' + [regex]::Escape($MarkerEnd) + '\r?\n?'
                    $raw = [regex]::Replace($raw, $pattern, '')
                    [System.IO.File]::WriteAllText($idx, $raw)
                    Write-Host "  * Limpo: $idx" -ForegroundColor Green
                }
            }
        }
    }
}

if (Test-Path $InstallDir) {
    Remove-Item -LiteralPath $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host '  * Pasta %APPDATA%\GhostHub removida' -ForegroundColor Green
}

Write-Host ''
Write-Host '  Pronto. Pode abrir o Discord de novo.' -ForegroundColor Green
Write-Host ''
try { $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown') } catch { Start-Sleep 2 }
