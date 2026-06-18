---
type: ADR
title: "Per-rule `fix.mjs` entry-point та rename `fix/` → `js/`"
---

# Per-rule `fix.mjs` entry-point та rename `fix/` → `js/`

**Status:** Accepted
**Date:** 2026-05-23

## Context and Problem Statement

У пакеті `@nitra/cursor` кожне правило `npm/rules/<id>/` реалізовувало JS-концерни у підкаталозі `fix/<concern>/check.mjs`. CLI `check` запускав правила централізовано через `discoverCheckableRules()` + `runRule()` — без стабільного entry-point на рівні правила. Це унеможливлювало запуск правила напряму (`bun rules/<id>/fix.mjs`), налагодження через IDE Run button та CI per-rule matrix jobs. Додатково назва `fix/` відображала функцію, а не технологію — на відміну від сусіднього `policy/` для Rego.

## Considered Options

- **Варіант A — Shim:** `<id>/fix.mjs` делегує `runStandardRule`; CLI лишається авторитативним (convention-based discovery + центральний `runRule`).
- **Варіант B — Per-rule entry з повною IoC:** CLI перебирає каталоги та dynamic-import'ує `<id>/fix.mjs`; правило саме вирішує оркестрацію через `runStandardRule`.
- **Варіант C — Hybrid з fallback:** CLI спочатку перевіряє наявність `<id>/fix.mjs`, інакше fallback на convention-discovery.
- Rename `fix/` → `js/` або зберегти поточну назву.
- walkCache: передавати `Map` як параметр через call stack або module-singleton.

## Decision Outcome

Chosen option: "Варіант B (per-rule entry з повною IoC) + rename `fix/` → `js/` + module-singleton walkCache", because Варіант B дозволяє запускати правило напряму і через CLI; rename на `js/` усуває колізію імен між каталогом concerns і entry-point файлом `fix.mjs` та узгоджує семантику з `policy/` (розподіл за технологією); module-singleton walkCache усуває потребу прокидати `Map` через 3 рівні й ізолює стан між тестами через `resetWalkCache()`.

### Consequences

- Good, because `bun npm/rules/<id>/fix.mjs` і `npx @nitra/cursor check <id>` дають ідентичний результат; smoke-тест `fix-mjs-contract.test.mjs` верифікує контракт 91 кейсом (1 sanity + 30×3); 948 тестів без регресій.
- Good, because структура `js/ | policy/` симетрична; CLI спростився до `listRuleIds + dynamic import + mod.run({walkCache})`.
- Good, because `resetWalkCache()` у `beforeEach` гарантує ізоляцію між тестами; 4 тест-кейси `walk-cache.test.mjs` зелені.
- Bad, because 30 файлів `fix.mjs` ідентичні між собою; Mandatory IoC — атомарна міграція 30 правил без перехідного fallback.
- Bad, because тести з літеральними шляхами `rules/<id>/fix/<concern>/` потребували оновлення після rename.

## More Information

Нові утиліти: `npm/scripts/utils/run-standard-rule.mjs`, `npm/scripts/utils/list-rule-ids.mjs`, `npm/scripts/utils/walk-cache.mjs` (API: `getOrCreateWalkCache(): Map<string, Promise<string[]>>` / `resetWalkCache(): void`). Шаблон `fix.mjs` (11 рядків): `import { runStandardRule } from '../../scripts/utils/run-standard-rule.mjs'; export async function run(ctx) { return runStandardRule(import.meta.dirname, ctx) }`. Rename: `git mv npm/rules/<id>/fix npm/rules/<id>/js` для 27 правил (3 правила — `ci4`, `efes`, `feedback` — `fix/` не мали); залишкові посилання у `.rego`, `.mdc`, `scripts/`, `tests/` оновлено через `perl -i.bak -pe`. Smoke-тест: `npm/tests/fix-mjs-contract.test.mjs`. Spec: `docs/superpowers/specs/2026-05-23-per-rule-fix-mjs-entry-point-design.md`. PR: https://github.com/nitra-labs/cursor/pull/196. Версія: `1.13.82` → `1.13.83`.

## Update 2026-05-23

Реалізація завершена. Нові util-файли: `npm/scripts/utils/walk-cache.mjs`, `npm/scripts/utils/list-rule-ids.mjs`, `npm/scripts/utils/run-standard-rule.mjs`. `discoverOneRule` виокремлено з `discover-checkable-rules.mjs`. 30 `rules/<id>/fix.mjs` згенеровано однаковим template (11 рядків). CLI `check`-команда замінена на `listRuleIds + dynamic import`. Smoke-тест `npm/tests/fix-mjs-contract.test.mjs` (91 кейс). CHANGELOG: `npm` v1.13.83. 104 нових тестових кейси, 0 регресій.

## Update 2026-05-23

Деталі реалізації rename та dual-mode. `git mv fix/ → js/` для 89 файлів у 27 правилах (`ci4`, `efes`, `feedback` не мали `fix/`; коміт `3d12000`). `if (import.meta.main)` блок у `fix.mjs` → `runRuleCli(import.meta.dirname)`: lite-config reader `.n-cursor.json` + whitelist-check + progress summary; нові утиліти: `read-n-cursor-config-lite.mjs`, `run-rule-cli.mjs`; коміт `928abb5`. CLI `case 'fix'` — spawn-wrapper до `rules/<id>/fix.mjs`; `case 'check'` — deprecated alias з попередженням. Усі публічні посилання `npx @nitra/cursor check` у `.mdc`, `.rego`, `README.md`, `AGENTS.md`-template, `skills/` замінено на `fix`. Контракт `fix.mjs`: `export async function run(ctx?: RuleContext): Promise<number>`.

## Update 2026-05-23

Уточнення меж перейменування `check` → `fix`. Внутрішні `check-<rule>.mjs`-скрипти (`npm/rules/*/js/*/check.mjs`) та їх роль у `conftest.mdc` (`check-<rule>.mjs` як фінальний крок у `lint-<rule>.mjs`) — не перейменовуються; це самостійна концепція внутрішнього детермінованого кроку. Зовнішні посилання, що потребують оновлення після rename: `npm/bin/n-cursor.js` JSDoc, `.claude/settings.json` permission `"Bash(npx @nitra/cursor check)"`, `npm/scripts/claude-stop-hook.mjs`, `.claude/commands/n-check.md`.
