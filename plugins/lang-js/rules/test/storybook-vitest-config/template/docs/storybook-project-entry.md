---
type: JS Module
title: storybook-project-entry.js
resource: plugins/lang-js/rules/test/storybook-vitest-config/template/storybook-project-entry.js
docgen:
  crc: 5a973960
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:error
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Канонічний запис `storybook`-проєкту в `test.projects`, щоб `storybook.mdc`, `vitest-config` і ADR Кластер 5 сходилися на одному форматі для browser-mode перевірок.  
Фіксує browser-mode з одним браузером `chromium`, `stories-glob` через токен `__STORYBOOK_STORIES_GLOB__`, а `detectStoriesGlob` зі scaffold-концерна використовує шлях без префіксу `../`.  
Вимагає `provider: playwright` як factory-виклик з `@vitest/browser-playwright`, бо `vitest@^4` прибрав рядкове API провайдера, а `@vitest/browser-playwright` постачається окремим пакетом.  
Дає `fix-vitest-config.mjs` читати лише вміст `export default {...}` для стабільного оновлення Storybook-інтеграції.

## Поведінка

1. Описує канонічний `storybook`-проєкт для `test.projects`, щоб збірка й перевірки для Storybook у репозиторії мали єдиний очікуваний вигляд.
2. Закріплює browser-mode з одним браузером — `chromium` — щоб цей проєкт запускався в однаковому середовищі.
3. Визначає набір stories через окремий токен-шаблон, який підставляється зі scaffold-конвеєра без додаткового префіксу шляху.
4. Використовує `playwright` як provider, щоб відповідати актуальному API `vitest` і не покладатися на застарілу строкову форму.
5. Підключає Storybook-інтеграцію через окремий конфігураційний запис, щоб `vitest-config` міг стандартизовано зібрати проєкт.
6. Дає `fix-vitest-config.mjs` стабільний фрагмент для читання: лише зміст експорту, без додаткових поведінкових припущень поза цим модулем.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
