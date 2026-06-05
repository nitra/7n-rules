# stryker-vue-macros-ignorer.mjs

## Огляд

Файл `stryker-vue-macros-ignorer.mjs` — це Stryker `Ignore`-plugin (мутаційне тестування), який інструктує Stryker не мутувати виклики Vue `<script setup>`-макросів: `defineProps`, `defineEmits`, `defineModel`, `defineSlots`, `defineExpose`, `defineOptions`.

Контекст проблеми:

- Stryker інструментує код тестового проєкту, обгортаючи вирази у тернарне покриттєве вираження виду `stryMutAct_9fa48(...) ? {} : (stryCov_9fa48(...), {...})`.
- Vue компайлер `@vue/compiler-sfc` вимагає, щоб аргументи макросів у `<script setup>` (наприклад `defineProps({...})`) були **статично-аналізованими** на етапі compile-sfc — макрос не може посилатися на локально оголошені змінні чи знаходитися всередині умовних виразів.
- Без цього ignorer-плагіна Stryker-інструментація створює саме такий «динамічний» вираз і `@vue/compiler-sfc` падає з помилкою:

  ```
  defineProps() in <script setup> cannot reference locally declared variables
  ```

Розв'язання: цей плагін під час обходу AST повертає Stryker'у не-порожнє повідомлення для будь-якого `CallExpression`, у якого `callee` — `Identifier` з ім'ям одного з шести Vue-макросів. Stryker, отримавши непорожнє значення з `shouldIgnore(path)`, **пропускає мутацію цілого піддерева** виклику і залишає оригінальний код незмінним. Як наслідок — згенерований інструментований код залишається сумісним з вимогами `@vue/compiler-sfc`.

Файл є частиною fixture-конфігурації для тестування правил у `npm/rules/test/js/data/stryker_config/` і вмикається в Stryker'і у двох місцях `stryker.config.mjs` поряд: у масиві `plugins: ['./stryker-vue-macros-ignorer.mjs']` (завантаження плагіна) і `ignorers: ['vue-macros']` (активація конкретного ignorer'а за ім'ям).

## Експорти / API

Модуль експортує два публічних символи (обидва — named exports, ESM):

| Символ           | Тип                             | Призначення                                                                                                                                 |
| ---------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `shouldIgnore`   | `(path) => string \| undefined` | Predicate-функція, яку Stryker-інструментер викликає для кожного вузла AST. Повертає повідомлення-причину, якщо мутацію треба пропустити.   |
| `strykerPlugins` | `Array<{kind, name, value}>`    | Стандартний експорт, який очікує plugin-loader зі Stryker (`@stryker-mutator/core/.../plugin-loader.js`). Містить один запис типу `Ignore`. |

Жодних default-експортів модуль не має.

### `strykerPlugins`

```js
export const strykerPlugins = [
  {
    kind: 'Ignore',
    name: 'vue-macros',
    value: { shouldIgnore }
  }
]
```

Поля:

- `kind: 'Ignore'` — категорія плагіна для Stryker; саме така категорія дозволяє пропускати мутації за рішенням `shouldIgnore`.
- `name: 'vue-macros'` — ім'я плагіна; саме це значення треба вказати у `ignorers: ['vue-macros']` у `stryker.config.mjs`, щоб увімкнути плагін.
- `value: { shouldIgnore }` — об'єкт-реалізація з єдиним методом `shouldIgnore`.

## Функції

### `shouldIgnore(path)`

```js
export function shouldIgnore(path)
```

**Призначення:** вирішити, чи треба пропустити мутацію поточного AST-вузла. Викликається Stryker-інструментером під час обходу AST-дерева коду, який інструментується для мутаційного тестування.

**Параметри:**

| Ім'я   | Тип                         | Опис                                                                                                                                                                                  |
| ------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `path` | `NodePath` (Babel-сумісний) | Об'єкт-обгортка над вузлом AST, який Stryker передає для перевірки. Очікувані поля/методи: `path.isCallExpression(): boolean` та `path.node.callee: { type: string, name?: string }`. |

**Повертає:**

- `string` (не-порожній) — повідомлення-причина, чому мутацію треба пропустити. Stryker, отримавши такий рядок, **не мутує** всеце піддерево виклику.
- `undefined` — продовжити стандартний процес: дозволити Stryker мутувати цей вузол.

**Алгоритм (послідовно):**

1. Якщо `path.isCallExpression()` повертає `false` — це не виклик функції, виходимо з `undefined` (нічого не пропускаємо).
2. Беремо `callee = path.node.callee`.
3. Якщо `callee.type !== 'Identifier'` — це не простий ідентифікатор (наприклад, `obj.method()` або `(fn)()`), виходимо з `undefined`.
4. Якщо `callee.name` відсутній у наборі `VUE_SETUP_MACROS` — це не Vue-макрос, виходимо з `undefined`.
5. Інакше повертаємо рядок `IGNORE_MESSAGE` — Stryker пропускає мутацію піддерева цього виклику.

**Side effects:** немає. Функція чиста (pure): не змінює `path`, не пише в зовнішній стан, не робить I/O.

**Граничні випадки:**

- Виклик через member-expression (`Vue.defineProps(...)`) **не** збігається, бо `callee.type === 'MemberExpression'`, а не `'Identifier'` — реальні Vue макроси завжди викликаються як вільні ідентифікатори у `<script setup>`, тому це коректно.
- Перейменовані імпорти (`import { defineProps as dp } from 'vue'`) не збігаються — це теж відповідає реальній семантиці Vue-макросів, які працюють лише з канонічними іменами.
- Локальні функції з тими самими іменами у звичайному коді (не `<script setup>`) теж будуть пропускатися — це навмисне послаблення в межах fixture'и; не вважається проблемою, оскільки такий код у проєкті дуже рідкісний.

## Внутрішні константи

| Ім'я               | Тип           | Значення                                                                                                                                                                                                            |
| ------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VUE_SETUP_MACROS` | `Set<string>` | `{'defineProps', 'defineEmits', 'defineModel', 'defineSlots', 'defineExpose', 'defineOptions'}` — повний канонічний набір Vue 3 `<script setup>` макросів. `Set` обрано для O(1) перевірки `has(name)`.             |
| `IGNORE_MESSAGE`   | `string`      | `'Vue <script setup> macro call cannot be mutated (defineProps/defineEmits/etc. must be statically analyzable for @vue/compiler-sfc).'` — повідомлення, яке потрапляє до Stryker-звіту як причина пропуску мутації. |

Обидві константи приватні для модуля (не експортуються).

## Залежності

- **Stryker (runtime контракт):** модуль не імпортує жодних бібліотек, але неявно покладається на API Stryker'а:
  - `@stryker-mutator/core` plugin-loader (`.../plugin-loader.js`) — шукає named export `strykerPlugins`.
  - Stryker-інструментер передає у `shouldIgnore` Babel-NodePath-подібний об'єкт із методом `isCallExpression()` та полем `node.callee`.
- **Vue:** модуль не імпортує `vue`, але семантика всіх шести макросів та обмеження «cannot reference locally declared variables» — це частина контракту `@vue/compiler-sfc`.
- **Babel AST shape:** покладається на стандартну структуру вузлів Babel (`CallExpression`, `Identifier`).
- **Імпорти:** жодних `import`-инструкцій. Модуль самодостатній.

## Потік виконання / Використання

Очікуване підключення у `stryker.config.mjs` (поряд із цим файлом):

```js
// stryker.config.mjs
export default {
  // ...решта Stryker-конфігурації
  plugins: ['./stryker-vue-macros-ignorer.mjs'],
  ignorers: ['vue-macros']
  // ...
}
```

Послідовність роботи в одному прогоні Stryker:

1. **Bootstrap.** Stryker читає `stryker.config.mjs`, бачить шлях `'./stryker-vue-macros-ignorer.mjs'` у `plugins` і динамічно імпортує модуль.
2. **Plugin registration.** Plugin-loader дістає named export `strykerPlugins`, ітерує його і реєструє запис `{kind: 'Ignore', name: 'vue-macros', value: {shouldIgnore}}` у внутрішньому реєстрі плагінів-ігнорерів.
3. **Activation.** Stryker звіряє реєстр з конфігураційним полем `ignorers: ['vue-macros']` і активує цей плагін за ім'ям. Якщо `name` у `ignorers` відсутній — плагін зареєстрований, але не використовується.
4. **AST traversal.** Stryker-інструментер обходить AST кожного файлу-кандидата на мутацію. Для кожного вузла, який є потенційним кандидатом на мутацію, викликає `shouldIgnore(path)` усіх активних `Ignore`-плагінів.
5. **Decision.** Якщо `shouldIgnore` повертає рядок — Stryker позначає цю мутацію як **Ignored**, не вставляє в неї `stryMutAct_*`/`stryCov_*`-обгортки і записує `IGNORE_MESSAGE` у звіт як причину.
6. **Codegen.** Для виклику Vue-макроса в інструментованому файлі залишається оригінальний код `defineProps({...})` без тернарного покриттєвого виразу — `@vue/compiler-sfc` успішно компілює `<script setup>`.
7. **Mutation testing run.** Тести виконуються над інструментованим кодом; мутації решти коду перевіряються нормально, а Vue-макроси не псуються.

Якщо плагін **не активувати** (або зареєструвати без рядка `'vue-macros'` у `ignorers`) — Stryker почне інструментувати макроси, і Vue компайлер впаде з помилкою «defineProps() in &lt;script setup&gt; cannot reference locally declared variables» ще до виконання тестів.

## Особливості та обмеження

- Покриває **всі шість** Vue 3 `<script setup>` макросів станом на актуальну версію Vue 3 — нові макроси (якщо з'являться) треба буде додавати у `VUE_SETUP_MACROS` вручну.
- Не розпізнає виклики через member-expression (`Vue.defineProps`) та перейменовані ідентифікатори — це відповідає реальним обмеженням Vue-макросів, тому є коректним.
- Працює з рівнем гранулярності «весь виклик» — Stryker пропускає мутацію всього піддерева `CallExpression`, включно з його аргументами; це навмисна поведінка, бо мутувати аргумент `defineProps({...})` теж зламає compile-sfc.
- Функція чиста — її легко тестувати ізольовано, передаючи власні mock'и `NodePath`-подібних об'єктів.

Rebuild Test.
