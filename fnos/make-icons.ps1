# Generate fnOS app icons (square, straight corners, sRGB PNG)
#   package icons : ICON.PNG (64)      / ICON_256.PNG (256)
#   desktop entry : app/ui/images/icon_64.png / icon_256.png
# Usage: powershell -ExecutionPolicy Bypass -File make-icons.ps1
# NOTE: keep this file ASCII-only (Windows PowerShell 5.1 reads .ps1 as ANSI
#       when there is no BOM, so non-ASCII literals would be garbled).
param(
  [string]$Root = $PSScriptRoot
)

Add-Type -AssemblyName System.Drawing

$pkg = Join-Path $Root 'sst-stock-simulator'
# 0x80A1 = CJK character "gu" (shares, as in 股票)
$glyph = [string][char]0x80A1

$targets = @(
  @{ Path = Join-Path $pkg 'ICON_256.PNG'; Size = 256 },
  @{ Path = Join-Path $pkg 'ICON.PNG'; Size = 64 },
  @{ Path = Join-Path $pkg 'app\ui\images\icon_256.png'; Size = 256 },
  @{ Path = Join-Path $pkg 'app\ui\images\icon_64.png'; Size = 64 }
)

foreach ($t in $targets) {
  $size = [int]$t.Size

  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

  $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.Color]::FromArgb(255, 239, 68, 68),
    [System.Drawing.Color]::FromArgb(255, 153, 27, 27),
    45.0
  )
  $g.FillRectangle($brush, $rect)

  $font = New-Object System.Drawing.Font(
    'Microsoft YaHei',
    [single]($size * 0.56),
    [System.Drawing.FontStyle]::Bold,
    [System.Drawing.GraphicsUnit]::Pixel
  )
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center

  $box = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
  $g.DrawString($glyph, $font, [System.Drawing.Brushes]::White, $box, $sf)

  $g.Dispose()
  $dir = Split-Path -Parent $t.Path
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $bmp.Save($t.Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()

  Write-Host ("wrote " + $t.Path + "  (" + $size + "x" + $size + ")")
}
