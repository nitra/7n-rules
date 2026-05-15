---
date: 2026-05-15
topic: concern-based JS + per-policy target.json
spec: docs/superpowers/specs/2026-05-15-npm-rules-concern-and-target-design.md
---

# ADR: concern-based JS + per-policy `target.json`

## Контекст

Після фази 1-4 реструктуризації (див. `docs/superpowers/specs/2026-05-14-npm-rules-restructure-design.md`) кожне правило живе у `npm/rules/<id>/` з одним `js/check.mjs` і `policy/<name>/<name>.rego`. Два болі:

- Один JS-файл на правило змушує тримати все в одному модулі (`abie/js/check.mjs` = 1153 рядки).
- Targeting rego-полісі розмазаний між `js/check.mjs` (виклики `runConftestBatch({ files })`) і централізованим `lint-conftest.mjs:TARGETS`. Pure-rego правило без JS-обгортки CLI не побачить (discoverCheckScripts фільтрує по `js/check.mjs`).

## Рішення

1. **Concern-based JS:** `rules/<id>/js/<concern>/check*.mjs`. Discovery читає підкаталоги `js/`, фільтрує `check*.mjs`, пропускає `*.test.mjs` і `utils/`.
2. **`target.json` per-policy:** `rules/<id>/policy/<name>/target.json` декларує `files.single` або `files.walkGlob`. CLI читає й передає у `runConftestBatch` — JS не дублює виклик.
3. **`applies()` в JS:** rule-level gate — опційний named export з `js/applies/check.mjs`. Повертає false → CLI пропускає все правило.
4. **`utils/` на двох рівнях:** `npm/scripts/utils/` (глобально), `npm/rules/<id>/utils/` (per-rule).
5. **Симетрія `js/<name>/` ↔ `policy/<name>/`:** одне ім'я — один концерн (pure-rego / pure-js / hybrid).
6. **Picomatch** як glob-парсер (1 dep, RegExp-compiled, найдешевший).

## Альтернативи, які відкинули

- **`rule.json` per-rule** замість `target.json` per-policy: централізує decl, але втрачає locality (полісі і її таргет розводяться).
- **Convention-only без декларації** (feed-all-yaml, нехай rego гейтить через `input.kind`): обмежує rego до kind-based полісі, ламає на безкіндових файлах (`.cspell.json`, `.oxfmtrc.json`).
- **Окремий `rule.json:applies`**: дублює функціональність JS, який і так часто потрібен; «inline в JS» прийнятно.

## Прийняті дрібніші питання

- **Legacy-fallback** для не мігрованих правил під час переходу: без іменування концерну. Discovery бачить `js/check.mjs` напряму, runner викликає окремою гілкою.
- **`required: true` для `walkGlob`**: заборонено в schema. Conditional «має бути файл» — через `applies()`.
- **`conftest.combine` у schema**: прибрано, додамо при першому юзкейсі.

## Наслідки

- CLI отримує дві нові утиліти у `npm/scripts/utils/`: `resolve-target-files.mjs`, `discover-checkable-rules.mjs`, `run-rule.mjs`.
- `picomatch@^4` додається у `dependencies` пакета `@nitra/cursor`.
- `lint-conftest.mjs:TARGETS` стає похідною від `target.json`-файлів — буде переписано після завершення міграції правил.
- Міграція інкрементальна, по одному правилу; legacy-гілка discovery прибирається після останнього.

## Деталі реалізації

Повна специфікація, контракти, JSON Schema, порядок міграції 7 кроків — у `docs/superpowers/specs/2026-05-15-npm-rules-concern-and-target-design.md`.

## Стан

В реалізації. Пілот — `rules/rego/` (3 канонічні полісі + `applies()` через `projectHasRegoFiles`).
