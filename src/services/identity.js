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

// Si corremos como iframe de la extensión (popup, overlay, offscreen), antes
// de devolver el vault al consumidor intentamos hidratarlo desde el bridge.
// El offscreen empuja periódicamente su `exportIdentity()` a chrome.storage.local;
// los overlays particionados lo leen al primer arranque para no generar una
// identidad nueva en su bucket aislado.
async function bridgeImportIfAvailable (id) {
  if (window === window.top) return  // no embed → nada que hacer
  try {
    const blob = await getIdentityBlob()
    if (!blob) return
    await id.importIdentity(blob)
    console.log('[cc-id-bridge] vault hidratado desde el bridge')
  } catch (e) {
    console.warn('[cc-id-bridge] import inicial falló:', e?.message || e)
  }
}

// Después de mutaciones de identidad en este vault, empujamos el blob al
// bridge para que otros contextos (el offscreen, popups, overlays en otras
// pestañas) puedan converger.
async function bridgePush (id) {
  if (window === window.top) return
  try {
    const blob = await id.exportIdentity()
    if (blob) await setIdentityBlob(blob)
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
  if (window === window.top) return  // pestaña normal: no hay parent al que empujar
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
    try { await id.importIdentity(blob) }
    catch (e) { console.warn('[cc-id-bridge] re-import on change failed:', e?.message || e) }
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
