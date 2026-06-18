---
type: JS Module
title: prompt.mjs
resource: npm/scripts/coverage-classify/prompt.mjs
docgen:
  crc: 12bfb99a
---

Модуль `prompt.mjs` — це prompt-builder для скрипта `coverage-classify`, що класифікує вцілілих мутантів зі звіту Stryker через LLM. Файл експонує дві сутності:

- статичний рядок `SYSTEM_PROMPT`, який описує LLM правила класифікації та формат JSON-відповіді;
- функцію `buildUserPrompt(mutant, cwd)`, яка для кожного конкретного мутанта збирає контекстний user-prompt: фрагмент вихідного коду навколо мутації, вміст відповідного тестового файла та дату останньої git-активності.

Розділення на статичний `SYSTEM_PROMPT` і динамічний `buildUserPrompt` обґрунтоване стратегією кешування промптів через Anthropic API (`cache_control: ephemeral`) — незмінна частина (системний промпт) кешується між викликами, а змінна (контекст мутанта) формується щоразу заново.

Модуль не виконує жодних мережевих викликів — він лише будує текст. Виклик LLM відбувається у викликальному коді (інший модуль `coverage-classify`).

## Експорти / API

| Експорт                        | Тип                       | Призначення                                                                                                                                                                                                                                                     |
| ------------------------------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SYSTEM_PROMPT`                | `string` (named export)   | Статичний англомовний системний промпт для LLM-класифікатора мутантів. Містить опис п'яти можливих verdict-категорій (`worth-testing`, `equivalent`, `defensive`, `glue`, `wrapper`), JSON-схему відповіді та інструкції щодо рівня впевненості (`confidence`). |
| `buildUserPrompt(mutant, cwd)` | `function` (named export) | Будує user-prompt для одного мутанта.                                                                                                                                                                                                                           |

Внутрішня (не експортована) функція:

- `extractTestTitles(content)` — допоміжна, витягує заголовки `describe/test/it` з тексту test-файла.

Внутрішні константи (не експортуються):

- `CONTEXT_LINES = 10` — кількість рядків контексту вище й нижче рядка мутанта при формуванні фрагмента вихідного коду.
- `TEST_FILE_MAX_LINES = 2000` — поріг розміру test-файла у рядках; якщо більше — у промпт іде лише список title-ів, а не повний текст.

## Функції

### `extractTestTitles(content)`

Внутрішня helper-функція для редукування довгих тестових файлів до списку заголовків.

- **Сигнатура**: `extractTestTitles(content: string) => string`
- **Параметри**:
  - `content` — повний текст test-файла як рядок.
- **Повертає**: рядок, де кожен запис має формат `describe: <title>` або `test: <title>` / `it: <title>`, з'єднаний через `\n`. Якщо у файлі не знайдено жодного блоку `describe`/`test`/`it` — повертає літерал `(no describe/test blocks found)`.
- **Алгоритм**: проганяє по `content` глобальний `unicode/multiline` regex `^\s*(describe|test|it)\(['"\`](.+?)['"\`]`, що ловить початки тестових блоків з аргументом у одинарних, подвійних або зворотних лапках. Для кожного match-у формує рядок `<kind>: <title>` і додає до масиву, який в кінці зливається в один рядок.
- **Side effects**: відсутні (чиста функція).
- **Обмеження**: regex не аналізує AST, тому коментарі типу `// describe('foo'`) також можуть бути захоплені; для шаблонів промпту це прийнятна апроксимація.

### `buildUserPrompt(mutant, cwd)`

Основна публічна функція модуля. Збирає markdown-розмічений user-prompt з чотирма секціями: метаінформація про мутант, фрагмент вихідного коду, існуючі тести, дата останньої git-активності файла.

- **Сигнатура**: `buildUserPrompt(mutant, cwd: string) => string`, де `mutant` має форму:
  ```
  {
    file: string,         // шлях до файла відносно cwd
    line: number,         // рядок мутації (1-based)
    col: number,          // колонка мутації
    mutantType: string,   // тип мутанта зі Stryker (наприклад "ConditionalExpression")
    original: string,     // оригінальний фрагмент коду
    replacement: string   // мутований фрагмент
  }
  ```
- **Параметри**:
  - `mutant` — об'єкт-опис мутанта, як зазначено вище.
  - `cwd` — абсолютний шлях до кореня проєкту; використовується для побудови абсолютного шляху до файла й як `cwd` для виклику `git`.
- **Повертає**: markdown-рядок із секціями `# Mutant`, `# Source context (±10 lines)`, `# Existing tests`, `# Recent activity`. Готовий бути переданим у поле `messages[].content` LLM-запиту.
- **Side effects**:
  - синхронні read-only file system операції: `existsSync`, `readFileSync` для джерельного файла й тестового файла;
  - синхронний виклик процесу `git log -1 --format=%ar -- <absPath>` через `execFileSync` (read-only щодо git-репозиторію).
- **Обробка помилок / graceful fallback**:
  - якщо джерельний файл не існує — `srcContext = '(source file unavailable)'`;
  - якщо тестовий файл не існує — `existingTests = '(no test file)'`;
  - якщо `git` недоступний, файл untracked або команда падає — `recentActivity = '(no git history)'`. `catch`-блок мовчазний, помилка проковтується (за коментарем `git unavailable or file untracked — keep placeholder`).

#### Алгоритм формування секцій

1. **Абсолютний шлях**: `absPath = join(cwd, mutant.file)`.
2. **Source context**:
   - читає файл, розбиває на рядки;
   - обчислює діапазон `[start, end)`, де `start = max(0, mutant.line - 1 - 10)`, `end = min(lines.length, mutant.line + 10)`;
   - вирізає slice, додає до кожного рядка префікс `<absoluteLineNumber>: ` (1-based) і об'єднує через `\n`.
3. **Existing tests** — шукає файл за конвенцією `dirname(absPath)/tests/<basename без .mjs>.test.mjs`:
   - якщо файл існує і має <= 2000 рядків — вставляє повний вміст;
   - якщо більше — викликає `extractTestTitles(content)` і вставляє лише заголовки тест-блоків.
4. **Recent activity**: викликає `git log -1 --format=%ar -- <absPath>` з опціями `cwd`, `encoding: 'utf8'`, `stdio: ['ignore', 'pipe', 'ignore']` (stderr глушиться). Trim-ить результат; якщо він непорожній — підставляє у плейсхолдер.
5. Повертає шаблонний рядок із усіма зібраними секціями.

## Залежності

### Зовнішні (Node.js builtins)

- `node:child_process` — `execFileSync` для виклику `git log`. Прямий виклик бінарника `git` без shell-інтерпретації (аргументи — масив).
- `node:fs` — `existsSync`, `readFileSync` для синхронного читання джерельних і тестових файлів.
- `node:path` — `basename`, `dirname`, `join` для роботи зі шляхами.

### Внутрішньопроєктні

Модуль не імпортує жодних інших модулів проєкту і не має внутрішньопроєктних залежностей.

### Очікувані виклики ззовні

Файл є частиною комплекту `npm/scripts/coverage-classify/`. Сусідні модулі тієї ж теки (`index.mjs`, `apply.mjs`, `cache.mjs`, `verdict-schema.mjs`) ймовірно імпортують `SYSTEM_PROMPT` і `buildUserPrompt` для побудови запитів до LLM і подальшої обробки verdict-ів. Цей файл сам по собі нічого не виконує — він суто «бібліотечний».

## Потік виконання / Використання

Типовий сценарій споживання:

1. Споживач (наприклад `index.mjs` у тій самій теці) імпортує:
   ```
   import { SYSTEM_PROMPT, buildUserPrompt } from './prompt.mjs'
   ```
2. Для кожного survived-мутанта зі Stryker-звіту:
   - формує об'єкт `mutant` із полів звіту;
   - викликає `const userPrompt = buildUserPrompt(mutant, process.cwd())`;
   - відправляє у LLM-API два повідомлення:
     - system: `SYSTEM_PROMPT` (з `cache_control: { type: 'ephemeral' }`),
     - user: `userPrompt`.
3. LLM повертає JSON-об'єкт за схемою, описаною у `SYSTEM_PROMPT`:
   ```
   {
     "verdict": "worth-testing" | "equivalent" | "defensive" | "glue" | "wrapper",
     "confidence": number,
     "reason": string,
     "suggestedTest": string  // тільки якщо verdict === "worth-testing"
   }
   ```
4. Викликальний код парсить відповідь (валідація схеми ймовірно в `verdict-schema.mjs`) і застосовує її (`apply.mjs`).

### Інваріанти й обмеження

- `mutant.file` має бути шляхом відносно `cwd` — інакше абсолютний шлях буде некоректний і обидва файли (джерело й тест) випадуть у fallback-плейсхолдери.
- Конвенція розташування тестів є жорсткою: `tests/<basename без .mjs>.test.mjs` поряд з джерельним файлом. Інші конвенції (наприклад `__tests__/` або `.spec.mjs`) не підтримуються — для них `existingTests` буде `(no test file)`.
- Розширення `.mjs` зашите у `basename(absPath, '.mjs')`. Для файлів інших розширень (`.js`, `.ts`, `.vue`) `basename` залишить розширення в результаті, тому шлях до тестів стане некоректним.
- `CONTEXT_LINES = 10` і `TEST_FILE_MAX_LINES = 2000` — внутрішні константи, не конфігуруються параметрами.
- `git log` запускається синхронно — для великої кількості мутантів це може бути bottleneck.
- Усі операції синхронні; модуль безпечний для послідовного використання, але не оптимізований під concurrent-доступ (хоча сам по собі stateless).
