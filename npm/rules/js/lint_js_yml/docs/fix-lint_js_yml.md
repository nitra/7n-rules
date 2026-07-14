---
type: JS Module
title: fix-lint_js_yml.mjs
resource: npm/rules/js/lint_js_yml/fix-lint_js_yml.mjs
docgen:
  crc: 39aecc30
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`patterns` — read-only набір правил для аналізу й уніфікації JavaScript lint-конфігурації в межах доступних шляхів. Він свідомо пропускає `.github` і `.git`, щоб не зачіпати службові та git-специфічні файли.

## Поведінка

1. `patterns` формує набір правил для виправлення lint-конфігурації JavaScript-проєкту.
2. Для кожного правила прив’язує оновлення до цільового workflow-файлу `.github/workflows/lint-js.yml`.
3. У межах своєї роботи свідомо не зачіпає `.github` і `.git`, щоб уникати змін у службових та внутрішніх областях.
4. Працює в read-only режимі щодо ФС і БД: сам нічого не записує, а лише описує, що треба виправити.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Свідомо пропускає шляхи: `.github`, `.git`.
