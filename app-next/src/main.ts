import { createApp } from 'vue'
import App from './App.vue'
import './assets/index.css'
import { store, attachSocketClient } from './store'
import { createWebSocketPlugin } from './plugins/webSocketClient'

/**
 * In dev the websocket goes through the Vite proxy on this same origin (see
 * vite.config.ts), which keeps Moonraker's Origin check happy. In production
 * the bundle is served by the printer itself, so the same relative URL is
 * already correct.
 */
const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
const url = `${protocol}://${window.location.host}/websocket`

const websocket = createWebSocketPlugin({ url, store, reconnectInterval: 2000 })
attachSocketClient(websocket.socket)

createApp(App).use(store).use(websocket).mount('#app')

websocket.socket.connect()
