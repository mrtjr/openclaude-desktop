import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    // Suppress 500KB warning — the main chunk is right-sized for a desktop app
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
