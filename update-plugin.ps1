# GhostHub Discord Plugin Updater
# Uso: irm "https://ghosthub.fun/update-plugin.ps1" | iex
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try { $null = chcp 65001 } catch {}

$ErrorActionPreference = 'Stop'
$BaseUrl      = if ($env:GH_BASE_URL) { $env:GH_BASE_URL.TrimEnd('/') } else { 'https://raw.githubusercontent.com/Felix404snow/ghosthub_plugin/main' }
$InstallDir   = Join-Path $env:APPDATA 'GhostHub'
$InjectFile   = Join-Path $InstallDir 'inject.js'
$RendererFile = Join-Path $InstallDir 'renderer.js'
$LogoPng      = Join-Path $InstallDir 'ghost.png'
$LogoIco      = Join-Path $InstallDir 'ghost.ico'
$MarkerStart  = '/* === GhostHub inject start === */'
$MarkerEnd    = '/* === GhostHub inject end === */'

function Write-Step([string]$msg, [string]$color = 'Cyan') {
    Write-Host "  * $msg" -ForegroundColor $color
}
function Write-Ok([string]$msg) { Write-Step $msg 'Green' }
function Write-Warn([string]$msg) { Write-Step $msg 'Yellow' }
function Write-Fail([string]$msg) { Write-Step $msg 'Red' }

Clear-Host
Write-Host ''
Write-Host '  ========================================' -ForegroundColor White
Write-Host '       GhostHub  |  Atualizar Plugin' -ForegroundColor White
Write-Host '       https://ghosthub.fun' -ForegroundColor DarkGray
Write-Host '  ========================================' -ForegroundColor White
Write-Host ''

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

Write-Step 'Baixando versao nova do plugin...'
try {
    # cache-bust pra nao pegar arquivo velho
    $ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    Invoke-WebRequest -Uri "$BaseUrl/plugin/inject.js?_=$ts" -OutFile $InjectFile -UseBasicParsing
    Invoke-WebRequest -Uri "$BaseUrl/plugin/renderer.js?_=$ts" -OutFile $RendererFile -UseBasicParsing
    try {
        Invoke-WebRequest -Uri "$BaseUrl/plugin/golivebypass.js?_=$ts" -OutFile (Join-Path $InstallDir 'golivebypass.js') -UseBasicParsing
    } catch {
        Write-Warn 'golivebypass.js nao baixou (Go Live/Camera opcional)'
    }
    try {
        Invoke-WebRequest -Uri "$BaseUrl/plugin/GOLIVEBYPASS-LICENSE.txt?_=$ts" -OutFile (Join-Path $InstallDir 'GOLIVEBYPASS-LICENSE.txt') -UseBasicParsing
    } catch {}
    $settingsFile = Join-Path $InstallDir 'settings.json'
    if (-not (Test-Path $settingsFile)) {
        try {
            Invoke-WebRequest -Uri "$BaseUrl/plugin/settings.json?_=$ts" -OutFile $settingsFile -UseBasicParsing
        } catch {
            Set-Content -Path $settingsFile -Value "{`n    `"enabled`": false,`n    `"routeMode`": `"auto`",`n    `"excludedCountries`": `"BR`"`n}`n" -Encoding UTF8
        }
    }
    $logoPlugin = Join-Path $InstallDir 'logo.png'
    try {
        Invoke-WebRequest -Uri "$BaseUrl/plugin/logo.png?_=$ts" -OutFile $logoPlugin -UseBasicParsing
    } catch {
        try { Invoke-WebRequest -Uri "$BaseUrl/logo.png?_=$ts" -OutFile $logoPlugin -UseBasicParsing } catch {}
    }
    Write-Ok 'Arquivos atualizados'
} catch {
    Write-Fail "Falha ao baixar: $($_.Exception.Message)"
    Write-Host ''
    Write-Host '  Pressione qualquer tecla para sair...' -ForegroundColor DarkGray
    try { $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown') } catch { Start-Sleep 3 }
    return
}

$logoOk = $false
foreach ($logoPath in @('/discordghost.png', '/logo.png')) {
    try {
        Invoke-WebRequest -Uri ($BaseUrl + $logoPath + "?_=$ts") -OutFile $LogoPng -UseBasicParsing
        if ((Get-Item $LogoPng).Length -gt 1000) { $logoOk = $true; break }
    } catch {}
}

function Get-DiscordRoots {
    $roots = @()
    foreach ($base in @(
        (Join-Path $env:LOCALAPPDATA 'Discord'),
        (Join-Path $env:LOCALAPPDATA 'DiscordCanary'),
        (Join-Path $env:LOCALAPPDATA 'DiscordPTB')
    )) {
        if (Test-Path $base) { $roots += $base }
    }
    return $roots
}

$discordRoots = Get-DiscordRoots
if (-not $discordRoots -or $discordRoots.Count -eq 0) {
    Write-Fail 'Discord nao encontrado. Instale o Discord desktop primeiro.'
    Write-Host ''
    Write-Host '  Pressione qualquer tecla para sair...' -ForegroundColor DarkGray
    try { $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown') } catch { Start-Sleep 3 }
    return
}

Write-Step 'Fechando Discord...'
foreach ($n in @('Discord', 'DiscordCanary', 'DiscordPTB')) {
    Get-Process -Name $n -ErrorAction SilentlyContinue | ForEach-Object {
        try { $_ | Stop-Process -Force -ErrorAction SilentlyContinue } catch {}
    }
}
Start-Sleep -Seconds 2
Write-Ok 'Discord fechado'

function Get-DiscordAppDirs([string]$root) {
    Get-ChildItem -Path $root -Directory -Filter 'app-*' -ErrorAction SilentlyContinue |
        Sort-Object { $_.Name } -Descending
}

function Find-CoreIndex([string]$appDir) {
    $modules = Join-Path $appDir 'modules'
    if (-not (Test-Path $modules)) { return $null }
    $core = Get-ChildItem -Path $modules -Directory -Filter 'discord_desktop_core-*' -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending |
        Select-Object -First 1
    if (-not $core) { return $null }
    $idx = Join-Path $core.FullName 'discord_desktop_core\index.js'
    if (Test-Path $idx) { return $idx }
    return $null
}

$injectTargets = @()
$exeToStart = $null
foreach ($root in $discordRoots) {
    foreach ($app in (Get-DiscordAppDirs $root)) {
        $idx = Find-CoreIndex $app.FullName
        if ($idx) {
            $injectTargets += [pscustomobject]@{ Index = $idx; AppDir = $app.FullName; Root = $root }
        }
        foreach ($exeName in @('Discord.exe', 'DiscordCanary.exe', 'DiscordPTB.exe')) {
            $exe = Join-Path $app.FullName $exeName
            if (-not $exeToStart -and (Test-Path $exe)) { $exeToStart = $exe }
        }
    }
}

if ($injectTargets.Count -eq 0) {
    Write-Fail 'Nao achei discord_desktop_core/index.js.'
    Write-Host '  Abra o Discord uma vez, feche, e rode o update de novo.' -ForegroundColor DarkGray
    Write-Host ''
    Write-Host '  Pressione qualquer tecla para sair...' -ForegroundColor DarkGray
    try { $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown') } catch { Start-Sleep 3 }
    return
}

$escapedPath = $InjectFile.Replace('\', '\\').Replace("'", "\'")
$injectBlock = @"
$MarkerStart
try { require('$escapedPath'); } catch (e) { console.error('[GhostHub] inject failed', e); }
$MarkerEnd
"@

Write-Step 'Reaplicando inject (caso o Discord tenha atualizado)...'
foreach ($t in $injectTargets) {
    $raw = [System.IO.File]::ReadAllText($t.Index)
    if ($raw.Contains($MarkerStart)) {
        $pattern = [regex]::Escape($MarkerStart) + '[\s\S]*?' + [regex]::Escape($MarkerEnd)
        $raw = [regex]::Replace($raw, $pattern, $injectBlock.Trim())
    } else {
        $raw = $injectBlock.Trim() + "`r`n" + $raw
        Write-Step "Inject recriado em $($t.AppDir)" 'DarkGray'
    }
    $bak = $t.Index + '.ghosthub.bak'
    if (-not (Test-Path $bak)) {
        Copy-Item -LiteralPath $t.Index -Destination $bak -Force
    }
    [System.IO.File]::WriteAllText($t.Index, $raw)
}
Write-Ok 'Inject ok'

function Set-DiscordGhostIcon([string]$appDir, [string]$pngPath) {
    if (-not (Test-Path $pngPath)) { return }

    foreach ($c in @(
        (Join-Path $appDir 'discord.png'),
        (Join-Path $appDir 'app.png')
    )) {
        try { Copy-Item -LiteralPath $pngPath -Destination $c -Force -ErrorAction SilentlyContinue } catch {}
    }

    $shell = New-Object -ComObject WScript.Shell
    $shortcutPlaces = @(
        (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Discord.lnk'),
        (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Discord Canary.lnk'),
        (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Discord PTB.lnk'),
        (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Discord Inc\Discord.lnk'),
        (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Discord Inc\Discord Canary.lnk'),
        (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Discord Inc\Discord PTB.lnk')
    )

    try {
        Add-Type -AssemblyName System.Drawing -ErrorAction Stop
        $bmp = [System.Drawing.Bitmap]::FromFile($pngPath)
        $size = 256
        $resized = New-Object System.Drawing.Bitmap $size, $size
        $g = [System.Drawing.Graphics]::FromImage($resized)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.DrawImage($bmp, 0, 0, $size, $size)
        $g.Dispose()
        $icon = [System.Drawing.Icon]::FromHandle($resized.GetHicon())
        $fs = [System.IO.File]::Create($LogoIco)
        $icon.Save($fs)
        $fs.Close()
        $bmp.Dispose()
        $resized.Dispose()

        $appIco = Join-Path $appDir 'app.ico'
        Copy-Item -LiteralPath $LogoIco -Destination $appIco -Force -ErrorAction SilentlyContinue

        foreach ($lnk in $shortcutPlaces) {
            if (-not (Test-Path $lnk)) { continue }
            try {
                $sc = $shell.CreateShortcut($lnk)
                $sc.IconLocation = "$LogoIco,0"
                $sc.Save()
            } catch {}
        }
    } catch {}
}

if ($logoOk) {
    foreach ($t in $injectTargets) {
        Set-DiscordGhostIcon -appDir $t.AppDir -pngPath $LogoPng
    }
}

Write-Step 'Reiniciando Discord...'
if ($exeToStart -and (Test-Path $exeToStart)) {
    Start-Process -FilePath $exeToStart
    Write-Ok 'Discord iniciado'
} else {
    $started = $false
    foreach ($root in $discordRoots) {
        $update = Join-Path $root 'Update.exe'
        if (Test-Path $update) {
            Start-Process -FilePath $update -ArgumentList '--processStart', 'Discord.exe'
            $started = $true
            Write-Ok 'Discord iniciado via Update.exe'
            break
        }
    }
    if (-not $started) { Write-Warn 'Abra o Discord manualmente.' }
}

Write-Host ''
Write-Host '  ========================================' -ForegroundColor Green
Write-Host '   Plugin atualizado! Abra o fantasma.' -ForegroundColor Green
Write-Host '  ========================================' -ForegroundColor Green
Write-Host ''
Write-Host '  Remover: irm "https://ghosthub.fun/uninstall-plugin.ps1" | iex' -ForegroundColor DarkGray
Write-Host ''
Write-Host '  Pressione qualquer tecla para fechar...' -ForegroundColor DarkGray
try { $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown') } catch { Start-Sleep -Seconds 3 }
