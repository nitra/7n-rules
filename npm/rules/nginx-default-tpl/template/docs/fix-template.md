---
type: JS Module
title: fix-template.mjs
resource: npm/rules/nginx-default-tpl/template/fix-template.mjs
docgen:
  crc: 93e1deb6
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

T0-autofix автоматизує детерміноване виправлення специфічних порушень у шаблонах конфігурації Nginx. Він виконує перейменування або перезапис файлу `default.tpl.conf` у `default.conf.template` для усунення `default-tpl-conf-legacy-name`, а також замінює директиву `error_log off;` на `error_log /dev/null crit;` для усунення `error-log-off-directive`.

## Поведінка

1. Визначає набір правил у `patterns` для автоматичного виправлення порушень у шаблонах конфігурації Nginx.
2. Для порушення `nginx-default-tpl-legacy-name` виконує перейменування або перезапис файлу `default.tpl.conf` у `default.conf.template` та фіксує змінені файли.
3. Для порушення `nginx-default-tpl-error-log-off` знаходить файли, що містять директиву `error_log off;`, та замінює її на `error_log /dev/null crit;`, фіксуючи змінені файли.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
