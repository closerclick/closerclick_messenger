import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

// Preferencias de notificación in-app. Por defecto se notifica TODO; el usuario
// apaga desde el panel lo que no quiere ver. Local a este dispositivo
// (localStorage). El "timbre" real con app cerrada es Web Push (notificationsStore).
const LS_KEY = 'cc-notif-prefs-v1'

const DEFAULTS = {
  contactMessages: true,   // DMs de tus contactos
  vouchedRequests: true,   // solicitudes avaladas por tu red de confianza
  strangerRequests: true,  // solicitudes de desconocidos (sin aval)
  helloRequests: true,     // cuando un desconocido te saluda/agrega (aún sin mensaje)
  sound: true              // pitido al notificar
}

export const useNotifPrefsStore = defineStore('notifPrefs', () => {
  const load = () => {
    try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(LS_KEY) || '{}')) } }
    catch { return { ...DEFAULTS } }
  }
  const prefs = ref(load())

  watch(prefs, (v) => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(v)) } catch (_) {}
  }, { deep: true })

  const set = (key, val) => { if (key in prefs.value) prefs.value[key] = !!val }

  // ¿Notificar un evento entrante? `kind`: 'message' | 'request' | 'hello'.
  // Para solicitudes/hellos, `vouched` elige entre la pref avalado/desconocido.
  const shouldNotify = (kind, vouched = false) => {
    const p = prefs.value
    if (kind === 'message') return p.contactMessages
    if (kind === 'hello') return p.helloRequests && (vouched ? p.vouchedRequests : p.strangerRequests)
    if (kind === 'request') return vouched ? p.vouchedRequests : p.strangerRequests
    return true
  }

  return { prefs, set, shouldNotify }
})
