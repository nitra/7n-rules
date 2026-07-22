---
type: JS Module
title: main.mjs
resource: plugins/lang-python/rules/python/workspace_root/main.mjs
docgen:
  crc: f45d6f1f
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл виявляє порушення моделі Python/uv workspace, де в репозиторії має бути рівно один кореневий workspace і один спільний lockfile. Він існує як read-only lint-контроль структурних проблем: `MISSING_ROOT_WORKSPACE`, `NESTED_WORKSPACE`, `PACKAGE_NOT_WORKSPACE_MEMBER` і `NESTED_LOCKFILE`, без спроб автоматично переносити чи виправляти файли. Під час обходу свідомо ігнорує `.git` і `node_modules`, кешує результати в межах одного прогону та працює fail-safe: перехоплює помилки й не кидає їх назовні.

## Поведінка

`lint` запускає read-only перевірку Python/uv workspace від кореня репозиторію, визначеного через `package.json`, збирає маніфести й lockfile-и, пропускаючи `.git` і `node_modules`, та накопичує порушення без змін у файловій системі.

Перевірка очікує один кореневий uv workspace: якщо кореневий маніфест не оголошує workspace, результат позначається кодом `MISSING_ROOT_WORKSPACE` — `"missing-root-workspace"` для відсутньої кореневої декларації. Після цього знайдені маніфести зіставляються з кореневими правилами membership і exclude: вкладені декларації workspace репортяться як `NESTED_WORKSPACE` — `"nested-workspace"` для забороненого workspace нижче кореня, а package-маніфести поза coverage кореневих members — як `PACKAGE_NOT_WORKSPACE_MEMBER` — `"package-not-workspace-member"` для пакетів, які мають бути включені до workspace або явно винесені з нього.

Lockfile-и перевіряються в тому ж контексті workspace: кореневий lockfile є єдиним очікуваним спільним джерелом резолюції, а додаткові lockfile-и поза дозволеними виключеннями репортяться як `NESTED_LOCKFILE` — `"nested-lockfile"` для локальних lockfile-ів, що розбивають єдину workspace-модель.

У межах одного прогону `lint` повторно використовує розібрані маніфести, щоб узгоджено перевіряти nested workspace, membership і lockfile-и на тих самих даних. Помилки читання або розбору обробляються fail-safe: перевірка повертає результат лінту з доступними діагностиками, не кидаючи винятки назовні.

## Публічний API

- NESTED_WORKSPACE — Стабільний reason: вкладений `[tool.uv.workspace]` поза кореневим pyproject.toml.
- NESTED_LOCKFILE — Стабільний reason: вкладений uv.lock у не-виключеному member (має бути один кореневий).
- MISSING_ROOT_WORKSPACE — Стабільний reason: кореневий pyproject.toml без `[tool.uv.workspace]` при кількох пакетах.
- PACKAGE_NOT_WORKSPACE_MEMBER — Стабільний reason: пакет не входить у members кореневого uv workspace.
- lint — знаходить проблеми з workspace-структурою пакетів за даними з package.json: забороняє вкладені workspace та lockfile у підпакетах, вимагає root workspace і членство пакета в ньому.

Експортовані константи-рядки позначають причини діагностик: NESTED_WORKSPACE="nested-workspace" — підпакет оголошує власний workspace; NESTED_LOCKFILE="nested-lockfile" — у підпакеті є локальний lockfile; MISSING_ROOT_WORKSPACE="missing-root-workspace" — кореневий проєкт не оголошує workspace; PACKAGE_NOT_WORKSPACE_MEMBER="package-not-workspace-member" — пакет не входить до кореневого workspace.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- Кешує результати в межах одного прогону.
- Свідомо пропускає шляхи: `.git`, `node_modules`.
