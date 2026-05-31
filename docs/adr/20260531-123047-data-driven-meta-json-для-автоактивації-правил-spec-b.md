---
session: 09dcb1bc-929b-4d88-90b0-c0611bed3d2f
captured: 2026-05-31T12:30:47+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/09dcb1bc-929b-4d88-90b0-c0611bed3d2f.jsonl
---

[end of transcript]

---

## ADR Data-Driven `meta.json` для автоактивації правил (Spec B)

## Context and Problem Statement

Автоактивація правил в `npm/scripts/auto-rules.mjs` спиралася на три хардкодовані структури (`autoRuleChecks`, `AUTO_RULE_ORDER`, `AUTO_RULE_DEPENDENCIES`) та на текстовий файл-маркер `auto.md` поряд з кожним правилом. Додавання нового правила вимагало ручного редагування трьох місць у коді ядра, що ускладнювало масштабування та підвищувало ризик невідповідності між даними й поведінкою.

## Considered Options

* Data-driven `meta.json` — один JSON-файл поряд з кожним правилом декларує `auto`, `worktree`, порядок, залежності; ядро стає інтерпретатором.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Data-driven `meta.json`", because кожен файл `rules/<id>/meta.json` декларує всю семантику автоактивації (4 форми поля `auto`: `"завжди"`, glob-рядок, масив glob-рядків, predicate+arg-об'єкт), а `auto-rules.mjs` переписується на мета-інтерпретатор, що зчитує ці дані — замість хардкодованих масивів.

### Consequences

* Good, because transcript фіксує очікувану користь: ядро `auto-rules.mjs` скорочено на ~449 рядків (хардкод прибрано), додавання правила зводиться до створення одного `meta.json`, повний регресійний сюїт 1978 тестів пройдено, 46/46 тестів `auto-rules.test.mjs` зелені.
* Good, because tauri автодетект увімкнено вперше — раніше він був dead code через відсутність запису в хардкодованих структурах.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Робота виконана в ізольованому git-worktree `feat/rule-meta-json` (`.worktrees/feat-rule-meta-json`), 9 комітів (`616f832`..`f02a148`), потрапила в `main` через fast-forward merge фонової сесії.
- Нові файли: `npm/scripts/lib/rule-meta.mjs`, `npm/scripts/lib/rule-predicates.mjs`, `npm/scripts/lib/rule-meta-helpers.mjs`, JSON-схема `rule-meta.json`, check-концерн `npm/rules/npm-module/js/rule_meta.mjs`.
- 33 файли `meta.json` створено для правил; 29 `auto.md` видалено (`git rm`).
- Ядро `auto-rules.mjs` переписано: `detectAutoRules` та `discoverRuleAutoActivation` тепер зчитують `meta.json` через `readRuleMeta`, порядок і залежності — з даних, а не з констант.
- `globToRegex` перевикористано з `npm/rules/npm-module/js/package_structure.mjs` (вже експортувалась).
- Цикл імпортів розірвано виділенням `rule-meta-helpers.mjs` (порядок Task 2 → Task 4 у плані).
- Контракт: `npm/scripts/tests/auto-rules.test.mjs` — 45 існуючих + 1 новий tauri-тест = 46 тестів.
- Специфікація Spec B: `docs/superpowers/plans/2026-05-31-rule-meta-json.md` (1170 рядків, коміт `f5cd64c`).
- Реалізація субагент-driven, послідовно (9 задач + review-цикли), модель per-task: haiku для дата-файлів, sonnet для logic, opus для ядра і фінального review.

---

## ADR Squash-merge як рекомендований спосіб завершення worktree-гілки

## Context and Problem Statement

При завершенні роботи в ізольованому git-worktree (`feat/rule-meta-json`) виникло питання: яким способом інтегрувати гілку в `main` — fast-forward (зберегти всі коміти), squash (один коміт) або PR. Усталеного правила в репозиторії не існувало — щоразу агент залишав вибір без рекомендації.

## Considered Options

* Squash-merge (`git merge --squash`) — всі зміни гілки зливаються в один коміт у `main`.
* Fast-forward merge — всі коміти гілки перемотуються в `main` як є.
* Pull Request — гілка пушиться на origin, відкривається PR.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Squash-merge", because користувач явно підтвердив цей варіант як бажаний за замовчуванням, пояснивши потребу мати «один коміт» для однієї логічної фічі; правило зафіксовано в `npm/rules/worktree/worktree.mdc` зі секцією «Завершення гілки worktree».

### Consequences

* Good, because transcript фіксує очікувану користь: worktree-правило тепер містить явну настанову — агент завжди пропонуватиме squash як перший варіант при завершенні гілки, без потреби щоразу уточнювати у користувача.
* Bad, because для поточної сесії squash не застосовано — Spec B потрапила в `main` через fast-forward merge фонової сесії до того, як squash було ініційовано; правило діятиме лише для наступних worktree-гілок.
* Bad, because правило набуде сили в проєктах лише після релізу версії пакета, що містить оновлений `worktree.mdc` (sync бере правила з опублікованого `@nitra/cursor`, а не з локального джерела).

## More Information

- Зміна внесена в `npm/rules/worktree/worktree.mdc` — нова секція «Завершення гілки worktree».
- Change-файл: `npm/.changes/1780218783124-a30f10.md` (bump patch, секція Changed).
- Коміт: `41cc767 feat(worktree-rule): пропонувати squash-merge при завершенні гілки worktree`.
- Дзеркало `.cursor/rules/n-worktree.mdc` оновиться автоматично при наступному `n-cursor sync` після публікації нової версії пакета.
- Технічна причина, чому squash не застосовано в поточній сесії: фонова паралельна сесія виконала fast-forward merge `feat/rule-meta-json` → `main` і видалила worktree/гілку до того, як основна сесія дійшла до кроку merge; `git merge --squash` відповів «Already up to date, nothing to squash».
