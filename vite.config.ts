import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Electron loads the production renderer through file://, so asset URLs
  // must stay relative to dist/index.html instead of pointing at /assets.
  base: './',
  plugins: [react()],
})
