# Builds dist/applypilot-<version>.zip — the same archive can be uploaded to the
# Chrome Web Store, Edge Add-ons and addons.mozilla.org (Firefox / Zen).
# Usage (Windows PowerShell):  powershell -ExecutionPolicy Bypass -File tools/package.ps1

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$manifest = Get-Content (Join-Path $root 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force -Path $dist | Out-Null

$zipPath = Join-Path $dist "applypilot-$($manifest.version).zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

$include = @('manifest.json', 'popup', 'scripts', 'icons')
$files = foreach ($item in $include) {
    $path = Join-Path $root $item
    if (Test-Path $path -PathType Container) {
        Get-ChildItem $path -Recurse -File | Where-Object { $_.Extension -ne '.md' }
    } else {
        Get-Item $path
    }
}

# Store entries with forward slashes; AMO rejects archives that use backslashes.
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in $files) {
        $entryName = $file.FullName.Substring($root.Path.Length + 1).Replace('\', '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
        Write-Host "  + $entryName"
    }
} finally {
    $zip.Dispose()
}

Write-Host "Created $zipPath"
