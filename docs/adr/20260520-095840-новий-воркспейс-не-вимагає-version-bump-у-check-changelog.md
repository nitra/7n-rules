---
session: 9df5af85-ba57-41e3-9b88-4e31c33fdc38
captured: 2026-05-20T09:58:40+03:00
transcript: /Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/9df5af85-ba57-41e3-9b88-4e31c33fdc38/9df5af85-ba57-41e3-9b88-4e31c33fdc38.jsonl
---

## ADR Новий воркспейс не вимагає version-bump у check-changelog

## Context and Problem Statement
`demo/` з'явився на гілці `main` після merge-base з `dev`, тому `demo/package.json` був відсутній на базі (`Vbase === null`). Функція `checkLocalOnlyChangedWorkspace` у `check.mjs` трактувала `Vbase === null` ідентично до «version не змінилась» і вимагала штучного bump `0.0.0 → 0.0.1`, хоча для нового воркспейсу початкова `0.0.0` з записом у `CHANGELOG.md` є достатньою.

## Considered Options
* Вимагати bump навіть для нового воркспейсу (попередня поведінка)
* Для нового воркспейсу перевіряти лише наявність запису в `CHANGELOG.md` для поточної `version` — без bump

## Decision Outcome
Chosen option: "Для нового воркспейсу перевіряти лише наявність запису в `CHANGELOG.md`", because якщо маніфест відсутній на merge-base, воркспейс є новим і не має попередньої версії для порівняння — вимога bump не має сенсу.

### Consequences
* Good, because `check changelog` проходить для `demo/` на `main` без штучного bump, що відповідає фактичному стані репозиторію.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Змінено: `npm/rules/changelog/fix/consistency/check.mjs` — функція `checkLocalOnlyChangedWorkspace`: гілка `Vbase === null` тепер перевіряє тільки CHANGELOG-запис для поточної `version`.
- Тест: `npm/rules/changelog/fix/consistency/check.test.mjs` — доданий сценарій `'feature-гілка: новий воркспейс з CHANGELOG для початкової version → pass без bump'`.
- `npm/CHANGELOG.md` оновлено у версії `1.13.63`.

---

## ADR Вибір бази порівняння для check-changelog залежно від поточної гілки

## Context and Problem Statement
`resolveBaseRef()` у `check.mjs` завжди брав `dev` першим із кандидатів `['dev', 'main']`. На гілці `main` це давало `git merge-base(dev, HEAD)` — потенційно дуже старий спільний предок. Користувач зазначив: зміни, що вносяться безпосередньо в `main`, мають порівнюватись з попереднім `main`, а `dev` взагалі може бути відсутнім у репозиторії.

## Considered Options
* Фіксований список кандидатів `['dev', 'main']` (попередня поведінка)
* Вибір бази залежно від поточної гілки: `main` → `origin/main` (або `HEAD~1`); feature → `merge-base(dev, HEAD)` якщо є `dev`, інакше `merge-base(main, HEAD)`

## Decision Outcome
Chosen option: "Вибір бази залежно від поточної гілки", because зміни безпосередньо в `main` повинні порівнюватись з попереднім станом `main`, а не з `dev`; репозиторії без `dev` мали б некоректну базу.

### Consequences
* Good, because на `main` порівняння відповідає фактичній дельті відносно опублікованого стану; feature-гілки в репозиторіях без `dev` тепер коректно використовують `main` як базу.
* Good, because transcript фіксує очікувану користь: `check changelog` проходить на чистому `main` без штучного bump `demo/`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Змінено: `npm/rules/changelog/fix/consistency/check.mjs` — функція `resolveBaseRef()`:
- `branch === 'main'`: використовує `origin/main` якщо SHA відомий; якщо `origin/main === HEAD` (синхронізовано), diff порожній і перевірка проходить; без remote — `HEAD~1`.
- `branch === 'dev'`: local-only перевірка пропускається (поведінка незмінна).
- feature: `merge-base(dev, HEAD)` якщо `dev` є, інакше `merge-base(main, HEAD)`.
- Додатково виправлено: коли `origin/main` збігається з `HEAD`, `is-ancestor` повертав `false` і хибно активувався fallback на `HEAD~1`; виправлено прямим порівнянням SHA.
- Тести: `npm/rules/changelog/fix/consistency/check.test.mjs` — оновлений сценарій `'main після merge dev → main'`; доданий `'main синхронізований з origin/main без локальних змін → pass'`.
- Документація: `npm/rules/changelog/changelog.mdc` — оновлено секцію `### local-only`.
- `npm/CHANGELOG.md` оновлено у версії `1.13.63`.
