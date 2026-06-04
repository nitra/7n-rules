# Мінімальна версія `@nitra/eslint-config` 3.10.0 — поріг у snippet-шаблоні

**Status:** Accepted
**Date:** 2026-05-31

## Context and Problem Statement

Мінімально допустима версія `@nitra/eslint-config` (`>= 3.9.2`) була захардкоджена у трьох клаузах Rego і дублювалась у коментарях, `deny`-повідомленнях та тексті обох `.mdc`-копій. Бамп порогу вимагав синхронних правок у ≥5 файлах і ризикував drift-ом.

## Considered Options

* Замінити магічні числа в Rego (`3.9.2 → 3.10.0`) — без усунення дублювання
* Винести поріг у `template/package.json.snippet.json`; Rego читає звідти; `.mdc` посилається на snippet

## Decision Outcome

Chosen option: "Винести поріг у snippet", because snippet вже є canonical template для `type`/`lint-js`; додавання `devDependencies` усуває дублювання поміж Rego, повідомленнями і документацією.

### Consequences

* Good, because наступний бамп — зміна одного значення в snippet; Rego та `.mdc` підхоплюють автоматично.
* Good, because рефакторинг Rego усунув `var-shadows-builtin`, `defer-assignment`, `messy-rule`; `regal lint` → 0 порушень.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- `template/package.json.snippet.json` — додано `"devDependencies": { "@nitra/eslint-config": "^3.10.0" }`
- `package_json.rego` — `eslint_min_range` читається зі snippet; узагальнений `semver_gte(actual, min_parts)` замінив три клаузи
- `package_json_test.rego` — тест `test_eslint_floor_driven_by_snippet`
- Кореневий `package.json` `^3.9.4 → ^3.10.0`; `bun install` встановив `@nitra/eslint-config@3.10.0`
- `.mdc` v1.28: літерал замінено посиланням на snippet
- `opa test` → 8/8; `regal lint` → 0; `opa fmt` чисто
- Change-файл: `npm/.changes/1780248426182-7741d0.md` (minor / Changed)
