---
kind: nitra-spec
status: draft
adr: null
plan: ../plans/2026-06-02-flow-release-infer-ws.md
risk: low
---

# flow release: інференс зміненого воркспейсу — дизайн

Дата: 2026-06-02
Власник: @vitaliytv
Статус: Draft (очікує апруву)
Беклог: flow-adaptation-backlog #9

## Проблема

`flow release` викликає `npx @nitra/cursor change ...rest` без `--ws`, тож `change`
дефолтиться на воркспейс `.` (корінь монорепо). Коли всі зміни під `npm/`, change-файл
лягає в кореневий `./.changes/` — а корінь монорепо не релізиться, тоді як `npm/`
лишається без change-файлу. (Спостережено: довелося вручну передавати `--ws npm`.)

## Рішення (Q1=A, з варіанту беклогу)

У `release` (commands.mjs), якщо в аргументах НЕ задано `--ws`, інферити змінений
воркспейс із git-diff від `base_commit` і автоматично додати `--ws <шлях>`:

- `workspaces = getMonorepoProjectRootDirs(cwd)`, `subWs = workspaces \ {'.'}`;
- `files = collectChangedFilesSince(base_commit, cwd)`;
- `hits = subWs`, для яких є змінений файл під `<ws>/`;
- **рівно один** subWs → додати `--ws <ws>` + інфо-лог;
- **кілька** → fail: «зміни у воркспейсах a, b — вкажи `--ws` явно»;
- **нуль** (зміни лише в корені/доках) → не додавати `--ws` (change дефолтиться на `.`, коректно);
- якщо `--ws` уже заданий явно — поважати, нічого не інферити.

Інференс fail-soft до недосяжного base: якщо `collectChangedFilesSince` кидає
(rebase/shallow), не валимо release — лог-попередження й лишаємо дефолт `change`.

## Зміни секціями

### A. `release` (commands.mjs)

- Перед викликом `change`: якщо `rest` не містить `--ws`, обчислити `hits` і сформувати
  `changeArgs = [...rest, '--ws', ws]` (для одного) / fail (для кількох) / `rest` (нуль).
- Хелпери (`listWorkspaces`, `changedFilesSince`) ін'єктувати через `deps` з дефолтами
  (`getMonorepoProjectRootDirs` / `collectChangedFilesSince`) — щоб release лишався unit-тестованим.
- Інференс рахувати у `effectiveCwd` (worktreeDir з резолвера #1).

## Тести (commands.test.mjs)

- один змінений subWs → `change` отримує `--ws <ws>`.
- кілька subWs → release exit 1, повідомлення зі списком.
- нуль subWs (лише корінь/докси) → `change` без `--ws`.
- `--ws` заданий явно → інференс не чіпає аргументи.
- `changedFilesSince` кидає → release не падає, дефолт зберігається (fail-soft), є warning.

## Не-цілі

- Не чіпаємо сам `change` (лишається загальним примітивом із дефолтом `.`).
- Не змінюємо формат change-файлу / логіку CHANGELOG.

## Як перевірити

- `bun test` commands — зелений; нові кейси проходять.
- У worktree зі змінами лише під `npm/`: `flow release …` (без `--ws`) кладе change-файл
  у `npm/.changes/`, не в корінь.

## Ризики

Low. Адитивна логіка перед делегуванням у `change`; явний `--ws` і поведінка кореня
не змінюються; інференс fail-soft.
