import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

// https://vitejs.dev/config/
export default defineConfig({
  base: './', // Important for Electron
  plugins: [react(), tsconfigPaths()],
  server: {
    port: 5180,
    strictPort: false,
  }
})
