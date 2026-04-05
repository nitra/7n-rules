# Програмна верифікація замість LLM-інтерпретації: як скоротити витрати токенів у 5-8 разів

## Проблема

Коли AI-агент (Cursor, Copilot, Codex, Claude) працює з проєктом, він повинен дотримуватися правил: конвенцій, конфігурацій, стандартів. Типовий підхід — описати правила в prompt-файлах (`.cursor/rules/*.mdc`, `AGENTS.md`, `.github/copilot-instructions.md`) і дозволити LLM самому перевіряти їх дотримання.

**Що відбувається при LLM-верифікації:**

```
Агент читає правило: "У проєкті не повинно бути package-lock.json, yarn.lock..."
    ↓
Агент виконує: glob("package-lock.json") → читає результат
    ↓
Агент виконує: glob("yarn.lock") → читає результат
    ↓
Агент виконує: glob("pnpm-lock.yaml") → читає результат
    ↓
Агент виконує: read("package.json") → парсить 500+ символів
    ↓
Агент "думає": "packageManager поле відсутнє, bun.lock є..."
    ↓
5 tool calls, ~800 reasoning tokens, 30 секунд
```

Кожен tool call — це overhead: токени на запит, відповідь, reasoning. І це лише **одне** правило. При 10 правилах агент витрачає 15-20 tool calls і тисячі токенів на те, що `node` зробить за 100ms.

## Рішення: CLI з детермінованими check-скриптами

Замість того щоб LLM інтерпретував правила і вручну перевіряв файли, створюємо **програмні скрипти**, які перевіряють все автоматично і повертають структурований результат.

### Архітектура

```
.cursor/rules/           npm/scripts/
┌─────────────────┐      ┌──────────────────┐
│ n-bun.mdc       │      │ check-bun.mjs    │
│ (правило для    │──────│ (програмна       │
│  LLM: що робити)│      │  перевірка)      │
└─────────────────┘      └──────────────────┘
        │                        │
        ▼                        ▼
  LLM читає і                Агент запускає:
  розуміє ЯК                 npx @nitra/cursor check bun
  писати код                         │
                                     ▼
                              ✅ Немає package-lock.json
                              ✅ Немає yarn.lock
                              ✅ bun.lock є
                              ❌ packageManager — видали
```

**MDC файл** — для LLM: пояснює _як_ писати код, конвенції, приклади.
**Check скрипт** — для програмної верифікації: перевіряє _чи_ все налаштовано правильно.

`npx @nitra/cursor check` без аргументів запускає лише ті `check-*.mjs`, для яких відповідний `.mdc` перелічений у `AGENTS.md` (шляхи виду `.cursor/rules/n-bun.mdc`). Явний список правил у командному рядку лишається можливим: `npx @nitra/cursor check bun ga`.

### Приклад: правило bun.mdc

**MDC файл** (що бачить LLM у контексті) — правила і конвенції:

```markdown
Проект використовує тільки Bun для керування залежностями.

Заборонено: npm install, yarn, pnpm
Lockfile: bun.lock
Видалити: package-lock.json, yarn.lock, pnpm-lock.yaml, .yarn, .yarnrc.yml
Прибрати поле packageManager з package.json

## Перевірка

`npx @nitra/cursor check bun`
```

**Check скрипт** (окремий файл, не в контексті):

```javascript
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

/**
 *
 */
export async function check() {
  let exitCode = 0
  const pass = msg => console.log(`  ✅ ${msg}`)
  const fail = msg => {
    console.log(`  ❌ ${msg}`)
    exitCode = 1
  }

  const forbidden = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.yarnrc.yml']
  for (const f of forbidden) {
    existsSync(f) ? fail(`Знайдено заборонений файл: ${f} — видали його`) : pass(`Немає ${f}`)
  }

  existsSync('.yarn') ? fail('Знайдено директорію .yarn — видали її') : pass('Немає .yarn/')

  existsSync('bun.lock') ? pass('bun.lock є') : fail('Відсутній bun.lock — запусти bun i')

  if (existsSync('package.json')) {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'))
    pkg.packageManager
      ? fail(`packageManager: "${pkg.packageManager}" — видали`)
      : pass('package.json не містить packageManager')
  }

  return exitCode
}
```

**Результат виконання:**

```
🔍 @nitra/cursor check — перевірка правил (1)

📋 bun:
  ✅ Немає package-lock.json
  ✅ Немає yarn.lock
  ✅ Немає pnpm-lock.yaml
  ✅ Немає .yarnrc.yml
  ✅ Немає .yarn/
  ✅ bun.lock є
  ✅ package.json не містить packageManager

✨ Результат: 1/1 правил без зауважень
```

Агент отримує цей вивід за **1 tool call** і одразу розуміє стан проєкту.

## Порівняння на реальних даних

Виміряно на проєкті з 10 правилами (bun, ga, js-format, js-lint, text, style-lint, npm-module, js-pino, nginx, vue):

### Контекст (кожне повідомлення до агента)

|           | CLI підхід                        | Без скриптів |
| --------- | --------------------------------- | ------------ |
| MDC файли | ~8130 tokens                      | ~8050 tokens |
| Різниця   | +80 tokens (рядки `## Перевірка`) | —            |

Overhead — менше 1%. Скрипти не потрапляють у контекст.

### Верифікація всіх 10 правил

| Метрика                | CLI check       | LLM верифікує вручну         |
| ---------------------- | --------------- | ---------------------------- |
| Tool calls             | **1**           | **15-20**                    |
| Токени від tool output | **~850**        | **~1400** (файли) + overhead |
| Reasoning токени       | **~100**        | **~2000-3000**               |
| Загалом                | **~950 tokens** | **~5000-8000 tokens**        |
| Час                    | **~1 сек**      | **~30-60 сек**               |
| Детермінованість       | **100%**        | ~80% (LLM може пропустити)   |

### Верифікація одного правила (js-format)

**CLI підхід:**

```
1 tool call → 189 tokens → агент одразу бачить що робити
```

**LLM вручну — треба прочитати 4 файли:**

```
Read .oxfmtrc.json     → 475 bytes   → перевірити 9 ключів
Read extensions.json   → 118 bytes   → знайти oxc.oxc-vscode
Read settings.json     → 1226 bytes  → перевірити 6 секцій formatter
Read package.json      → 517 bytes   → перевірити відсутність prettier

4 tool calls → ~584 tokens input → ~500 tokens reasoning
= ~1100 tokens (vs 189 у CLI)
```

## Антипатерн: скрипти в prompt-контексті

Перший варіант, який ми спробували — вбудувати скрипти прямо в MDC файли:

```markdown
## Scripts

​`javascript title="check-bun.mjs"
import { existsSync } from 'node:fs'
// ... 30 рядків коду перевірки ...
process.exitCode = exitCode
​`
```

**Чому це погано:**

- MDC з `alwaysApply: true` завантажуються в контекст **кожного** повідомлення
- Скрипти додали ~520 рядків до сумарного контексту
- Ці токени витрачаються навіть коли агент просто пише код
- Збільшення контексту: 966 → 1488 рядків (+54%)

**Правильний підхід:** скрипти в окремих файлах, у MDC — лише посилання на команду.

## Як застосувати у своєму проєкті

### Крок 1: Визнач правила

Опиши правила в `.cursor/rules/` (або `AGENTS.md`) як зазвичай — це інструкції для LLM.

### Крок 2: Створи check-скрипти

Для кожного правила, яке можна перевірити програмно, створи скрипт:

```javascript
// scripts/check-<rule-name>.mjs
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

/**
 *
 */
export async function check() {
  let exitCode = 0
  const pass = msg => console.log(`  ✅ ${msg}`)
  const fail = msg => {
    console.log(`  ❌ ${msg}`)
    exitCode = 1
  }

  // Перевірки з використанням лише node:fs, node:path
  // Без зовнішніх залежностей!

  return exitCode
}
```

### Крок 3: Додай CLI точку входу

```javascript
// bin/cli.js
const scriptsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts')

const [command, ...args] = process.argv.slice(2)
if (command === 'check') {
  // Без аргументів — імена правил з AGENTS.md (.cursor/rules/….mdc) ∩ наявні check-*.mjs
  // З аргументами — лише вказані правила
}
```

### Крок 4: Вкажи команду в правилі

```markdown
## Перевірка

`npx @your-package check <rule-name>`
```

## Принципи

1. **MDC файл = інструкція для LLM** — як писати код, конвенції, приклади
2. **Check скрипт = програмна верифікація** — чи правила дотримані
3. **Скрипти ніколи не в контексті** — лише в окремих файлах
4. **Тільки Node.js built-ins** — скрипти працюють без `npm install`
5. **Структурований вивід** — `✅`/`❌` з чіткими повідомленнями і exit code
6. **Одна команда** — агент запускає один tool call замість десятків

## Де ще застосовувати цей патерн

- **Перевірка структури проєкту** — директорії, файли конфігурацій
- **Валідація CI/CD** — наявність workflows, правильні triggers
- **Аудит залежностей** — заборонені/обов'язкові пакети
- **Перевірка конфігурацій** — ESLint, prettier, stylelint, cspell
- **Міграції** — перевірка що стара конфігурація замінена на нову

Кожне правило, яке LLM перевіряє читанням файлів — кандидат на check-скрипт.
