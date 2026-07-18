---
type: JS Module
title: fix-lint_repo_yml.mjs
resource: plugins/ci-github/rules/ga/lint_repo_yml/fix-lint_repo_yml.mjs
docgen:
  crc: 838883e0
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`patterns` описує, які шляхи потрапляють у lint-синхронізацію для `.github/workflows/lint-repo.yml`, щоб ця частина репозиторію оновлювалася за спільними правилами. Він свідомо пропускає `.github` і `.git`, тож працює лише з цільовими шляхами поза цими межами.

## Поведінка

1. `patterns` визначає набір правил для синхронізації lint-налаштування з шаблоном у `.github/workflows/lint-repo.yml`.
2. `patterns` свідомо не охоплює `.github` і `.git`, щоб не втручатися в службові та історичні області репозиторію.
3. `patterns` працює read-only: він лише описує очікувану поведінку перевірки й не змінює файлову систему чи базу даних.
4. `patterns` потрібен, щоб підтримувати узгодженість workflow lint-репозиторію з централізованим шаблоном і зменшувати ручне супроводження.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Свідомо пропускає шляхи: `.github`, `.git`.
