// Outbound relay: cuando el messenger corre como popup u overlay, no se
// conecta directamente al proxy. En su lugar, encola operaciones en
// `chrome.storage.local` bajo `cc-outbound-v1`. El offscreen (única instancia
// con conexión real al proxy) escucha cambios en esa key y procesa la cola.
//
// Beneficios:
//  - Una sola conexión al proxy por usuario, sin importar cuántas pestañas
//    HTTPS estén abiertas (cada una con su overlay).
//  - El offscreen se mantiene siempre vivo via service worker, así que los
//    sends llegan aun si el usuario cierra el popup justo después.
//
// API mínima: `relayProxyCall('send', [tokens, msg])`. El offscreen ejecuta
// `wsProxyClient.send(...args)`. Mismo patrón para `sendByPubkey`.

import { kvGet, kvSet, kvAppendArray, onKvChanged } from './identityBridge'

const QUEUE_KEY = 'cc-outbound-v1'

let _seq = 0
const newId = () => `${Date.now()}-${++_seq}`

/** Encola una llamada al proxy. Resuelve cuando se persiste en storage. */
export async function relayProxyCall (method, args) {
  const id = newId()
  await kvAppendArray(QUEUE_KEY, { id, method, args, ts: Date.now() })
  return id
}

/**
 * Solo para offscreen: procesa la cola.
 * `processor(item)` debe ser async y devolver true si fue procesado (se quita
 * de la cola) o false para reintentar más tarde.
 *
 * Devuelve `{ drain, dispose }`: `drain()` fuerza un re-procesamiento inmediato
 * (útil cuando `isConnected` cambia a true y hay items pendientes), `dispose()`
 * se desuscribe del onKvChanged.
 */
export function watchOutboundQueue (processor) {
  let inFlight = false
  const drain = async () => {
    if (inFlight) return
    inFlight = true
    try {
      const arr = await kvGet(QUEUE_KEY)
      if (!Array.isArray(arr) || arr.length === 0) return
      const remaining = []
      for (const item of arr) {
        try {
          const ok = await processor(item)
          if (!ok) remaining.push(item)
        } catch (_) {
          remaining.push(item)
        }
      }
      if (remaining.length !== arr.length) await kvSet(QUEUE_KEY, remaining)
    } finally { inFlight = false }
  }
  // Drain al inicio (items previos).
  drain().catch(() => {})
  // Re-drain ante cualquier cambio en la cola.
  const dispose = onKvChanged((key) => {
    if (key === QUEUE_KEY) drain().catch(() => {})
  })
  return { drain, dispose }
}
