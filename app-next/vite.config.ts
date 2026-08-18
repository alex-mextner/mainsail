import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// Address of the live printer (Orange Pi running Klipper + Moonraker).
// Override with MOONRAKER_HOST=... when developing against another machine.
const moonrakerHost = process.env.MOONRAKER_HOST ?? 'http://192.168.11.160'
const moonrakerWs = moonrakerHost.replace(/^http/, 'ws')

export default defineConfig({
    plugins: [vue(), tailwindcss()],
    css: {
        // Pin PostCSS to an empty inline config. Without this, Vite searches
        // upward for a config and finds the Vue 2 tree's root package.json,
        // which declares an `autoprefixer` plugin that is not installed here
        // ("Cannot find module 'autoprefixer'"). Tailwind v4 runs through the
        // Vite plugin above and needs no PostCSS pipeline of its own.
        postcss: {},
    },
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
    server: {
        host: '127.0.0.1',
        port: 5273,
        // Proxy every Moonraker route through the dev server so the browser talks
        // to the same origin. This sidesteps both CORS on the HTTP API and
        // Moonraker's Origin check on the websocket handshake -- see
        // `cors_domains` in printer-configs/moonraker.conf, which does NOT list
        // this dev port.
        proxy: {
            '/websocket': { target: moonrakerWs, ws: true, changeOrigin: true },
            '/printer': { target: moonrakerHost, changeOrigin: true },
            '/server': { target: moonrakerHost, changeOrigin: true },
            '/api': { target: moonrakerHost, changeOrigin: true },
            '/access': { target: moonrakerHost, changeOrigin: true },
            '/machine': { target: moonrakerHost, changeOrigin: true },
            // The camera. `moonrakerHost` is port 80, where nginx already
            // proxies /webcam/ to mjpg-streamer -- so the whole camera view can
            // be exercised against the real hardware from a laptop, before any
            // change is made on the printer itself.
            '/webcam': { target: moonrakerHost, changeOrigin: true },
        },
    },
    // `vite preview` serves the built bundle. It needs the same proxy as the dev
    // server, otherwise the production artifact can only be tested on the
    // printer itself -- and "it builds" would never get upgraded to "it runs".
    preview: {
        host: '127.0.0.1',
        port: 5274,
        proxy: {
            '/websocket': { target: moonrakerWs, ws: true, changeOrigin: true },
            '/printer': { target: moonrakerHost, changeOrigin: true },
            '/server': { target: moonrakerHost, changeOrigin: true },
            '/api': { target: moonrakerHost, changeOrigin: true },
            '/access': { target: moonrakerHost, changeOrigin: true },
            '/machine': { target: moonrakerHost, changeOrigin: true },
            '/webcam': { target: moonrakerHost, changeOrigin: true },
        },
    },
    build: {
        // The production bundle is served by the printer itself, from the same
        // origin as Moonraker, so no proxy is involved there.
        outDir: 'dist',
        chunkSizeWarningLimit: 1500,
    },
})
