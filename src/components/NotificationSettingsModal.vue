<script setup>
import { computed } from 'vue'
import { useNotifPrefsStore } from '../stores/notifPrefsStore'
import { useNotificationsStore } from '../stores/notificationsStore'

const emit = defineEmits(['close'])
const prefsStore = useNotifPrefsStore()
const push = useNotificationsStore()

const prefs = computed(() => prefsStore.prefs)

const ITEMS = [
  { key: 'contactMessages',  label: 'Mensajes de contactos',     hint: 'Avisar cuando un contacto te escribe.' },
  { key: 'vouchedRequests',  label: 'Solicitudes avaladas',      hint: 'Desconocidos avalados por tu red de confianza.' },
  { key: 'strangerRequests', label: 'Solicitudes de desconocidos', hint: 'Sin aval de tu red. Apágalo si recibís spam.' },
  { key: 'helloRequests',    label: 'Cuando alguien te agrega',  hint: 'Avisar al recibir un saludo, aunque no haya mensaje aún.' },
  { key: 'sound',            label: 'Sonido',                    hint: 'Pitido corto al notificar.' }
]

const toggle = (key) => prefsStore.set(key, !prefs.value[key])

const togglePush = async () => {
  if (push.enabled) await push.disable()
  else await push.enable()
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal">
      <header class="head">
        <h2>Notificaciones</h2>
        <button class="x" @click="emit('close')" aria-label="Cerrar">×</button>
      </header>

      <div class="body">
        <p class="intro">Elige qué quieres que te avise la app mientras está abierta.</p>

        <ul class="opts">
          <li v-for="it in ITEMS" :key="it.key" class="opt">
            <div class="opt-text">
              <span class="opt-label">{{ it.label }}</span>
              <span class="opt-hint">{{ it.hint }}</span>
            </div>
            <button
              class="switch"
              :class="{ on: prefs[it.key] }"
              role="switch"
              :aria-checked="prefs[it.key]"
              @click="toggle(it.key)"
            ><span class="knob"></span></button>
          </li>
        </ul>

        <div class="push-block" v-if="push.supported">
          <div class="opt-text">
            <span class="opt-label">Aviso con la app cerrada (push)</span>
            <span class="opt-hint">
              Recibí un timbre aunque no tengas la pestaña abierta.
              <template v-if="push.permission === 'denied'"> (Permiso bloqueado en el navegador.)</template>
            </span>
          </div>
          <button
            class="switch"
            :class="{ on: push.enabled }"
            role="switch"
            :aria-checked="push.enabled"
            :disabled="push.busy || push.permission === 'denied'"
            @click="togglePush"
          ><span class="knob"></span></button>
        </div>
        <p v-if="push.error" class="error">{{ push.error }}</p>
      </div>

      <footer class="foot">
        <button class="btn" @click="emit('close')">Listo</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.modal { max-width: 460px; }
.head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 24px; border-bottom: 1px solid var(--border, #2a3550);
}
.x {
  background: transparent; border: 0; font-size: 24px; cursor: pointer;
  color: var(--muted, #8aa0bd); width: 32px; height: 32px; border-radius: 8px;
}
.x:hover { background: var(--bg-3, #1b2536); color: var(--text, #e7edf6); }
.body { padding: 18px 24px; }
.intro { margin: 0 0 14px; font-size: 13px; color: var(--muted, #8aa0bd); }
.opts { list-style: none; margin: 0; padding: 0; }
.opt, .push-block {
  display: flex; align-items: center; gap: 14px;
  padding: 12px 0; border-top: 1px solid rgba(255,255,255,.06);
}
.opt:first-child { border-top: 0; }
.push-block { margin-top: 14px; border-top: 1px solid var(--border, #2a3550); padding-top: 16px; }
.opt-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.opt-label { font-size: 14px; font-weight: 600; color: var(--text, #e7edf6); }
.opt-hint { font-size: 12px; color: var(--muted, #8aa0bd); line-height: 1.4; }
.error { margin: 12px 0 0; font-size: 13px; color: #ef6b6b; }

.switch {
  flex-shrink: 0;
  width: 46px; height: 26px; border-radius: 999px; border: 0;
  background: var(--bg-4, #2a3550); position: relative; cursor: pointer;
  transition: background 160ms ease-out;
}
.switch.on { background: var(--accent, #2dd4bf); }
.switch:disabled { opacity: .5; cursor: not-allowed; }
.knob {
  position: absolute; top: 3px; left: 3px;
  width: 20px; height: 20px; border-radius: 50%; background: #fff;
  transition: transform 160ms ease-out;
}
.switch.on .knob { transform: translateX(20px); }

.foot {
  display: flex; justify-content: flex-end;
  padding: 14px 24px; background: var(--bg-2, #141c2b); border-top: 1px solid var(--border, #2a3550);
}
</style>
