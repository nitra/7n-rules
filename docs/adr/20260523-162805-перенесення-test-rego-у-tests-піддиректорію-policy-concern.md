---
session: bcdba371-cfb8-46ab-a284-8869588499a7
captured: 2026-05-23T16:28:05+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/bcdba371-cfb8-46ab-a284-8869588499a7.jsonl
---

11/12 — та сама pre-existing `with-lock` issue. Готово.

## Підсумок цієї ітерації

**1. `*_test.rego` → `policy/<concern>/tests/`** (69 файлів, bulk `git mv`). Нова структура для кожного concern:
```
policy/package_json/
├── package_json.rego
├── target.json
└── tests/
└── package_json_test.rego
```
Жодних змін у самих `.rego` файлах не потрібно — Rego використовує `package`-декларації, а не файлові шляхи. Conftest `-p <dir>` рекурсивний, тому `conftest verify` і `conftest test` знаходять тести автоматично.

**2. `rules/test/fix/location/check.mjs`** — розширено: `isTestFile` тепер перевіряє і `_test.rego` суфікс. `npx @nitra/cursor check test` охоплює 146 файлів (77 JS + 69 Rego).

**3. `rules/test/test.mdc`** — оновлено опис: додано приклад `policy/<concern>/tests/` структури, `*_test.rego` у списку конвенції та `package.json#files` exclusion.

**CHANGELOG** `[1.13.82]` + version bump `1.13.81 → 1.13.82`.

**Верифікація:** `bun test` → 843 pass / 2 fail (pre-existing); `npx @nitra/cursor check test` → ✅ Всі 146 тестових файлів у `tests/`.

---

## ADR Перенесення `*_test.rego` у `tests/` піддиректорію policy-concern

## Context and Problem Statement
У пакеті `@nitra/cursor` Rego unit-тести (`*_test.rego`) лежали поряд із правилом у `policy/<concern>/`, тоді як JS-тести вже мігрували у `tests/` піддиректорії. Конвенція відрізнялась залежно від типу тесту.

## Considered Options
* Перемістити `*_test.rego` у `policy/<concern>/tests/` (симетрія з JS).
* Залишити `*_test.rego` поряд із `.rego` (OPA/conftest community-конвенція).

## Decision Outcome
Chosen option: "Перемістити у `policy/<concern>/tests/`", because симетрія з JS-конвенцією (`tests/` завжди) важливіша за слідування зовнішній community-нормі; conftest `-p <dir>` рекурсивний, тому поведінка не змінюється.

### Consequences
* Good, because єдина конвенція для всіх типів тестів; `npx @nitra/cursor check test` охоплює 77 JS + 69 Rego.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Bulk move: 69 файлів, `git mv`. Правило-канон: `npm/rules/test/fix/location/check.mjs`. conftest calls використовують `-p npm/rules` або `-p <concernDir>` — обидва рекурсивні.
