/**
 * ipc-document.js — v1.9.0
 * IPC handlers for document parsing (PDF, DOCX) and file open dialog.
 * Loaded by main.js via: require('./ipc-document')(ipcMain, app, dialog)
 */

module.exports = function registerDocumentHandlers(ipcMain, app, dialog) {
  const path  = require('path')
  const fs    = require('fs')
  const https = require('https')

  // GET HTTPS simples → { status, body }. UA obrigatório na API do GitHub.
  const httpsGet = (hostname, reqPath) => new Promise((resolve) => {
    const req = https.get({ hostname, path: reqPath, headers: { 'User-Agent': 'OpenClaude-Desktop', 'Accept': 'application/vnd.github+json' } }, (res) => {
      let d = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { d += c; if (d.length > 8 * 1024 * 1024) req.destroy() })
      res.on('end', () => resolve({ status: res.statusCode, body: d }))
    })
    req.on('error', (e) => resolve({ status: 0, body: '', error: e.message }))
    req.setTimeout(20000, () => { req.destroy(); resolve({ status: 0, body: '', error: 'timeout' }) })
  })

  // ─── Instalar skills do GitHub (sem git clone, v2.155.0) ────────────────
  // Recebe { owner, repo, branch? } (o renderer parseia via parseRepoSpec).
  // Lista a árvore do repo (API), filtra SKILL.md, baixa o raw de cada um,
  // salva numa PASTA PADRÃO (userData/skills-library/owner-repo) e devolve os
  // conteúdos p/ instalar. Limite de segurança e mensagens de erro amigáveis.
  ipcMain.handle('fetch-github-skills', async (event, spec) => {
    try {
      const owner = String(spec?.owner || '').trim()
      const repo = String(spec?.repo || '').trim()
      if (!owner || !repo) return { files: [], error: 'Repositório inválido (use owner/repo ou a URL do GitHub).' }
      let branch = String(spec?.branch || '').trim()
      if (!branch) {
        const meta = await httpsGet('api.github.com', `/repos/${owner}/${repo}`)
        if (meta.status === 403) return { files: [], error: 'Limite de requisições do GitHub atingido — tente novamente em alguns minutos.' }
        if (meta.status === 404) return { files: [], error: `Repositório ${owner}/${repo} não encontrado.` }
        if (meta.status !== 200) return { files: [], error: `Falha ao acessar o GitHub (${meta.status || meta.error || 'rede'}).` }
        try { branch = JSON.parse(meta.body).default_branch || 'main' } catch { branch = 'main' }
      }
      const tree = await httpsGet('api.github.com', `/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`)
      if (tree.status !== 200) return { files: [], error: `Não foi possível listar os arquivos do repo (${tree.status || tree.error || 'rede'}).` }
      let paths = []
      try { paths = (JSON.parse(tree.body).tree || []).map((t) => t.path).filter((p) => /(^|\/)SKILL\.md$/i.test(p)) } catch { /* json ruim */ }
      paths = paths.slice(0, 500)
      if (!paths.length) return { files: [], error: 'Nenhum SKILL.md encontrado neste repositório (listas "awesome-*" são índices e não contêm skills).', branch }
      const baseDir = path.join(app.getPath('userData'), 'skills-library', `${owner}-${repo}`)
      const files = []
      for (const p of paths) {
        const raw = await httpsGet('raw.githubusercontent.com', `/${owner}/${repo}/${branch}/${p.split('/').map(encodeURIComponent).join('/')}`)
        if (raw.status === 200 && raw.body) {
          files.push({ path: p, content: raw.body })
          try { const dest = path.join(baseDir, p); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, raw.body, 'utf-8') } catch { /* best-effort */ }
        }
      }
      return { files, dir: baseDir, branch, found: paths.length, error: null }
    } catch (e) {
      return { files: [], error: e.message }
    }
  })

  // ─── Importação em massa de skills (SKILL.md) ───────────────────────────

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

  // ─── Importação em massa de skills (SKILL.md) ───────────────────────────
  // Abre uma pasta e varre recursivamente por arquivos SKILL.md (o padrão
  // aberto: cada skill é uma pasta com um SKILL.md). Devolve [{path, content}].
  // Pensado p/ apontar nos repos da comunidade (anthropics/skills, awesome-*)
  // clonados e importar tudo de uma vez (v2.153.0).
  ipcMain.handle('import-skills-dir', async () => {
    const { BrowserWindow } = require('electron')
    const win = BrowserWindow.getFocusedWindow()
    try {
      const r = await dialog.showOpenDialog(win, {
        properties: ['openDirectory'],
        title: 'Pasta com skills (SKILL.md) — ex.: repositórios da comunidade clonados',
      })
      if (r.canceled || !r.filePaths.length) return { files: [], root: null, error: null }
      const root = r.filePaths[0]
      const out = []
      const MAX_FILES = 3000
      const SKIP_DIRS = new Set(['node_modules', '.git', '.github', 'dist', 'build', '.next', 'vendor'])
      const walk = (dir, depth) => {
        if (out.length >= MAX_FILES || depth > 10) return
        let entries
        try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
        for (const e of entries) {
          if (out.length >= MAX_FILES) break
          if (e.isDirectory()) {
            if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(path.join(dir, e.name), depth + 1)
          } else if (/^skill\.md$/i.test(e.name)) {
            try {
              const full = path.join(dir, e.name)
              if (fs.statSync(full).size <= 1024 * 1024) out.push({ path: full, content: fs.readFileSync(full, 'utf-8') })
            } catch { /* pula arquivo ilegível */ }
          }
        }
      }
      walk(root, 0)
      return { files: out, root, error: null }
    } catch (e) {
      return { files: [], root: null, error: e.message }
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
