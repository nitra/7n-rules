---
kind: nitra-plan
spec: null
flow: null
status: backlog
---

# План адаптації n-cursor flow (беклог)

Дата: 2026-06-01
Джерело: ретроспектива сесії `changelog-npm-module-align` (узгодження `n-changelog.mdc` ↔ `n-npm-module.mdc`).
Кожен пункт — реальне тертя, спостережене під час проходження flow init→spec→plan→verify→review.

## Кроки

1. **cwd-незалежний резолвинг стану flow.** `flow spec/plan/verify/review` шукають `.flow.json` за поточною гілкою, але виклики shell скидаються в головне дерево → повторюване «стану нема».
   acceptance: будь-яка `flow`-підкоманда знаходить стан через `git --git-common-dir`/скан `.worktrees/*.flow.json` незалежно від cwd, **або** fail з підказкою «перейди в worktree: cd …»; `flow init` друкує точний `cd`-рядок.

2. **Level-класифікатор не знижувати лише за fix-дієсловами.** «усунути/виправити» дали L0 для задачі на 4 файли правил/політик + meta-логіку (реально L2+).
   acceptance: рівень зважує к-сть таргет-файлів і дотик до `rules/`/`policy/`/`.mdc`/слів «суперечність/інваріант/meta»; `init` приймає `--level`; рівень тече через Spec (як `risk`).

3. **`trace` має резолвити лінки відносно теки артефакту.** Зараз `join(root, target)` (repo-root-relative) суперечить file-relative конвенції доків → warning «розрив ланцюга» і на коректних, і на биткових лінках; сигнал знецінений.
   acceptance: коректно злінковані spec↔plan дають 0 warning; биткий лінк — 1 warning; (опц.) підтримка обох форм.

4. **`verify`: розрізняти «gate провалено» vs «тулчейн відсутній — не виміряно».** Coverage жорстко залежить від npx-кешованого Stryker (не бачить проєктний `vitest-runner`); opa/regal невидимі для npx-subprocess; один untracked биткий `sample/*.rego` валить увесь rego-loader.
   acceptance: per-gate статус; «не зміг стартувати» не читається як код-фейл; Stryker з `node_modules` + preflight на плагін з actionable-меседжем; rego-loader скоуплений на tracked-файли воркспейсу.

5. **Координація flow з auto-commit/ADR/formatter-хуками.** Хук сам закомітив WIP (без change-файлу → одразу порушує `check changelog`) і згенерував ADR; форматер стер `eslint-disable`.
   acceptance: auto-commit під пакетним воркспейсом або кладе change-файл, або лишає staged-not-committed до `release`; хук-дії (commit/змінив файл) логуються в потік flow.

6. **`verify`-lint має позначати, чи finding передіснує на base.** Changed-files-lint підтягнув чужу debt (`sonarjs/no-empty-test-file` file-level, який inline-disable не глушить і автофікс зриває як «unused»; jsdoc-warning) → роздування scope.
   acceptance: кожен lint-finding має прапор pre-existing(base) vs introduced(diff); агент/рецензент відділяє «ти зламав» від «торкнувся старого боргу».

7. **`review` має read-доступ до файлів, на які посилається diff (і до spec).** 4/6 findings були «з diff не видно» і всі спростовані читанням не-diff файлів — severity витрачено на нефальсифіковні «можливо».
   acceptance: рецензент може відкрити referenced-файли/spec; cross-file-твердження верифікуються (🔴 «не підтверджено» → «verified: покрито consistency.mjs») або позначаються тегом «needs cross-file check» замість severity.

## Додатково (виявлено на фазі release)

8. **`fix`/`verify` у репо-джерелі `@nitra/cursor` запускають ВСТАНОВЛЕНУ версію чеків, не working-tree.** `npx @nitra/cursor fix` показував повідомлення з уже видалених функцій (`checkDirtyNpmRequiresVersionBump`) — бо виконував реєстрову v3.9.0, а не мій змінений `package_structure.mjs`. Отже flow-гейти НЕ валідують зміни до самих чеків при догфудингу; справжня валідація — лише worktree-unit-тести.
   acceptance: `flow verify`/`fix` у репо-джерелі резолвлять чек-код із working-tree (`npm/`), а не з `node_modules`/npx-кешу; або явно попереджають «гейт виконано встановленою версією — для змін до чеків покладайся на unit-тести».

9. **`flow release` не інферить змінений воркспейс.** Без `--ws npm` change-файл ліг у корінь (`./.changes/`), хоча всі зміни під `npm/` — корінь монорепо не релізиться, а `npm/` лишився без change-файлу.
   acceptance: `flow release` визначає воркспейс(и) з git-diff від `base_commit` і кладе change-файл туди (або вимагає `--ws`, якщо змін у кількох воркспейсах); не пише в корінь монорепо за наявності підпакетів.

10. **Mirror `.cursor/rules/n-*.mdc` не синхронізується зі зміною канонічних `npm/rules/*/​*.mdc`.** Tracked-дзеркало лишилось стале (`n-changelog.mdc` v3.1, `n-npm-module.mdc` зі старою секцією «Build версія») → PR внутрішньо неконсистентний; регенерація потребує важкого bare-sync, який тягне skills/claude-config/devDeps.
    acceptance: легкий цільовий ресинк лише змінених правил (без побічного синку), або pre-commit-хук, що тримає дзеркало в актуальному стані, або CI-чек parity canonical↔mirror.

## Що працює добре (закріпити)

- **Spec-дискусія по одному питанню** зловила дві найбільші помилки самого брифу (механізму `backfill` не існує; чеки були _інвертовані_, а не лише з поганим текстом). Буквальне виконання брифу дало б невірний код.
  → Зробити Spec **обовʼязковим** для будь-чого, що чіпає `rules/`/checks, навіть коли класифікатор каже L0 (повʼязано з кроком 2).
