// ─── Auto-update (Claude-style "Restart to update") ─────────────────
//
// Wires electron-updater so the app downloads new releases IN THE BACKGROUND
// and, when one is ready, tells the renderer to show a subtle "Reiniciar para
// atualizar" button in the sidebar footer (mirroring Claude Desktop). The user
// clicks it → quitAndInstall → relaunched on the new version. No more manually
// downloading + running an installer every release (the user's actual workflow
// today — confirmed via the Dev Insights / live inspection).
//
// Update feed: GitHub Releases of `mrtjr/openclaude-desktop` (the provider in
// resources/app-update.yml). Each release must carry the NSIS `.exe`, its
// `.blockmap`, and `latest.yml` — published as part of the ship flow.
//
// Safety: only the periodic check is gated to packaged builds (electron-updater
// can't resolve a feed in dev). Event wiring + IPC are always registered so the
// renderer's calls never throw, and every updater error is swallowed to a
// renderer message — a broken update must never break app startup.

const { autoUpdater } = require('electron-updater')

let wired = false

/**
 * @param {() => Electron.BrowserWindow | null} getWin  accessor for the main window
 * @param {boolean} enabled  whether to actually poll for updates (app.isPackaged)
 */
function initAutoUpdater(getWin, enabled) {
  if (wired) return
  wired = true

  const send = (payload) => {
    try {
      const win = getWin && getWin()
      if (win && !win.isDestroyed()) win.webContents.send('update-status', payload)
    } catch { /* window gone — ignore */ }
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('error', (err) =>
    send({ state: 'error', message: String((err && err.message) || err) }))
  autoUpdater.on('update-available', (info) =>
    send({ state: 'available', version: info && info.version }))
  autoUpdater.on('update-not-available', () =>
    send({ state: 'none' }))
  autoUpdater.on('download-progress', (p) =>
    send({ state: 'downloading', percent: Math.round((p && p.percent) || 0) }))
  autoUpdater.on('update-downloaded', (info) =>
    send({ state: 'downloaded', version: info && info.version }))

  if (!enabled) return // dev: events/IPC wired, but no feed to poll

  const check = () => { autoUpdater.checkForUpdates().catch(() => { /* offline / no feed */ }) }
  setTimeout(check, 8000)               // shortly after launch
  setInterval(check, 6 * 60 * 60 * 1000) // every 6h
}

/** Quit and install a downloaded update. Safe to call even if nothing is
 *  staged (electron-updater no-ops / throws, which we swallow). */
function quitAndInstall() {
  try { autoUpdater.quitAndInstall() } catch (e) { return { error: String((e && e.message) || e) } }
  return { ok: true }
}

module.exports = { initAutoUpdater, quitAndInstall, autoUpdater }
