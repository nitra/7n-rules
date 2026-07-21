---
type: JS Module
title: storybook-project-entry.js
resource: plugins/lang-js/rules/storybook/vitest-config/template/storybook-project-entry.js
docgen:
  crc: 5d9feafd
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл задає еталонний фрагмент конфігурації для інструментів правил. Він потрібен як незмінний зразок для порівняння або відновлення очікуваного стану конфігурації. Механізм є read-only: не записує дані у файлову систему чи базу даних.

## Поведінка

1. Визначає канонічний запис окремого тестового проєкту для Storybook у конфігурації Vitest.

2. Вмикає виконання Storybook-тестів у browser mode, щоб перевірки stories запускалися в браузерному середовищі.

3. Обмежує браузерну перевірку Chromium, щоб результат був стабільним і відповідав прийнятому стандарту репозиторію.

4. Задає пошук stories через шаблон, який підставляється під час генерації або виправлення конфігурації.

5. Підключає Storybook setup-файл для Vitest, щоб тести stories отримували потрібне середовище Storybook.

6. Слугує еталонним фрагментом для інструментів правил, які порівнюють або відновлюють правильний запис Storybook-проєкту в `test.projects`.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
