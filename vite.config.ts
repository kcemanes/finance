import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // `prompt`, not `autoUpdate`: the app is a form people type into, and a
      // silent reload mid-entry would throw away what they were writing. The
      // new worker waits until UpdatePrompt is clicked.
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],

      manifest: {
        id: '/',
        name: 'Finance',
        short_name: 'Finance',
        description:
          'Log expenses by category, set a monthly budget, and see where the month went — online or off.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        // Matches --color-ground in the light palette, so the splash screen
        // and the first paint are the same colour.
        background_color: '#f8fafc',
        theme_color: '#f8fafc',
        categories: ['finance', 'productivity'],
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            // Android crops this to a shape of its choosing; the mark is
            // inset to survive the tightest one. See scripts/generate-icons.mjs.
            src: '/maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },

      workbox: {
        // The built shell, precached so a cold launch works with no network.
        // Supabase requests are deliberately absent: they are not cached at
        // all, because IndexedDB already holds the data and the sync engine
        // decides when to go to the server. A stale HTTP cache in between
        // would only be a second, disagreeing copy.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  // Served from the custom domain root (see public/CNAME), so base stays '/'.
})
