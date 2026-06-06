# workflows.mjs

## Огляд

Файл перевіряє GitHub Actions workflows на відповідність певним правилам та стандартам. Він забезпечує консистентність та якість workflow, виявляючи потенційні проблеми, такі як відсутність clean/lint workflow або використання непідтримуваних інструментів. Це частина автоматизованого процесу забезпечення дотримання найкращих практик при розробці GitHub Actions.

## Поведінка

*   `checkShellcheckInstalled`: Перевіряє наявність бінарника `shellcheck` в системному PATH.
*   `checkGaWorkflowFiles`: Перевіряє наявність workflow-файлів з розширенням `.yml` та відсутність інших розширень.
*   `runAllGaRego`: Запускає Rego-перевірки для всіх workflow-файлів, використовуючи `conftest` для аналізу.
*   `check`: Координує всі перевірки, включаючи Rego-аналіз, перевірку workflow-структури та перевірку наявність файлів.

## Публічний API

- checkShellcheckInstalled — Перевіряє наявність `shellcheck` у системі та зупиняє workflow, якщо його немає.
- check — Перевіряє відповідність проєкту правилам валідації.
- runAllGaRego — Запускає Rego-перевірку правил, як перший етап валідації.
- lint-ga — Запускає перевірку `bun lint-ga` з використанням `actionlint` та `zizmor`.

## Гарантії поведінки

*   Гарантується наявність файлів `package.json`, `.vscode/*` та `.github/zizmor.yml`.
*   Гарантується, що workflow використовує `actions/checkout@v6` перед локальними операціями.
*   Гарантується, що workflow використовує composite action `action.yml` з `npx @nitra/cursor`.
*   Гарантується, що workflow містить `clean-ga-workflows.yml`, `clean-merged-branch.yml`, `lint-ga.yml` та `git-ai.yml`.
*   Гарантується, що workflow використовує `concurrency` для паралельного виконання.
*   Гарантується, що workflow не містить `oven-sh/setup-bun`, `actions/cache`, `bun install` у `uses` або `run`.
*   Гарантується, що workflow не використовує shell-продовження `\` у `run`.
*   Гарантується, що workflow використовує `shellcheck` локально.
*   Гарантується, що workflow перевіряє наявність файлів за допомогою `git ls-files :(glob)` та `on.*.paths`.
*   Гарантується, що workflow перевіряє наявність файлів, що залишилися від MegaLinter.
