---
type: JS Module
title: fix-clean_merged_ignore_branches.mjs
resource: plugins/ci-github/rules/abie/clean_merged_ignore_branches/fix-clean_merged_ignore_branches.mjs
docgen:
  crc: 4adccad6
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.97
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Нормалізує workflow чистки злитих гілок до канонічного шаблону концерну, щоб для `.github/workflows/clean-merged-branch.yml` у consumer-репо завжди використовувався один і той самий стандарт. Публічний контракт файлу — `patterns`, а `.github` і `.git` свідомо не зачіпаються.

## Поведінка

1. `patterns` задає один канонічний сценарій приведення workflow чистки злитих гілок у відповідність до шаблону концерну для `.github/workflows/clean-merged-branch.yml`.
2. Якщо цільовий файл уже існує, зберігаються всі позатимплейтні ключі та коментарі, а канонічні значення шаблону мають пріоритет у своїй області.
3. Якщо цільового файла немає, він створюється з канонічного snippet-а.
4. Обробка свідомо обходить `.github` і `.git`, щоб не торкатися службових шляхів поза очікуваним контуром змін.

## Публічний API

- patterns — Один детермінований патерн: deep-merge канонічного snippet-а концерну в
`.github/workflows/clean-merged-branch.yml` консюмер-репо — відсутні ключі
додаються, канонічні значення мають пріоритет, коментарі й ключі поза
шаблоном не чіпаються; якщо файлу немає — створюється зі snippet-а.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Свідомо пропускає шляхи: `.github`, `.git`.
