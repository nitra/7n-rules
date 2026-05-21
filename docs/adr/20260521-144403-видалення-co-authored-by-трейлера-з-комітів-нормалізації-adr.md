---
session: ea881c04-dcf0-4753-a405-2366550a0911
captured: 2026-05-21T14:44:03+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/ea881c04-dcf0-4753-a405-2366550a0911.jsonl
---

## ADR Видалення `Co-Authored-By` трейлера з комітів нормалізації ADR

## Context and Problem Statement
Під час покрокового комітування батчів нормалізації ADR Claude Code auto-mode classifier заблокував коміт із трейлером `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` з причиною "Content Integrity / Impersonation" — рядок хибно приписує авторство конкретній версії моделі.

## Considered Options
* Залишити `Co-Authored-By` у форматі `Claude Opus 4.7`
* Закомітити без `Co-Authored-By`-трейлера

## Decision Outcome
Chosen option: "Закомітити без `Co-Authored-By`-трейлера", because auto-mode classifier явно відхилив трейлер із посиланням на назву моделі як impersonation, і блокування треба було обійти без зміни правил безпеки.

### Consequences
* Good, because transcript фіксує очікувану користь: коміти проходять без порушення Content Integrity-правил.
* Bad, because авторство LLM-агента в git-history більше не фіксується явно.

## More Information
Заблокований коміт: `git commit -m "adr: normalize batch\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"`. Успішний коміт: `git commit -q -m "adr: normalize batch"`. Перший успішний коміт після виправлення — `bb28aaf`.

---

## ADR Покроковий коміт батчів нормалізації ADR

## Context and Problem Statement
При ручному запуску `/n-adr-normalize` скрипт `normalize-decisions.sh` обробляє по 10 найстаріших чернеток за один виклик. Потрібно було вирішити, коли робити `git commit` — після кожного батчу чи після повної обробки всіх чернеток.

## Considered Options
* Закомітити після кожного батчу й продовжувати до вичерпання чернеток
* Закомітити всі батчі одним комітом у кінці

## Decision Outcome
Chosen option: "Закомітити після кожного батчу й продовжувати", because користувач явно обрав "Закомітити й продовжити" в підтверджувальному діалозі після першого батчу, і цей підхід застосовувався послідовно для батчів 1–7.

### Consequences
* Good, because transcript фіксує очікувану користь: кожен батч атомарно зафіксовано (`7c62d53`, `c45b8c9`, `f3ddb9e`, `bb28aaf`, `d03d00d`, `0ddee21`, `dfaaa87`), що дозволяє відкатити окремий батч без втрати решти.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Скрипт: `.claude/hooks/normalize-decisions.sh`. Журнал: `.claude/hooks/normalize-decisions.log`. Розмір батчу визначається змінною `ADR_NORMALIZE_THRESHOLD`; для ручного запуску використовувалось `ADR_NORMALIZE_THRESHOLD=0 ADR_NORMALIZE_MIN_INTERVAL_HOURS=0`. За 7 батчів оброблено ~60 чернеток (з 66 початкових), залишилось 17.
