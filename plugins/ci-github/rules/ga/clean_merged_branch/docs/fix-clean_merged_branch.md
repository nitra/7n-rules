---
type: JS Module
title: fix-clean_merged_branch.mjs
resource: plugins/ci-github/rules/ga/clean_merged_branch/fix-clean_merged_branch.mjs
docgen:
  crc: e78a4923
  model: openai-codex/gpt-5.4-mini
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`patterns` звіряє шаблонну конфігурацію з відповідними файлами репозиторію, щоб підтримувати узгодженість між шаблоном і робочим станом. Працює лише на читання, не торкається `.github` і `.git`, і не змінює файлову систему чи базу даних.

## Поведінка

1. `patterns` формує набір правил для узгодження шаблонної конфігурації з цільовим workflow-файлом `.github/workflows/clean-merged-branch.yml`.
2. `patterns` використовує це правило як частину автоматизованого вирівнювання між шаблоном і робочим репозиторієм, щоб підтримувати однакову поведінку в потрібному workflow.
3. `patterns` свідомо не охоплює шляхи `.github` і `.git`, щоб не зачіпати службові та внутрішні дані репозиторію.
4. `patterns` працює read-only: лише описує, що треба зіставити, і не записує зміни у файлову систему чи базу даних.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Свідомо пропускає шляхи: `.github`, `.git`.
