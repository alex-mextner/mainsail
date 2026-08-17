import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import './assets/index.css'
import { useConnectionStore } from './stores/connection'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')

// Connect after mount so the shell paints immediately and the connection state
// is visible while it happens, rather than the page sitting blank.
useConnectionStore().connect()
