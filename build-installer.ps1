$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
$env:WIN_CSC_LINK = ''
Set-Location $PSScriptRoot
npx electron-builder --win nsis 2>&1
