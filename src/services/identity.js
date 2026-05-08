// Singleton compartido del Identity vault para toda la app.
//
// Importar `Identity` desde `@gatoseya/closer-click-identity` directamente
// en varios stores funcionaba mientras Vite los metía en el mismo chunk.
// `connectionStore` hace `import()` dinámico de `threadsStore` y
// `contactsStore` (para evitar dependencia circular en setup), lo que
// puede empujar a Rollup a duplicar el módulo `closer-click-identity` en
// chunks separados — y si pasa, cada copia tiene su propia variable
// `singleton`, su propio `_pending` Map y su propio iframe handler. El
// resultado: `listPeers` queda colgado porque la respuesta llega a otra
// instancia.
//
// Forzando que TODOS los stores usen este wrapper, el lib se importa una
// sola vez en este módulo y todos comparten el mismo objeto Identity.

import { Identity } from '@gatoseya/closer-click-identity'
import { getIdentityBlob, setIdentityBlob, onIdentityBlobChanged } from './identityBridge'

let _instance = null
let _connectPromise = null

// Estado del bridge para evitar loops:
//  - `_lastPushedHash`: blob ya publicado (skip si no cambia).
//  - `_isImporting`: flag mientras corremos `id.importIdentity` desde el
//    bridge — los mutadores que dispare el import (saveMe, savePeers en el
//    vault) NO deben volver a pushear, sino se forma un loop entre contextos.
let _lastPushedHash = null
let _isImporting = false

function hashBlob (blob) {
  if (!blob) return ''
  // Hash barato: primeros chars del JSON. No es criptográfico, solo dedup.
  try {
    const s = JSON.stringify(blob)
    let h = 0
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
    return s.length + ':' + h
  } catch { return Math.random().toString(36) }
}

async function bridgeImportIfAvailable (id) {
  if (window === window.top) return
  try {
    const blob = await getIdentityBlob()
    if (!blob) return
    _isImporting = true
    try {
      await id.importIdentity(blob)
      _lastPushedHash = hashBlob(blob)  // ya está sincronizado con el bridge
    } finally { _isImporting = false }
    console.log('[cc-id-bridge] vault hidratado desde el bridge')
  } catch (e) {
    console.warn('[cc-id-bridge] import inicial falló:', e?.message || e)
  }
}

async function bridgePush (id) {
  if (_isImporting) return  // evita echo loop con onIdentityBlobChanged
  try {
    const blob = await id.exportIdentity()
    if (!blob) return
    const h = hashBlob(blob)
    if (h === _lastPushedHash) return  // sin cambios, no duplicamos
    _lastPushedHash = h
    await setIdentityBlob(blob)
  } catch (e) {
    console.warn('[cc-id-bridge] push falló:', e?.message || e)
  }
}

// El modo `overlay` corre en un site cualquiera y vive en un partition
// aislado: NO debe escribir identidad. Solo recibe. Los modos `popup` y
// `offscreen` corren en chrome-extension://, tienen storage unpartitioned
// vía host_permissions y SÍ son fuente de verdad — propagamos sus cambios.
function isWriteAuthorisedEmbed () {
  if (window === window.top) return true  // pestaña normal
  const embed = new URLSearchParams(location.search).get('embed')
  return embed === 'popup' || embed === 'offscreen'
}

// Wraps a few mutating methods so each successful call snapshots the vault
// to the bridge automatically. Si el lib agrega más mutadores en el futuro,
// añadirlos aquí.
function attachAutoPush (id) {
  if (!isWriteAuthorisedEmbed()) return
  const MUTATORS = [
    'addContact', 'updateContact', 'removeContact',
    'setMyNickname', 'setRating', 'forgetPeer',
    'mergeEndorsements', 'recordQuery'
  ]
  for (const name of MUTATORS) {
    const orig = id[name]
    if (typeof orig !== 'function') continue
    id[name] = async function (...args) {
      const result = await orig.apply(id, args)
      bridgePush(id).catch(() => {})
      return result
    }
  }
}

// Cambios externos del blob (otros contextos): re-importamos para mantener
// este vault al día sin recargar la página. Aplica a todos los modos embed.
function attachExternalSync (id) {
  if (window === window.top) return
  onIdentityBlobChanged(async (blob) => {
    if (!blob) return
    const h = hashBlob(blob)
    if (h === _lastPushedHash) return  // ya estamos al día (probablemente lo escribimos nosotros)
    _isImporting = true
    try { await id.importIdentity(blob); _lastPushedHash = h }
    catch (e) { console.warn('[cc-id-bridge] re-import on change failed:', e?.message || e) }
    finally { _isImporting = false }
  })
}

/**
 * Devuelve la instancia compartida del Identity vault, esperando a que
 * `ready` haya completado. Reutiliza la promesa entre llamadas concurrentes.
 * Devuelve `null` si el vault no está alcanzable (e.g. iframe blocked) en
 * lugar de tirar — los stores tienen fallbacks para ese caso.
 */
export async function getIdentity () {
  if (_instance) return _instance
  if (_connectPromise) return _connectPromise
  _connectPromise = (async () => {
    try {
      const inst = await Identity.connect()
      await bridgeImportIfAvailable(inst)
      attachAutoPush(inst)
      attachExternalSync(inst)
      // Cualquier contexto con write authority publica su blob al bridge
      // inmediatamente: pestaña directa de messenger.closer.click, popup
      // pineado y offscreen. La extensión inyecta `identity-bridge-host.js`
      // también en messenger.closer.click, así que la pestaña directa puede
      // hablar con chrome.storage.local vía window.postMessage a sí misma.
      if (isWriteAuthorisedEmbed()) {
        bridgePush(inst).catch(() => {})
      }
      _instance = inst
      return _instance
    } catch (e) {
      console.warn('Identity vault unreachable:', e)
      _instance = null
      return null
    } finally {
      _connectPromise = null
    }
  })()
  return _connectPromise
}

/** Acceso síncrono (puede devolver null si aún no completó connect). */
export function currentIdentity () {
  return _instance
}
