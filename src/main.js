import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { registerSW } from 'virtual:pwa-register'
import './style.css'
import App from './App.vue'

// Modo embed: cuando la PWA se carga como iframe desde la extensión
// (popup/overlay/offscreen), recibimos `?embed=popup` o similar y aplicamos
// estilos compactos vía la clase `cc-embed` en el <html>.
const embed = new URLSearchParams(location.search).get('embed')
if (embed) document.documentElement.classList.add('cc-embed')

const app = createApp(App)
app.use(createPinia())
app.mount('#app')

registerSW({ immediate: true })
