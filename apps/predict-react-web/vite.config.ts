import { resolve } from 'node:path'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig((config) => {
  const tanstackStartConfig = tanstackStart({
    prerender: {
      enabled: config.mode === 'production',
    },
  })

  return {
    plugins: [tailwindcss(), tanstackStartConfig, viteReact()],
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
      },
    },
  }
})
