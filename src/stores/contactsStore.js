import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { Identity } from '@gatoseya/closer-click-identity'
import { useConnectionStore } from './connectionStore'
import { sanitizeNickname } from '../utils/sanitize'
import { computeDerivedRating, buildTrustMap } from '../utils/rating'

let _identity = null
async function getIdentity () {
  if (_identity) return _identity
  try { _identity = await Identity.connect() } catch (e) {
    console.warn('Identity vault unreachable:', e); _identity = null
  }
  return _identity
}

/**
 * Contacts live in the shared identity vault (id.closer.click) since v0.6.0,
 * so chat / chess / messenger see the same address book. The vault stores
 * contact metadata next to rating/endorsement data on the same peer record.
 */
export const useContactsStore = defineStore('contacts', () => {
  const connection = useConnectionStore()

  const peers = ref([])              // all peer records from vault
  const onlineMap = ref(new Map())   // pubkey -> token (in-memory, this session)
  const ratingTick = ref(0)

  const contacts = computed(() => {
    ratingTick.value
    return peers.value.filter(p => p.isContact)
      .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))
  })

  const trustMap = computed(() => buildTrustMap(peers.value))

  const refresh = async () => {
    const id = await getIdentity()
    if (!id) return
    try {
      peers.value = await id.listPeers()
      ratingTick.value++
    } catch (e) { console.warn('listPeers failed:', e) }
  }
  // backward-compat alias used elsewhere
  const refreshPeers = refresh

  const addContact = async ({ pubkey, nickname, token, encryptionPubkey, notes }) => {
    if (!pubkey) throw new Error('pubkey required')
    const id = await getIdentity()
    if (!id) throw new Error('Identity vault no disponible')
    const cleanNick = nickname ? sanitizeNickname(nickname) : undefined
    await id.addContact({
      publickey: pubkey,
      nickname: cleanNick,
      encryptionPubkey: encryptionPubkey || undefined,
      lastToken: token || undefined,
      notes
    })
    await refresh()
    return findByPubkey(pubkey)
  }

  const updateContact = async (pubkey, patch) => {
    const id = await getIdentity()
    if (!id) return
    const allowed = {}
    for (const k of ['nickname', 'lastToken', 'encryptionPubkey', 'contactNotes']) {
      if (k in patch) allowed[k] = patch[k]
    }
    if (Object.keys(allowed).length === 0) return
    await id.updateContact(pubkey, allowed)
    await refresh()
  }

  const removeContact = async (pubkey) => {
    const id = await getIdentity()
    if (!id) return
    await id.removeContact(pubkey)
    await refresh()
  }

  const findByPubkey = (pubkey) => contacts.value.find(c => c.publickey === pubkey)
  const findByToken  = (token)  => contacts.value.find(c => c.lastToken === token)
  const peerFor      = (pubkey) => peers.value.find(p => p.publickey === pubkey) || null

  // ---- Online presence (per-session, not persisted) ----------------------

  const markOnline = (pubkey, token) => {
    onlineMap.value.set(pubkey, token)
    onlineMap.value = new Map(onlineMap.value)
    // Also record the latest token in the vault contact record
    if (findByPubkey(pubkey) && token) {
      updateContact(pubkey, { lastToken: token }).catch(() => {})
    }
  }
  const markOffline = (token) => {
    for (const [pk, tk] of onlineMap.value.entries()) {
      if (tk === token) onlineMap.value.delete(pk)
    }
    onlineMap.value = new Map(onlineMap.value)
  }
  const isOnline = (pubkey) => onlineMap.value.has(pubkey)
  const tokenFor = (pubkey) => onlineMap.value.get(pubkey) || findByPubkey(pubkey)?.lastToken || null

  // ---- Rating -------------------------------------------------------------

  const ratePeer = async (pubkey, rating, notes) => {
    const id = await getIdentity()
    if (!id) throw new Error('Identity vault no disponible')
    await id.setRating(pubkey, rating, notes || '')
    await refresh()
  }

  const ratingFor = (pubkey) => {
    if (!pubkey) return { value: null, source: null, count: 0 }
    return computeDerivedRating(peerFor(pubkey), trustMap.value)
  }
  const myRatingFor = (pubkey) => peerFor(pubkey)?.myRating?.rating ?? null

  return {
    peers, contacts, ratingTick, onlineMap,
    refresh, refreshPeers,
    addContact, updateContact, removeContact,
    findByPubkey, findByToken, peerFor,
    markOnline, markOffline, isOnline, tokenFor,
    ratePeer, ratingFor, myRatingFor
  }
})
