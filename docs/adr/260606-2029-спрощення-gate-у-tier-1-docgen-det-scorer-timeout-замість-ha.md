---
session: d943f92b-e895-4110-8ae0-338380a03c95
captured: 2026-06-06T20:29:28+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d943f92b-e895-4110-8ae0-338380a03c95.jsonl
---

## ADR спрощення gate-у Tier 1 docgen: det-scorer + timeout замість Haiku-рефері

## Context and Problem Statement

У двотировому docgen-pipeline (`docgen-gen.mjs`) local-файли (sym < 4) після генерації через gemma3:4b проходили через `cloudScoreDoc` — Claude Haiku як зовнішній рефері якості. При score < 70 файл ескалювався до Tier 2 (Claude Sonnet). Це означало мінімум два API-виклики на кожен local-файл, навіть коли Haiku жодного разу не тригерив ескалацію у реальному прогоні проєкту (52 файли, мінімальний score = 80).

## Considered Options

* Залишити Haiku як рефері якості для всіх sym < 4 файлів
* Замінити Haiku на детермінований скорер (`scoreDoc`, 0 токенів) + hard timeout 5 хв → ескалація до Tier 2

## Decision Outcome

Chosen option: "Замінити Haiku на det-scorer + timeout", because у реальному прогоні 52 local-файлів Haiku жодного разу не тригерив ескалацію (мінімум 80, поріг 70), тобто кожен Haiku-виклик був зайвим; det-scorer безкоштовно ловить ті структурні дефекти, які реально зустрічаються (відсутній `## Огляд`, хибні гарантії кешування, короткий `## Поведінка`). Семантичні помилки на sym < 4 файлах у transcript підтверджені як рідкісні і некритичні.

### Consequences

* Good, because усунуто API-виклик Haiku на кожен local-файл — нульова вартість det-scorer замість ~$0.001–0.002 × N файлів.
* Good, because публічний API `generateDoc` спрощено: прибрані параметри `scoreModel`, `threshold`, `scoreCloud`; CLI більше не приймає `--score-model` та `--score-cloud`.
* Bad, because det-scorer не виявляє семантичних помилок — transcript явно зафіксував: `workflows.mjs` (sym=6) отримав det-score=100 при семантично зламаному документі (хибні інваріанти, internal → public плутанина). Для sym < 4 такі помилки рідкісні, але захист зменшився.

## More Information

Файл: `npm/skills/docgen/js/docgen-gen.mjs`.
Нова схема: `sym < 4` → Tier 1 gemma3:4b + `scoreDoc` → `detScore < 70` або `timeout > 300 000 ms` → `claudeOneShot` (Tier 2, `escalated: true`); `sym ≥ 4` → `claudeOneShot` одразу (`preRouted: true`).
Прибрані: функція `cloudScoreDoc`, параметри `scoreModel`/`threshold`/`scoreCloud`, CLI-прапори `--score-model`/`--score-cloud`.
Додано: `LOCAL_TIMEOUT_MS = 5 * 60 * 1000`, `timeoutReject(ms)`, `withTimeout(p, ms)` — helper-и для hard timeout локальної генерації.
