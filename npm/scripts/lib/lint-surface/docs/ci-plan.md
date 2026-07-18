---
type: JS Module
title: ci-plan.mjs
resource: npm/scripts/lib/lint-surface/ci-plan.mjs
docgen:
  crc: ce7f2a96
  model: openai-codex/gpt-5.4-mini
  score: 90
  issues: internal-name:computeActiveDomains,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл визначає спільний для GitHub Actions і Azure Pipelines CI-план для сервіс-орієнтованого запуску lint-доменів: за git-дельтою та `--path` він вирішує, які домени мають узагалі стартувати. Джерело правди активності домену — та сама таблиця, що й у `lint <domain> --path`: якщо `plan` сказав `true`, відповідний lint-домен щось запускатиме; якщо `false` — CI-джоби скіпаються через `if:`/`condition:`. Гейт-джоба `plan` емить `js=true|false` для наступних CI-джоб. Команда read-only: без глобального лока, без мутації `package.json`, без root-guard. Якщо база дельти не резолвиться (`main`, `origin/main` чи `--base`-ref недоступні), код переходить у fail-open: показує warning і вмикає всі домени.

## Поведінка

- `computeCiPlan` — обчислює CI-план для всього репозиторію або для `--path`, визначає стан доменів, ознаку змін, наявність тестів у піддереві та переходить у fail-open, якщо база дельти не резолвиться.
- `renderCiPlanHuman` — перетворює CI-план у лаконічний людиночитаний звіт для stdout, показуючи стан бази, домени та агреговані прапори.
- `renderCiPlanGithubLines` — формує рядки `name=value` для `$GITHUB_OUTPUT`, щоб GitHub Actions міг використовувати результати плану як outputs.
- `renderCiPlanAzureLines` — формує Azure Pipelines logging commands для output-змінних, щоб downstream-джоби могли читати результати плану.
- `runCiPlanCli` — обробляє CLI-підкоманду `n-rules ci plan`, обирає формат виводу (`--json`, `--github`, `--azure` або human), і повідомляє про fail-open, якщо база дельти не визначилась.

## Публічний API

- computeCiPlan — формує набір CI-доменів для запуску: або для сервісу з `--path`, або для всього репо без нього.
- renderCiPlanHuman — виводить план у зручному для людини вигляді в stdout.
- renderCiPlanGithubLines — готує `name=value` рядки для `$GITHUB_OUTPUT`: окремо для кожного домену та для агрегованих значень.
- renderCiPlanAzureLines — виводить Azure Pipelines logging commands у stdout, щоб downstream-джоби читали значення з output variables.
- runCiPlanCli — обробляє `n-rules ci plan` і підтримує `--path`, `--base`, `--cwd`, `--github`, `--azure`, `--json`.

Changelog: не перевірявся

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
