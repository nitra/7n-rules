---
session: 9dfc7994-b7a9-48df-8524-8c221d82d608
captured: 2026-05-18T10:05:21+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/9dfc7994-b7a9-48df-8524-8c221d82d608.jsonl
---

## ADR Обов'язкові markdown-посилання на template-файли у канонічних `.mdc`

## Context and Problem Statement
Перевірка `findMissingMdcRefs` (у `npm/scripts/utils/run-rule.mjs`) завершувалась помилкою для правил `text`, `js-lint`, `js-run`: їхні канонічні `<id>.mdc` не містили markdown-посилань на жодного файла з підкаталогів `policy/*/template/`. Правило `security` вже відповідало вимогам і слугувало взірцем.

## Considered Options
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати markdown-посилання в канонічні `.mdc`", because `findMissingMdcRefs` вимагає, щоб кожен файл у `template/` був згаданий як посилання в `<id>.mdc`, а правило `security` вже дотримувалось цієї конвенції — її поширили на решту правил.

### Consequences
* Good, because `findMissingMdcRefs` тепер проходить для `text` (v1.28), `js-lint` (v1.23), `js-run` (v1.9) — перевірено у transcript (`text → OK`, `js-lint → OK`, `js-run → OK`).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли: `npm/rules/text/text.mdc`, `npm/rules/js-lint/js-lint.mdc`, `npm/rules/js-run/js-run.mdc`. Верифікація: `node -e "import('./npm/scripts/utils/check-mdc-template-refs.mjs').then(..."`. Пакет: `npm/package.json` 1.13.26 → 1.13.27, запис у `npm/CHANGELOG.md`.

---

## ADR Виправлення `stripJsonComments` з урахуванням рядкових літералів

## Context and Problem Statement
Функція `stripJsonComments` у `npm/scripts/utils/template.mjs` (рядок ~21) використовувала regex `/\/\*[\s\S]*?\*\//g` без розрізнення string-літералів. Через це glob-патерн `**/node_modules/**` у масиві `ignorePaths` файлу `.cspell.json.snippet.json` трактувався як відкриваючий `/*`, а наступний `**/vscode-extension/**` — як закриваючий `*/`; сім елементів масиву колапсували в один склеєний рядок. Rego-перевірка скаржилась, що канонічні glob-и відсутні в `.cspell.json` проєкту.

## Considered Options
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Regex з альтернативою для рядкових літералів", because рядок вигляду `"(?:\\.|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/[^\n]*` дозволяє пропускати вміст у лапках нетронутим і прибирати лише справжні коментарі.

### Consequences
* Good, because усі 26 тестів у `npm/scripts/utils/template.test.mjs` проходять, включно з новим регресійним тестом для glob-патернів з `/*` і `*/`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли: `npm/scripts/utils/template.mjs`, `npm/scripts/utils/template.test.mjs`. Пакет `npm/package.json` зафіксовано в `1.13.28`, відповідний запис у `npm/CHANGELOG.md` — рядок `### Fixed`.

---

## ADR Per-project файл винятків kubescape (`.kubescape-exceptions.json`)

## Context and Problem Statement
`lint-k8s` (`kubescape scan`) тригерував контроль C-0012 ("Applications credentials in configuration files") на env-змінній `HASURA_GRAPHQL_JWT_SECRET` у `configmap.yaml`. Значення містить публічний JWT-конфіг (`jwk_url` + `issuer`) — не credentials — але kubescape не розрізняє публічні та приватні значення за іменем ключа.

## Considered Options
* Per-project exceptions-файл (`.kubescape-exceptions.json` у корені проєкту, передається через `--exceptions`)
* (Інші варіанти були запропоновані системою, але користувач вибрав лише цей.)

## Decision Outcome
Chosen option: "Per-project exceptions-файл", because це стандартний механізм kubescape для обходу false-positive на рівні конкретного проєкту без глобальних змін у правилі.

### Consequences
* Good, because `lint-k8s` автоматично підхоплює `.kubescape-exceptions.json` з кореня проєкту, якщо файл існує (`existsSync`), і додає `--exceptions <abs-path>` до виклику kubescape; відсутність файлу нічого не змінює (backward-compatible).
* Good, because `k8s.mdc` (v1.30) тепер документує формат канонічного `actionType: alertOnly` для C-0012 з прикладом `HASURA_GRAPHQL_JWT_SECRET`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли: `npm/rules/k8s/lint/lint.mjs` (нові функції `buildKubescapeExceptionsArgs`, оновлений `runKubescape(dirs, root)`), `npm/rules/k8s/lint/run-roots.test.mjs` (новий тест для `buildKubescapeExceptionsArgs`), `npm/rules/k8s/k8s.mdc`. Пакет: `npm/package.json` 1.13.31 → 1.13.32, запис у `npm/CHANGELOG.md`. Тести: 6 pass у `run-roots.test.mjs`.
