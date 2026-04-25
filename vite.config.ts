import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api-asxs': {
        target: 'https://api.asxs.top',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api-asxs/, ''),
      },
      '/api-n8n': {
        target: process.env.VITE_N8N_PROXY_TARGET || 'http://127.0.0.1:5678',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api-n8n/, ''),
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/')

          if (
            normalizedId.includes('/node_modules/react/') ||
            normalizedId.includes('/node_modules/react-dom/')
          ) {
            return 'react'
          }

          if (normalizedId.includes('/node_modules/antd/')) {
            return 'antd-core'
          }

          if (
            normalizedId.includes('/node_modules/@ant-design/icons/') ||
            normalizedId.includes('/node_modules/@ant-design/icons-svg/')
          ) {
            return 'ant-icons'
          }

          if (
            normalizedId.includes('/node_modules/@ant-design/cssinjs/') ||
            normalizedId.includes('/node_modules/@ant-design/cssinjs-utils/')
          ) {
            return 'ant-css'
          }

          if (
            normalizedId.includes('/node_modules/@rc-component/') ||
            normalizedId.includes('/node_modules/rc-')
          ) {
            return 'ant-rc'
          }

          return undefined
        },
      },
    },
  },
})
