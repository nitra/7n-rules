---
session: e513a1f0-c8b8-4eec-a745-63768ffe456b
captured: 2026-05-16T15:42:18+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/e513a1f0-c8b8-4eec-a745-63768ffe456b.jsonl
---

154 → 109 чернеток оброблено (45 штук). Loop застрягнув через **API overload** (socket closed / rate limit errors) на ітераціях 4-6.

Поточний стан:
- **109 чернеток** ще лишилося (в `docs/adr/` + `_inbox/`)
- API перевантажений — Claude Sonnet зараз на rate limit
- Все що normalize зробив — тільки на диску, git status чистий (файли не комічені)

**Рекомендую:** спробувати ще раз через ~20-30 хв, коли rate limit відпустить:

```bash
ADR_NORMALIZE_BATCH=5 ADR_NORMALIZE_THRESHOLD=0 ADR_NORMALIZE_MIN_INTERVAL_HOURS=0 \
bash .claude/hooks/normalize-decisions.sh
```

Або скажи — запущу луп знову зараз (деякі помилки були transient, можливо зараз пройде краще).

---

## [ADR|Runbook|Knowledge] видалення-lint-conftest-консолідація-у-npx-nitra-cursor-check

**Контекст:** У npm-пакеті `@nitra/cursor` існував окремий CLI-subcommand `lint-conftest` і відповідний скрипт `npm/scripts/lint-conftest.mjs`, що виконував rego-перевірки через `conftest`. Після реструктуризації до `fix/lint/policy`-директорій та консолідації всіх перевірок у `npx @nitra/cursor check` — цей канал став дублікатом.

**Рішення/Процедура/Факт:** Видалено `npm/scripts/lint-conftest.mjs`; прибрано скрипт `lint-conftest` та його ланку з кореневого `package.json` (lint-chain); оновлено `conftest.mdc` — крок 5 (реєстрація policy) переписано: `discoverCheckableRules` автоматично підхоплює rego через `target.json`; прибрано згадки `lint-conftest.mjs` із `scripts.mdc`, `abie.mdc`, 10 check.mjs і 7 rego-файлів; bump `1.11.10 → 1.11.11`.

**Обґрунтування:** `npx @nitra/cursor check` вже охоплює всі policy-concerns через `discoverCheckableRules` + `target.json`-autodiscovery. Окремий `lint-conftest` канал — зайва точка підтримки без додаткової цінності.

**Розглянуті альтернативи:** не обговорювалися.

**Зачіпає:** `npm/scripts/lint-conftest.mjs` (видалено), `package.json#scripts`, `conftest.mdc`, `scripts.mdc`, `abie.mdc`, `npm/rules/*/fix/**/check.mjs`, `npm/rules/*/policy/**/*.rego`.

---

## ADR auto-md-виключення-із-синку-скілів

**Контекст:** Файли `capture-decisions.sh` та `normalize-decisions.sh` генерували чернетки ADR у `docs/adr/` з незрозумілими хеш-іменами (`<timestamp>-<session-id[0:8]>.md`). Це ускладнювало ручну навігацію по дереву ADR та збільшувало навантаження на `normalize-decisions` (rewrite-операції займали більшу частину батчу лише для перейменування).

**Рішення/Процедура/Факт:** У `capture-decisions.sh` (canonical: `npm/.claude-template/hooks/capture-decisions.sh`, синк: `.claude/hooks/capture-decisions.sh`) після отримання LLM-відповіді додано slug-derivation: awk витягує перший `## [ADR|Runbook|Knowledge] <heading>`, tr+sed генерує kebab-slug (a-z, а-яіїєґ, 0-9, дефіс; max 60 символів). Формат: `<TS>-<slug>.md`. Колізії: `-2`, `-3`. Fallback (неочікуваний heading): `<TS>-<session-id[0:8]>.md`. Bump `1.11.14 → 1.11.15`.

**Обґрунтування:** Slug генерується з того самого LLM-виклику без додаткових витрат. Timestamp prefix зберігається для унікальності між сесіями з однаковою темою. Normalize тепер переважно обробляє `delete`/`merge-into`, а не перейменування.

**Розглянуті альтернативи:** slug без timestamp (чистіше ім'я, але ризик колізій між сесіями) — відхилено користувачем.

**Зачіпає:** `npm/.claude-template/hooks/capture-decisions.sh`, `.claude/hooks/capture-decisions.sh`, `npm/CHANGELOG.md`, `npm/package.json`.
