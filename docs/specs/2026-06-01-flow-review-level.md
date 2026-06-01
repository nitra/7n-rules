---
kind: nitra-spec
status: draft
adr: null
plan: null
---

# flow review (adversarial) + scale-adaptive level — дизайн

Дата: 2026-06-01
Власник: @vitaliytv
Статус: Draft (очікує апруву)

## Мета

Закрити дві найцінніші діри, виявлені аналізом BMAD, у термінах нашого
Пасивного Турнікета (Sovereign, без залежності від BMAD/superpowers):

1. **`flow review`** — adversarial-перевірка коду ПІСЛЯ написання: незалежний
   субагент читає лише `git diff base_commit` і шукає логічні баги/ризики, яких
   не ловлять механічні гейти (`verify` = lint+coverage). Findings пишуться у
   стан, людина вирішує fix/skip.
2. **scale-adaptive `level`** — `flow init` визначає рівень складності задачі
   (0–3) за описом і записує його в стан; рівень right-size'ить, скільки
   adversarial-рецензентів спавнить `flow review`, і які фази рекомендовані
   (контракт). Знімає надмірну церемонію з дрібних задач.

## Передісторія

`verify` дає булевий вердикт за механічними гейтами. BMAD quick-dev показує цінність
ланцюга `self-check → adversarial-review → resolve-findings`. У нас уже є вся
інфраструктура: `subagent-runner` (`createRunner`), `base_commit` у стані,
патерн панелі (`plan-panel.mjs`), `recordTransition`. `flow review` — природне
перевикористання цього.

## Scope

**In:**
- `flow review` — нова підкоманда Фасада A: diff від `base_commit`, спавн
  adversarial-рецензента(ів), запис `review` у `.flow.json`.
- `level` — детекція в `init` + поле стану; впливає на кількість рецензентів.
- Контракт `flow.mdc` — крок review + згадка рівнів.

**Out (поза цим інкрементом):**
- Risk/NFR окремі артефакти `docs/qa/` (фолдимо «risk note» у spec пізніше).
- Структурований qa-gate.yaml (тримаємо вердикт у `.flow.json`).
- DoD-чекліст, tech-spec рівні, advanced-elicitation (окремо).

## Підходи (розглянуті)

- **A. `flow review` як окрема команда (обрано).** Чисте розділення: `verify` —
  механічні гейти, `review` — семантика. Перевикористовує runner. Людина —
  у циклі resolve.
- **B. Вшити review у `verify`.** Відкинуто: змішує детерміновані гейти з
  недетермінованим LLM-review; ускладнює exit-код.
- **C. Лише контракт `.mdc` без коду.** Відкинуто: немає персистентності
  findings у стані й немає масштабування за рівнем.

## Дизайн

### `level` (scale-adaptive)

- Чиста функція `detectLevel(desc)` → `0|1|2|3` за ключовими словами:
  - L0: `fix|typo|bump|rename|hotfix` — тривіальне;
  - L3: `platform|migration|rewrite|architecture|enterprise|редизайн`;
  - L2: `feature|epic|refactor` багатофайлове;
  - L1: дефолт (мала фіча).
- `init` пише `level` у стан (поряд із `base_commit`).
- Семантика: `flow review` спавнить `reviewersForLevel(level)` рецензентів
  (L0→1, L1→1, L2→2, L3→3). Контракт рекомендує spec+plan для L≥1.

### `flow review`

1. Читає стан; нема — код 1. Бере `base_commit` зі стану (фолбек `HEAD~1`).
2. `git diff <base>...HEAD` (+ `git diff` робочого дерева) → текст diff. Порожній
   diff → лог «нема змін», код 0.
3. Спавнить N adversarial-рецензентів (N = за рівнем) через runner; кожен —
   промпт «знайди баги/ризики ЛИШЕ в цьому diff, поверни JSON findings».
4. Парсить findings (`[{severity, file, issue, suggestion}]`, fail-soft на
   невалідному — лог-варн, не валимо).
5. Дедуплікує, пише `review: { at, findings, reviewers }` у стан через
   `recordTransition`. Друкує таблицю findings.
6. Exit-код: 0 завжди (review — інформативний, не блокує; як домовлено про м'які
   ворота). High-severity → виразний лог-warn.

### Артефакти й стан

- `.flow.json`: нові поля `level` (init), `review` (review).
- Контракт `flow.mdc`: крок «Review (рекомендовано)» після коду, перед release.

## Зв'язок із тестами

- `detectLevel`/`reviewersForLevel` — чисті, юніт-тести (таблиця keyword→level).
- `flow review`: runner/now/`run`(git) ін'єктуються; тести без реальних git/LLM
  (як `commands.test.mjs`/`plan.test.mjs`).
- `init`: тест, що `level` пишеться у стан.

## Ризики

- Недетермінований LLM-вивід рецензента → fail-soft парсинг (не валимо verify-флоу).
- Великий diff → обрізати до розумного ліміту (напр. перші N рядків) у промпті.
