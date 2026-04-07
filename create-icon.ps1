Add-Type -AssemblyName System.Drawing

# Create a proper ICO file with multiple sizes
function Create-Ico {
    param([string]$outputPath)

    $sizes = @(256, 128, 64, 48, 32, 16)
    $images = @()

    foreach ($size in $sizes) {
        $bmp = New-Object System.Drawing.Bitmap($size, $size)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $g.Clear([System.Drawing.Color]::FromArgb(255, 26, 26, 46))

        # Draw a circle background
        $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 224, 122, 95))
        $g.FillEllipse($brush, 4, 4, $size - 8, $size - 8)

        # Draw "C" letter
        $whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
        $fontSize = [int]($size * 0.55)
        $font = New-Object System.Drawing.Font('Arial', $fontSize, [System.Drawing.FontStyle]::Bold)
        $textSize = $g.MeasureString('C', $font)
        $x = ($size - $textSize.Width) / 2
        $y = ($size - $textSize.Height) / 2
        $g.DrawString('C', $font, $whiteBrush, $x, $y)

        $g.Dispose()
        $images += $bmp
    }

    # Write ICO file manually
    $stream = New-Object System.IO.MemoryStream
    $writer = New-Object System.IO.BinaryWriter($stream)

    # ICO header
    $writer.Write([uint16]0)  # Reserved
    $writer.Write([uint16]1)  # Type: ICO
    $writer.Write([uint16]$sizes.Count)  # Count

    # Calculate offset for image data
    $headerSize = 6 + ($sizes.Count * 16)
    $offset = $headerSize

    $imageData = @()
    foreach ($img in $images) {
        $ms = New-Object System.IO.MemoryStream
        $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $imageData += ,$ms.ToArray()
        $ms.Dispose()
    }

    # Write directory entries
    for ($i = 0; $i -lt $sizes.Count; $i++) {
        $size = $sizes[$i]
        $data = $imageData[$i]
        $writer.Write([byte]$(if ($size -eq 256) { 0 } else { $size }))  # Width
        $writer.Write([byte]$(if ($size -eq 256) { 0 } else { $size }))  # Height
        $writer.Write([byte]0)   # Color count
        $writer.Write([byte]0)   # Reserved
        $writer.Write([uint16]1) # Planes
        $writer.Write([uint16]32) # Bit count
        $writer.Write([uint32]$data.Length)  # Size
        $writer.Write([uint32]$offset)       # Offset
        $offset += $data.Length
    }

    # Write image data
    foreach ($data in $imageData) {
        $writer.Write($data)
    }

    $writer.Flush()
    [System.IO.File]::WriteAllBytes($outputPath, $stream.ToArray())
    $stream.Dispose()
    $writer.Dispose()

    foreach ($img in $images) { $img.Dispose() }

    Write-Host "ICO created at $outputPath"
}

# Create PNG for display
$bmp = New-Object System.Drawing.Bitmap(256, 256)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::FromArgb(255, 26, 26, 46))
$brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 224, 122, 95))
$g.FillEllipse($brush, 4, 4, 248, 248)
$whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$font = New-Object System.Drawing.Font('Arial', 140, [System.Drawing.FontStyle]::Bold)
$textSize = $g.MeasureString('C', $font)
$g.DrawString('C', $font, $whiteBrush, (256 - $textSize.Width) / 2, (256 - $textSize.Height) / 2)
$g.Dispose()
$bmp.Save('D:\claude-desktop\public\icon.png', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "PNG created"

# Create proper ICO
Create-Ico -outputPath 'D:\claude-desktop\public\icon.ico'
