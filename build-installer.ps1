$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
$env:WIN_CSC_LINK = ''
Set-Location 'D:\claude-desktop'
npx electron-builder --win nsis 2>&1
