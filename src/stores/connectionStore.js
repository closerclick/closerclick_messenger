import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getWebSocketProxyClient } from '@gatoseya/closer-click-proxy-client'
import { getIdentity } from '../services/identity'
import { sanitizeNickname } from '../utils/sanitize'
import { relayProxyCall, watchOutboundQueue } from '../services/proxyRelay'

const URL_EMBED = new URLSearchParams(typeof location !== 'undefined' ? location.search : '').get('embed')
// Relay mode: el messenger no toca el WebSocket; pone los sends en
// chrome.storage.local y el offscreen los procesa. Aplica a popup/overlay.
const IS_RELAY_MODE = URL_EMBED === 'popup' || URL_EMBED === 'overlay'
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
    // En modo relay (popup/overlay) NO abrimos WebSocket propio: el offscreen
    // tiene la única conexión real. Esto evita que cada pestaña HTTPS abierta
    // sume una conexión más al proxy. Marcamos isConnected=true porque, desde
    // la perspectiva del UI, los sends sí "salen" (encolados al offscreen).
    if (IS_RELAY_MODE) {
      isConnected.value = true
      console.log('[cc-conn] relay mode: skipping direct WebSocket connect')
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
    return result
  }

  const disconnect = () => {
    wsProxyClient.disconnect()
    isConnected.value = false
    token.value = null
  }

  // En modo relay, sendMessage/sendByPubkey encolan en chrome.storage.local
  // bajo `cc-outbound-v1`. El offscreen (más abajo) escucha y procesa la cola
  // con su WebSocket único. Los demás contextos (direct tab, offscreen) usan
  // el client directamente.
  const sendMessage = IS_RELAY_MODE
    ? (toTokens, raw) => relayProxyCall('send', [toTokens, raw])
    : (toTokens, raw) => wsProxyClient.send(toTokens, raw)
  const sendByPubkey = IS_RELAY_MODE
    ? (toPubkeys, raw) => relayProxyCall('sendByPubkey', [toPubkeys, raw])
    : (toPubkeys, raw) => wsProxyClient.sendByPubkey(toPubkeys, raw)

  // Solo el offscreen es procesador de la cola: tiene la única conexión.
  if (IS_OFFSCREEN) {
    watchOutboundQueue(async (item) => {
      if (!isConnected.value) return false  // reintenta cuando estemos conectados
      try {
        if (item.method === 'send') wsProxyClient.send(...item.args)
        else if (item.method === 'sendByPubkey') wsProxyClient.sendByPubkey(...item.args)
        else { console.warn('relay: unknown method', item.method); return true } // descartar
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
    wsProxyClient.on('connect', () => { isConnected.value = true; connectionError.value = null })
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
