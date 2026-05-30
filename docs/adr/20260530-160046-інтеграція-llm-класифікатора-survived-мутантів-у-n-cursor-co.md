---
session: bb3047db-5332-4649-a713-3f1cde68927a
captured: 2026-05-30T16:00:46+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/bb3047db-5332-4649-a713-3f1cde68927a.jsonl
---

---

## ADR Інтеграція LLM-класифікатора survived мутантів у `n-cursor coverage`

## Context and Problem Statement

Команда зафіксувала, що пряма мета «100% mutation score» генерує шум: змушує писати тести для CLI-обгортокgit , тонких spawn-wrappers і «defensive» гілок для impossible state — де coverage не додає реального сигналу. Потрібен механізм розрізнити «killable» мутантів (де тест доречний) від «allowed gaps» (де тест марний або покривається інтеграційно).

## Considered Options

* LLM-класифікатор через Claude API (Sonnet 4.6), що класифікує кожен survived мутант у одну з 5 категорій і виключає non-killable з знаменника score.
* Статичні exclusion-файли (coverage-policy.yaml + `@test-policy` JSDoc).
* Piggybacking на Stryker incremental.json (класифікувати лише нові мутанти).

## Decision Outcome

Chosen option: "LLM-класифікатор через Claude API з file-hash-keyed cache", because команда явно обрала Рівень 3 (LLM-підхід), Sonnet 4.6 з prompt caching, автоматичний виклик у `n-cursor coverage`, threshold=1.1 на старті (нуль активних виключень першого прогону для збору даних).

### Consequences

* Good, because transcript фіксує очікувану користь: mutation score рахується лише по «Killable» мутантах — метрика відображає реальну якість тестів, а не артефакти типу cli-glue.
* Good, because cache по git-blob-hash означає: повторна класифікація не викликає API, якщо файл не змінився.
* Bad, because без `ANTHROPIC_API_KEY` класифікація мовчки скіпається (`console.warn`), а COVERAGE.md показує тільки Raw score без позначки «classify: skipped» в документі.
* Bad, because `runCoverageSteps` передає в `fixSurvivedMutants` повний `allSurvived`, а не відфільтрований — coverage-fix-агент може писати тести для allowed-gaps. Нешкідливо при threshold=1.1, але стане проблемою після зниження порогу.

## More Information

- Spec: `docs/superpowers/specs/2026-05-30-coverage-classify-design.md`
- Plan: `docs/superpowers/plans/2026-05-30-coverage-classify.md`
- Entry point: `npm/scripts/coverage-classify/index.mjs` — `classify(survived, cwd)`
- Зависимості: `@anthropic-ai/sdk ^0.100.1`, `zod ^4.4.3` у `npm/package.json#dependencies`
- Cache: `npm/reports/coverage-classify.cache.json` (gitignored)
- Verdict schema: `npm/scripts/coverage-classify/verdict-schema.mjs` — 5 категорій: `worth-testing`, `equivalent`, `defensive`, `glue`, `wrapper`
- Skip rule: `verdict in {equivalent, defensive, glue, wrapper} AND confidence >= 0.7`; початковий threshold=1.1 (ніщо не виключається) для збору реальних даних
- Graceful fallback: без API key або при SDK error → conservative verdict `worth-testing` з `confidence=0`
- Commits: `20fafef` (orchestrator), `51c8bc3` (integration у runCoverageSteps), `fd5ff34` (apply.mjs), `c06a105` (prompt.mjs), `ce7f206` (cache.mjs), `2769989` (verdict-schema.mjs)
