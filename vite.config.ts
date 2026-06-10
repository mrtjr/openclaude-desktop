import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// Real app version injected at build time — the UserMenu used to show a
// hardcoded string that drifted 45 releases behind the installed build.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: 'dist',
    // Kept at 800 so a bloated *boot* chunk still trips the warning (this is
    // how Ciclo 2 caught the 976KB markdown chunk). The one expected offender
    // is `o200k_base` (~2.3MB) — the lazy js-tiktoken rank table, pulled only
    // on demand via dynamic import (see services/tokenizer.ts), never in the
    // boot path. It's named explicitly in the warning, so it doesn't mask a
    // real regression: a newly-bloated app chunk shows up as a second line.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // Split heavy 3rd-party deps into their own chunks so they cache
        // independently and don't invalidate on every app update.
        manualChunks: {
          // Markdown + slim syntax highlighting (highlight.js/lib/common,
          // ~37 languages). The full highlight.js (~190 langs) made this
          // chunk ~976KB; the slim build cuts it to ~150KB.
          'markdown': ['marked', 'highlight.js'],
          // (mammoth/pdf-parse are main-process require()s, never in the
          // renderer bundle, so they need no manualChunk — a 'docs' entry
          // here only produced an empty chunk + build warning.)
          // React core stays in main chunk (hot path)
        },
      },
    },
  },
  server: {
    port: 5173,
  },
})
