---
type: ADR
title: T0 changelog-фікс і mkdirSync для fix-конформності
description: Детерміноване створення change-файлу та створення батьківських тек перед записом LLM-патчів прибирають зайві LLM-ескалації й ENOENT.
---

**Status:** Accepted
**Date:** 2026-06-19

## Context and Problem Statement

Escalation-аналітика fix-конформності показала два повторювані дефекти. Порушення changelog «є релевантні зміни, але немає change-файлу» проходило через LLM-драбину, хоча workspace і дія були детерміновані. Окремо `applyChanges` записував файли через `writeFileSync` без створення батьківської теки, тому LLM-патчі для нових шляхів, наприклад `.changes/`, падали з `ENOENT`.

## Considered Options

- Додати T0-патерн у `t0.mjs`, який парсить changelog-violation і викликає `writeChange` без LLM.
- Додати `mkdirSync(dirname(absPath), { recursive: true })` перед `writeFileSync` у `applyChanges`.
- Залишити changelog-violation у LLM-драбині та не створювати батьківські теки перед записом.

## Decision Outcome

Chosen option: "T0-патерн для changelog і `mkdirSync` перед `writeFileSync`", because transcript фіксує, що changelog-violation є детермінованим, а ENOENT при записі нового файлу був реальним багом, знайденим escalation-аналітикою.

### Consequences

- Good, because changelog-violation закривається до LLM-драбини через `writeChange`, без витрати local/cloud викликів.
- Good, because LLM-патчі можуть створювати файли у ще неіснуючих каталогах без `ENOENT`.
- Bad, because T0-патерн фіксує `bump: 'patch'` і `section: 'Changed'`; якщо потрібен інший semver або секція, transcript передбачає ручне редагування change-файлу.
- Neutral, because transcript не містить підтвердження інших негативних наслідків для `mkdirSync`.

## More Information

- `npm/scripts/lib/fix/t0.mjs` — патерн `changelog-create-change-file`, regex для `❌ <ws>: є релевантні зміни, але немає change-файлу`, виклик `writeChange({ bump: 'patch', section: 'Changed', ws, cwd })`.
- `npm/scripts/lib/fix/tests/t0.test.mjs` — тести T0-патерну.
- `npm/scripts/lib/fix/llm-fix-apply.mjs` — додано `mkdirSync(dirname(absPath), { recursive: true })` перед `writeFileSync`.
- Коміт у transcript: `fac8f5b2`.
