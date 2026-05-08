import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useConnectionStore } from './connectionStore'
import { useContactsStore } from './contactsStore'
import { getIdentity } from '../services/identity'
import { getStore } from '../services/store'
import { sanitizeMessage } from '../utils/sanitize'

const MAX_THREAD = 1000   // cap per-thread history (server-side cap también)
const LEGACY_KEY = 'messenger_threads_v1'  // migración del antiguo localStorage
const LOCAL_CACHE_KEY = 'messenger_threads_cache_v1'  // espejo local resiliente

const loadLocalCache = () => {
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}
const saveLocalCache = (data) => {
  try { localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(data)) }
  catch (e) { console.warn('local thread cache write failed:', e) }
}

/**
 * Thread entry shape: { id, dir: 'in'|'out', text, ts, pending?: boolean }
 * Threads are keyed by contact pubkey.
 *
 * Wire protocol (string format `TYPE|json`):
 *   HELLO            { nickname, encryptionPubkey, pubkey }
 *   IDENTIFY_CHALLENGE { nonce }
 *   IDENTIFY_RESPONSE  { nonce, signature, publickey, encryptionPubkey }
 *   DM_ENC           { envelope, ts }      payload encrypted with id.encrypt
 *   DM_ACK           { id }
 *   RATING_QUERY     { queryId, subject }
 *   RATING_REPLY     { queryId, subject, mine, endorsements }
 */
export const useThreadsStore = defineStore('threads', () => {
  const connection = useConnectionStore()
  const contacts = useContactsStore()

  const threads = ref(loadLocalCache())   // hidratación inmediata desde cache local
  const ACTIVE_KEY = 'messenger_active_pubkey_v1'
  const activePubkey = ref(localStorage.getItem(ACTIVE_KEY) || null)
  const outbox = ref([])        // messages waiting for recipient to come online
  // Último DM entrante decodificado, para que App.vue muestre la notificación
  // centrada cuando llegue uno nuevo.
  const lastIncomingDM = ref(null)

  const activeThread = computed(() => activePubkey.value ? (threads.value[activePubkey.value] || []) : [])
  const activeContact = computed(() => activePubkey.value ? contacts.findByPubkey(activePubkey.value) : null)

  // Carga inicial: pide los hilos al store remoto y, si encontramos un
  // localStorage legacy del messenger viejo, lo migramos una vez.
  const load = async () => {
    const store = await getStore()
    // Si el store remoto no está disponible, NO borramos lo que ya tenemos
    // en memoria (hidratado desde el cache local). Mejor mostrar histórico
    // potencialmente desactualizado que pantalla en blanco.
    if (!store) return
    // Migración one-time desde el localStorage del messenger antiguo
    try {
      const legacy = localStorage.getItem(LEGACY_KEY)
      if (legacy) {
        const oldThreads = JSON.parse(legacy)
        for (const [pk, arr] of Object.entries(oldThreads || {})) {
          if (!Array.isArray(arr)) continue
          for (const entry of arr) await store.appendMessage(pk, entry)
        }
        localStorage.removeItem(LEGACY_KEY)
        console.log('[threads] migrated legacy localStorage to store.closer.click')
      }
    } catch (e) { console.warn('legacy migration failed:', e) }

    // Carga el snapshot completo: para messenger es viable porque en general
    // hay pocas conversaciones. Si crece, podemos pasar a lazy-load por hilo.
    const summaries = await store.getThreadSummaries()
    const next = {}
    for (const k of Object.keys(summaries)) {
      next[k] = await store.listThread(k)
    }
    // Si el remoto está vacío pero teníamos algo en cache local, conservamos
    // el cache para no perderlo (puede ser que el vault esté bloqueado).
    if (Object.keys(next).length === 0 && Object.keys(threads.value).length > 0) {
      console.warn('[threads] remote store returned empty; keeping local cache')
      return
    }
    threads.value = next
    saveLocalCache(threads.value)
  }

  // Apend optimista en memoria + escritura asíncrona al store remoto.
  // El UI ve el cambio al instante; si la escritura falla queda log.
  const append = async (pubkey, entry) => {
    if (!entry.id) entry.id = crypto.randomUUID()
    if (!entry.ts) entry.ts = Date.now()
    if (!threads.value[pubkey]) threads.value[pubkey] = []
    threads.value[pubkey].push(entry)
    if (threads.value[pubkey].length > MAX_THREAD) {
      threads.value[pubkey] = threads.value[pubkey].slice(-MAX_THREAD)
    }
    saveLocalCache(threads.value)
    const store = await getStore()
    if (store) {
      try { await store.appendMessage(pubkey, entry) }
      catch (e) { console.warn('store.appendMessage failed:', e) }
    }
  }

  // Actualiza un campo de una entry existente y la persiste de nuevo. Útil
  // para marcar `pending: false` tras DM_ACK o tras envío exitoso.
  const updateEntry = async (pubkey, entryId, patch) => {
    const arr = threads.value[pubkey]
    if (!arr) return
    const e = arr.find(x => x.id === entryId)
    if (!e) return
    Object.assign(e, patch)
    saveLocalCache(threads.value)
    const store = await getStore()
    if (store) { try { await store.appendMessage(pubkey, e) } catch (_) {} }
  }

  const setActive = (pubkey) => {
    activePubkey.value = pubkey
    if (pubkey) {
      localStorage.setItem(ACTIVE_KEY, pubkey)
      tryHandshake(pubkey)
    } else {
      localStorage.removeItem(ACTIVE_KEY)
    }
  }

  const formatMessage = (type, payload) => `${type}|${JSON.stringify(payload)}`
  const parseMessage = (raw) => {
    const i = raw.indexOf('|')
    if (i < 0) return { type: null, payload: null }
    try { return { type: raw.slice(0, i), payload: JSON.parse(raw.slice(i + 1)) } }
    catch { return { type: null, payload: null } }
  }

  // ------------------------------------------------------------------------
  // Outbound: send DM
  // ------------------------------------------------------------------------

  const sendDM = async (pubkey, text) => {
    const trimmed = sanitizeMessage(text)
    if (!trimmed) return
    const contact = contacts.findByPubkey(pubkey)
    if (!contact) throw new Error('Unknown contact')

    const entry = { id: crypto.randomUUID(), dir: 'out', text: trimmed, ts: Date.now(), pending: true }
    append(pubkey, entry)

    if (!contact.encryptionPubkey) {
      // No conocemos su clave de cifrado todavía — queda en outbox local
      // hasta completar el handshake.
      outbox.value.push({ pubkey, entryId: entry.id, text: trimmed })
      return
    }
    try {
      const id = await getIdentity()
      if (!id) throw new Error('Identity vault no disponible')
      // El proxy direcciona por pubkey: si está online, entrega al instante;
      // si no, encola hasta 24h. El "token" del wrap puede ser cualquier
      // identificador estable: usamos la pubkey del destinatario para que
      // sea el mismo valor al cifrar y al descifrar (vault.decrypt usa
      // myToken como key del wrap).
      const envelope = await id.encrypt(
        [{ token: pubkey, encryptionPubkey: contact.encryptionPubkey }],
        trimmed
      )
      const msg = formatMessage('DM_ENC', { envelope, ts: entry.ts, mid: entry.id })
      // Solo rutamos por token si tenemos presencia CONFIRMADA en esta sesión
      // (`liveTokenFor`). El `lastToken` persistido en vault puede ser de una
      // sesión anterior y el proxy lo descartaría sin caer a cola offline,
      // así que para esos casos usamos pubkey (cola offline 24h del proxy).
      const token = contacts.liveTokenFor(pubkey)
      if (token) await connection.sendMessage([token], msg)
      else       await connection.sendByPubkey([pubkey], msg)
      await updateEntry(pubkey, entry.id, { pending: false })
    } catch (e) {
      console.warn('sendDM failed; will retry:', e)
      outbox.value.push({ pubkey, entryId: entry.id, text: trimmed })
    }
  }

  const flushOutbox = async () => {
    if (outbox.value.length === 0) return
    const remaining = []
    for (const item of outbox.value) {
      const c = contacts.findByPubkey(item.pubkey)
      if (!c || !c.encryptionPubkey) { remaining.push(item); continue }
      try {
        const id = await getIdentity()
        if (!id) { remaining.push(item); continue }
        const envelope = await id.encrypt(
          [{ token: item.pubkey, encryptionPubkey: c.encryptionPubkey }],
          item.text
        )
        const msg = formatMessage('DM_ENC', { envelope, ts: Date.now(), mid: item.entryId })
        const token = contacts.liveTokenFor(item.pubkey)
        if (token) await connection.sendMessage([token], msg)
        else       await connection.sendByPubkey([item.pubkey], msg)
        await updateEntry(item.pubkey, item.entryId, { pending: false })
      } catch (err) {
        console.warn('flush failed:', err)
        remaining.push(item)
      }
    }
    outbox.value = remaining
  }

  // ------------------------------------------------------------------------
  // Handshake — exchange identity + encryption pubkeys with a contact whose
  // token we know is online.
  // ------------------------------------------------------------------------

  const tryHandshake = async (pubkey) => {
    const c = contacts.findByPubkey(pubkey)
    if (!c) return
    const token = contacts.liveTokenFor(pubkey)
    // Si tenemos presencia confirmada esta sesión, vamos por challenge.
    // Si no, mandamos un HELLO por pubkey: el proxy lo entregará al peer
    // (instant si está conectado, queue offline si no). Cuando responda
    // su HELLO, markOnline lo marcará como en línea en el UI.
    if (token) {
      try {
        const id = await getIdentity()
        if (!id) return
        const { nonce } = await id.makeChallenge()
        const msg = formatMessage('IDENTIFY_CHALLENGE', { nonce })
        await connection.sendMessage([token], msg)
      } catch (e) { console.warn('tryHandshake:', e) }
    } else {
      await sendHelloByPubkey(pubkey)
    }
  }

  const buildHello = async () => {
    const id = await getIdentity()
    if (!id) return null
    const pubkey = id.me?.publickey
    if (!pubkey) return null
    const encryptionPubkey = await id.getEncryptionPubkey()
    return formatMessage('HELLO', {
      nickname: connection.nickname,
      pubkey, encryptionPubkey
    })
  }

  const sendHello = async (token) => {
    try {
      const msg = await buildHello()
      if (!msg) return
      await connection.sendMessage([token], msg)
    } catch (e) { console.warn('sendHello:', e) }
  }

  // Pinga por pubkey: usado cuando no tenemos token vivo del peer pero
  // queremos saber su presencia. El proxy ruta al token actual (si está
  // identificado) o encola hasta 24h.
  const sendHelloByPubkey = async (pubkey) => {
    try {
      const msg = await buildHello()
      if (!msg) return
      await connection.sendByPubkey([pubkey], msg)
    } catch (e) { console.warn('sendHelloByPubkey:', e) }
  }

  // ------------------------------------------------------------------------
  // Inbound dispatch
  // ------------------------------------------------------------------------

  const handleIncoming = async (fromToken, raw, meta = {}) => {
    const { type, payload } = parseMessage(raw)
    if (!type || !payload) return
    switch (type) {
      case 'HELLO':                return handleHello(fromToken, payload, meta)
      case 'IDENTIFY_CHALLENGE':   return handleChallenge(fromToken, payload)
      case 'IDENTIFY_RESPONSE':    return handleResponse(fromToken, payload)
      case 'DM_ENC':               return handleDM(fromToken, payload, meta)
      case 'DM_ACK':               return handleAck(fromToken, payload)
      case 'RATING_QUERY':         return handleRatingQuery(fromToken, payload)
      case 'RATING_REPLY':         return handleRatingReply(fromToken, payload)
    }
  }

  const handleHello = async (fromToken, payload) => {
    if (!payload?.pubkey) return
    // If this pubkey is already a contact, refresh its presence + encryption key.
    const existing = contacts.findByPubkey(payload.pubkey)
    // Importante: hay que AWAIT antes de mandar el HELLO de vuelta. Si no,
    // el otro lado recibe nuestro HELLO, manda DM_ENC, y cuando llega aquí
    // el contacto aún no está persistido en el vault → "DM from unknown peer".
    if (existing) {
      await contacts.updateContact(payload.pubkey, {
        lastToken: fromToken,
        encryptionPubkey: payload.encryptionPubkey || existing.encryptionPubkey,
        nickname: existing.nickname || payload.nickname
      })
      contacts.markOnline(payload.pubkey, fromToken)
      flushOutbox()
      sendHello(fromToken)
    } else {
      await contacts.addContact({
        pubkey: payload.pubkey,
        nickname: payload.nickname || payload.pubkey.slice(0, 8),
        token: fromToken,
        encryptionPubkey: payload.encryptionPubkey || null
      })
      contacts.markOnline(payload.pubkey, fromToken)
      sendHello(fromToken)
    }
  }

  const handleChallenge = async (fromToken, payload) => {
    const id = await getIdentity()
    if (!id || !payload?.nonce) return
    try {
      const response = await id.signChallenge(payload.nonce)
      const msg = formatMessage('IDENTIFY_RESPONSE', response)
      await connection.sendMessage([fromToken], msg)
      // also send a HELLO so they learn nickname
      sendHello(fromToken)
    } catch (e) { console.warn('signChallenge:', e) }
  }

  const handleResponse = async (fromToken, payload) => {
    const id = await getIdentity()
    if (!id || !payload?.publickey) return
    try {
      const result = await id.verifyResponse(payload)
      if (!result.ok) return
      const pubkey = result.publickey
      const encryptionPubkey = result.encryptionPubkey || payload.encryptionPubkey || null
      // Promote to contact (or refresh if already there)
      contacts.addContact({
        pubkey, token: fromToken, encryptionPubkey,
        nickname: contacts.findByPubkey(pubkey)?.nickname
      })
      contacts.markOnline(pubkey, fromToken)
      contacts.refreshPeers()
      flushOutbox()
    } catch (e) { console.warn('verifyResponse:', e) }
  }

  const handleDM = async (fromToken, payload, meta = {}) => {
    if (!payload?.envelope) return
    // Resolver al remitente: si el proxy nos da `from_publickey` (caso de
    // entrega offline o cualquier mensaje pubkey-direccionado) lo usamos
    // directamente; si no, caemos a buscar por lastToken.
    const findContact = () => {
      let c = null
      if (meta.fromPubkey) c = contacts.findByPubkey(meta.fromPubkey)
      if (!c) c = contacts.contacts.find(x => x.lastToken === fromToken)
      return c
    }
    let c = findContact()
    // Si el HELLO viene en paralelo y aún no terminó, esperamos hasta 2s.
    if (!c) {
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 200))
        c = findContact()
        if (c?.encryptionPubkey) break
      }
    }
    const senderEnc = c?.encryptionPubkey
    if (!c || !senderEnc) {
      console.warn('DM from unknown peer', fromToken, meta.fromPubkey || '', '— dropping until handshake')
      return
    }
    try {
      const id = await getIdentity()
      if (!id) return
      // El wrap key es la pubkey del receptor (myPublickey). Si el sobre
      // viene del flujo legacy por token, intentamos primero pubkey y luego
      // token como fallback.
      const myPub = connection.myPublickey
      let result
      try {
        result = await id.decrypt(senderEnc, myPub, payload.envelope)
      } catch (e1) {
        try { result = await id.decrypt(senderEnc, connection.token, payload.envelope) }
        catch (e2) { throw e1 }
      }
      // El vault devuelve { plaintext }, no un string directo.
      const text = result?.plaintext ?? ''
      const cleanText = sanitizeMessage(text)
      const entry = {
        id: payload.mid || crypto.randomUUID(),
        dir: 'in',
        text: cleanText,
        ts: payload.ts || Date.now(),
        queued: !!meta.queued,
        queuedAt: meta.queuedAt || null
      }
      append(c.publickey, entry)

      // Notifica a la UI para mostrar la notificación centrada (App.vue
      // observa `lastIncomingDM` y aplica el fade in/out + mark-as-displayed).
      lastIncomingDM.value = {
        id: entry.id,
        fromPubkey: c.publickey,
        fromNickname: c.nickname || c.publickey.slice(0, 8),
        text: cleanText,
        ts: entry.ts
      }

      // Si el PWA está embebido (extensión / future apps), notifica al parent
      // para que pueda disparar toast/notificación nativa.
      if (window !== window.parent) {
        try {
          window.parent.postMessage({
            source: 'cc-messenger',
            type: 'dm-arrived',
            dm: {
              id: entry.id,
              fromPubkey: c.publickey,
              fromNickname: c.nickname || c.publickey.slice(0, 8),
              text: cleanText,
              ts: entry.ts,
              queued: entry.queued
            }
          }, '*')
        } catch (_) {}
      }
      // Optional ack — si conocemos token actual, lo mandamos por token;
      // si no, por pubkey (el ack también puede irse offline).
      if (payload.mid) {
        const ack = formatMessage('DM_ACK', { id: payload.mid })
        const tk = contacts.tokenFor(c.publickey)
        if (tk) await connection.sendMessage([tk], ack)
        else    await connection.sendByPubkey([c.publickey], ack)
      }
    } catch (e) { console.warn('decrypt failed:', e) }
  }

  const handleAck = async (fromToken, payload) => {
    if (!payload?.id) return
    for (const [pk, arr] of Object.entries(threads.value)) {
      const e = arr.find(x => x.id === payload.id)
      if (e) { await updateEntry(pk, payload.id, { pending: false }); return }
    }
  }

  // ---- Ratings -----------------------------------------------------------

  const askRatingsAbout = async (subjectPubkey) => {
    const id = await getIdentity()
    if (!id) return
    const queryId = crypto.randomUUID()
    const tokens = []
    for (const c of contacts.contacts) {
      if (c.publickey === subjectPubkey) continue
      const t = contacts.tokenFor(c.publickey)
      if (t) tokens.push(t)
    }
    if (tokens.length === 0) return
    const msg = formatMessage('RATING_QUERY', { queryId, subject: subjectPubkey })
    await connection.sendMessage(tokens, msg)
  }

  const handleRatingQuery = async (fromToken, payload) => {
    const id = await getIdentity()
    if (!id || !payload?.subject || !payload?.queryId) return
    try {
      const c = contacts.contacts.find(x => x.lastToken === fromToken)
      if (c) await id.recordQuery(c.publickey, payload.subject)
      const { mine, endorsements } = await id.getRatingsForSubject(payload.subject)
      const reply = formatMessage('RATING_REPLY', {
        queryId: payload.queryId, subject: payload.subject, mine, endorsements
      })
      await connection.sendMessage([fromToken], reply)
    } catch (e) { console.warn('handleRatingQuery:', e) }
  }

  const handleRatingReply = async (fromToken, payload) => {
    const id = await getIdentity()
    if (!id || !payload?.subject) return
    try {
      if (payload.mine) await id.mergeEndorsements(payload.subject, [payload.mine])
      if (Array.isArray(payload.endorsements) && payload.endorsements.length) {
        await id.mergeEndorsements(payload.subject, payload.endorsements)
      }
      contacts.refreshPeers()
    } catch (e) { console.warn('handleRatingReply:', e) }
  }

  // Carga asíncrona — el UI verá hilos aparecer cuando el store responda.
  // Además, nos suscribimos a `onSync`: el store puede arrancar bloqueado
  // (sin passphrase) y los hilos cifrados solo aparecen tras unlock + sync.
  // Sin esto, al refrescar la página los mensajes no se ven porque `load`
  // corre antes de que el vault esté desbloqueado.
  const reload = () => load().catch(e => console.warn('threads.load failed:', e))
  reload()
  ;(async () => {
    const store = await getStore()
    if (!store?.onSync) return
    store.onSync((ev) => {
      const t = ev?.type || ev
      if (t === 'unlock' || t === 'sync' || t === 'connect' || t === 'remote-update') {
        reload()
      }
    })
  })()

  return {
    threads, activePubkey, activeThread, activeContact, outbox, lastIncomingDM,
    setActive, sendDM, flushOutbox,
    handleIncoming, sendHello, sendHelloByPubkey, tryHandshake,
    askRatingsAbout, load
  }
})
