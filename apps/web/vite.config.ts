import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// IDLEBOT_API lets a second checkout (e.g. a worktree API on :3100) run beside main's :3000.
const api = process.env.IDLEBOT_API ?? 'http://127.0.0.1:3000'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5190,
    strictPort: true,
    proxy: {
      '/api': api,
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    proxy: {
      '/api': api,
    },
  },
})
