# Parity-гард дзеркала `.cursor/rules` ↔ канонічні правила

**Status:** Accepted
**Date:** 2026-06-02

## Context and Problem Statement

Файли `.cursor/rules/n-<id>.mdc` є дзеркалами канонічних `npm/rules/<id>/<id>.mdc` з inlined-шаблонами. 5 дзеркал відстали від канонів (changelog, flow, ga, npm-module, test), і жодного автоматичного механізму виявлення дрейфу не існувало.

## Considered Options

- Parity-тест у repo-self-suite (vitest) + разова регенерація наявних розбіжностей
- Легка targeted-resync команда (без побічного синку skills/devDeps)
- Pre-commit hook

## Decision Outcome

Chosen option: "Parity-тест у repo-self-suite + разова регенерація", because найменший tooling-обсяг: хелпер `mirror-parity.mjs` повторює той самий трансформ `inlineTemplateLinks(canonical, ruleDir)`, що застосовує `npx @nitra/cursor`-синк; live-гард у vitest ловить наступний дрейф раніше за PR-merge.

### Consequences

- Good, because live-гард `findMirrorDrift` дав порожній результат після регенерації; `flow verify` пройшов зелено.
- Bad, because orphan-дзеркала (дзеркало є, канон видалено) гард мовчки ігнорує — `listManagedMirrors` відфільтровує відсутній канон. By-design: видалення orphan — відповідальність bare-sync.

## More Information

Нові файли: `npm/scripts/lib/mirror-parity.mjs` (exports `listManagedMirrors`, `expectedMirrorContent`, `findMirrorDrift`), `npm/scripts/lib/tests/mirror-parity.test.mjs` (4 тести). Регенеровано 5 дзеркал. Гілка `flow-mirror-parity` (`fe5501f`) → `main` (`2e0c15e`).
