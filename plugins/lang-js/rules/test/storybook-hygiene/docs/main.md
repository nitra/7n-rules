---
type: JS Module
title: main.mjs
resource: plugins/lang-js/rules/test/storybook-hygiene/main.mjs
docgen:
  crc: aa5523ba
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 75
  issues: internal-name:collectInScopeVuePackages,internal-name:isRelativeOrAliasSpecifier,anchor-miss:(storybook.mdc),best-of-2:retry-won,judge-refine:kept-original,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл надає публічну функцію `lint` для перевірки коду в fail-safe режимі: помилки перехоплюються й не викидаються назовні, щоб перевірка не зупиняла зовнішній процес аварійно. Власних операцій запису у файлову систему або базу даних файл не виконує.

## Поведінка

1. `lint` обмежує hygiene-перевірки Storybook лише Vue component library пакетами в актуальному скоупі, щоб не створювати хибні спрацювання для app-пакетів із власними Vite aliases та іншим способом підключення Quasar у Storybook.

2. Для кожного такого пакета перевіряє `.vue`-файли на сторонні імпорти, яких немає в `dependencies` або `peerDependencies` у `package.json`. Відносні імпорти, типові aliases, Node built-ins і auto-import globals не вважаються проблемою.

3. Якщо знаходить незадекларований сторонній пакет, додає порушення з маркером повідомлення ``, щоб запобігти тихим поломкам після змін у third-party залежностях.

4. Окремо визначає пакети з глобальними Quasar SCSS-змінними й перевіряє, чи Storybook конфігурація бібліотеки вмикає їх підхоплення через `sassVariables`.

5. Якщо глобальні SCSS-змінні є, але Storybook їх не підхоплює, додає м’яке попередження, бо це може розсинхронити вигляд компонентів між звичайним build і Storybook.

6. Breaking-change guard для мажорних оновлень third-party пакетів свідомо не автоматизує: це лишається людським пунктом ревʼю.

7. У разі внутрішньої помилки повертає fail-safe результат лінту без прокидання винятку назовні.

## Публічний API

- lint — Detector concern-а `storybook/hygiene`: для кожного Vue component library пакета у скоупі
  канону Storybook (`collectInScopeVuePackages`) — undeclared third-party imports у `.vue` та
  auto-detect глобальних Quasar SCSS-змінних без `sassVariables` у `.storybook/main.js`
  (storybook.mdc, ADR Кластер 6). Breaking-change guard при мажорному апгрейді
  third-party-пакетів свідомо не автоматизується — людський пункт, hygiene.mdc.

Свідомо ЛИШЕ `type: 'library'` (хвиля 2a, фікс за результатами живого пілота gt):
обидві перевірки писались і перевірялись лише на бібліотечному кейсі й дають хибні
спрацювання на app-пакетах. (1) Undeclared-import: app-пакети типово мають
`resolve.alias` у своєму `vite.config.js` (Quasar CLI-конвенція — `src`, `components`,
`boot`, `layouts`, `pages` тощо), тож `.vue`-сторінка легітимно імпортує
`import X from 'components/Foo.vue'` (без `./`/`@/`-префікса) — `isRelativeOrAliasSpecifier`
цього не розпізнає й трактує alias як ім'я стороннього npm-пакета. (2) Sass-variables:
app-канонічний `.storybook/main.js` (хвиля 2a) СВІДОМО не викликає `quasar()` взагалі —
`@storybook/builder-vite` підхоплює повний `vite.config.js` app-проєкту без власного
`viteFinal`-інстанса (асиметрія з бібліотекою, `scaffold/template/app-main.js`) — маркер
`sassVariables` там ніколи не з'явиться, навіть якщо SCSS-змінні пакета коректно
підключені через власний `vite.config.js`.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
