---
session: d943f92b-e895-4110-8ae0-338380a03c95
captured: 2026-06-06T20:27:07+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d943f92b-e895-4110-8ae0-338380a03c95.jsonl
---

## ADR sym ≥ 4 як поріг двотирового routing у docgen

## Context and Problem Statement
Локальна модель (`gemma3:4b`) обробляє прості файли добре, але на складних видає семантичні помилки (тавтологічні гарантії, хибні інваріанти, плутанину internal/public). Потрібно визначити єдиний числовий сигнал і поріг для автоматичного вибору між локальним і хмарним тиром генерації документації.

## Considered Options
* `sym ≥ 3` → cloud (103 файли хмарою, 43%)
* `sym ≥ 4` → cloud (52 файли хмарою, 22%)
* `sym ≥ 5` → cloud (40 файлів хмарою, 17%)
* `exp` (кількість exports) як основний сигнал
* `imp` (внутрішні імпорти) як основний сигнал

## Decision Outcome
Chosen option: "`sym ≥ 4` → cloud", because benchmark на 8 файлах показав Pearson r=−0.651 для `sym` (найсильніший сигнал); `exp` має позитивну кореляцію (+0.384) — файли з багатьма публічними функціями локальна модель обробляє добре; на реальних файлах sym=4 (k8s-tree.mjs, score 90%) є граничним але прийнятним для local, тоді як sym=5+ (lint.mjs score 80% із семантичними помилками) і sym=6–7 (workflows.mjs score "100" за детермінованим скорером, але з критичними помилками: хибне кешування, internal→public плутанина, false invariants) вимагають хмари.

### Consequences
* Good, because transcript фіксує очікувану користь: 78% файлів (189/241 у проєкті) обробляються локально безкоштовно; cloud-порція ~$1.5–2 на повний проєкт; розподіл підтверджено `tier_audit.mjs` на реальному кодобазі (без stryker-сендбоксів і `npm/bin`).
* Bad, because sym=4 є borderline (90% якості), і 12 таких файлів могли б іти у cloud для вищої точності — обрано консервативний вибір на користь економії ресурсів.

## More Information
- `npm/skills/docgen/js/docgen-gen.mjs`: `const DEFAULT_SYM_THRESHOLD = 4` (рядок 231)
- `~/docgen-bench3/tier_audit.mjs`: скрипт аудиту з фільтрацією `SKIP_PATH_PREFIXES = ['npm/reports', 'npm/bin']`
- `~/docgen-bench3/complexity.mjs`: функція `complexityScore`, кореляційний аналіз Pearson
- `~/docgen-bench3/comparison/`: git-репо з cloud (base) і local (working tree) для `commands.mjs` (sym=15) та `safety.mjs` (sym=17)

---

## ADR Спрощення quality gate — прибрати Haiku-рефері, залишити det-scorer + timeout

## Context and Problem Statement
Попередня схема мала три зони: `sym < 2` (тільки det-scorer), `sym ∈ [2, 4)` (local + Haiku як рефері), `sym ≥ 4` (cloud). Haiku-рефері додавав API-виклик і latency для borderline файлів. За даними прогону 52 local-файлів жодна ескалація не спрацювала (мінімальний score = 80, поріг = 70), тому складність схеми не виправдана.

## Considered Options
* Залишити Haiku як рефері для всіх `sym < 4`
* Прибрати Haiku, залишити тільки det-scorer (0 токенів) + 5-хвилинний timeout → ескалація у Tier 2
* Прибрати det-scorer, залишити тільки "не порожня" як gate

## Decision Outcome
Chosen option: "прибрати Haiku, залишити det-scorer + 5-хв timeout", because Haiku ніколи не спрацьовував на реальних даних (score ніколи не опускався нижче 70 для `sym < 4`); det-scorer коштує 0 токенів і ловить структурні помилки (відсутній `## Огляд`, хибне кешування, короткий `## Поведінка`); "не порожня" відхилено — не ловить семантичних помилок; timeout додано як safety net проти зависання ollama.

### Consequences
* Good, because transcript фіксує очікувану користь: нульова вартість gate (немає Haiku API-викликів), менша latency для local tier, спрощена логіка в `docgen-gen.mjs` — `scoreModel` параметр і `BORDERLINE_SYM_LOW` константа повністю видалені.
* Bad, because для гіпотетичного складного `sym < 4` файлу, де det-scorer дає хибний false negative (score ≥ 70 але документ семантично неправильний), Haiku більше не виправить ситуацію; transcript не містить підтверджених прикладів такого сценарію.

## More Information
- `npm/skills/docgen/js/docgen-gen.mjs`: `const LOCAL_TIMEOUT_MS = 5 * 60 * 1000` (додано); функції `cloudScoreDoc`, `scoreModel`, `BORDERLINE_SYM_LOW` — видалено; commit `668d1877`
- Фінальна схема в коді: `sym < 4` → `withTimeout(generateOrchestrated|generateOneShot, LOCAL_TIMEOUT_MS)` → `scoreDoc()` → при score < 70 або timeout → `claudeOneShot(cloudModel)`; `sym ≥ 4` → `claudeOneShot(cloudModel)` одразу
