<script setup>
import { ref, nextTick, watch, computed } from 'vue'
import { useThreadsStore } from '../stores/threadsStore'
import { useContactsStore } from '../stores/contactsStore'

const threads = useThreadsStore()
const contacts = useContactsStore()
const emit = defineEmits(['back', 'rate'])

const text = ref('')
const scroller = ref(null)

const c = computed(() => threads.activeContact)
const online = computed(() => c.value && contacts.isOnline(c.value.publickey))
const rating = computed(() => c.value ? contacts.ratingFor(c.value.publickey) : null)

const stars = (val) => {
  if (val == null) return ''
  const full = Math.round(val)
  return '★'.repeat(full) + '☆'.repeat(5 - full)
}

const send = async () => {
  const v = text.value
  if (!v.trim()) return
  text.value = ''
  await threads.sendDM(c.value.publickey, v)
  scrollDown()
}

const scrollDown = () => nextTick(() => {
  if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
})

watch(() => threads.activeThread.length, scrollDown)
watch(() => threads.activePubkey, scrollDown, { immediate: true })

const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
</script>

<template>
  <div class="conv" v-if="c">
    <header class="head">
      <button class="back" @click="emit('back')">←</button>
      <div class="who">
        <div class="row">
          <span :class="['dot', online ? 'on' : 'off']"></span>
          <strong>{{ c.nickname }}</strong>
          <span
            v-if="rating.value != null"
            :class="['stars', rating.source]"
            @click="emit('rate', c.publickey)"
          >{{ stars(rating.value) }}</span>
        </div>
        <div class="sub">
          <code>{{ c.lastToken || '—' }}</code>
          <span v-if="!online" class="off-text">offline · mensajes en cola</span>
        </div>
      </div>
      <button class="rate-btn" @click="emit('rate', c.publickey)" title="Calificar">★</button>
    </header>

    <div class="messages" ref="scroller">
      <div v-if="threads.activeThread.length === 0" class="empty">
        Aún no hay mensajes. Saluda 👋
      </div>
      <div
        v-for="m in threads.activeThread"
        :key="m.id"
        :class="['msg', m.dir]"
      >
        <div class="bubble">
          <div class="text">{{ m.text }}</div>
          <div class="meta">
            <span>{{ fmtTime(m.ts) }}</span>
            <span v-if="m.dir === 'out' && m.pending" class="pending"> · pendiente</span>
          </div>
        </div>
      </div>
    </div>

    <form class="composer" @submit.prevent="send">
      <textarea
        v-model="text"
        rows="1"
        placeholder="Escribe un mensaje..."
        @keydown.enter.exact.prevent="send"
      />
      <button class="btn" :disabled="!text.trim()" type="submit">Enviar</button>
    </form>
  </div>
</template>

<style scoped>
.conv { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.head {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 16px; border-bottom: 1px solid var(--border);
  background: var(--bg-2);
}
.back { background: transparent; border: 0; color: var(--text); font-size: 22px; cursor: pointer; }
.who { flex: 1; min-width: 0; }
.row { display: flex; align-items: center; gap: 8px; }
.sub { font-size: 12px; color: var(--muted); display: flex; gap: 8px; align-items: center; }
.sub code { background: var(--bg-3); padding: 1px 5px; border-radius: 3px; }
.dot { width: 8px; height: 8px; border-radius: 50%; }
.dot.on { background: #4caf50; }
.dot.off { background: #555; }
.stars { font-size: 14px; cursor: pointer; }
.stars.mine { color: var(--gold); }
.stars.derived { color: var(--derived); }
.off-text { color: #c47; }
.rate-btn { background: transparent; color: var(--gold); border: 0; font-size: 22px; cursor: pointer; }

.messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 8px; }
.empty { color: var(--muted); margin: auto; }
.msg { display: flex; }
.msg.out { justify-content: flex-end; }
.bubble {
  max-width: 75%; padding: 8px 12px; border-radius: 14px;
  background: var(--bg-3); position: relative;
}
.msg.out .bubble { background: var(--accent-2); }
.text { white-space: pre-wrap; word-wrap: break-word; }
.meta { font-size: 11px; color: var(--muted); margin-top: 4px; text-align: right; }
.pending { font-style: italic; }

.composer {
  display: flex; gap: 8px; padding: 12px 16px;
  border-top: 1px solid var(--border); background: var(--bg-2);
}
.composer textarea { flex: 1; resize: none; min-height: 38px; max-height: 120px; }
</style>
