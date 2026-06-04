---
session: 889efce9-844a-483c-84fa-b12a55f91b76
captured: 2026-06-04T19:38:51+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/889efce9-844a-483c-84fa-b12a55f91b76.jsonl
---

Виходить, transcript охоплює два рішення:

1. `/n-fix` перевіряє лише закомічений стан через worktree — незакомічені зміни поза його скоупом.
2. fix не авто-відновлює відсутні кроки в workflow; він тільки репортить порушення.

Обидва — дизайнові рішення з поясненням у сесії. Ось MADR:

---

## ADR Межі перевірки `/n-fix` — тільки закомічений стан через worktree

## Context and Problem Statement
Незакомічена зміна в `.github/workflows/npm-publish.yml` (видалений крок `Release (bump + CHANGELOG + tag)`) порушувала канон правила `n-npm-module.mdc`, але `/n-fix` повернув `19/19 ✅` без жодних виправлень. Виникло питання, чому перевірка не виявила відхилення.

## Considered Options
* Перевіряти незакомічені зміни в основному робочому дереві (working tree)
* Перевіряти тільки закомічений стан через тимчасовий git-worktree

## Decision Outcome
Chosen option: "Перевіряти тільки закомічений стан через тимчасовий git-worktree", because `/n-fix` створює `.worktrees/main-fix` від закоміченого `HEAD` і перевіряє/виправляє файли всередині worktree; основне робоче дерево він не чіпає.

### Consequences
* Good, because перевірка ізольована від незбережених локальних правок і не ризикує пошкодити поточний uncommitted-стан.
* Bad, because незакомічені порушення канону лишаються непоміченими — щоб їх виявити, спочатку треба зробити `git commit`.

## More Information
- Правило-канон: `.cursor/rules/n-npm-module.mdc`, рядки 70–118 (deep-subset перевірка `npm_publish_yml`).
- Порушений файл: `.github/workflows/npm-publish.yml` — відсутній крок `run: node npm/bin/n-cursor.js release`.
- Закомічена канонічна версія підтверджена командою `git show HEAD:.github/workflows/npm-publish.yml`.
- Відновлення: `git checkout -- .github/workflows/npm-publish.yml`.

---

## ADR `/n-fix` не авто-відновлює відсутні кроки в workflow — тільки репортить порушення

## Context and Problem Statement
У workflow `.github/workflows/npm-publish.yml` вручну видалили обов'язковий крок `Release (bump + CHANGELOG + tag)`. Постало питання, чи може `/n-fix` автоматично дописати відсутній крок і відновити канон.

## Considered Options
* Автоматично дописувати відсутні кроки до workflow-файлів
* Тільки репортити порушення deep-subset перевірки (FAIL), не змінюючи файл

## Decision Outcome
Chosen option: "Тільки репортити порушення deep-subset перевірки (FAIL), не змінюючи файл", because fix не домальовує відсутні кроки workflow автоматично — він репортить порушення; відновлення покладається на розробника (наприклад, `git checkout -- <file>`).

### Consequences
* Good, because поведінка передбачувана: fix не вносить небажаних автоматичних правок у CI-конфіги.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Порушення фіксується перевіркою `npm_module.npm_publish_yml` (deep-subset: усі кроки канонічного сніпета обов'язкові, зайві дозволені, порядок неважливий).
- Канон задано в `.cursor/rules/n-npm-module.mdc`.
- Відновлення виконується вручну: `git checkout -- .github/workflows/npm-publish.yml`.
