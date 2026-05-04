<script setup>
import { ref } from 'vue'
const emit = defineEmits(['set'])
const nick = ref('')
const submit = () => {
  const v = nick.value.trim()
  if (v.length < 3 || v.length > 20) return
  emit('set', v)
}
</script>

<template>
  <div class="modal-backdrop">
    <div class="modal">
      <h2>Bienvenido a Messenger</h2>
      <p>Elige tu nickname para comenzar.</p>
      <input
        v-model="nick"
        @keyup.enter="submit"
        placeholder="Nickname (3-20 chars)"
        autofocus
      />
      <div class="actions">
        <button class="btn" :disabled="nick.trim().length < 3 || nick.trim().length > 20" @click="submit">Entrar</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
input { width: 100%; }
</style>
