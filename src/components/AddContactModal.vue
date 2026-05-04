<script setup>
import { ref } from 'vue'
import { useConnectionStore } from '../stores/connectionStore'
import { useContactsStore } from '../stores/contactsStore'
import { useThreadsStore } from '../stores/threadsStore'
import { sanitizeNickname } from '../utils/sanitize'

const emit = defineEmits(['close'])
const connection = useConnectionStore()
const contacts = useContactsStore()
const threads = useThreadsStore()

const tab = ref('add')   // 'add' | 'mine'
const tokenInput = ref('')
const nicknameInput = ref('')
const error = ref('')

const myToken = () => connection.token

const submit = async () => {
  error.value = ''
  const tk = (tokenInput.value || '').trim().toUpperCase()
  if (!/^[A-Z0-9]{4,8}$/.test(tk)) {
    error.value = 'Token inválido (4-8 caracteres alfanuméricos en mayúsculas).'
    return
  }
  if (tk === connection.token) {
    error.value = 'Ese es tu propio token.'
    return
  }
  // Send a HELLO probe; the other side will reply, and the handler in
  // threadsStore will create / refresh the contact entry by pubkey once
  // the IDENTIFY_RESPONSE arrives. We optionally pre-create with a
  // placeholder if the user provided a nickname.
  if (nicknameInput.value.trim()) {
    // We don't know the pubkey yet — we tag this as a pending probe.
    // The contact gets reconciled by pubkey once HELLO/IDENTIFY arrives.
  }
  try {
    await threads.sendHello(tk)
    // Also kick off a challenge so we get the verified pubkey.
    await connection.wsProxyClient.send([tk], 'IDENTIFY_CHALLENGE|' + JSON.stringify({ nonce: 'probe-'+Date.now() }))
    emit('close')
  } catch (e) {
    error.value = e.message || 'Error enviando saludo'
  }
}

const copyToken = async () => {
  if (!myToken()) return
  try { await navigator.clipboard.writeText(myToken()) } catch {}
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal">
      <div class="tabs">
        <button :class="['tab', tab==='add' && 'active']" @click="tab='add'">Añadir contacto</button>
        <button :class="['tab', tab==='mine' && 'active']" @click="tab='mine'">Mi token</button>
      </div>

      <div v-if="tab === 'add'">
        <p>Pega el token (4-8 caracteres) que tu contacto te ha compartido:</p>
        <input v-model="tokenInput" placeholder="Ej: A4F2" maxlength="8" autofocus />
        <input v-model="nicknameInput" placeholder="Nickname (opcional)" maxlength="20" />
        <p v-if="error" class="error">{{ error }}</p>
        <p class="hint">
          Le enviaremos un saludo cifrado con tu identidad. Cuando tu contacto
          responda, aparecerá automáticamente en tu lista.
        </p>
        <div class="actions">
          <button class="btn secondary" @click="emit('close')">Cancelar</button>
          <button class="btn" @click="submit">Enviar saludo</button>
        </div>
      </div>

      <div v-else>
        <p>Comparte este token con tu contacto:</p>
        <div class="token-box">
          <code>{{ myToken() || '...' }}</code>
          <button class="btn secondary" @click="copyToken" :disabled="!myToken()">Copiar</button>
        </div>
        <p class="hint">
          Tu token cambia cada vez que te conectas, pero tu identidad (clave pública)
          se mantiene. Una vez que tu contacto te haya añadido, se reconecta automáticamente.
        </p>
        <div class="actions">
          <button class="btn" @click="emit('close')">Cerrar</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tabs { display: flex; gap: 4px; margin-bottom: 14px; border-bottom: 1px solid var(--border); }
.tab {
  background: transparent; border: 0; color: var(--muted);
  padding: 8px 14px; cursor: pointer; border-bottom: 2px solid transparent;
}
.tab.active { color: var(--text); border-color: var(--accent); }
input { width: 100%; margin-top: 8px; }
.hint { color: var(--muted); font-size: 13px; margin-top: 12px; }
.error { color: var(--danger); font-size: 13px; margin-top: 8px; }
.token-box { display: flex; gap: 8px; align-items: center; margin: 12px 0; }
.token-box code {
  flex: 1; background: var(--bg-3); padding: 10px;
  font-size: 24px; font-family: monospace; border-radius: 6px;
  text-align: center; letter-spacing: 4px;
}
</style>
