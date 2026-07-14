---
type: JS Module
title: fix-lint_text.mjs
resource: npm/rules/text/lint_text/fix-lint_text.mjs
docgen:
  crc: cefae829
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`patterns` визначає, які текстові зміни вважаються придатними для узгодження з еталонною структурою workflow. Вона потрібна, щоб перевірка зосереджувалась на змісті потрібних файлів і не торкалась службових шляхів `.github` і `.git`.

## Поведінка

1. `patterns` формує набір правил для узгодження текстової перевірки з еталонною структурою workflow.
2. Підготовлює виправлення для цільового файлу `.github/workflows/lint-text.yml`.
3. Свідомо обходить службові шляхи `.github` і `.git`, щоб не зачіпати внутрішню інфраструктуру репозиторію.
4. Працює лише на читання: не змінює файлову систему і не виконує запис у БД.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Свідомо пропускає шляхи: `.github`, `.git`.
