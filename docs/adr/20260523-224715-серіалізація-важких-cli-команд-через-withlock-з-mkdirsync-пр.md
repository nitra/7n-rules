---
session: 15a0a2e6-de28-4a12-8fa8-3cee36f7fe61
captured: 2026-05-23T22:47:15+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/15a0a2e6-de28-4a12-8fa8-3cee36f7fe61.jsonl
---

## ADR Серіалізація важких CLI-команд через `withLock` з mkdirSync-примітивом

## Context and Problem Statement
Кілька агентів паралельно запускали важкі команди пакета `@nitra/cursor` (`lint-ga`, `lint-rego`, `lint-text`, `lint-k8s`, `lint-docker`, `fix`), що призводило до перевантаження диску/CPU та некоректних результатів. Потрібен механізм взаємного виключення, що працює на macOS + bun без зовнішніх залежностей (`flock` на macOS відсутній).

## Considered Options
* Атомарний лок через `mkdirSync` (bun-native)
* `/usr/bin/shlock` (BSD-утиліта, є на macOS)
* npm-пакет `proper-lockfile`

## Decision Outcome
Chosen option: "Атомарний лок через `mkdirSync`", because `fs.mkdirSync()` атомарний на APFS — рівно один процес виграє створення директорії-локу (`EEXIST` для решти); не потребує зовнішніх залежностей; дозволяє природно вбудувати дедуп у той самий модуль (~150 рядків bun). `shlock` дає лише взаємне виключення без дедупу; `proper-lockfile` — стороння залежність без потрібної функціональності.

### Consequences
* Good, because transcript фіксує очікувану користь: усі 12 тестів `with-lock.test.mjs` + `worktree-fingerprint.test.mjs` зелені після першої реалізації; `npx @nitra/cursor fix changelog` виводить `🔒 fix-changelog: лок взято`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Реалізація: `npm/scripts/utils/with-lock.mjs`, `npm/scripts/utils/worktree-fingerprint.mjs`
- Публічний API: `withLock(key, runFn, opts?) → Promise<number>`; дедуп-хелпер `shouldDedup(result, fingerprint, ttl)`
- Стан: `node_modules/.cache/n-cursor/<key>/lock/` (дир-лок) + `node_modules/.cache/n-cursor/<key>/result.json`
- Комміт реалізації: `c4b9ea3`; розгортання на всі команди: `17fd868` (v1.13.85)
- Тести: `npm/scripts/utils/tests/with-lock.test.mjs`, `npm/scripts/utils/tests/worktree-fingerprint.test.mjs`

---

## ADR Черга + дедуплікація за хешем git-дерева як стратегія конкуренції

## Context and Problem Statement
Коли агент Б намагається запустити важку команду, а лок тримає агент А, потрібно вибрати поведінку: агент Б може відмовитись, скипнути або чекати. Водночас, якщо стан репо не змінився, повторне виконання команди марне — результат буде ідентичним.

## Considered Options
* Чекати в черзі + дедуплікувати результат (обрано)
* Відмовитись з помилкою (fail-fast)
* Пропустити без очікування (skip-and-continue)

## Decision Outcome
Chosen option: "Чекати в черзі + дедуплікувати результат", because агент Б потребує підтвердження коректності (fail-fast унеможливлює це), а skip пропускає валідацію; дедуп дає оптимізацію без втрати гарантій — якщо `exitCode === 0`, fingerprint збігся і TTL (10 хв) не вийшов, Б отримує `exit 0` без повторного запуску.

### Consequences
* Good, because transcript фіксує очікувану користь: дедуп вимикається для невдалих прогонів (Б завжди отримує свіжий вивід помилок); лог `♻️ <key>: дедуп — те саме дерево пройшло Nс тому, пропускаю` робить поведінку прозорою.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Fingerprint = sha256 від `git rev-parse HEAD` + `git diff HEAD` + untracked-файли через `git hash-object`; поза git-репо → fingerprint `null` → дедуп вимкнено, лок залишається.
- Таймаут очікування: 20 хв → лог-попередження + виконання без локу.
- Застарілий лок: `process.kill(pid, 0)` на мертвий PID або вік > 30 хв → лок очищається й захоплюється заново.
- Реалізація в `npm/scripts/utils/with-lock.mjs`; константи `ttl`/`staleAgeMs`/`waitTimeout` — параметри `opts`.

---

## ADR Лок вбудований у `runStandardRule` та lint-функції замість окремої команди-обгортки

## Context and Problem Statement
Агенти запускають команди безпосередньо (`bun run lint-ga`, `npx @nitra/cursor fix`). Початковий дизайн передбачав окрему підкоманду `n-cursor guard <key> -- <команда>`, яку скіли мали б пам'ятати викликати — але це слабке місце: прямий виклик `bun run lint` обходить захист.

## Considered Options
* Окрема команда-обгортка `n-cursor guard`
* Лок вбудований інтринсивно в кожну lint-функцію та `runStandardRule`

## Decision Outcome
Chosen option: "Лок вбудований інтринсивно", because агент далі запускає `bun run lint-ga` / `npx @nitra/cursor fix` як завжди — лок прозорий; неможливо обійти прямим викликом; скіли не потребують змін.

### Consequences
* Good, because transcript фіксує очікувану користь: лок працює незалежно від того, звідки запущена команда — через скіл, `bun run lint`, або `n-cursor fix`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `lint-ga`: `export const runLintGaCli = () => withLock('lint-ga', runLintGaSteps)` — `npm/rules/ga/lint/lint.mjs:168`
- `lint-rego`, `lint-text`, `lint-k8s`, `lint-docker`: аналогічний патерн `*Steps` + `*Cli` у відповідних `lint.mjs`
- `fix` (per-rule): лок вбудовано в `npm/scripts/utils/run-standard-rule.mjs`; `runFixCommand` у `n-cursor.js` делегує до spawn-процесів `rules/<id>/fix.mjs`, кожен з яких проходить через `runStandardRule` → `withLock('fix-<id>')`
- Конвенція зафіксована в `.cursor/rules/scripts.mdc` — секція «Серіалізація важких CLI-команд: `withLock`»
- Комміт: `17fd868`, версія `@nitra/cursor` `1.13.85`
