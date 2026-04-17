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
          // Markdown + syntax highlighting (~400KB combined)
          'markdown': ['marked', 'highlight.js'],
          // Math rendering (~200KB)
          'katex': ['katex'],
          // Document parsing (~150KB)
          'docs': ['mammoth'],
          // React core stays in main chunk (hot path)
        },
      },
    },
  },
  server: {
    port: 5173,
  },
})
