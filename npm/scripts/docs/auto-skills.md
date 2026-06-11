---
docgen:
  source: npm/scripts/auto-skills.mjs
  crc: 44328898
---

# `auto-skills.mjs`

## Огляд

Модуль `npm/scripts/auto-skills.mjs` відповідає за **автовизначення (auto-activation) скілів** для файлу конфігурації `.n-cursor.json`. Він сканує директорію `npm/skills/` і для кожного скілу читає його `meta.json`, щоб визначити, чи має скіл активуватися автоматично — завжди або лише за наявності певних виявлених auto-правил (rules).

Ключова ідея модуля: **`meta.json` — єдине джерело правди**. У коді немає жорстко прописаної мапи відповідностей між скілами та правилами; усе зчитується з метаданих скіла. Раніше використовувався hardcoded `AUTO_SKILL_ORDER`, тепер він обчислюється динамічно — експорт залишено для зворотної сумісності.

Підтримуються три формати поля `auto` у `meta.json`:

- `auto: "завжди"` — скіл активується незавжди, незалежно від інших правил. Приклади за коментарями у файлі: `fix`, `lint`, `llm-patch`, `publish-telegram`.
- `auto: ["rule", …]` — скіл активується, якщо **усі** перелічені правила вже виявлено auto-rules-модулем. Приклади за коментарями: `adr-normalize` залежить від `["adr"]`, `taze` — від `["bun"]`.
- поле `auto` відсутнє або формат не розпізнано — скіл лише opt-in (тільки через `.n-cursor.json:skills`).

Сканування `npm/skills/` виконується **синхронно під час завантаження модуля**: це дає детермінізм результату і узгоджується з sync-API сусіднього модуля `auto-rules.mjs`. Результат кешується на час життя процесу (`SKILL_AUTO_ACTIVATION`).

## Експорти / API

Модуль експортує:

| Символ                                                                 | Тип                                           | Призначення                                                              |
| ---------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------ |
| `discoverSkillAutoActivation(skillsDir?)`                              | function                                      | Сканує директорію зі скілами та повертає мапу `skillId → SkillAutoSpec`. |
| `AUTO_SKILL_ORDER`                                                     | `readonly string[]` (frozen)                  | Стабільний алфавітний список id скілів, які мають авто-активацію.        |
| `AUTO_SKILL_RULE_DEPENDENCIES`                                         | `Readonly<Record<string, readonly string[]>>` | Лише ті скіли, у яких `auto: [rule, …]` — мапа `skillId → rules[]`.      |
| `detectAutoSkills({ availableSkills, detectedRules, disableSkills? })` | function                                      | Обчислює фінальний список авто-скілів за станом середовища.              |

Тип `SkillAutoSpec` (визначається JSDoc-typedef):

```js
/** @typedef {{ always: true } | { rules: readonly string[] }} SkillAutoSpec */
```

Тобто кожен скіл, що пройшов парсинг, або має `always: true`, або несе масив `rules`.

## Функції

### `discoverSkillAutoActivation(skillsDir = SKILLS_DIR)`

**Сигнатура:**

```js
function discoverSkillAutoActivation(skillsDir?: string): Record<string, SkillAutoSpec>
```

**Параметри:**

- `skillsDir` _(string, optional)_ — шлях до директорії зі скілами. За замовчуванням — `SKILLS_DIR = join(PACKAGE_ROOT, 'skills')`, де `PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))` (тобто корінь npm-пакету). Параметр існує для override у тестах.

**Повертає:** `Record<string, SkillAutoSpec>` — мапа `skillId (== ім'я піддиректорії) → spec`.

**Поведінка:**

1. Якщо `skillsDir` не існує — повертається порожній обʼєкт `{}`.
2. Інакше викликається `readdirSync(skillsDir, { withFileTypes: true })`.
3. Для кожного запису:
   - пропускаються файли (не директорії) та все, що починається з `.` (наприклад, приховані).
   - читається `meta.json` через `readSkillMetaRaw(...)`; якщо raw-обʼєкт відсутній (`null`/`undefined`) — скіл пропускається.
   - поле `raw.auto` пропускається через `parseSkillAutoSpec(...)`; якщо розпізнано — записується в `out[entry.name]`.
4. Скіли без розпізнаного `auto` **не потрапляють у результат** — вони можуть бути ввімкнені лише вручну через `.n-cursor.json:skills`.

**Side effects:** sync I/O — `existsSync`, `readdirSync`, читання `meta.json` усередині `readSkillMetaRaw`. Інших побічних ефектів немає.

### `detectAutoSkills({ availableSkills, detectedRules, disableSkills })`

**Сигнатура:**

```js
function detectAutoSkills(params: {
  availableSkills: string[],
  detectedRules: string[],
  disableSkills?: string[],
}): { skills: string[] }
```

**Параметри:**

- `availableSkills` _(string[])_ — перелік id скілів, доступних у поточній збірці пакету (без префіксу `n-`). Будь-який скіл, який є в `SKILL_AUTO_ACTIVATION`, але відсутній у `availableSkills`, **не активується**.
- `detectedRules` _(string[])_ — id правил, що їх виявив auto-rules-крок; використовується як множина "виявлених" залежностей для специфікацій `{ rules: [...] }`.
- `disableSkills` _(string[], optional)_ — список id скілів із `.n-cursor.json` із прапором `disable-skills`. За замовчуванням — заморожений пустий масив `DEFAULT_DISABLED_LIST`.

**Повертає:** `{ skills: string[] }` — список id активованих скілів у **стабільному алфавітному порядку** (через `AUTO_SKILL_ORDER.filter(...)`).

**Алгоритм:**

1. Нормалізує `availableSkills` у `Set` (lowercase, trim).
2. Будує `Set` із `disableSkills` та `detectedRules`.
3. Для кожної пари `[skillId, spec]` у `SKILL_AUTO_ACTIVATION`:
   - якщо скіл не входить у `normalizedSkills` або входить у `disableSkillsSet` — пропуск.
   - якщо `spec` має `always: true` **або** усі `spec.rules` присутні в `detectedRulesSet` — скіл додається до результуючого `detected`.
4. Фінальний список будується через `AUTO_SKILL_ORDER.filter(id => detected.has(id))`, що гарантує детермінований алфавітний порядок та фільтрацію тільки тих id, які реально мають spec.

**Side effects:** немає — функція чиста. Використовує тільки заздалегідь обчислений `SKILL_AUTO_ACTIVATION` і `AUTO_SKILL_ORDER`.

## Внутрішні константи модуля

- `PACKAGE_ROOT` — корінь npm-пакету: `dirname(dirname(fileURLToPath(import.meta.url)))`. Тобто два рівні вгору від `npm/scripts/auto-skills.mjs` → `npm/`.
- `SKILLS_DIR` — `join(PACKAGE_ROOT, 'skills')`, тобто `npm/skills/`.
- `SKILL_AUTO_ACTIVATION` — результат `discoverSkillAutoActivation()` під час імпорту модуля; кеш на час процесу.
- `AUTO_SKILL_ORDER` — `Object.freeze(Object.keys(SKILL_AUTO_ACTIVATION).toSorted(localeCompare))`. Заморожений алфавітний список усіх скілів з auto-spec.
- `AUTO_SKILL_RULE_DEPENDENCIES` — `Object.freeze(Object.fromEntries(...))`: похідна view, де лишаються тільки записи зі spec-формою `{ rules }`. Призначена для зворотної сумісності й для автодоку.
- `DEFAULT_DISABLED_LIST` — `Object.freeze([])`, дефолтне значення для параметра `disableSkills`.

## Залежності

**Node.js стандартні модулі:**

- `node:fs` — `existsSync`, `readdirSync` (синхронне сканування директорії).
- `node:path` — `dirname`, `join`.
- `node:url` — `fileURLToPath` (для отримання абсолютного шляху модуля з `import.meta.url`).

**Локальні модулі:**

- `./lib/skill-meta.mjs` — імпортуються:
  - `readSkillMetaRaw(skillPath)` — читає сирий обʼєкт `meta.json` за шляхом до директорії скілу.
  - `parseSkillAutoSpec(raw.auto)` — нормалізує значення `auto` у `SkillAutoSpec` (`{ always: true }`, `{ rules: [...] }` або `null`).

**Файлова система (рантайм-залежності):**

- Очікується наявність директорії `npm/skills/` із піддиректоріями `<skillId>/meta.json`. Відсутність директорії оброблена коректно (повертається `{}`).

## Потік виконання / Використання

### Завантаження модуля (init phase)

1. `PACKAGE_ROOT` і `SKILLS_DIR` обчислюються на основі `import.meta.url`.
2. Викликається `discoverSkillAutoActivation()` — це **синхронне** I/O під час імпорту: читається `npm/skills/`, з кожної піддиректорії — `meta.json`. Результат зберігається у `SKILL_AUTO_ACTIVATION`.
3. `AUTO_SKILL_ORDER` і `AUTO_SKILL_RULE_DEPENDENCIES` похідні від цього кешу — обчислюються одноразово і заморожуються.

### Виклик `detectAutoSkills` (runtime)

Зазвичай викликається на етапі генерації / валідації `.n-cursor.json`. Послідовність:

1. Зовнішній код визначає `availableSkills` (зі стану пакету / маніфесту) та `detectedRules` (через сусідній auto-rules pipeline).
2. Опціонально передає `disableSkills` із конфігу користувача.
3. Функція повертає `{ skills: [...] }` — фінальний відсортований список id, готовий до запису у конфіг.

### Приклад використання

```js
import { detectAutoSkills, AUTO_SKILL_ORDER, AUTO_SKILL_RULE_DEPENDENCIES } from './auto-skills.mjs'

const { skills } = detectAutoSkills({
  availableSkills: ['fix', 'lint', 'adr-normalize', 'taze', 'publish-telegram'],
  detectedRules: ['adr', 'bun'],
  disableSkills: ['publish-telegram']
})

// skills буде у стабільному алфавітному порядку:
// напр. ['adr-normalize', 'fix', 'lint', 'taze']
// (publish-telegram вимкнено через disableSkills)
```

### Контракти й інваріанти

- **Детермінізм:** порядок результату повністю визначається `AUTO_SKILL_ORDER`, який є `localeCompare`-сортованим snapshot-ом на момент імпорту.
- **Безпека до відсутніх скілів:** скіли, доступні у `SKILL_AUTO_ACTIVATION`, але не присутні у `availableSkills`, ніколи не активуються.
- **Кеш:** перечитати `npm/skills/` без перезавантаження модуля неможливо — функція `discoverSkillAutoActivation` тут лише для прямого виклику з тестів (передаючи інший `skillsDir`).
- **Опт-аут:** `disableSkills` має пріоритет над `auto`-активацією.

## Rebuild Test

Уявімо, що файл загублено. За цим описом його можна відновити так:

1. ESM-модуль із Node-імпортами `existsSync, readdirSync` із `node:fs`, `dirname, join` із `node:path`, `fileURLToPath` із `node:url`.
2. Імпорт `parseSkillAutoSpec, readSkillMetaRaw` із `./lib/skill-meta.mjs`.
3. Константи `PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))`, `SKILLS_DIR = join(PACKAGE_ROOT, 'skills')`.
4. Експортована функція `discoverSkillAutoActivation(skillsDir = SKILLS_DIR)`: якщо `!existsSync(skillsDir)` → `{}`; інакше readdirSync з `withFileTypes`, ітерувати, пропускати не-директорії та `name.startsWith('.')`, читати `readSkillMetaRaw(join(skillsDir, entry.name))`, пропускати falsy, парсити `parseSkillAutoSpec(raw.auto)`, додавати в `out[entry.name]` тільки якщо парсер повернув spec.
5. Константа модуля `SKILL_AUTO_ACTIVATION = discoverSkillAutoActivation()`.
6. Експорт `AUTO_SKILL_ORDER = Object.freeze(Object.keys(SKILL_AUTO_ACTIVATION).toSorted((a,b) => a.localeCompare(b)))`.
7. Експорт `AUTO_SKILL_RULE_DEPENDENCIES = Object.freeze(Object.fromEntries(Object.entries(SKILL_AUTO_ACTIVATION).filter(([, spec]) => 'rules' in spec).map(([id, spec]) => [id, spec.rules])))`.
8. Константа `DEFAULT_DISABLED_LIST = Object.freeze([])`.
9. Експортована функція `detectAutoSkills({ availableSkills, detectedRules, disableSkills = DEFAULT_DISABLED_LIST })`: побудувати `normalizedSkills = new Set(availableSkills.map(s => s.trim().toLowerCase()))`, `disableSkillsSet`, `detectedRulesSet`; пройти `Object.entries(SKILL_AUTO_ACTIVATION)`, пропустити коли скіл не у `normalizedSkills` або у `disableSkillsSet`, інакше додати до `detected` якщо `'always' in spec` або `spec.rules.every(d => detectedRulesSet.has(d))`; повернути `{ skills: AUTO_SKILL_ORDER.filter(id => detected.has(id)) }`.
