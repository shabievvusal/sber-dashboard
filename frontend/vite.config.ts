import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // Слушать на всех интерфейсах для доступа извне
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true
      },
      '/integrations': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        timeout: 300000, // 5 минут таймаут для больших файлов
      },
      '/uploads': {
        target: 'http://localhost:5000',
        changeOrigin: true
      }
    }
  }
})




