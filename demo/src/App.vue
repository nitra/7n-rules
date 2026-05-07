<script setup>
import welcomeImage from './assets/welcome.png.avif'
</script>

<template>
  <main class="welcome">
    <img :src="welcomeImage" alt="Welcome" class="welcome__image" />
    <h1 class="welcome__title">Привіт, n-cursor!</h1>
    <p class="welcome__subtitle">
      Це пісочниця для перевірки правил із <code>.cursor/rules/</code>. Сюди додаємо мінімальні фікстури під конкретні
      сценарії й запускаємо <code>npx @nitra/cursor check &lt;rule&gt;</code>.
    </p>
  </main>
</template>

<style scoped>
.welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 48px 16px;
  font-family:
    system-ui,
    -apple-system,
    'Segoe UI',
    sans-serif;
  text-align: center;
}

.welcome__image {
  max-width: 240px;
  height: auto;
}

.welcome__title {
  margin: 0;
  font-size: clamp(24px, 4vw, 36px);
}

.welcome__subtitle {
  max-width: 560px;
  margin: 0;
  color: #555;
  line-height: 1.5;
}

.welcome__subtitle code {
  background: #f3f3f3;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.9em;
}
</style>
