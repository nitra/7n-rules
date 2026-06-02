---
session: c893caa2-5ff0-49f2-878b-bcb1acbae65e
captured: 2026-06-02T17:14:40+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/c893caa2-5ff0-49f2-878b-bcb1acbae65e.jsonl
---

Читаю вже наявний ADR-файл і порівнюю з транскриптом, щоб не дублювати наявні рішення і виписати лише нове.

Наявний файл фіксує 4 рішення: `detectLevel` word-boundary, `release` інференс `--ws`, `flow review` read-access, coverage-gate Stryker. Транскрипт містить іще одне рішення, якого там нема — **mirror-parity** (`flow-mirror-parity`). Дописую його.

## ADR parity-гард дзеркала `.cursor/rules` ↔ канонічні правила

## Context and Problem Statement
Файли `.cursor/rules/n-<id>.mdc` є дзеркалами канонічних `npm/rules/<id>/<id>.mdc` з inlined-шаблонами. Протягом сесії з'ясувалось, що 5 дзеркал відстали від канонів (changelog v3.1 vs v3.2, npm-module зі старою секцією «Build версія», flow/ga/test без свіжих секцій), і жодного автоматичного механізму виявлення дрейфу не існувало.

## Considered Options
* Parity-тест (CI-гард): перевіряє `inline(канон) == дзеркало`, фейлить на дрейфі; разова регенерація наявних розбіжностей тим самим трансформом
* Легка targeted-resync команда (без побічного синку skills/devDeps)
* Pre-commit hook

## Decision Outcome
Chosen option: "Parity-тест + разова регенерація", because це найменший tooling-обсяг: хелпер `mirror-parity.mjs` повторює той самий трансформ `inlineTemplateLinks(canonical, ruleDir)`, що його застосовує основний `npx @nitra/cursor`-синк; live-гард у тесті (vitest) ловить будь-який наступний дрейф раніше за CI.

### Consequences
* Good, because transcript фіксує очікувану користь: live-гард `findMirrorDrift` дав порожній результат після регенерації; `flow verify` (lint + coverage) пройшов зелено на тому самому прогоні.
* Bad, because orphan-дзеркала (дзеркало є, а канон видалено) гард мовчки ігнорує — `listManagedMirrors` відфільтровує відсутній канон; виявлено під час `flow review` цього ж diff, залишено by-design (видалення orphan-`n-*.mdc` є відповідальністю bare-sync).

## More Information
Нові файли: `npm/scripts/lib/mirror-parity.mjs` (exports `listManagedMirrors`, `expectedMirrorContent`, `findMirrorDrift`), `npm/scripts/lib/tests/mirror-parity.test.mjs` (4 тести: unit-фікстура + live-гард). Регенеровано 5 дзеркал: `n-changelog.mdc`, `n-flow.mdc`, `n-ga.mdc`, `n-npm-module.mdc`, `n-test.mdc`. Гілка `flow-mirror-parity` (`fe5501f`) змерджена у `main` (`2e0c15e`). Трансформ: `inlineTemplateLinks` з `npm/scripts/lib/inline-template-links.mjs`.
