# Influence Launcher Release Script (FULL AUTOMATION)
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
# Build without signing first to get the MSI
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
    # Force remove old same-named file if exists to avoid collision
    if (Test-Path $msiPath) { Remove-Item $msiPath -Force }
    Rename-Item -Path $foundMsi.FullName -NewName $newName -Force
}
$msiFile = Get-Item $msiPath
$baseName = $msiFile.BaseName
$zipPath = Join-Path $bundleFolder "$baseName.zip" # Although we use MSI, we keep the naming consistent

# 4. Sign the MSI directly (Avoids ZIP compression issues)
Write-Host "--- Signing MSI directly ---" -ForegroundColor Cyan
# Capture both stdout and stderr to be safe
$sigOutput = npx tauri signer sign -k "$privateKey" $msiPath 2>&1 | Out-String

# Minisign signature has 3 lines. The actual signature is the one that's pure Base64.
# We look for a line that is only Base64 characters and is long enough.
$signature = ""
foreach ($line in ($sigOutput -split "`r?`n")) {
    $cleanLine = $line.Trim()
    # A minisign signature line is usually 88 characters of Base64
    if ($cleanLine -match "^[A-Za-z0-9+/=]{60,}$") {
        $signature = $cleanLine
        break
    }
}

if (-not $signature) {
    Write-Host "Raw output from signer:" -ForegroundColor Gray
    Write-Host $sigOutput -ForegroundColor Gray
    Write-Error "Failed to extract signature from tauri signer output!"
}

# Get repo info from endpoints for download URL
$endpoint = $config.plugins.updater.endpoints[0]
# Use regex for more reliable extraction of User/Repo
if ($endpoint -match "githubusercontent\.com/([^/]+/[^/]+)/") {
    $repoPath = $Matches[1]
} else {
    Write-Error "Could not parse GitHub repo from endpoint: $endpoint"
}

$downloadUrl = "https://github.com/$repoPath/releases/download/$version/$($msiFile.Name)"
Write-Host "Download URL will be: $downloadUrl" -ForegroundColor Gray

# 5. Prepare update.json
$pubDate = Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ"
$updateJson = @"
{
  "version": "$version",
  "notes": "Update to version $version",
  "pub_date": "$pubDate",
  "platforms": {
    "windows-x86_64": {
      "signature": "$signature",
      "url": "$downloadUrl"
    }
  }
}
"@

# 6. Automatic GitHub Deployment
Write-Host "`n--- Deploying to GitHub ---" -ForegroundColor Cyan
$ghAvailable = Get-Command gh -ErrorAction SilentlyContinue

if ($ghAvailable) {
    # 6.1 Sync with Remote to avoid push rejection
    Write-Host "Checking branch and syncing..." -ForegroundColor Gray
    git checkout main
    
    # Autofix: Commit any local changes if they exist
    $status = git status --porcelain
    if ($status) {
        Write-Host "Local changes detected. Committing before sync..." -ForegroundColor Yellow
        git add .
        git commit -m "chore: sync local changes before deploy"
    }

    # Autofix: Ensure src-tauri/.gitignore is NOT tracked
    $trackedGitignore = git ls-files src-tauri/.gitignore
    if ($trackedGitignore) {
        Write-Host "Removing src-tauri/.gitignore from tracking..." -ForegroundColor Yellow
        git rm --cached src-tauri/.gitignore
        git commit -m "chore: remove src-tauri/.gitignore from repository"
    }

    git pull --rebase origin main

    # 6.2 Update local update.json (UTF8 without BOM)
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText((Join-Path $PSScriptRoot "update.json"), $updateJson, $utf8NoBom)
    
    # 6.3 Update README.md with the new download link
    $readmePath = Join-Path $PSScriptRoot "README.md"
    if (Test-Path $readmePath) {
        Write-Host "Updating README.md with link: $downloadUrl" -ForegroundColor Gray
        $readmeContent = Get-Content $readmePath -Raw
        # Replace only the last link at the end of the line (matches ](link) at end)
        $newReadmeContent = $readmeContent -replace "\]\([^\)]+\)$", "]($downloadUrl)"
        [System.IO.File]::WriteAllText($readmePath, $newReadmeContent, $utf8NoBom)
    }
    
    # 6.4 Git commit & push update.json and README.md
    Write-Host "Pushing updates to repository..." -ForegroundColor Gray
    git add update.json README.md
    git commit -m "chore: update version to $version and README"
    git push origin main

    # 6.4 Create GitHub Release and upload ZIP + MSI
    Write-Host "Creating GitHub Release $version..." -ForegroundColor Gray
    
    # Check if release already exists using exit code instead of variable check
    $exists = $true
    try {
        gh release view $version --json id > $null 2>&1
        if ($LASTEXITCODE -ne 0) { $exists = $false }
    } catch {
        $exists = $false
    }

    if (-not $exists) {
        # Autofix: Delete local tag if it exists to avoid "tag exists locally but not pushed" error
        git tag -d $version 2>$null
        gh release create $version $msiPath --title "$version" --notes "$version"
    } else {
        Write-Host "Release $version already exists. Uploading assets..." -ForegroundColor Yellow
        gh release upload $version $msiPath --clobber
    }
    
    Write-Host "`n====================================================" -ForegroundColor Green
    Write-Host "DEPLOYMENT SUCCESSFUL!" -ForegroundColor Green
    Write-Host "====================================================`n" -ForegroundColor Green
} else {
    Write-Host "`n[!] GitHub CLI (gh) not found. Skipping automatic deployment." -ForegroundColor Yellow
    Write-Host "COPY AND PASTE THIS TO YOUR update.json ON GITHUB:" -ForegroundColor Yellow
    Write-Host "----------------------------------------------------" -ForegroundColor Gray
    Write-Host $updateJson -ForegroundColor White
    Write-Host "----------------------------------------------------" -ForegroundColor Gray
}

Write-Host "`nPress Enter to close this window..." -ForegroundColor Gray
Read-Host
