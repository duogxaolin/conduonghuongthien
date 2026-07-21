<template>
  <Teleport to="body">
    <div class="toast-container" aria-live="polite" aria-atomic="true">
      <TransitionGroup name="toast">
        <div
          v-for="toast in toasts"
          :key="toast.id"
          class="toast-item"
          :class="`toast-${toast.type}`"
        >
          <div class="toast-icon">
            <i v-if="toast.type === 'success'" class="fa-solid fa-circle-check"></i>
            <i v-else-if="toast.type === 'error'" class="fa-solid fa-circle-xmark"></i>
            <i v-else-if="toast.type === 'warning'" class="fa-solid fa-triangle-exclamation"></i>
            <i v-else class="fa-solid fa-circle-info"></i>
          </div>

          <div class="toast-content">
            <h4 class="toast-title">{{ toast.title }}</h4>
            <p class="toast-message">{{ toast.message }}</p>
          </div>

          <button
            class="toast-close-btn"
            @click="remove(toast.id)"
            aria-label="Đóng thông báo"
          >
            <i class="fa-solid fa-xmark"></i>
          </button>

          <div
            v-if="toast.duration && toast.duration > 0"
            class="toast-progress"
            :style="{ animationDuration: `${toast.duration}ms` }"
          ></div>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup>
const { toasts, remove } = useToast()
</script>

<style scoped>
.toast-container {
  position: fixed;
  top: 24px;
  right: 24px;
  z-index: 999999;
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 420px;
  width: calc(100vw - 48px);
  pointer-events: none;
}

.toast-item {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 16px 18px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(12px);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.06);
  border: 1px solid rgba(0, 0, 0, 0.08);
  pointer-events: auto;
  overflow: hidden;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.toast-icon {
  font-size: 1.4rem;
  flex-shrink: 0;
  margin-top: 2px;
}

.toast-content {
  flex: 1;
  min-width: 0;
}

.toast-title {
  font-size: 0.95rem;
  font-weight: 700;
  margin: 0 0 4px 0;
  line-height: 1.3;
}

.toast-message {
  font-size: 0.88rem;
  color: #4b5563;
  margin: 0;
  line-height: 1.4;
  word-break: break-word;
}

.toast-close-btn {
  background: transparent;
  border: none;
  color: #9ca3af;
  font-size: 1.1rem;
  cursor: pointer;
  padding: 2px 4px;
  line-height: 1;
  border-radius: 4px;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.toast-close-btn:hover {
  color: #1f2937;
  background-color: rgba(0, 0, 0, 0.05);
}

/* Variants */
.toast-success {
  border-left: 5px solid #2e7d32;
}
.toast-success .toast-icon { color: #2e7d32; }
.toast-success .toast-title { color: #1b5e20; }
.toast-success .toast-progress { background: #2e7d32; }

.toast-error {
  border-left: 5px solid #d32f2f;
}
.toast-error .toast-icon { color: #d32f2f; }
.toast-error .toast-title { color: #c62828; }
.toast-error .toast-progress { background: #d32f2f; }

.toast-warning {
  border-left: 5px solid #ed6c02;
}
.toast-warning .toast-icon { color: #ed6c02; }
.toast-warning .toast-title { color: #e65100; }
.toast-warning .toast-progress { background: #ed6c02; }

.toast-info {
  border-left: 5px solid #0288d1;
}
.toast-info .toast-icon { color: #0288d1; }
.toast-info .toast-title { color: #01579b; }
.toast-info .toast-progress { background: #0288d1; }

/* Progress bar */
.toast-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 3px;
  width: 100%;
  opacity: 0.8;
  animation: toast-countdown linear forwards;
}

@keyframes toast-countdown {
  from { width: 100%; }
  to { width: 0%; }
}

/* Animations */
.toast-enter-from {
  opacity: 0;
  transform: translateX(60px) scale(0.95);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(60px) scale(0.9);
}
</style>
