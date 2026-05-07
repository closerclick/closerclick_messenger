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

// Diagnóstico: imprime contexto al arrancar. Útil para entender si estamos
// en secure context, qué origen tenemos, quién es el top-level, etc.
try {
  let topOrigin = null
  let topAccessible = false
  try { topOrigin = window.top.location.origin; topAccessible = true }
  catch (_) { topOrigin = '(cross-origin, blocked)' }
  console.log('[cc-messenger] context', {
    origin: location.origin,
    href: location.href,
    embed: embed || null,
    isSecureContext: window.isSecureContext,
    inIframe: window !== window.top,
    topOrigin,
    topAccessible,
    parentOrigin: window.parent !== window ? '(cross-origin)' : location.origin,
    cryptoRandomUUID: typeof crypto?.randomUUID === 'function',
    cryptoSubtle: !!crypto?.subtle,
    userAgent: navigator.userAgent
  })
} catch (e) { console.warn('[cc-messenger] context log failed', e) }

// Polyfill de crypto.randomUUID: requiere "secure context", que NO se cumple
// cuando esta PWA va en un iframe dentro de una página padre HTTP (overlay
// de la extensión sobre sitios http://). En ese caso `crypto.randomUUID` es
// undefined y libs como `closer-click-store` (sync.js getDeviceId) revientan.
// Lo emulamos con `crypto.getRandomValues`, que sí está disponible siempre.
if (typeof crypto !== 'undefined' && typeof crypto.randomUUID !== 'function') {
  crypto.randomUUID = function () {
    const b = new Uint8Array(16)
    crypto.getRandomValues(b)
    b[6] = (b[6] & 0x0f) | 0x40
    b[8] = (b[8] & 0x3f) | 0x80
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('')
    return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`
  }
}

const app = createApp(App)
app.use(createPinia())
app.mount('#app')

registerSW({ immediate: true })
