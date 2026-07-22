---
type: JS Module
title: main.mjs
resource: plugins/lang-js/rules/storybook/hygiene/main.mjs
docgen:
  crc: 9e36e1a2
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 85
  issues: internal-name:collectInScopeVuePackages,anchor-miss:(storybook.mdc),judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл описує read-only lint-перевірку `lint` для Storybook-правил, що спираються на `package.json`. Перевірка потрібна, щоб виявляти порушення конфігурації без змін у файловій системі чи БД; помилки перехоплюються fail-safe і не виходять назовні як винятки.

## Поведінка

1. `lint` визначає Vue component library пакети, для яких діє Storybook-канон. Якщо таких пакетів немає, повертає успішний результат із повідомленням.

2. Для кожного знайденого пакета читає його `package.json` і формує перелік дозволених third-party залежностей із `dependencies` та `peerDependencies`.

3. Переглядає `.vue` файли пакета з урахуванням ignore-конфігурації та знаходить імпорти сторонніх пакетів. Відносні шляхи, alias-шляхи, Node builtin модулі та auto-import глобали не вважаються порушеннями.

4. Якщо `.vue` файл імпортує сторонній пакет, якого немає в `package.json` поточного пакета, додає порушення `undeclared-import`. Для одного файлу один і той самий пакет повідомляється лише один раз.

5. Перевіряє, чи має пакет глобальні Quasar SCSS-змінні. Якщо вони є, але `.storybook/main.js` не вмикає їх для Storybook, додає попередження `missing-sass-variables`.

6. Не змінює файлову систему або зовнішній стан: перевірка працює read-only і лише повертає результат лінту.

7. Некоректні або нерозбірні файли не зупиняють перевірку назовні: такі випадки обробляються fail-safe, щоб лінт міг продовжити роботу.

## Публічний API

- lint — Detector concern-а `storybook/hygiene`: для кожного Vue component library пакета у скоупі
  канону Storybook (`collectInScopeVuePackages`) — undeclared third-party imports у `.vue` та
  auto-detect глобальних Quasar SCSS-змінних без `sassVariables` у `.storybook/main.js`
  (storybook.mdc, ADR Кластер 6). Breaking-change guard при мажорному апгрейді
  third-party-пакетів свідомо не автоматизується — людський пункт, hygiene.mdc.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
