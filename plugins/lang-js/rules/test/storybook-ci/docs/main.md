---
type: JS Module
title: main.mjs
resource: plugins/lang-js/rules/test/storybook-ci/main.mjs
docgen:
  crc: b29cb4d1
  model: openai-codex/gpt-5.4-mini
  score: 85
  issues: internal-name:collectInScopeVuePackages,anchor-miss:(storybook.mdc),judge:inaccurate:0.96
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл фіксує канонічні репо-шляхи й маркери для storybook CI, щоб у Vue component library пакетах у scope швидко знаходити правильні `.github/actions/setup-playwright-chromium/action.yml` і `.github/workflows/lint-storybook.yml` та зіставляти їх із повідомленнями в `storybook.mdc`. Експортовані константи-рядки: PLAYWRIGHT_ACTION_REL=".github/actions/setup-playwright-chromium/action.yml" — канонічний шлях до Playwright action; STORYBOOK_WORKFLOW_REL=".github/workflows/lint-storybook.yml" — канонічний шлях до workflow linting. Маркери повідомлень: PLAYWRIGHT_ACTION_MARKERS і STORYBOOK_WORKFLOW_MARKERS, які прив’язують перевірки до повідомлень у `storybook.mdc`. Це потрібно, щоб підтримувати єдиний storybook-канон без зайвого обходу `.github` і `.git`, із кешуванням результату в межах одного прогону.

## Поведінка

- PLAYWRIGHT_ACTION_REL — задає репо-рівневий шлях до канонічного composite action `.github/actions/setup-playwright-chromium/action.yml`, який перевіряється як частина storybook CI.
- STORYBOOK_WORKFLOW_REL — задає репо-рівневий шлях до канонічного workflow `.github/workflows/lint-storybook.yml`, що відповідає за швидкий storybook-лінт.
- PLAYWRIGHT_ACTION_MARKERS — описує канонічні ознаки composite action для storybook CI, щоб гарантувати кеш Playwright і встановлення лише chromium; у повідомленнях використовується прив’язка до `storybook.mdc`.
- STORYBOOK_WORKFLOW_MARKERS — описує канонічні ознаки workflow для storybook CI, щоб гарантувати запуск швидкого `vitest --project=storybook`; у повідомленнях використовується прив’язка до `storybook.mdc`.
- lint — перевіряє наявність storybook CI-канону лише для репозиторіїв із Vue component library пакетами в scope; якщо таких пакетів немає, завершується без зауважень. Свідомо не зачіпає `.github` і `.git` як окремі області обходу; кешує результат у межах одного прогону.

## Публічний API

- PLAYWRIGHT_ACTION_REL — Repo-relative шлях канонічного composite action (не per-package — один на репозиторій).
- STORYBOOK_WORKFLOW_REL — Repo-relative шлях канонічного workflow, що запускає `vitest --project=storybook`.
- PLAYWRIGHT_ACTION_MARKERS — Маркери канону composite action `setup-playwright-chromium` (ADR Кластер 5): кеш
  `ms-playwright` через `actions/cache`, ключ від версії playwright, install лише chromium.
  Текстовий пошук — той самий підхід, що й `MAIN_JS_MARKERS`/`PREVIEW_JS_MARKERS` у `scaffold`.
- STORYBOOK_WORKFLOW_MARKERS — Маркери канону `.github/workflows/lint-storybook.yml`: композитний Playwright-кеш ПІСЛЯ
  setup-bun-deps, і швидкий `vitest --project=storybook` (ADR Кластер 5 — nightly-only
  `@7n/test coverage`/mutation-testing на PR не запускається, лише цей швидкий шлях).
- lint — Detector concern-а `storybook/ci` (ADR Кластер 5, CI-частина): для репозиторіїв з бодай
  одним Vue component library пакетом у скоупі Storybook (`collectInScopeVuePackages`) —
  канонічний composite action `setup-playwright-chromium` (кеш Playwright-браузерів, лише
  chromium) і канонічний `.github/workflows/lint-storybook.yml`, що запускає швидкий
  `vitest --project=storybook` на PR. Гейтований `requires.capability: ci:github` — спить
  у репозиторіях без плагіна `@7n/rules-ci-github` (немає `.github/workflows`).

Nightly-only `@7n/test coverage` (mutation testing) — поза обсягом цього concern-а: ADR
Кластер 5 явно розділяє швидкий PR-шлях (цей concern) і nightly mutation-прогін, який
лишається окремою інфраструктурою `test/stryker_config`.

## Гарантії поведінки

- Кешує результати в межах одного прогону.
- Свідомо пропускає шляхи: `.github`, `.git`.
