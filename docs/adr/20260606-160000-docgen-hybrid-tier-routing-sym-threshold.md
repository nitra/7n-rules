---
type: ADR
title: ""
---

## ADR Hybrid docgen routing: sym-threshold як детермінований tier-сигнал

## Context and Problem Statement
Пайплайн генерації документації використовував єдиний режим — локальну модель (gemma3:4b) для всіх файлів. Для складних файлів (sym ≥ 4) локальна генерація давала 50–67% якості і займала 14+ хвилин, що унеможливлювало масштабування. Потрібен автоматичний механізм routing без LLM-скорингу.

## Considered Options
* Підхід A — детермінований скоринг по `facts`: перевірка cache-hallucination, витоків internal-names, довжини секцій
* Підхід B — LLM-суддя: локальна модель оцінює власний вивід за 4 критеріями (0–10)
* Підхід C — складність файлу (`facts.internalSymbols.length`) як proxy-сигнал для routing

## Decision Outcome
Chosen option: "Підхід C — sym ≥ 4 → Tier 2 (cloud), sym < 4 → Tier 1 (local)", because Pearson-кореляція між `internalSymbols.length` та якістю документу становить −0.651 — найсильніший сигнал серед усіх метрик; перевірка займає 0 токенів і <1 ms.

### Consequences
* Good, because 78% файлів проєкту (189 з 241, без stryker-сендбоксів та bundle) залишаються у безкоштовному tier 1; 22% (52 файли) маршрутизуються у cloud (~$1.5 на весь проєкт одноразово).
* Good, because детермінована перевірка не залежить від стохастичності моделі — routing повністю відтворюваний при будь-якому запуску.
* Good, because Підхід A (після виправлення false-positives) показав зсув +35 пп від ручної оцінки — гірше за B (+25 пп); Підхід B показав систематичне завищення оцінки власного виводу.
* Bad, because sym=3 залишається у tier 1 попри можливу 50%-якість (зафіксовано на `npm/rules/ga/fix.mjs`): borderline-зона не покрита автоматично.

## More Information
Реалізовано у `npm/skills/docgen/js/docgen-gen.mjs`: константа `DEFAULT_SYM_THRESHOLD = 4`, умова `if (complexity >= symThreshold && env.ANTHROPIC_API_KEY)` → `claudeOneShot()`. Прапор `--tier-only` для аудиту без генерації. Аудит проєкту: `node ~/docgen-bench3/tier_audit.mjs`. Розподіл sym (241 файл): sym=0–3 → 78%, sym=4+ → 22%. Дослідження кореляції: `~/docgen-bench3/complexity.mjs`. Коефіцієнти кореляції: sym −0.651, imp −0.585, exp +0.384, combo −0.287.
