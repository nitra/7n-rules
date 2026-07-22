---
type: JS Module
title: fix-clean_merged_branch.mjs
resource: plugins/ci-github/rules/ga/clean_merged_branch/fix-clean_merged_branch.mjs
docgen:
  crc: b4fbbbfb
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`patterns` нормалізує workflow автоматичного видалення злитих гілок у `consumer`-репо до канонічного шаблону концерну: фіксує цільовий `clean_merged_branch` для `.github/workflows/clean-merged-branch.yml`, щоб цей сценарій відповідав спільним правилам для таких файлів. Для узгодження з контрактом файлу враховує лише релевантний контекст і свідомо не зачіпає шляхи `.github` та `.git` поза цим workflow.

## Поведінка

1. `patterns` задає один канонічний сценарій вирівнювання workflow для автоматичного видалення злитих гілок у консюмер-репо.
2. Сценарій спрямований на `.github/workflows/clean-merged-branch.yml` і приводить його до шаблону концерну.
3. Якщо цільовий файл уже існує, зберігає локальні відхилення поза шаблоном, але оновлює відсутні частини та надає пріоритет канонічним значенням.
4. Якщо цільового файлу немає, створює його з канонічного snippet-а.
5. Не зачіпає свідомо пропущені шляхи `.github` і `.git` поза цільовим workflow-контекстом.

## Публічний API

- patterns — Один детермінований патерн: deep-merge канонічного snippet-а концерну в
`.github/workflows/clean-merged-branch.yml` консюмер-репо — відсутні ключі
додаються, канонічні значення мають пріоритет, коментарі й ключі поза
шаблоном не чіпаються; якщо файлу немає — створюється зі snippet-а.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Свідомо пропускає шляхи: `.github`, `.git`.
