---
type: JS Module
title: storybook.mjs
resource: plugins/lang-js/coverage-provider/storybook.mjs
docgen:
  crc: 96e515b5
  model: openai-codex/gpt-5.4-mini
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Визначає Storybook workspace-и у Vue-компонентних бібліотеках зі сторі за наявністю Storybook-identity-пакетів у `devDependencies` `package.json` workspace-пакета (`npm/package.json`), щоб відокремити канонічні Storybook-root-и від інших workspace-ів. Така детекція спирається на governance `npm-module/npm_package_json.rego`, який дозволяє в `devDependencies` лише identity-пакети Storybook і пінить їх точні версії. `STORIES_FILE_RE`, `STORYBOOK_CANON_DEV_DEPS`, `isStorybookRoot`, `hasStories` підтримують пошук сторі-файлів і виявлення Storybook-root-ів у межах цього канону.

## Поведінка

STORIES_FILE_RE відокремлює файли сторі від решти дерева, щоб покриття для Storybook не змішувалося з production-кодом і не залежало від місця виклику.  
STORYBOOK_CANON_DEV_DEPS задає спільний набір identity-маркерів, які читаються з package.json і визначають, чи workspace слід рахувати як Storybook-root; це опирається на правила канону, а не на наявність окремого скафолду.  
isStorybookRoot використовує package.json як єдине джерело істини для такого висновку: якщо у devDependencies є хоча б один канонічний marker, workspace вважається Storybook-пакетом; за помилок читання або розбору результат безпечний і не перериває потік.  
hasStories проходить workspace у пошуках сторі-файлів і повертає лише факт їх наявності, не покладаючись на структуру на кшталт .storybook/ чи на вкладені зони типу node_modules або dist.  
Разом ці публічні імена формують двоступеневу перевірку: спершу визначається канонічний Storybook-root через package.json, далі підтверджується наявність сторі-файлів; обидва сигнали потрібні для коректного підрахунку покриття vitest browser mode.

## Публічний API

- STORIES_FILE_RE — `*.stories.*` файли — не production-код, окремий вимір покриття (Storybook, не JS-рядок).
- STORYBOOK_CANON_DEV_DEPS — Канонічний allowlist Storybook-identity devDeps (канон Storybook, Кластер 7;
  версії запінені в `npm-module/npm_package_json.rego` репо 7n-rules).
  `@storybook/addon-vitest` СВІДОМО не тут: це root-only test-tooling (плагін
  vitest-конфіга, `bun/package_json.rego#allowed_root_test_deps`), а не
  identity-маркер Storybook-пакета.
- isStorybookRoot — Чи workspace — канонічний Storybook-пакет: хоча б один identity-пакет із
  {@link STORYBOOK_CANON_DEV_DEPS} у `devDependencies` його `package.json`.
  Лише `devDependencies` (не `dependencies`) — канон тримає identity-пакети саме
  там; тека `.storybook/` не сигнал (скафолд гарантує правило `storybook`, а
  детекція за самим `package.json` бачить пакет ще до скафолду).
- hasStories — Чи workspace має хоч один `*.stories.*` файл (`node_modules`/`dist`/… не скануються).

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.
