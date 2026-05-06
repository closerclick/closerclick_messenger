<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { getIdentity } from '../services/identity'
import { getStore } from '../services/store'

const emit = defineEmits(['close'])

// Read OAuth client ID from build-time env. Configure in messenger's .env:
//   VITE_GOOGLE_OAUTH_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
// Both vault origins (id.closer.click + store.closer.click) must be
// added as Authorized JavaScript Origins in the Google Cloud Console.
const CLIENT_ID = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID || ''

const passphrase = ref('')
const passphrase2 = ref('')
const showPassphrase = ref(false)
const busy = ref(false)
const error = ref('')
const idStatus = ref({ connected: false, unlocked: false, dirty: false })
const stStatus = ref({ connected: false, unlocked: false, dirty: false })
const lastEvent = ref(null)

let unsubId = null
let unsubSt = null

async function refresh () {
  const id = await getIdentity()
  const st = await getStore()
  if (id) idStatus.value = await id.syncStatus()
  if (st) stStatus.value = await st.syncStatus()
}

onMounted(async () => {
  const id = await getIdentity()
  const st = await getStore()
  if (id) unsubId = id.onSync((ev) => { lastEvent.value = ev; refresh() })
  if (st) unsubSt = st.onSync((ev) => { lastEvent.value = ev; refresh() })
  await refresh()
})
onUnmounted(() => { unsubId?.(); unsubSt?.() })

async function connectGoogle () {
  if (!CLIENT_ID) { error.value = 'Falta VITE_GOOGLE_OAUTH_CLIENT_ID en build'; return }
  error.value = ''; busy.value = true
  try {
    const id = await getIdentity()
    const st = await getStore()
    if (id) await id.syncConnect(CLIENT_ID)
    if (st) await st.syncConnect(CLIENT_ID)
    await refresh()
  } catch (e) { error.value = e.message || String(e) }
  finally { busy.value = false }
}

async function disconnectGoogle () {
  busy.value = true
  try {
    const id = await getIdentity(); const st = await getStore()
    if (id) await id.syncDisconnect()
    if (st) await st.syncDisconnect()
    await refresh()
  } finally { busy.value = false }
}

async function unlock () {
  error.value = ''
  if (passphrase.value.length < 12) { error.value = 'Mínimo 12 caracteres'; return }
  if (passphrase2.value && passphrase.value !== passphrase2.value) {
    error.value = 'Las passphrases no coinciden'; return
  }
  busy.value = true
  try {
    const id = await getIdentity(); const st = await getStore()
    if (id) await id.syncUnlock(passphrase.value)
    if (st) await st.syncUnlock(passphrase.value)
    passphrase.value = ''; passphrase2.value = ''
    await refresh()
  } catch (e) { error.value = e.message || String(e) }
  finally { busy.value = false }
}

async function lock () {
  busy.value = true
  try {
    const id = await getIdentity(); const st = await getStore()
    if (id) await id.syncLock()
    if (st) await st.syncLock()
    await refresh()
  } finally { busy.value = false }
}

async function syncNow () {
  busy.value = true; error.value = ''
  try {
    const id = await getIdentity(); const st = await getStore()
    if (id) await id.syncNow()
    if (st) await st.syncNow()
    await refresh()
  } catch (e) { error.value = e.message || String(e) }
  finally { busy.value = false }
}

function statusLabel (s) {
  if (!s.connected) return '⚪ Sin cuenta'
  if (!s.unlocked) return '🔒 Bloqueado'
  if (s.dirty) return '🔄 Guardando…'
  return '✅ Al día'
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal">
      <header>
        <h3>Tu cuenta</h3>
        <button class="x" @click="emit('close')">×</button>
      </header>

      <p class="desc">
        Inicia sesión con Google para que tus claves, contactos e historial vivan en
        <strong>tu Google Drive</strong> y estén disponibles en cualquier dispositivo donde
        entres con la misma cuenta. Tus datos se cifran con tu <strong>contraseña personal</strong>
        antes de subir, así que ni Google ni nosotros podemos leerlos. Si olvidas la
        contraseña, no hay forma de recuperarlos.
      </p>

      <div class="row">
        <div class="vault-status">
          <div><b>Identidad</b></div>
          <div>{{ statusLabel(idStatus) }}</div>
        </div>
        <div class="vault-status">
          <div><b>Mensajes</b></div>
          <div>{{ statusLabel(stStatus) }}</div>
        </div>
      </div>

      <div v-if="!idStatus.connected || !stStatus.connected" class="actions">
        <button :disabled="busy" @click="connectGoogle">Iniciar sesión con Google</button>
      </div>

      <div v-else-if="!idStatus.unlocked || !stStatus.unlocked" class="unlock">
        <label>
          Contraseña personal
          <input :type="showPassphrase ? 'text' : 'password'" v-model="passphrase" autocomplete="off" />
        </label>
        <label>
          Confirmar (solo primera vez)
          <input :type="showPassphrase ? 'text' : 'password'" v-model="passphrase2" autocomplete="off" />
        </label>
        <label class="show-pw">
          <input type="checkbox" v-model="showPassphrase" />
          Mostrar contraseña
        </label>
        <div class="actions">
          <button :disabled="busy" @click="unlock">Entrar</button>
          <button :disabled="busy" class="ghost" @click="disconnectGoogle">Cerrar sesión Google</button>
        </div>
      </div>

      <div v-else class="actions">
        <button :disabled="busy" @click="syncNow">Actualizar ahora</button>
        <button :disabled="busy" class="ghost" @click="lock">Bloquear</button>
        <button :disabled="busy" class="ghost" @click="disconnectGoogle">Cerrar sesión Google</button>
      </div>

      <div v-if="error" class="error">{{ error }}</div>
      <div v-if="lastEvent" class="event">
        <code>{{ lastEvent.kind }} → {{ lastEvent.status }}</code>
        <span v-if="lastEvent.error"> — {{ lastEvent.error }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center; z-index: 1000;
}
.modal {
  background: var(--bg-1, #fff); color: var(--fg, #222);
  width: min(480px, 92vw); border-radius: 10px; padding: 20px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
}
header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
header h3 { margin: 0; font-size: 18px; }
.x { background: transparent; border: 0; font-size: 24px; cursor: pointer; color: inherit; }
.desc { font-size: 13px; line-height: 1.5; color: var(--muted, #666); margin: 0 0 16px; }
.row { display: flex; gap: 12px; margin-bottom: 16px; }
.vault-status { flex: 1; padding: 10px; background: var(--bg-2, #f5f5f5); border-radius: 6px; font-size: 13px; }
.unlock label { display: block; font-size: 13px; margin-bottom: 8px; }
.unlock input[type=password], .unlock input[type=text] {
  display: block; width: 100%; padding: 8px; margin-top: 4px;
  border: 1px solid var(--border, #ddd); border-radius: 4px; font-family: monospace;
}
.show-pw { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.actions button {
  background: var(--accent, #2196f3); color: #fff; border: 0;
  padding: 8px 14px; border-radius: 6px; cursor: pointer; font-size: 14px;
}
.actions button.ghost { background: transparent; color: var(--accent, #2196f3); border: 1px solid currentColor; }
.actions button:disabled { opacity: 0.5; cursor: not-allowed; }
.error { margin-top: 12px; color: #c44; font-size: 13px; }
.event { margin-top: 12px; font-size: 12px; color: var(--muted, #888); }
.event code { background: var(--bg-3, #eee); padding: 1px 4px; border-radius: 3px; }
</style>
