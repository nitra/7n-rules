---
session: d943f92b-e895-4110-8ae0-338380a03c95
captured: 2026-06-06T19:52:27+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d943f92b-e895-4110-8ae0-338380a03c95.jsonl
---

## ADR sym ≥ 4 як поріг маршрутизації Tier 2 у docgen

## Context and Problem Statement
Docgen-конвеєр потребує сигналу для розподілу файлів між локальною моделлю (gemma3:4b) та Claude (Tier 2). Необхідно визначити, яке числове значення кількості внутрішніх символів (`sym`) забезпечує оптимальний баланс між якістю документації та витратами на хмарну обробку.

## Considered Options
* `sym ≥ 4 → cloud` (22% cloud, 78% local; sym=4 дає 90% якості локально)
* `sym ≥ 5 → cloud` (17% cloud, 83% local; sym=4 залишається локальним без захисту)

## Decision Outcome
Chosen option: "`sym ≥ 4 → cloud`", because порівняльний аналіз на реальних файлах проєкту (`commands.mjs` sym=15, `safety.mjs` sym=17, та чотири файли sym=4–7) показав, що критичні семантичні помилки починаються впевнено з sym=5–6 (перевернута логіка версій у `consistency.mjs`, приписування Rego-логіки JS-файлу у `workflows.mjs`), а sym=4 є граничним (90% якості, дрібні фактичні неточності). Заощадження від підйому порогу до 5 становлять ~$0.10–0.15 на повний прогін при реальному ризику непомічених семантичних помилок.

### Consequences
* Good, because 78% файлів (189 із 241) обробляються локально безкоштовно; 22% cloud-файлів (52) покривають саме ті оркестратори і складні модулі, де локальна модель плутає внутрішнє з публічним.
* Bad, because sym=4 файли (k8s-tree.mjs та ін.) відправляються в cloud попри 90% локальну якість — незначна переплата відносно реального ризику.

## More Information
Виміряна кореляція Пірсона: `sym` (внутрішні символи) = −0.651 — найсильніший одиночний предиктор якості доку. Аудит: `~/docgen-bench3/tier_audit.mjs`. Константа у коді: `DEFAULT_SYM_THRESHOLD = 4` у `npm/skills/docgen/js/docgen-gen.mjs:231`. Порівняльний git-репозиторій: `~/docgen-bench3/comparison/`.

---

## ADR Спрощення quality-gate у docgen: лише det-scorer + timeout

## Context and Problem Statement
Після підтвердження порогу `sym ≥ 4` залишалась неузгодженість у схемі для локальних файлів: `sym < 2` проходило без рефері, `sym ∈ [2, 4)` — з Haiku як рефері через `cloudScoreDoc`. Під час сесії схема ітерувалась тричі, завершившись рішенням про повне видалення Haiku.

## Considered Options
* Haiku як рефері для всіх sym < 4 + timeout 5 хв
* Лише det-scorer (0 токенів) + timeout 5 хв → Tier 2

## Decision Outcome
Chosen option: "Лише det-scorer + timeout 5 хв", because Haiku-рефері не є необхідним — детермінований скорер (`scoreDoc()`) ловить ключові структурні проблеми (відсутній `## Огляд`, хибне кешування, короткий `## Поведінка`) при нульових витратах на токени; у реальному прогоні 52 local-файлів мінімальний det-score = 80, жодної ескалації не відбулося, тобто Haiku-шар не додавав практичної цінності.

### Consequences
* Good, because pipeline не робить жодних API-викликів для Tier 1 файлів, поки det-score ≥ 70 і генерація укладається у 5 хвилин; `scoreModel` параметр та `cloudScoreDoc` функція повністю видалені з `docgen-gen.mjs`.
* Bad, because det-scorer не виявляє семантичних помилок (перевернута логіка, хибні інваріанти) — тільки структурні. Transcript не містить підтверджених негативних наслідків для production-якості.

## More Information
Фінальна схема у `npm/skills/docgen/js/docgen-gen.mjs`:
```
sym < 4  → Tier 1 local (timeout LOCAL_TIMEOUT_MS = 5 хв)
→ det-scorer (0 токенів)
→ score < 70 або timeout → Tier 2 claudeOneShot
sym ≥ 4  → Tier 2 одразу (pre-routing)
```
Видалені: `BORDERLINE_SYM_LOW`, `scoreModel`, `scoreCloud`, `cloudScoreDoc` call у `generateDoc`. Timeout реалізований через `withTimeout(promise, LOCAL_TIMEOUT_MS)`.

---

## ADR Розширення DOCGEN_IGNORE_GLOBS: npm/bin/**

## Context and Problem Statement
При аудиті проєкту (`tier_audit.mjs`) виявлено, що `npm/bin/n-cursor.js` (згенерований bundle, sym=34) потрапляє у вибірку для docgen і суттєво перекошує статистику. `npm/reports/**` вже містився у списку виключень, але `npm/bin/**` — ні.

## Considered Options
* Додати `npm/bin/**` до `DOCGEN_IGNORE_GLOBS`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати `npm/bin/**` до `DOCGEN_IGNORE_GLOBS`", because `npm/bin/n-cursor.js` є згенерованим артефактом збірки, а не вихідним кодом — документація на нього безглузда і розміщення її поряд із ним порушувало б принцип "docs/ поряд із джерелом".

### Consequences
* Good, because transcript фіксує очікувану користь: після виключення кількість файлів-кандидатів скоротилась з 938 до 241 (без stryker і bin).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `npm/skills/docgen/js/docgen-ignore.mjs`. Доданий рядок: `'npm/bin/**'` поряд із вже наявним `'npm/reports/**'`. `npm/reports/stryker/.tmp/sandbox-*/` виключені раніше через той самий glob `npm/reports/**`.
