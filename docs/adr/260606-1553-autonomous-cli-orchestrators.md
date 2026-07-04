---
type: ADR
status: Proposed
date: 2026-06-06
---

# ADR: Автономні CLI-оркестратори (`fix`, `lint`, `taze`)

## Контекст

Поточна архітектура n-cursor: CLI-команди (`fix`, `lint`, `taze`) є **чекерами та репортерами**. Логіка "як виправляти" живе у SKILL.md — агент (LLM) читає інструкцію, сам аналізує порушення, сам приймає рішення, сам пише виправлення.

Це означає:
- Агент витрачає токени на детерміністичну роботу (парсинг JSON, вибір файлу для правки)
- Логіка виправлення дублюється між SKILL.md і здоровим глуздом LLM
- Якість залежить від того, наскільки точно агент прочитав SKILL.md
- Скіл — це 8-кроковий workflow, а не one-liner

## Рішення

**CLI-команди стають автономними оркестраторами.**

```bash
npx @nitra/cursor fix    # структурні порушення → сам виправляє
npx @nitra/cursor lint   # лінт-порушення → сам виправляє
npx @nitra/cursor taze   # застарілі deps → сам оновлює
```

Exit 0 = чисто. Exit 1 = не вдалось (з поясненням у stdout).

Агент більше не читає покрокову інструкцію — він запускає одну команду і перевіряє exit code.

## Ключові рішення дизайну

### 1. Ієрархія тірів всередині оркестратора

```
T0   — детерміністична підготовка (0 LLM токенів)
         bunx taze, bun install, backup/cleanup, etc.

T0-auto — regex-парсинг violation → програмний фікс (0 LLM токенів)
         "recommendations має містити X" → write to extensions.json

T1   — LLM-tier через pi (коли T0 недостатньо)
         script збирає контекст → pi → script застосовує

check-gate — детерміністична перевірка після кожного тіру
         повертає до T0-auto/T1 якщо ще є порушення (convergence-loop)
```

### 2. LLM-tier: C1 pattern (script-extracts, LLM-returns)

**Не** tool-use всередині LLM. Натомість:

1. Script детерміністично збирає контекст (читає файли, витягує violation, знаходить usages)
2. Будує self-contained prompt з повним контекстом
3. `pi -p "<prompt>" --model claude-haiku-4-5` → повертає виправлений файл цілком
4. Script застосовує програмно

```
orchestrator                           pi (LLM)
    │                                     │
    ├─ читає violation output             │
    ├─ читає файл з порушенням            │
    ├─ читає changelog / rule             │
    ├─ будує prompt ──────────────────────►
    │                                     ├─ розуміє зміну
    │                                     └─ повертає виправлений файл
    ◄──────────────────────────────────────┤
    ├─ застосовує (write)                 │
    └─ check-gate                         │
```

LLM отримує лише необхідний зріз, не знає про решту репо.

### 3. Всі LLM-виклики через `pi`

```bash
pi -p "<prompt>" --model claude-haiku-4-5   # tier 1 (default)
pi -p "<prompt>" --model claude-sonnet-4-6  # tier 2 (ескалація)
```

Користувач налаштовує API-ключі в pi самостійно. Оркестратор не тримає жодних ключів.

Ескалація: haiku × 2 fails на тому самому rule → sonnet.

### 4. Послідовне виконання (не паралельні під-ворктрі)

Якщо агент у ворктрі запускає `fix` і `lint` — послідовно:

```bash
npx @nitra/cursor fix && npx @nitra/cursor lint
```

**Чому не паралельні під-ворктрі:**
- fix і lint не є незалежними: fix може створити конфіг (eslint.config.js), який lint потім перевіряє
- Паралельні під-ворктрі гарантовано конфліктують на спільних файлах (package.json, extensions.json)
- Merge двох під-ворктрі — окрема складна задача без чіткого winner

### 5. Тонкі скіли як агентський інтерфейс

SKILL.md перестає бути покроковою інструкцією. Стає декларацією:

```markdown
# n-fix
Запусти:
npx @nitra/cursor fix
Exit 0 = структура проєкту відповідає правилам.
```

Агент не знає як fix працює — він знає що fix робить і що означає exit code.

### 6. Команди ідемпотентні

Якщо порушень немає — команда завершується швидко (T0 check, 0 LLM). Агент може викликати після будь-яких своїх змін як verification step.

## Що змінюється

| | До | Після |
|---|---|---|
| Де логіка виправлення | SKILL.md (агент читає) | CLI (orchestrator.mjs) |
| Агентський інтерфейс | 8-крокова інструкція | `npx @nitra/cursor fix` |
| LLM-виклики | агент через SDK/bash | orchestrator через pi |
| `fix --json` | є (check-only mode) | **видалено** |
| Worktree для fix/lint | обов'язковий (worktree:true) | **не обов'язковий** — CLI сам ізолює через convergence-loop |

## Наслідки

**Позитивні:**
- Агент витрачає 0 токенів на детерміністичну роботу
- Якість виправлення не залежить від того наскільки агент дотримався SKILL.md
- CLI можна запустити вручну з терміналу, без агента
- Тести для оркестратора — unit-тести JS, не e2e з агентом

**Негативні / ризики:**
- Складніша реалізація CLI (orchestrator.mjs per skill)
- LLM-tier потребує pi в PATH (залежність від локального інструменту)
- C1 pattern (повний файл у відповіді) → великі файли = великі промпти

## Scope цього ADR

Перша реалізація: `fix` і `taze`. `lint` — наступна ітерація (складніша: source code refactoring at scale).

## Update 2026-06-06

- `npx @nitra/cursor fix` без `--json` запускає автономний orchestrator, а `--json` лишається check-only режимом для CI й машинного аналізу.
- Orchestrator виконує convergence-loop: T0-auto → LLM-worker haiku→sonnet → recheck, максимум 3 ітерації або до `failed === 0`.
- Scoped запуск на кшталт `fix bun rego` обмежує оркестратор вказаними rules.
- `fix-run` лишається як застарілий псевдонім; основний UX — саме `n-cursor fix`.
- Demo з transcript: 3 violations (`bun`, `rego`, `style-lint`) закрито T0-auto за одну ітерацію, 0 LLM-викликів.
- Змінені точки інтеграції: `npm/bin/n-cursor.js`, `npm/skills/fix/js/orchestrator.mjs`, `npm/skills/fix/SKILL.md`, `.cursor/skills/n-fix/SKILL.md`.

## Update 2026-06-06

- `n-cursor fix` має бути автономним CLI-виконавцем, а не лише checker-ом: агент викликає `npx @nitra/cursor fix` і оцінює exit code.
- Логіка convergence-loop, T0-auto, LLM-tier і ескалації переноситься у CLI; SKILL.md зводиться до однієї команди.
- T0-auto — детермінований рівень виправлень через regex-парсинг structured violation-output без LLM-токенів; зафіксований приклад: `vscode-ext-add`, `rm-forbidden-file` у `npm/skills/fix/js/t0.mjs`.
- Для `fix + lint` обрано послідовне виконання в одному worktree, бо lint має бачити конфіги, створені fix; паралельні під-worktree відхилено через конфлікти на спільних файлах.
- LLM-виклики orchestration-tier мають іти через `pi` у C1-патерні: orchestrator збирає контекст, `pi` повертає replacement, orchestrator застосовує його програмно; tool-use на стороні LLM не використовується.

## Update 2026-06-06

Уточнено реалізаційний контракт автономних CLI-оркестраторів:

- `npm/skills/fix/meta.json` містить `{ "auto": "завжди", "worktree": true, "orchestrator": true }`.
- `npm/skills/fix/js/orchestrator.mjs` реалізує convergence-loop: T0-check → T0-auto (`fix-t0`) → LLM-worker через `pi` → recheck.
- `npm/skills/fix/js/llm-worker.mjs` використовує C1 pattern: script збирає rule `.mdc` і файли з violation, викликає `pi`, отримує JSON зі змінами і застосовує їх.
- `fix --json` вилучено з публічного API; для внутрішнього JSON-check використовується `_fix-check`.
- `fix-run` лишається deprecated alias.
- Перевірка `bun test npm/skills/fix/js/tests/t0.test.mjs` пройшла: 11/11 pass.

Порядок подальшої реалізації скілів: `fix` → `taze` → `lint`.
