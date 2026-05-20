---
session: 9df5af85-ba57-41e3-9b88-4e31c33fdc38
captured: 2026-05-20T09:58:23+03:00
transcript: /Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/9df5af85-ba57-41e3-9b88-4e31c33fdc38/9df5af85-ba57-41e3-9b88-4e31c33fdc38.jsonl
---

## ADR Новий воркспейс без merge-base не вимагає version bump

## Context and Problem Statement
`demo/` з'явився на гілці `main` після точки розгалуження з `dev`. Оскільки `demo/package.json` на merge-base відсутній, `readBaseVersion` повертала `null`. Функція `checkLocalOnlyChangedWorkspace` в `check.mjs` трактувала `Vbase === null` так само, як «version не змінено», і вимагала bump `0.0.0 → 0.0.1`, хоча воркспейс щойно створено.

## Considered Options
* Вимагати bump навіть для нових воркспейсів (поведінка до виправлення)
* Для нових воркспейсів (маніфест відсутній на merge-base) перевіряти лише наявність CHANGELOG-запису для поточної `version` без вимоги bump

## Decision Outcome
Chosen option: "Для нових воркспейсів перевіряти лише наявність CHANGELOG-запису", because якщо `demo/package.json` не існував на merge-base, воркспейс є новим — початкова `version` (`0.0.0`) є коректною, і штучний bump не потрібен.

### Consequences
* Good, because `check changelog` проходить для `demo/` без штучного bump: `✅ demo: новий воркспейс (на dev відсутній demo/package.json) — перевіряємо CHANGELOG для 0.0.0`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінено: `npm/rules/changelog/fix/consistency/check.mjs` — гілка `Vbase === null` у `checkLocalOnlyChangedWorkspace` тепер означає новий воркспейс; `npm/rules/changelog/fix/consistency/check.test.mjs` — доданий тест `'feature-гілка: новий воркспейс з CHANGELOG для початкової version → pass без bump'`; `npm/CHANGELOG.md` — запис у розділі `1.13.63`.

---

## ADR Вибір бази порівняння для `check changelog` на гілці `main`

## Context and Problem Statement
`resolveBaseRef()` перебирала кандидатів у порядку `['dev', 'main']`. Якщо репо мало гілку `dev`, на `main` база ставала `merge-base(dev, HEAD)` — спільний предок, що може бути дуже старим. Через це нові воркспейси й незакомічені зміни, внесені безпосередньо в `main`, порівнювалися з надто старим станом. Крім того, `dev` може бути відсутній у репо.

## Considered Options
* Залишити `['dev', 'main']` як пріоритетний список кандидатів для всіх гілок
* На `main` порівнювати з `origin/main` (або `HEAD~1` за відсутності remote); feature-гілки — `merge-base` з `dev` якщо є, інакше з `main`

## Decision Outcome
Chosen option: "На `main` порівнювати з `origin/main` або `HEAD~1`", because зміни, що вносяться безпосередньо в `main`, мають порівнюватися з попереднім станом `main`, а не з `dev`; `dev` взагалі може бути відсутній у репо.

### Consequences
* Good, because таблиця бази порівняння стала детермінованою: `main` → `origin/main` / `HEAD~1`; `dev` → local-only пропускається; feature → `merge-base(dev, HEAD)` або `merge-base(main, HEAD)`.
* Good, because виправлено крайній випадок: якщо `origin/main` збігається з `HEAD`, перевірка коректно бачить порожній diff замість хибного fallback на `HEAD~1`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінено: `npm/rules/changelog/fix/consistency/check.mjs` — константа `BASE_BRANCH_CANDIDATES` видалена, `resolveBaseRef()` переписана з розгалуженням по `branch === 'main'`; `npm/rules/changelog/fix/consistency/check.test.mjs` — тест `'main після merge dev → main'` замінено на `'main синхронізований з origin/main без локальних змін → pass'`, додано ще 2 сценарії; `.cursor/rules/n-changelog.mdc` — оновлено секцію `### local-only`; `npm/CHANGELOG.md` — запис у розділі `1.13.63`.
