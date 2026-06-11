---
docgen:
  source: npm/scripts/coverage-classify/apply.mjs
  crc: 0f54e6a0
---

# apply.mjs

## Огляд

Модуль `apply.mjs` із пакета `coverage-classify` відповідає за **застосування вердиктів класифікатора мутаційних розривів** до табличних coverage-рядків. Він фільтрує список «вижилих» мутантів (`survived`) у кожному рядку, ділячи їх на дві категорії:

1. **Allowed gaps** — мутанти, які класифікатор позначив як `equivalent`, `defensive`, `glue` або `wrapper` з рівнем впевненості (`confidence`) не нижче встановленого порогу. Такі мутанти виключаються з підрахунку «killable» (зменшують `mutation.total`) та виносяться в окремий список для подальшого рендеру в `COVERAGE.md`.
2. **Залишок (remaining survived)** — все, що варто тестувати (`worth-testing`), а також низько-впевнені `skip`-вердикти. Ці мутанти залишаються у вихідному `row.survived` і впливають на mutation score.

Модуль **не мутує вхідні дані** (`rows`, `verdicts`) — повертає нові об'єкти. Це дозволяє безпечно використовувати його у пайплайнах, де ті ж самі рядки можуть оброблятись паралельно або кешуватись.

Логіка віднімання `skippedCount` з `mutation.total` зумовлена тим, що allowed-gap-мутанти не є реальною прогалиною в покритті: вони або еквівалентні оригіналу (нічого не ламають), або захисні (стосуються неможливих гілок), або клейові/обгорткові — тобто, тестувати їх економічно невиправдано.

## Експорти / API

| Експорт                                    | Тип            | Призначення                                                                                          |
| ------------------------------------------ | -------------- | ---------------------------------------------------------------------------------------------------- |
| `isAllowedGap(verdict, threshold)`         | named function | Перевіряє, чи окремий verdict-об'єкт кваліфікує мутанта як allowed-gap.                              |
| `applyVerdicts(rows, verdicts, threshold)` | named function | Застосовує мапу вердиктів до набору coverage-рядків і повертає augmented rows + список allowed-gaps. |

Default-експорту немає. Внутрішня константа `SKIP_VERDICTS` не експортується.

## Функції

### `isAllowedGap(verdict, threshold)`

**Сигнатура:**

```js
isAllowedGap(verdict: { verdict: string, confidence: number }, threshold: number): boolean
```

**Параметри:**

- `verdict` — об'єкт із полями:
  - `verdict` (`string`) — категорія вердикту класифікатора. Очікувані значення: `'equivalent' | 'defensive' | 'glue' | 'wrapper' | 'worth-testing'` (та потенційно інші).
  - `confidence` (`number`) — рівень впевненості класифікатора в діапазоні `[0, 1]`.
- `threshold` (`number`) — мінімальна впевненість, починаючи з якої skip-вердикт визнається allowed-gap (наприклад, `0.7`).

**Повертає:** `boolean`. `true` — якщо `verdict.verdict` належить до `SKIP_VERDICTS` (`equivalent`, `defensive`, `glue`, `wrapper`) **і** `verdict.confidence >= threshold`. Інакше — `false`.

**Side effects:** немає. Чиста функція.

**Гранична поведінка:**

- Низько-впевнений skip-verdict (`confidence < threshold`) → `false`, мутант залишиться як survived.
- `worth-testing` із будь-якою впевненістю → `false`.
- Невідома категорія, відсутня в `SKIP_VERDICTS` → `false`.

---

### `applyVerdicts(rows, verdicts, threshold)`

**Сигнатура:**

```js
applyVerdicts(
  rows: Array<Row>,
  verdicts: Array<{ key: string, verdict: VerdictObj }>,
  threshold: number
): { rows: Array<Row>, allowedGaps: Array<AllowedGap> }
```

Де:

```ts
Row = {
  area: string,
  coverage: object,
  mutation: { caught: number, total: number },
  survived?: Array<{
    file: string,
    mutants: Array<Mutant>,
    exampleTest?: object | null,
    recommendationText?: string | null
  }>
}

Mutant = { line: number, col: number, replacement: string, ...rest }
VerdictObj = { verdict: string, confidence: number, reason: string }
AllowedGap = { file: string, mutant: Mutant, verdict: VerdictObj }
```

**Параметри:**

- `rows` — масив coverage-рядків (один рядок на «area», тобто workspace/директорію). Кожен рядок містить агреговану статистику мутацій та опційний список `survived`-груп (згрупованих по файлу).
- `verdicts` — масив об'єктів `{ key, verdict }`, де `key` має формат `${file}:${line}:${col}:${replacement}` і однозначно ідентифікує мутанта.
- `threshold` — поріг впевненості (передається в `isAllowedGap`).

**Повертає:** об'єкт з двома полями:

- `rows` (`Array<Row>`) — нові рядки, де:
  - `survived` містить лише ті групи й тих мутантів, які **не** є allowed-gap; порожні групи (де всі мутанти стали allowed-gap) виключаються.
  - `mutation.total` зменшено на сумарну кількість allowed-gap-мутантів у цьому рядку (`skippedCount`).
  - `mutation.caught`, `coverage`, `area` залишаються без змін.
  - Усі інші поля рядка зберігаються через spread (`...row`).
- `allowedGaps` (`Array<AllowedGap>`) — плоский список (без групування по area/file) усіх мутантів, які класифіковано як allowed-gap, разом із посиланням на файл та оригінальним verdict-об'єктом. Призначений для рендеру окремої секції в `COVERAGE.md`.

**Side effects:** немає. Не мутує `rows`, `verdicts`, `verdict`-об'єкти, групи `survived`, окремих мутантів. Кожен новий об'єкт створюється через `{...row}` / `{...group, mutants: remainingMutants}`.

**Алгоритм:**

1. Побудувати `Map<key, verdict>` із масиву `verdicts` для O(1)-пошуку.
2. Ініціалізувати порожній акумулятор `allowedGaps`.
3. Для кожного `row` (через `rows.map(...)`):
   - Прочитати `survived ?? []` (підтримка рядків без поля `survived`).
   - Завести лічильник `skippedCount = 0` і масив `remainingSurvived`.
   - Для кожної `group` із `survived`:
     - Завести `remainingMutants`.
     - Для кожного `mutant` зібрати ключ `${group.file}:${mutant.line}:${mutant.col}:${mutant.replacement}`.
     - Знайти verdict у мапі. Якщо знайдено й `isAllowedGap(verdict, threshold)` — додати `{ file: group.file, mutant, verdict }` у `allowedGaps` та інкрементувати `skippedCount`. Інакше — додати мутанта в `remainingMutants`.
     - Якщо `remainingMutants` непорожній — додати в `remainingSurvived` об'єкт-копію групи з оновленим списком мутантів. Порожні групи відсіюються.
   - Повернути новий рядок: `{ ...row, survived: remainingSurvived, mutation: { ...row.mutation, total: row.mutation.total - skippedCount } }`.
4. Повернути `{ rows: augmentedRows, allowedGaps }`.

**Гранична поведінка:**

- Мутант без відповідного запису у `verdicts` (verdict не знайдено в мапі) → залишається в `remainingMutants` (вважаємо «не класифіковано» → не allowed-gap).
- `row.survived` відсутній / `undefined` → `survived` у вихідному рядку буде `[]` (порожній масив), `mutation.total` без змін.
- Усі мутанти однієї групи стали allowed-gap → група не з'являється в `remainingSurvived`.
- Жоден мутант не визнано allowed-gap → `allowedGaps` буде порожнім, `mutation.total` без змін.
- `mutation.total - skippedCount` може теоретично стати від'ємним, якщо `total` був неконсистентним із кількістю survived (модуль не валідує цей інваріант, надія на коректність вхідних даних).

## Залежності

**Зовнішні (npm):** немає. Файл — чистий ES-модуль без імпортів.

**Внутрішні:** немає. Модуль є самодостатнім listener-free helper'ом без побічних залежностей.

**Runtime:** Node.js / Bun (ESM, синтаксис `export function`). Використовує стандартні структури даних `Map` та `Set` без полі­філів.

**Тип-формат:** усі типи описані JSDoc-блоками (без TypeScript-файлу типів). Структури `Row`, `Mutant`, `VerdictObj` визначені неявно через JSDoc у сигнатурах.

## Потік виконання / Використання

Модуль є проміжною ланкою в пайплайні класифікації мутаційних прогалин у coverage-звіті:

1. **Збір coverage-рядків.** Інший етап пайплайну агрегує статистику покриття й мутаційного тестування по кожній area (workspace) та формує `rows` із полями `mutation.{caught,total}` та `survived` (групи `{file, mutants[]}`).
2. **Класифікація через LLM (або іншого класифікатора).** Для кожного survived-мутанта будується ключ `${file}:${line}:${col}:${replacement}` і отримується `verdict = { verdict, confidence, reason }`. Результат — масив `{key, verdict}`.
3. **Виклик `applyVerdicts(rows, verdicts, threshold)`.** На цьому етапі мутанти діляться на allowed-gaps та залишок, а `mutation.total` коригується.
4. **Рендер у `COVERAGE.md`.** Поверне́ні `rows` рендеряться у таблицю покриття; `allowedGaps` — в окрему секцію «Allowed gaps» (з причинами вердиктів).

**Типовий приклад використання:**

```js
import { applyVerdicts, isAllowedGap } from './apply.mjs'

const threshold = 0.7

const rows = [
  {
    area: 'npm/foo',
    coverage: { lines: 95.2 },
    mutation: { caught: 18, total: 20 },
    survived: [
      {
        file: 'npm/foo/src/index.mjs',
        mutants: [
          { line: 10, col: 5, replacement: '!=' },
          { line: 22, col: 9, replacement: '+' }
        ]
      }
    ]
  }
]

const verdicts = [
  {
    key: 'npm/foo/src/index.mjs:10:5:!=',
    verdict: { verdict: 'equivalent', confidence: 0.9, reason: 'no behavioral diff' }
  },
  {
    key: 'npm/foo/src/index.mjs:22:9:+',
    verdict: { verdict: 'worth-testing', confidence: 0.85, reason: 'real gap' }
  }
]

const { rows: augmented, allowedGaps } = applyVerdicts(rows, verdicts, threshold)

// augmented[0].mutation.total === 19  (20 - 1 allowed-gap)
// augmented[0].survived[0].mutants має 1 елемент (другий мутант)
// allowedGaps має 1 елемент із file: 'npm/foo/src/index.mjs'
```

**Інваріанти, на які слід зважати при змінах:**

- Ключ мутанта **має точно збігатися** з ключем у `verdicts` (формат `${file}:${line}:${col}:${replacement}`). Зміна формату в одному місці ламає матчинг.
- `mutation.caught` ніколи не змінюється — allowed-gaps вилучаються тільки з `total` (бо вони і так не були caught).
- Не покладайтесь на стабільний порядок `allowedGaps`: він залежить від порядку `rows` і всередині — порядку груп та мутантів. Якщо потрібен детермінований ордер, сортуйте у викликачі.

## Rebuild Test

За цією документацією має бути можливо повністю відтворити поведінку `apply.mjs`:

- Скласти `Set` SKIP_VERDICTS = `{equivalent, defensive, glue, wrapper}`.
- Реалізувати `isAllowedGap(verdict, threshold)` як `SKIP_VERDICTS.has(verdict.verdict) && verdict.confidence >= threshold`.
- Реалізувати `applyVerdicts(rows, verdicts, threshold)`:
  - побудувати `Map` з `verdicts`,
  - пройти `rows.map` з immutable-оновленням,
  - для кожного survived-мутанта зібрати ключ за фіксованим форматом, перевірити через `isAllowedGap`, зібрати окремий список allowedGaps та зменшити `mutation.total`,
  - відсіяти порожні групи, повернути `{rows, allowedGaps}`.
- Не імпортувати нічого; не мутувати входи.
