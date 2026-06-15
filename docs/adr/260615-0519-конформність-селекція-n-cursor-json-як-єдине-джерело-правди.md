---
session: 31bcf47f-efb3-4015-bd75-1a07def77614
captured: 2026-06-15T05:19:19+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/31bcf47f-efb3-4015-bd75-1a07def77614.jsonl
---

Все зроблено:
- `main` запушено в origin (`adff7a50..70c36ec7`)
- Worktrees `.feat-tool-surface-rule-adr-exp` і `.main-adr-normal` видалено
- Локальні гілки `feat/tool-surface-rule`, `feat/tool-surface-rule-adr-exp`, `main-adr-normal` видалено

---

## ADR Конформність-селекція: `.n-cursor.json` як єдине джерело правди

## Context and Problem Statement
У системі `npx @nitra/cursor lint --full` конформність-фаза визначала список правил для перевірки через discovery файлів `.cursor/rules/*.mdc` на диску, а не через `.n-cursor.json`. Це призводило до ситуації «enabled-but-no-.mdc → тихо пропущено»: правило, активоване в конфізі, але без свіжого `sync` (= без відповідного `.mdc`), ніколи не потрапляло в конформність-перевірку. Джерело правди для селекції було неявним і залежало від стану файлової системи.

## Considered Options
* **Config-first**: `resolveCheckRuleIds` бере `available ∩ isRuleEnabled(cfg)`, `.cursor/rules/*.mdc` — лише fallback за відсутнього конфіга
* **Дволанцюговий гейт (попередній стан)**: discovery по `.mdc` на Шарі-1 селекції + `isRuleEnabled` на Шарі-2 всередині per-rule `runRuleCli`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Config-first", because `.n-cursor.json` — вже наявний авторитет (через `readNCursorConfigLite`/`isRuleEnabled`), і дводублевий гейт створював silent-failure клас помилок: enabled-правило без `.mdc` тихо зникало з конформності замість того, щоб перевірятися.

### Consequences
* Good, because transcript фіксує очікувану користь: усунено дрейф «enabled-правило без `.mdc` → silently skipped» — `resolveCheckRuleIds` тепер повертає `available ∩ enabled(cfg)` незалежно від стану диска.
* Good, because прибрано дублювання логіки: `isRuleEnabled`-гейт у `runRuleCli` видалено — кожен автоматичний шлях (`lint`, orchestrator, t0, hook) отримує вже відфільтрований список від `resolveCheckRuleIds`.
* Bad, because за відсутнього конфіга (debug/open-by-default) fallback лишається на `.mdc`-discovery — поведінка у двох режимах дещо розходиться.

## More Information
* Змінені файли: `npm/scripts/lib/fix/run-fix-check.mjs` (`resolveCheckRuleIds`), `npm/scripts/lib/run-rule-cli.mjs` (видалено гейт + імпорти), `npm/scripts/lib/tests/run-rule-cli.test.mjs` (переписано під «без гейту»), `npm/scripts/lib/fix/tests/resolve-check-rule-ids.test.mjs` (новий, 7 кейсів).
* Fallback-логіка: коли `cfg.exists === false` → `listProjectRulesMdcFiles` + `discoverCheckRulesFromCursorRules` (поведінка незмінна).
* Changelog: `npm/.changes/260614-2151.md` (`minor`/`Changed`).
* Функцію `resolveCheckRuleIds` експортовано для тестування.
