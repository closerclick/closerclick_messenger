import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getWebSocketProxyClient } from '@gatoseya/closer-click-proxy-client'
import { Identity } from '@gatoseya/closer-click-identity'
import { sanitizeNickname } from '../utils/sanitize'

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

  const setNickname = (name) => {
    nickname.value = sanitizeNickname((name || '').trim())
    localStorage.setItem('messenger_nickname', nickname.value)
  }

  const myPublickey = ref(null)
  const queuedDelivered = ref(0)

  const connect = async () => {
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
    let id
    try { id = await Identity.connect() } catch { return }
    if (!id || !token.value) return
    const publickey = await id.getPublicKey()
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

  const sendMessage = (toTokens, raw) => wsProxyClient.send(toTokens, raw)
  const sendByPubkey = (toPubkeys, raw) => wsProxyClient.sendByPubkey(toPubkeys, raw)

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
