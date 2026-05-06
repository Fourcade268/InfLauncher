# Influence Launcher Compilation Script (BUILD ONLY)
$PSScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $PSScriptRoot

$ErrorActionPreference = "Stop"

# 1. Preparation & Signing Key
Write-Host "`n--- Preparing Signing Key ---" -ForegroundColor Cyan
if (-not (Test-Path "src-tauri/private.key")) {
    Write-Error "src-tauri/private.key NOT FOUND!"
}
$privateKey = (Get-Content "src-tauri/private.key" -Raw).Trim()
$env:TAURI_SIGNING_PRIVATE_KEY = $privateKey
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""

# 2. Build
Write-Host "`n--- Cleaning old artifacts ---" -ForegroundColor Gray
if (Test-Path "src-tauri/target/release/bundle/msi") {
    Remove-Item "src-tauri/target/release/bundle/msi/*" -Include "*.zip","*.sig","*.msi" -Force -ErrorAction SilentlyContinue
}

Write-Host "`n--- Running Tauri Build ---" -ForegroundColor Cyan
npm run tauri build

# 3. Paths and Version
$config = Get-Content "src-tauri/tauri.conf.json" | ConvertFrom-Json
$version = $config.version
$bundleFolder = "src-tauri/target/release/bundle/msi"

# Dynamically find and RENAME the MSI to the desired name
$foundMsi = Get-ChildItem -Path $bundleFolder -Filter "*.msi" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($null -eq $foundMsi) {
    Write-Error "MSI file not found in $bundleFolder! Build might have failed."
}

$newName = "InfLauncherSetup_$version" + "_x64.msi"
$msiPath = Join-Path $bundleFolder $newName
if ($foundMsi.Name -ne $newName) {
    Write-Host "Renaming $($foundMsi.Name) to $newName" -ForegroundColor Gray
    if (Test-Path $msiPath) { Remove-Item $msiPath -Force }
    Rename-Item -Path $foundMsi.FullName -NewName $newName -Force
}
$msiFile = Get-Item $msiPath

# 4. Sign the MSI directly
Write-Host "--- Signing MSI directly ---" -ForegroundColor Cyan
$sigOutput = npx tauri signer sign -k "$privateKey" $msiPath 2>&1 | Out-String

Write-Host "`n====================================================" -ForegroundColor Green
Write-Host "COMPILATION SUCCESSFUL!" -ForegroundColor Green
Write-Host "Installer: $newName" -ForegroundColor White
Write-Host "====================================================`n" -ForegroundColor Green

Write-Host "`nPress Enter to close this window..." -ForegroundColor Gray
Read-Host
