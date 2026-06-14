# n-fix — межі перевірки: тільки закомічений стан через worktree

**Status:** Accepted
**Date:** 2026-06-04

## Context and Problem Statement

Після успішного завершення `/n-fix` (19/19 ✅) виявилось, що незакомічена зміна в `.github/workflows/npm-publish.yml` (видалений обов'язковий крок `Release (bump + CHANGELOG + tag)`) порушувала канон правила `n-npm-module.mdc`, але перевірка її не виявила. Також постало питання, чи може `/n-fix` автоматично відновити відсутні кроки у workflow-файлах.

## Considered Options

* Перевіряти незакомічені зміни в основному робочому дереві (working tree)
* Перевіряти тільки закомічений стан через тимчасовий git-worktree
* Автоматично дописувати відсутні кроки до workflow-файлів при порушенні
* Тільки репортити порушення deep-subset перевірки (FAIL), не змінюючи файл

## Decision Outcome

Chosen option: "Перевіряти тільки закомічений стан через тимчасовий git-worktree + лише репортити порушення", because `/n-fix` створює `.worktrees/main-fix` від закоміченого `HEAD` і перевіряє/виправляє файли всередині worktree; fix не домальовує відсутні кроки workflow автоматично — він репортить порушення; відновлення покладається на розробника (наприклад, `git checkout -- <file>`).

### Consequences

* Good, because перевірка ізольована від незбережених локальних правок і не ризикує пошкодити uncommitted-стан.
* Good, because поведінка передбачувана: fix не вносить небажаних автоматичних правок у CI-конфіги.
* Bad, because незакомічені порушення канону лишаються непоміченими до `git commit`.
* Neutral, because transcript не містить підтверджених додаткових негативних наслідків.

## More Information

- Правило-канон: `.cursor/rules/n-npm-module.mdc`, рядки 70–118 (deep-subset перевірка `npm_publish_yml`; усі кроки канону обов'язкові, зайві дозволені, порядок неважливий).
- Worktree для fix: `.worktrees/main-fix`, створений від поточної гілки `main`.
- Закомічена канонічна версія підтверджена командою `git show HEAD:.github/workflows/npm-publish.yml`.
- Порушений крок у незакоміченій версії: `run: node npm/bin/n-cursor.js release`.
- Відновлення: `git checkout -- .github/workflows/npm-publish.yml`.
- Worktree-семантика `/n-fix` описана в `.cursor/skills/n-fix/SKILL.md` та `.cursor/rules/n-worktree.mdc`.
