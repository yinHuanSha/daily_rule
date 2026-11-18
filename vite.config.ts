import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      injectRegister: false,
      includeManifestIcons: false, // The Workbox glob below already includes PNG icons.
      scope: './',
      manifest: {
        id: './',
        name: '每日国策 · Daily Rule',
        short_name: '每日国策',
        description: '用国策树记录、维护和回顾个人行动规则。',
        lang: 'zh-CN',
        start_url: './',
        scope: './',
        display: 'standalone',
        theme_color: '#20362f',
        background_color: '#f4efdf',
        icons: [
          { src: './icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: './icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: './icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{html,js,css,svg,png,jpg,jpeg,webp,avif,woff,woff2}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
      },
    }),
  ],
})
