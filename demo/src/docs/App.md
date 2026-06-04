# App.vue

## Огляд

Файл `demo/src/App.vue` — це кореневий Single-File Component (SFC) Vue 3, який слугує вхідною сторінкою (welcome screen) демо-додатка-«пісочниці» репозиторію `@nitra/cursor`. Компонент `App` написаний у синтаксисі `<script setup>` (Composition API, скрипт-сетап), не приймає вхідних параметрів і не емітить подій. Його єдина задача — відрендерити статичну вітальну сторінку: зображення `welcome.png.avif`, заголовок `«Привіт, n-cursor!»` та підпис із короткою інструкцією, як запускати перевірки правил із `.cursor/rules/` командою `npx @nitra/cursor check <rule>`.

Компонент складається з трьох SFC-блоків:

- `<script setup>` — імпорт асету `welcomeImage`.
- `<template>` — розмітка кореневого блока `<main class="welcome">`.
- `<style scoped>` — локальні (scoped) CSS-стилі для класів `.welcome`, `.welcome__image`, `.welcome__title`, `.welcome__subtitle` та вкладеного селектора `.welcome__subtitle code`.

## Експорти / API

`App.vue` — стандартний Vue SFC, тому експортує **default export** — об'єкт Vue-компонента, скомпонований інструментарієм Vue (`@vitejs/plugin-vue`) із блоків `<script setup>`, `<template>` та `<style scoped>`. Іменованих експортів немає.

Публічний контракт компонента `App`:

- **Props**: відсутні (`defineProps` не викликається).
- **Emits**: відсутні (`defineEmits` не викликається).
- **Slots**: відсутні (`<slot>` у шаблоні не використовується).
- **Експоновані методи** (через `defineExpose`): відсутні.
- **Реактивний стан**: відсутній (немає викликів `ref`, `reactive`, `computed`, `watch`, `watchEffect` тощо).

Єдина прив'язка до шаблону зі сторони `<script setup>` — константа модуля `welcomeImage`, яку шаблон використовує у атрибуті `:src` тега `<img>`.

## Функції

Файл `demo/src/App.vue` **не визначає жодних функцій, методів, обчислюваних властивостей чи хуків життєвого циклу**. Він не містить ані `function`-декларацій, ані стрілкових функцій, ані обробників подій у шаблоні (`@click`, `@input` тощо). Уся логіка зведена до:

1. Статичного імпорту асету в блоці `<script setup>`.
2. Декларативного рендерингу розмітки у блоці `<template>`.

Сайд-ефектів виконання (мережевих запитів, мутацій DOM поза рендером Vue, доступу до `window`/`localStorage` тощо) у компоненті `App` немає.

## Залежності

### Імпорти

- `import welcomeImage from './assets/welcome.png.avif'` — імпорт бінарного асету (зображення у форматі AVIF) з директорії `demo/src/assets/`. Імпорт обробляється збиральником (Vite): `welcomeImage` стає рядком — URL-ом готового асету після білду (з хешем у production, з ориґінальним шляхом у dev-режимі).

### Неявні залежності

- **Vue 3** — компонент використовує синтаксис `<script setup>`, який підтримується `@vitejs/plugin-vue` і компілятором `@vue/compiler-sfc`.
- **Збиральник (Vite)** — потрібен для резолвінгу імпорту `./assets/welcome.png.avif` як URL-а зображення.
- **Глобальні CSS-змінні / нормалізатор стилів** — не використовуються; усі стилі задані в блоці `<style scoped>` цього ж файлу.

### Зовнішні CSS-залежності

Жодних. Шрифт обирається через CSS-ланцюжок `system-ui, -apple-system, 'Segoe UI', sans-serif` і не підтягується ззовні.

## Реактивний стан

У компоненті `App` **немає** реактивного стану. Константа `welcomeImage` — це звичайна імпортована змінна модуля (рядок-URL після обробки збиральником), не реактивне посилання. Перерендер `App` ініціюється лише стандартним механізмом Vue (зокрема монтуванням), оскільки немає ані `ref`/`reactive`-стану, ані пропсів, ані слотів, що могли б змінитись.

## Структура шаблону

Кореневий елемент шаблону `App.vue`:

```
<main class="welcome">
  <img :src="welcomeImage" alt="Welcome" class="welcome__image" />
  <h1 class="welcome__title">Привіт, n-cursor!</h1>
  <p class="welcome__subtitle">
    Це пісочниця для перевірки правил із <code>.cursor/rules/</code>. Сюди додаємо мінімальні фікстури під конкретні
    сценарії й запускаємо <code>npx @nitra/cursor check &lt;rule&gt;</code>.
  </p>
</main>
```

Розмітка містить три семантичні елементи всередині `<main>`:

1. `<img>` з атрибутами `:src="welcomeImage"`, `alt="Welcome"`, `class="welcome__image"`. Прив'язка `:src` (директива `v-bind:src`) підставляє рядок-URL із константи `welcomeImage`.
2. `<h1 class="welcome__title">` зі статичним текстом `«Привіт, n-cursor!»`.
3. `<p class="welcome__subtitle">` зі статичним текстом-описом, у який вкладені два теги `<code>`: один з текстом `.cursor/rules/`, другий — з HTML-енкодованим `npx @nitra/cursor check &lt;rule&gt;` (відображається як `npx @nitra/cursor check <rule>`).

Іменування класів використовує BEM-конвенцію: блок `welcome` та елементи `welcome__image`, `welcome__title`, `welcome__subtitle`.

## Стилі (`<style scoped>`)

CSS у `App.vue` оголошено зі specifier `scoped`, тобто Vue додає до кожного селектора атрибутний хеш на етапі компіляції, ізолюючи стилі від інших компонентів.

Селектори та їхні правила:

- `.welcome` — `display: flex`, `flex-direction: column`, `align-items: center`, `gap: 16px`, `padding: 48px 16px`, шрифтовий стек `system-ui, -apple-system, 'Segoe UI', sans-serif`, `text-align: center`.
- `.welcome__image` — `max-width: 240px`, `height: auto`.
- `.welcome__title` — `margin: 0`, `font-size: clamp(24px, 4vw, 36px)` (адаптивний розмір від 24 до 36 px).
- `.welcome__subtitle` — `max-width: 560px`, `margin: 0`, `color: #555`, `line-height: 1.5`.
- `.welcome__subtitle code` — `background: #f3f3f3`, `padding: 2px 6px`, `border-radius: 4px`, `font-size: 0.9em`. Цей селектор стилізує теги `<code>`, вкладені у `.welcome__subtitle`.

## Потік виконання / Використання

### Життєвий цикл

1. **Імпорт асету.** Під час побудови модуля `App.vue` Vite розв'язує імпорт `./assets/welcome.png.avif` і присвоює константі `welcomeImage` URL-рядок до згенерованого асету.
2. **Реєстрація компонента.** Експортований за замовчуванням Vue-компонент `App` зазвичай монтується у точку входу демо-додатка (типово — `demo/src/main.js`/`main.mjs`/`main.ts` через `createApp(App).mount('#app')`). Сам файл `App.vue` про точку монтування не знає.
3. **Рендер шаблону.** Vue рендерить `<main class="welcome">` з трьома дочірніми вузлами; `<img>` отримує `src`, рівний значенню `welcomeImage`.
4. **Застосування scoped-стилів.** Vue додає атрибутний селектор до елементів шаблону й до правил із `<style scoped>`, забезпечуючи ізоляцію стилів.

### Сценарії використання

- `App.vue` — це кореневий компонент демо-пісочниці `demo/`. Його призначення суто демонстраційне: показати, що складальний конвеєр (Vite + Vue + AVIF-асет) працює.
- Для нових сценаріїв тестування правил із `.cursor/rules/` у директорію `demo/src/` додаються додаткові фікстури/компоненти, а команда `npx @nitra/cursor check <rule>` запускає відповідну перевірку.

### Передумови для роботи

- Існування файлу `demo/src/assets/welcome.png.avif`. Якщо його не буде, збиральник видасть помилку резолвінгу імпорту.
- Налаштований `@vitejs/plugin-vue` (або еквівалентний `vue-loader`), що компілює SFC.

## Rebuild Test (повна реконструкція)

За цим документом файл `demo/src/App.vue` можна відтворити так:

1. Створити SFC із трьох блоків: `<script setup>`, `<template>`, `<style scoped>`.
2. У `<script setup>` написати єдиний рядок: `import welcomeImage from './assets/welcome.png.avif'`.
3. У `<template>` помістити `<main class="welcome">` з трьома дітьми:
   - `<img :src="welcomeImage" alt="Welcome" class="welcome__image" />`,
   - `<h1 class="welcome__title">Привіт, n-cursor!</h1>`,
   - `<p class="welcome__subtitle">Це пісочниця для перевірки правил із <code>.cursor/rules/</code>. Сюди додаємо мінімальні фікстури під конкретні сценарії й запускаємо <code>npx @nitra/cursor check &lt;rule&gt;</code>.</p>`.
4. У `<style scoped>` оголосити CSS-правила для `.welcome`, `.welcome__image`, `.welcome__title`, `.welcome__subtitle` та `.welcome__subtitle code` за значеннями з секції «Стилі (`<style scoped>`)» цього документа.
5. Не додавати жодних props, emits, slots, реактивного стану, обробників подій чи хуків життєвого циклу — компонент `App` їх не має.
