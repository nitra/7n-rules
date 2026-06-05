# stryker-vue-macros-ignorer.mjs

## Огляд

Файл `stryker-vue-macros-ignorer.mjs` — це Stryker `Ignore`-плагін, який забороняє mutation-тестеру Stryker мутувати виклики Vue `<script setup>`-макросів: `defineProps`, `defineEmits`, `defineModel`, `defineSlots`, `defineExpose`, `defineOptions`.

Причина існування плагіна `stryker-vue-macros-ignorer.mjs`:

- Stryker під час інструментації коду огортає аргументи довільного виразу у тернарний coverage-вираз вигляду `stryMutAct_9fa48(...) ? {} : (stryCov_9fa48(...), {...})`.
- Vue-компілятор `@vue/compiler-sfc` вимагає, щоб виклики макросів у `<script setup>` були **статично-аналізованими** на етапі compile-sfc. Якщо аргумент макроса є динамічним виразом (наприклад, тернарним), компілятор падає з помилкою:

  ```
  defineProps() in <script setup> cannot reference locally declared variables
  ```

- Тому плагін `stryker-vue-macros-ignorer.mjs` повідомляє Stryker’у пропускати мутацію піддерева, корінь якого — виклик одного з шести зазначених макросів.

Інтеграція з Stryker:

- Стандартний Stryker plugin-loader (з пакета `@stryker-mutator/core`, файл `.../plugin-loader.js`) очікує іменований експорт `strykerPlugins: Plugin[]`.
- У `stryker.config.mjs` шлях до файла `stryker-vue-macros-ignorer.mjs` додається у масив `plugins: ['./stryker-vue-macros-ignorer.mjs']`.
- Конкретний ignorer вмикається за іменем: `ignorers: ['vue-macros']` (відповідає полю `name` у запису `strykerPlugins`).

## Експорти / API

Файл `stryker-vue-macros-ignorer.mjs` має два іменовані експорти ESM:

| Експорт          | Тип                                     | Призначення                                                                                                                          |
| ---------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `shouldIgnore`   | `function(path) => string \| undefined` | Колбек, який Stryker викликає для кожного babel-NodePath. Повертає текст-причину, якщо мутацію треба пропустити, інакше `undefined`. |
| `strykerPlugins` | `Plugin[]` (масив з одним записом)      | Реєстраційний масив для Stryker plugin-loader; містить опис `Ignore`-плагіна з іменем `vue-macros` і значенням `{ shouldIgnore }`.   |

Внутрішні (не експортовані) сутності модуля `stryker-vue-macros-ignorer.mjs`:

| Ім’я               | Тип           | Призначення                                                                                                                                                                                                       |
| ------------------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VUE_SETUP_MACROS` | `Set<string>` | Множина імен Vue `<script setup>`-макросів, виклики яких треба ігнорувати: `defineProps`, `defineEmits`, `defineModel`, `defineSlots`, `defineExpose`, `defineOptions`.                                           |
| `IGNORE_MESSAGE`   | `string`      | Текст-причина, який повертається у Stryker, коли виклик макроса знайдено: `'Vue <script setup> macro call cannot be mutated (defineProps/defineEmits/etc. must be statically analyzable for @vue/compiler-sfc).'` |

## Функції

### `shouldIgnore(path)`

Сигнатура:

```js
export function shouldIgnore(path)
```

JSDoc-тип (як у файлі `stryker-vue-macros-ignorer.mjs`):

```js
/**
 * @param {{
 *   isCallExpression: () => boolean,
 *   node: { callee: { type: string, name?: string } }
 * }} path
 * @returns {string | undefined}
 */
```

Параметри:

- `path` — babel `NodePath`, який Stryker-instrumenter передає у `shouldIgnore` під час обходу AST. Функція `shouldIgnore` використовує дві властивості `path`:
  - `path.isCallExpression()` — метод, який повертає `true`, якщо поточний вузол є викликом функції (`CallExpression`);
  - `path.node.callee` — `callee` поточного `CallExpression`; для роботи функції `shouldIgnore` важливі поля `callee.type` і `callee.name`.

Що повертає функція `shouldIgnore`:

- `string` (constant `IGNORE_MESSAGE`) — якщо вузол є викликом одного з шести Vue `<script setup>`-макросів. Stryker трактує non-empty string як сигнал «пропустити мутацію цього піддерева».
- `undefined` — інакше; Stryker продовжує мутувати вузол як зазвичай.

Алгоритм роботи функції `shouldIgnore` (точне відтворення коду файла `stryker-vue-macros-ignorer.mjs`):

1. Якщо `path.isCallExpression()` повертає falsy — вийти, повернувши `undefined`.
2. Прочитати `callee = path.node.callee`.
3. Якщо `callee.type !== 'Identifier'` — вийти, повернувши `undefined`. Це відсікає, наприклад, `obj.defineProps(...)` або `(0, defineProps)(...)`.
4. Якщо `VUE_SETUP_MACROS.has(callee.name)` повертає `false` — вийти, повернувши `undefined`.
5. Інакше — повернути `IGNORE_MESSAGE`.

Side effects функції `shouldIgnore`:

- Жодних. Функція `shouldIgnore` — pure: вона тільки читає поля `path` і повертає рядок або `undefined`. Жодних мутацій AST, I/O, глобального стану, логування.

## Залежності

- **Зовнішні runtime-залежності** у файлі `stryker-vue-macros-ignorer.mjs`: відсутні. Файл не імпортує жодних модулів через `import`.
- **Інтерфейсні залежності (duck-typed)**:
  - `path: { isCallExpression(): boolean, node: { callee: { type: string, name?: string } } }` — структура, яку Stryker-instrumenter передає у функцію `shouldIgnore`. Сумісна з babel `NodePath`.
- **Зовнішні споживачі**:
  - `@stryker-mutator/core` (`plugin-loader.js`) — імпортує іменований експорт `strykerPlugins` із файла, заданого у `stryker.config.mjs → plugins`.
  - `stryker.config.mjs` — конфіг Stryker, у якому шлях до `stryker-vue-macros-ignorer.mjs` додається у `plugins`, а ім’я `'vue-macros'` — у `ignorers`.
- **Технологічний контекст**:
  - Vue 3 SFC з `<script setup>` і його макросами;
  - `@vue/compiler-sfc` — компілятор SFC, який вимагає статично-аналізованих макросів;
  - Stryker як mutation-тестер JavaScript/TypeScript.

## Потік виконання / Використання

Реєстрація плагіна `stryker-vue-macros-ignorer.mjs` у Stryker:

1. Покласти файл `stryker-vue-macros-ignorer.mjs` поряд із `stryker.config.mjs` (або вказати інший відносний шлях).
2. У `stryker.config.mjs` додати:

   ```js
   export default {
     // ...
     plugins: ['./stryker-vue-macros-ignorer.mjs'],
     ignorers: ['vue-macros']
   }
   ```

3. Під час старту Stryker plugin-loader (`@stryker-mutator/core/.../plugin-loader.js`) імпортує `stryker-vue-macros-ignorer.mjs`, читає іменований експорт `strykerPlugins` і реєструє запис `{ kind: 'Ignore', name: 'vue-macros', value: { shouldIgnore } }`.
4. Завдяки `ignorers: ['vue-macros']` Stryker активує саме цей ignorer (за полем `name`).

Виконання під час інструментації AST:

1. Stryker обходить AST вхідного файла (наприклад, `.vue` або `.js`/`.ts`-кода з SFC).
2. Для кожного `NodePath` Stryker викликає `shouldIgnore(path)` із зареєстрованих `Ignore`-плагінів.
3. Функція `shouldIgnore` з файла `stryker-vue-macros-ignorer.mjs`:
   - перевіряє, чи вузол є `CallExpression`;
   - перевіряє, що `callee.type === 'Identifier'`;
   - перевіряє, що ім’я `callee.name` належить множині `VUE_SETUP_MACROS` (`defineProps`, `defineEmits`, `defineModel`, `defineSlots`, `defineExpose`, `defineOptions`);
   - якщо всі три умови виконуються — повертає `IGNORE_MESSAGE`, і Stryker не мутує піддерево цього виклику;
   - інакше — повертає `undefined`, і Stryker мутує вузол стандартно.

Приклади поведінки функції `shouldIgnore`:

- `defineProps<{ x: number }>()` → `path.isCallExpression() === true`, `callee.type === 'Identifier'`, `callee.name === 'defineProps'`, належить `VUE_SETUP_MACROS` → повертає `IGNORE_MESSAGE` → мутація пропускається.
- `defineEmits(['change'])` → аналогічно → мутація пропускається.
- `someModule.defineProps(...)` → `callee.type === 'MemberExpression'` → функція `shouldIgnore` повертає `undefined` → мутація йде як зазвичай.
- `useFoo()` → `callee.name === 'useFoo'` не входить у `VUE_SETUP_MACROS` → `undefined` → мутація йде як зазвичай.
- Не-виклик (наприклад, `BinaryExpression a + b`) → `path.isCallExpression() === false` → `undefined` → мутація йде як зазвичай.

Чому це важливо для збірки Vue-SFC:

- Якби `shouldIgnore` повертав `undefined` для `defineProps`/`defineEmits`/тощо, Stryker замінив би їхній аргумент на тернарний coverage-вираз `stryMutAct_9fa48(...) ? {} : (stryCov_9fa48(...), {...})`.
- Такий вираз для `@vue/compiler-sfc` не є статично-аналізованим, і компіляція SFC падає з помилкою `defineProps() in <script setup> cannot reference locally declared variables`.
- Плагін `stryker-vue-macros-ignorer.mjs` усуває цей конфлікт, виводячи Vue-макроси з-під мутацій.
