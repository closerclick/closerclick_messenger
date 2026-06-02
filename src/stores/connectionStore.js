import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getWebSocketProxyClient } from '@closerclick/closer-click-proxy-client'
import { getIdentity } from '../services/identity'
import { sanitizeNickname } from '../utils/sanitize'
import { relayProxyCall, watchOutboundQueue } from '../services/proxyRelay'

const URL_EMBED = new URLSearchParams(typeof location !== 'undefined' ? location.search : '').get('embed')
// Solo overlay (FAB en sites HTTPS) usa relay: una pestaña con FAB activo
// cada una abriendo conexión al proxy = spam → ban. Popup pineado y direct
// tab abren su propia conexión normal.
const IS_RELAY_MODE = URL_EMBED === 'overlay'
const IS_OFFSCREEN = URL_EMBED === 'offscreen'

export const useConnectionStore = defineStore('connection', () => {
  const wsProxyClient = getWebSocketProxyClient()

  const token = ref(null)
  const isConnected = ref(false)
  const connectionError = ref(null)
  // Proxios conocidos del ecosistema (federados entre sí). El usuario elige su
  // "home"; la federación entrega los mensajes aunque el contacto esté en otro.
  // La lista se DESCUBRE del directorio de nodos (https://closer.click/nodes.json)
  // con cache + fallback hardcodeado. Base para round-robin/health-check a futuro.
  const DEFAULT_PROXIES = ['wss://proxy.closer.click', 'wss://proxy2.closer.click']
  const DIRECTORY_URL = 'https://closer.click/nodes.json'
  const loadCachedProxies = () => {
    try { const c = JSON.parse(localStorage.getItem('messenger_proxies') || 'null'); return Array.isArray(c) && c.length ? c : DEFAULT_PROXIES }
    catch { return DEFAULT_PROXIES }
  }
  const KNOWN_PROXIES = ref(loadCachedProxies())
  const DEFAULT_PROXY = import.meta.env.VITE_WS_URL || KNOWN_PROXIES.value[0]
  const wsUrl = ref(localStorage.getItem('messenger_proxy_url') || DEFAULT_PROXY)

  // Descubrimiento: baja el directorio y mergea los proxios (∪ con los defaults).
  const loadNodeDirectory = async () => {
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 4000)
      const r = await fetch(DIRECTORY_URL, { cache: 'no-cache', signal: ctrl.signal }).finally(() => clearTimeout(t))
      if (!r.ok) return
      const dir = await r.json()
      const urls = (dir.proxies || []).map(p => p && p.url).filter(u => typeof u === 'string' && /^wss?:\/\//.test(u))
      if (!urls.length) return
      const merged = Array.from(new Set([...urls, ...DEFAULT_PROXIES]))
      KNOWN_PROXIES.value = merged
      localStorage.setItem('messenger_proxies', JSON.stringify(merged))
    } catch (_) { /* sin red / CORS → queda el cache/fallback */ }
  }
  const nickname = ref(sanitizeNickname(localStorage.getItem('messenger_nickname') || ''))
  const nicknameSet = computed(() => nickname.value.trim().length > 0)

  // Self-presence channel name is derived from my own pubkey, so contacts can
  // resolve {pubkey -> token} by listing the channel `presence_<pubkey-hash>`.
  const presenceChannel = ref(null)

  let handlersSetup = false

  const setNickname = (name, opts = {}) => {
    nickname.value = sanitizeNickname((name || '').trim())
    localStorage.setItem('messenger_nickname', nickname.value)
    // También guardarlo en la vault, así viaja con `id.exportIdentity()` y
    // los overlays particionados pueden recuperarlo del bridge. Si el caller
    // pasa `{ writeToVault: false }` (p.ej. el placeholder derivado del
    // pubkey en overlay) saltamos esto para no contaminar el vault.
    if (nickname.value && opts.writeToVault !== false) {
      getIdentity().then(id => id?.setMyNickname?.(nickname.value)).catch(() => {})
    }
  }

  const myPublickey = ref(null)
  const queuedDelivered = ref(0)

  const connect = async () => {
    if (IS_RELAY_MODE) {
      // Overlay: no abre WebSocket; los sends salen vía cc-outbound-v1.
      isConnected.value = true
      console.log('[cc-conn] overlay → relay mode (no direct WebSocket)')
      return
    }
    try {
      connectionError.value = null
      await ready  // directorio + auto-selección del mejor nodo (si no hay home fijo)
      wsProxyClient.updateConfig({ url: wsUrl.value })
      if (!handlersSetup) { setupHandlers(); handlersSetup = true }
      const assigned = await wsProxyClient.connect()
      if (assigned && !token.value) token.value = assigned
      isConnected.value = true
      // Identificarse con la pubkey del vault para activar la cola offline.
      identifyWithVault().catch(e => console.warn('identify failed:', e))
    } catch (e) {
      connectionError.value = e.message
      isConnected.value = false
      console.error('Connection error:', e)
    }
  }

  const identifyWithVault = async () => {
    const id = await getIdentity()
    if (!id || !token.value) return
    // El vault entrega la pubkey en `me` durante el `ready` postMessage; no
    // hay un método getPublicKey() en la API.
    const publickey = id.me?.publickey
    if (!publickey) {
      console.warn('vault me.publickey no disponible — saltando identify')
      return
    }
    const data = { op: 'identify', publickey, token: token.value, ts: Date.now() }
    const { signature } = await id.signData(data)
    const result = await wsProxyClient.identify({ data, signature })
    myPublickey.value = publickey
    queuedDelivered.value = result?.queued_delivered || 0
    // Si el usuario activó notificaciones, re-registrar la push subscription
    // (los endpoints pueden rotar). Silencioso si no optó o falta permiso.
    import('./notificationsStore.js')
      .then(m => m.useNotificationsStore().ensureSubscribed())
      .catch(() => {})
    return result
  }

  const disconnect = () => {
    wsProxyClient.disconnect()
    isConnected.value = false
    token.value = null
  }

  // Cambiar de proxio (home): reconecta y re-identifica. Como los proxios están
  // federados, seguís alcanzando a contactos en otros nodos. `persist`: guardar
  // como tu home (selección manual) o solo temporal (failover automático).
  const setProxyUrl = async (url, { persist = true } = {}) => {
    const u = (url || '').trim()
    if (!/^wss?:\/\//.test(u) || u === wsUrl.value) return
    wsUrl.value = u
    if (persist) localStorage.setItem('messenger_proxy_url', u)
    if (IS_RELAY_MODE) return
    disconnect()
    await connect()
  }

  // Health-check de un proxio (HTTP /health del mismo host).
  const healthCheck = async (wssUrl) => {
    try {
      const httpUrl = wssUrl.replace(/^ws/, 'http').replace(/\/+$/, '') + '/health'
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 4000)
      const r = await fetch(httpUrl, { signal: ctrl.signal, cache: 'no-store' }).finally(() => clearTimeout(t))
      return r.ok
    } catch (_) { return false }
  }

  // Auto-failover: cuando el client se rinde con el proxio actual, busca otro
  // sano del directorio y salta (temporal, sin pisar tu home elegido). La
  // federación garantiza que igual te lleguen los mensajes desde el nuevo nodo.
  let failingOver = false
  const attemptFailover = async () => {
    if (failingOver || IS_RELAY_MODE) return
    failingOver = true
    try {
      for (const url of KNOWN_PROXIES.value.filter(u => u !== wsUrl.value)) {
        if (await healthCheck(url)) {
          console.warn('[cc-conn] failover →', url)
          await setProxyUrl(url, { persist: false })
          return
        }
      }
      // Ninguno sano: reintentar el actual más tarde (evita loop apretado).
      console.warn('[cc-conn] sin proxio alternativo sano; reintento en 10s')
      setTimeout(() => { if (!isConnected.value) connect().catch(() => {}) }, 10000)
    } finally { failingOver = false }
  }

  // Elige el proxio SANO con MENOR latencia (ping a /health). null si ninguno.
  const pickBestProxy = async () => {
    const results = await Promise.all(KNOWN_PROXIES.value.map(async (url) => {
      const start = (performance?.now?.() ?? Date.now())
      const ok = await healthCheck(url)
      return { url, ok, ms: (performance?.now?.() ?? Date.now()) - start }
    }))
    const healthy = results.filter(r => r.ok).sort((a, b) => a.ms - b.ms)
    return healthy.length ? healthy[0].url : null
  }

  // Init coordinado: baja el directorio y, si NO elegiste un home explícito,
  // auto-selecciona el nodo más rápido (temporal, se re-evalúa cada arranque).
  // `connect()` espera esto para usar el proxio elegido.
  const ready = (async () => {
    await loadNodeDirectory()
    if (!IS_RELAY_MODE && !localStorage.getItem('messenger_proxy_url')) {
      const best = await pickBestProxy()
      if (best) { wsUrl.value = best; console.log('[cc-conn] auto-seleccionado:', best) }
    }
  })()

  // Overlay: encola en chrome.storage.local para que el offscreen procese.
  // Resto: usa wsProxyClient directo.
  const sendMessage = IS_RELAY_MODE
    ? (toTokens, raw) => relayProxyCall('send', [toTokens, raw])
    : (toTokens, raw) => wsProxyClient.send(toTokens, raw)
  const sendByPubkey = IS_RELAY_MODE
    ? (toPubkeys, raw) => relayProxyCall('sendByPubkey', [toPubkeys, raw])
    : (toPubkeys, raw) => wsProxyClient.sendByPubkey(toPubkeys, raw)

  // Solo el offscreen procesa la cola.
  let queueWatcher = null
  if (IS_OFFSCREEN) {
    queueWatcher = watchOutboundQueue(async (item) => {
      if (!isConnected.value) return false  // reintenta cuando estemos conectados
      try {
        if (item.method === 'send') wsProxyClient.send(...item.args)
        else if (item.method === 'sendByPubkey') wsProxyClient.sendByPubkey(...item.args)
        else { console.warn('relay: unknown method', item.method); return true }
        return true
      } catch (e) {
        console.warn('relay: process failed:', e)
        return false
      }
    })
  }

  const setPresenceChannel = (name) => { presenceChannel.value = name }

  const setupHandlers = () => {
    wsProxyClient.on('token', (t) => { token.value = t })
    wsProxyClient.on('connect', () => {
      isConnected.value = true
      connectionError.value = null
      // Re-procesar items deferidos en la cola al (re)conectar.
      if (queueWatcher) queueWatcher.drain().catch(() => {})
    })
    wsProxyClient.on('disconnect', () => { isConnected.value = false; token.value = null })
    wsProxyClient.on('error', (err) => {
      connectionError.value = err.error || err.message || 'Unknown error'
      console.error('WS error:', err)
    })
    wsProxyClient.on('message', (fromToken, payload, meta) => {
      const raw = typeof payload === 'string' ? payload : JSON.stringify(payload)
      import('./threadsStore.js').then(m => m.useThreadsStore().handleIncoming(fromToken, raw, meta || {})).catch(() => {})
    })
    wsProxyClient.on('peer_disconnected', (peerToken) => {
      import('./contactsStore.js').then(m => m.useContactsStore().markOffline(peerToken)).catch(() => {})
    })
    // El client se rindió de reconectar al proxio actual → intentar otro nodo.
    wsProxyClient.on('reconnect_failed', () => { attemptFailover() })
  }

  return {
    token, isConnected, connectionError, wsUrl, nickname, nicknameSet, presenceChannel,
    myPublickey, queuedDelivered,
    connect, disconnect, sendMessage, sendByPubkey, setNickname, setPresenceChannel, wsProxyClient,
    KNOWN_PROXIES, setProxyUrl,
    identifyWithVault
  }
})
