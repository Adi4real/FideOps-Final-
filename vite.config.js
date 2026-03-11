import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // This ensures your @/ imports point to the src folder
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // Optional: useful if you want to see all logs during debugging
    logLevel: 'info', 
  }
})