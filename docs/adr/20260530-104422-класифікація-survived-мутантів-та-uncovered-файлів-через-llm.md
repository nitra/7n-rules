---
session: bb3047db-5332-4649-a713-3f1cde68927a
captured: 2026-05-30T10:44:22+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/bb3047db-5332-4649-a713-3f1cde68927a.jsonl
---

Spec записаний і закомічений у `c1d0980`. Будь ласка, перегляньте:

**`docs/superpowers/specs/2026-05-30-llm-coverage-classifier-design.md`**

Якщо є правки — скажіть, і я оновлю. Якщо все ок — перейдемо до implementation plan (skill `writing-plans`).

---

## ADR: Класифікація survived мутантів та uncovered-файлів через LLM

## Context and Problem Statement
`n-cursor coverage` публікував raw mutation score, що штовхало до «100%-покриття» і змушувало писати тести на spawn-обгортки, CLI glue та еквівалентні мутанти, де unit-тест не додає сигналу. Потрібен механізм, який відрізняє «Killable» від «Allowed gaps» без ручних виключень.

## Considered Options
* LLM-класифікатор (Claude Sonnet 4.6) — окремий модуль, автоматично викликається у кожному `n-cursor coverage`, кешується за git-blob-hash.
* Статичні exclusion-списки в `stryker.config.mjs` або `coverage-policy.yaml` — ручне ведення без reasoning.
* JSDoc-мітки `@test-policy: glue` в source-файлах — локалізовані, але не містять обґрунтування і не підходять для uncovered-files.

## Decision Outcome
Chosen option: "LLM-класифікатор (claude-sonnet-4-6)", because він може аналізувати контекст (±10 рядків, наявні тести, git-вік файлу) і повертати структурований verdict з обґрунтуванням — не можна досягти статичними списками без значної ручної роботи.

### Consequences
* Good, because `Killable score` замість raw прибирає тиск на «100%» і залишає тільки мутанти, де тест реально валідний.
* Good, because кеш за git-blob-hash означає що re-classify виконується тільки при зміні коду, а не при кожному запуску.
* Bad, because вимагає `ANTHROPIC_API_KEY` — без нього classify-секція мовчки пропускається, і COVERAGE.md публікується без Killable Score.

## More Information
- Spec: `docs/superpowers/specs/2026-05-30-llm-coverage-classifier-design.md`
- Модуль: `npm/scripts/coverage-classify/` (index, prompt, cache, verdict-schema, apply).
- Trigger: автоматично у `npm/rules/test/coverage/coverage.mjs` якщо `process.env.ANTHROPIC_API_KEY` задано.
- Cache: `npm/reports/coverage-classify.cache.json` (gitignored), version-keyed, format v1.
- Skip rule: `verdict ∈ [equivalent, defensive, glue, wrapper] AND confidence ≥ 0.7`.
- API: `claude-sonnet-4-6`, `max_tokens: 1024`, system prompt із `cache_control: { type: 'ephemeral' }`.
