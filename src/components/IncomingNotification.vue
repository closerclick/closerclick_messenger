<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  // { id, fromNickname, text } | null
  dm: { type: Object, default: null }
})
const emit = defineEmits(['done'])

const visible = ref(false)
const phase = ref('hidden')   // 'hidden' | 'in' | 'shown' | 'out'

let timers = []
function clearTimers () {
  for (const t of timers) clearTimeout(t)
  timers = []
}

watch(() => props.dm, (next) => {
  if (!next) return
  clearTimers()
  visible.value = true
  // fade-in
  phase.value = 'in'
  timers.push(setTimeout(() => { phase.value = 'shown' }, 500))
  // visible 5s, then fade-out
  timers.push(setTimeout(() => { phase.value = 'out' }, 5500))
  // remove + signal done after fade-out
  timers.push(setTimeout(() => {
    visible.value = false
    phase.value = 'hidden'
    emit('done', next.id)
  }, 6000))
}, { immediate: true })
</script>

<template>
  <div v-if="visible" :class="['cc-incoming', 'phase-' + phase]" aria-live="polite">
    <div class="card">
      <div class="from">{{ dm?.fromNickname || 'Mensaje nuevo' }}</div>
      <div class="text">{{ dm?.text }}</div>
    </div>
  </div>
</template>

<style scoped>
.cc-incoming {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 99999;
  opacity: 0;
  transition: opacity 0.5s ease;
}
.cc-incoming.phase-in,
.cc-incoming.phase-shown {
  opacity: 1;
}
.cc-incoming.phase-out {
  opacity: 0;
}
.card {
  background: var(--bg-2, #fff);
  color: var(--text, #2b2118);
  border: 1px solid var(--border, #d8c9b6);
  border-radius: 16px;
  padding: 22px 28px;
  max-width: min(440px, 80vw);
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.25);
  pointer-events: auto;
  text-align: center;
}
.from {
  font-family: var(--font-headline);
  font-weight: 600;
  font-size: 14px;
  color: var(--accent, #c0392b);
  margin-bottom: 8px;
}
.text {
  font-size: 16px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-wrap: break-word;
}
</style>
