---
type: JS Module
title: main.mjs
resource: plugins/lang-js/rules/test/storybook-page-coverage/main.mjs
docgen:
  crc: 30386934
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 90
  issues: internal-name:collectInScopeVuePackages,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Документ описує правило lint для сторінок, щоб у кожного сторінкового екрана був пов’язаний smoke-story поруч із кодом. Це потрібно, щоб `storybook.mdc` міг помічати сторінки без coverage через маркери повідомлень і підтримувати однаковий рівень перевірки для всіх сторінок.

## Поведінка

1. Збирає всі app-пакети в поточному скоупі та, якщо таких пакетів немає, одразу завершується з нейтральним повідомленням `storybook page-coverage: немає app-пакетів у скоупі (storybook.mdc)`.
2. Для кожного app-пакета перевіряє сторінки під `src/pages/` і виключає з розгляду лише ті шляхи, що явно позначені як ignore у конфігурації проєкту.
3. Для кожної `.vue`-сторінки очікує хоча б одну story поруч у тому самому каталозі; якщо story немає, фіксує `warn`-порушення з маркером `[page-coverage]` і поясненням, що сторінка app-проєкту без smoke-story не відповідає вимозі `storybook.mdc`.
4. Повертає підсумок лінту без змін у файловій системі чи базі даних.

## Публічний API

- lint — Detector concern-а `storybook/page-coverage` (ADR-розширення 2026-07-20, хвиля 2a): для
  кожного app-пакета у скоупі (`storybook.detectApps: true`, `collectInScopeVuePackages`,
  `type: 'app'`) — кожен `.vue` під `src/pages/` має мати хоча б одну story поряд. Рівень
  `warn` (не гейт) — на відміну від бібліотечного скафолду хвилі 1, smoke-покриття
  сторінок хвилі 2a свідомо мʼяке.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
