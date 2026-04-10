/**
 * ipc-document.js — v1.9.0
 * IPC handlers for document parsing (PDF, DOCX) and file open dialog.
 * Loaded by main.js via: require('./ipc-document')(ipcMain, app, dialog)
 */

module.exports = function registerDocumentHandlers(ipcMain, app, dialog) {
  const path = require('path')
  const fs   = require('fs')

  // ─── Open file dialog ────────────────────────────────────────────────────
  ipcMain.handle('open-file-dialog', async (event, opts = {}) => {
    const { BrowserWindow } = require('electron')
    const win = BrowserWindow.getFocusedWindow()
    try {
      const result = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        filters: opts.filters || [
          { name: 'Images',    extensions: ['png','jpg','jpeg','gif','webp','bmp'] },
          { name: 'Documents', extensions: ['pdf','docx','doc','txt','md'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        title: opts.title || 'Selecionar arquivo',
      })
      if (result.canceled || !result.filePaths.length) return { filePath: null, error: null }
      return { filePath: result.filePaths[0], error: null }
    } catch (e) {
      return { filePath: null, error: e.message }
    }
  })

  // ─── Document parsing (PDF / DOCX / TXT) ────────────────────────────────
  ipcMain.handle('read-document', async (event, filePath) => {
    try {
      const stats = fs.statSync(filePath)
      if (stats.size > 20 * 1024 * 1024) {
        return { content: null, name: path.basename(filePath), error: 'Arquivo muito grande (> 20 MB)' }
      }

      const ext = path.extname(filePath).toLowerCase()

      // ── PDF ──────────────────────────────────────────────────────────────
      if (ext === '.pdf') {
        let pdfParse
        try { pdfParse = require('pdf-parse') } catch {
          return { content: null, name: path.basename(filePath), error: 'pdf-parse não instalado. Execute: npm install pdf-parse' }
        }
        const buffer = fs.readFileSync(filePath)
        const data   = await pdfParse(buffer)
        return {
          content: data.text,
          name:    path.basename(filePath),
          pages:   data.numpages,
          error:   null,
        }
      }

      // ── DOCX ─────────────────────────────────────────────────────────────
      if (ext === '.docx' || ext === '.doc') {
        let mammoth
        try { mammoth = require('mammoth') } catch {
          return { content: null, name: path.basename(filePath), error: 'mammoth não instalado. Execute: npm install mammoth' }
        }
        const result = await mammoth.extractRawText({ path: filePath })
        return {
          content: result.value,
          name:    path.basename(filePath),
          error:   null,
        }
      }

      // ── Plain text / Markdown ────────────────────────────────────────────
      if (['.txt', '.md', '.csv', '.json', '.yaml', '.yml', '.xml', '.html', '.htm'].includes(ext)) {
        const content = fs.readFileSync(filePath, 'utf-8')
        return { content, name: path.basename(filePath), error: null }
      }

      // ── Image: return base64 ─────────────────────────────────────────────
      if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext)) {
        const buffer  = fs.readFileSync(filePath)
        const base64  = buffer.toString('base64')
        const mimeMap = { '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
                          '.gif':'image/gif', '.webp':'image/webp', '.bmp':'image/bmp' }
        return {
          content:  null,
          base64,
          mimeType: mimeMap[ext] || 'image/png',
          name:     path.basename(filePath),
          isImage:  true,
          error:    null,
        }
      }

      return { content: null, name: path.basename(filePath), error: `Tipo de arquivo não suportado: ${ext}` }
    } catch (e) {
      return { content: null, name: path.basename ? path.basename(filePath) : filePath, error: e.message }
    }
  })
}
