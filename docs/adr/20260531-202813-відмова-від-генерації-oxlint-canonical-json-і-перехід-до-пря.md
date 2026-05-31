---
session: 27bcf8ad-3d79-4564-975c-e30f0be45f1d
captured: 2026-05-31T20:28:13+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/27bcf8ad-3d79-4564-975c-e30f0be45f1d.jsonl
---

## ADR Відмова від генерації `oxlint-canonical.json` і перехід до прямого редагування

## Context and Problem Statement
У репозиторії існував тришаровий пайплайн: `oxlint-canonical-skeleton.json` + `oxlint-rules.tsv` → `rebuild-oxlint-canonical.mjs` → `oxlint-canonical.json`. Виникло питання, чи можна видалити `oxlint-rules.tsv`, оскільки `oxlint-canonical.json` містить ті самі дані. Аналіз показав, що TSV є джерелом генерації (source), а JSON — артефактом. Разом з тим стало очевидно, що від генерації можна відмовитись повністю, зробивши `oxlint-canonical.json` єдиним source-of-truth.

## Considered Options
* Залишити TSV + skeleton як source-of-truth, видаляти тільки зайві дублікати — не розглядалось як окрема опція, але була початкова відповідь асистента («TSV видаляти небезпечно»).
* Відмовитись від генерації: редагувати `oxlint-canonical.json` напряму, видалити весь генераційний пайплайн.

## Decision Outcome
Chosen option: "Відмовитись від генерації: редагувати `oxlint-canonical.json` напряму", because користувач явно обрав цей варіант після того, як асистент описав необхідний скоуп змін («відмовитись від генерації — редагувати `oxlint-canonical.json` напряму як source-of-truth — і разом видалити/переробити `rebuild-oxlint-canonical.mjs` + `oxlint-canonical-skeleton.json`, прибрати entry з `knip.json`»).

### Consequences
* Good, because transcript фіксує очікувану користь: зменшення кількості файлів, що треба підтримувати (TSV + skeleton + скрипт → один JSON); `bun test rules/js-lint/js/tests/tooling.test.mjs` проходить 12/12 після видалення.
* Bad, because transcript не містить підтверджених негативних наслідків. Редагувати JSON з 370+ правилами дещо незручніше, ніж TSV (по одному рядку), але цей компроміс у transcript явно не розглядався як проблема.

## More Information
Видалені файли (через `git rm`):
- `npm/rules/js-lint/js/data/tooling/oxlint-rules.tsv`
- `npm/rules/js-lint/js/data/tooling/oxlint-canonical-skeleton.json`
- `npm/rules/js-lint/lib/rebuild-oxlint-canonical.mjs`

Оновлені файли:
- `knip.json` — прибрано entry `rules/js-lint/lib/rebuild-oxlint-canonical.mjs`
- `.v8rignore` — прибрано рядок `oxlint-canonical-skeleton.json` (поточний шлях) та мертві рядки `npm/scripts/utils/{knip,oxlint-canonical-skeleton,oxlint-canonical}.json` і `npm/scripts/utils/__fixtures__/**`
- `npm/rules/js-lint/js-lint.mdc` + `.cursor/rules/n-js-lint.mdc` — прибрано опис генерації, виправлено застарілий шлях `js/tooling/` → `js/data/tooling/`, версія `1.26 → 1.27`

Change-файл: `npm/.changes/1780241234497-9b8327.md` (patch / Changed).

---

## ADR Мінімальна версія `@nitra/eslint-config` підвищена до `3.10.0`

## Context and Problem Statement
Правило `js-lint.mdc` вимагало мінімум `@nitra/eslint-config >= 3.9.2`. До канону `oxlint-canonical.json` додано нові правила плагіну `e18e` (зокрема `e18e/prefer-array-fill`, `e18e/prefer-date-now` та інші — загалом список збільшився на ~13 правил). Для сумісності з розширеним каноном мінімальна вимога підвищена.

## Considered Options
Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Підняти мінімум до `3.10.0`", because користувач прямо вказав: «постав мінімальну версію eslint config 3.10.0», а `3.10.0` підтверджено як `latest` на реєстрі (`npm view @nitra/eslint-config dist-tags → { latest: '3.10.0' }`).

### Consequences
* Good, because transcript фіксує очікувану користь: Rego `opa test` → 7/7 pass після зміни semver-логіки; кореневий `package.json` оновлено до `^3.10.0`, `bun install` встановив `@nitra/eslint-config@3.10.0`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Semver-перевірка у Rego замінена: три клаузи для `>= 3.9.2` (major > 3 / major == 3 && minor > 9 / major == 3 && minor == 9 && patch >= 2) → дві клаузи для `>= 3.10.0` (major > 3 / major == 3 && minor >= 10).

Файли, де змінено межу:
- `npm/rules/js-lint/policy/package_json/package_json.rego` — enforcement + коментарі + deny-повідомлення
- `npm/rules/js-lint/policy/package_json/package_json_test.rego` — valid-фікстура `^3.9.2 → ^3.10.0`; межовий too-old кейс `^3.5.0 → ^3.9.9`
- `npm/rules/js-lint/js/tooling.mjs` — коментар `≥ 3.9.2 → ≥ 3.10.0`
- `npm/rules/js-lint/js-lint.mdc` + `.cursor/rules/n-js-lint.mdc` — текст мінімуму та приклад `package.json`, версія `1.26 → 1.27`
- `package.json` (кореневий) — `^3.9.4 → ^3.10.0`, `bun.lock` оновлено

Change-файл: `npm/.changes/1780248426182-7741d0.md` (minor / Changed).
