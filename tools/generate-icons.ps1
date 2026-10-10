# Generates the PNG toolbar/store icons from the same geometry as icons/icon.svg.
# Usage (Windows PowerShell):  powershell -ExecutionPolicy Bypass -File tools/generate-icons.ps1

Add-Type -AssemblyName System.Drawing

$iconDir = Join-Path $PSScriptRoot '..\icons'
New-Item -ItemType Directory -Force -Path $iconDir | Out-Null

function New-RoundedRectPath([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $path.AddArc($x, $y, $d, $d, 180, 90)
    $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

function New-Polygon([single]$scale, [int[]]$coords) {
    $points = @()
    for ($i = 0; $i -lt $coords.Length; $i += 2) {
        $points += New-Object System.Drawing.PointF(($coords[$i] * $scale), ($coords[$i + 1] * $scale))
    }
    return [System.Drawing.PointF[]]$points
}

foreach ($size in 16, 32, 48, 128) {
    $bitmap = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bitmap)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    $s = $size / 128.0
    $inset = if ($size -le 16) { 0 } else { 4 * $s }
    $radius = 28 * $s

    $rect = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
    $gradient = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect,
        [System.Drawing.Color]::FromArgb(255, 79, 70, 229),
        [System.Drawing.Color]::FromArgb(255, 124, 58, 237), 45.0)
    $bgPath = New-RoundedRectPath $inset $inset ($size - 2 * $inset) ($size - 2 * $inset) $radius
    $g.FillPath($gradient, $bgPath)

    $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 255, 255))
    $white82 = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(209, 255, 255, 255))
    $white60 = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(153, 255, 255, 255))

    $g.FillPolygon($white, (New-Polygon $s @(24, 62, 104, 28, 58, 74)))
    $g.FillPolygon($white82, (New-Polygon $s @(58, 74, 104, 28, 80, 102)))
    $g.FillPolygon($white60, (New-Polygon $s @(58, 74, 64, 96, 72, 84)))

    $out = Join-Path $iconDir "icon-$size.png"
    $bitmap.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)

    $g.Dispose(); $bitmap.Dispose(); $gradient.Dispose(); $bgPath.Dispose()
    $white.Dispose(); $white82.Dispose(); $white60.Dispose()
    Write-Host "Created $out"
}
