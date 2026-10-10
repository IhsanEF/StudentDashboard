import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'pwa-auto-update-register',
        enforce: 'pre',
        transform(code, id) {
          if (id.endsWith('/src/main.tsx') || id.endsWith('src/main.tsx')) {
            return {
              code: `import { registerSW } from 'virtual:pwa-register';\n` +
                `registerSW({\n` +
                `  immediate: true,\n` +
                `  onRegisteredSW(_swUrl, r) {\n` +
                `    if (r) {\n` +
                `      setInterval(() => { r.update(); }, 60 * 60 * 1000);\n` +
                `      document.addEventListener('visibilitychange', () => {\n` +
                `        if (document.visibilityState === 'visible') { r.update(); }\n` +
                `      });\n` +
                `    }\n` +
                `  }\n` +
                `});\n` + code,
              map: null,
            };
          }
        },
      },
      VitePWA({
        registerType: 'autoUpdate',
        // Public icons are already covered by the Workbox glob.
        includeManifestIcons: false,
        manifest: {
          id: '/',
          name: 'UBC Student Dashboard',
          short_name: 'UBC Dash',
          description: 'A responsive student dashboard with AI-powered calendar, screenshot, camera, and syllabus import for Canvas coursework.',
          theme_color: '#002145',
          background_color: '#002145',
          display: 'standalone',
          orientation: 'any',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          navigateFallbackDenylist: [/^\/api\//, /^\/__\/auth(?:\/|$)/, /\.ics$/],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        },
        devOptions: {
          enabled: process.env.DISABLE_HMR !== 'true',
          type: 'module',
        },
      }),
    ],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('/node_modules/')) {
              if (/\/(?:@firebase|firebase)\//.test(id)) return 'firebase';
              if (/\/(?:react|react-dom|scheduler)\//.test(id)) return 'react';
            }
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
