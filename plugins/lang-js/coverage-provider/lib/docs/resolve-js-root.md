---
type: JS Module
title: resolve-js-root.mjs
resource: plugins/lang-js/coverage-provider/lib/resolve-js-root.mjs
docgen:
  crc: f4370476
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`resolveAllJsRoots` визначає JS-корені проєкту, щоб інші частини системи працювали з фактичними package-коренями. Для single-package повертає корінь поточного проєкту, а для workspace-проєктів знаходить усі workspaces, зокрема за glob-патернами на кшталт `cf/*`. Під час розгортання glob-патернів свідомо ігнорує `.git` і `node_modules`.

## Поведінка

1. `resolveAllJsRoots` перевіряє, чи проєкт має кореневий `package.json`; без нього JS-корені не визначаються.
2. Якщо проєкт не оголошує workspaces, JS-коренем вважається корінь поточного проєкту.
3. Якщо workspaces оголошені, кожен workspace перетворюється на окремий JS-корінь лише за наявності власного `package.json`.
4. Workspace-патерни із wildcard розгортаються в усі відповідні пакети, при цьому свідомо пропускаються `.git` і `node_modules`.
5. Якщо жоден workspace не дав придатного JS-кореня, результатом стає корінь поточного проєкту як безпечний fallback.

## Публічний API

- resolveAllJsRoots — Plural-варіант: повертає всі JS-roots проєкту. Для workspace-projects — кожен
  workspace з власним `package.json` (з розгортанням glob-патернів); для
  single-package — `[cwd]`. Порожній масив без кореневого package.json.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Під час розгортання glob-патернів свідомо пропускає шляхи: `.git`, `node_modules`.
