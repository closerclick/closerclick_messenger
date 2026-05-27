import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getWebSocketProxyClient } from '@gatoseya/closer-click-proxy-client'
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
  const wsUrl = ref(import.meta.env.VITE_WS_URL || 'wss://proxy.closer.click')
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
  }

  return {
    token, isConnected, connectionError, wsUrl, nickname, nicknameSet, presenceChannel,
    myPublickey, queuedDelivered,
    connect, disconnect, sendMessage, sendByPubkey, setNickname, setPresenceChannel, wsProxyClient,
    identifyWithVault
  }
})
