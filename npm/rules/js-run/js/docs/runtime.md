---
type: JS Module
title: runtime.mjs
resource: npm/rules/js-run/js/runtime.mjs
docgen:
  crc: 1a524399
  model: claude-sonnet-4-6
  score: 100
---

Модуль перевіряє відповідність правилам `js-run.mdc` для всіх workspace-пакетів монорепо (не кореневого пакета). Frontend-пакети (з `vite` у `devDependencies`) пропускаються повністю — перевіряються лише backend-пакети.

## Поведінка

`check` обходить workspace-пакети і для кожного запускає перевірки:

1. **jsconfig** — якщо у пакеті є `src/`, валідує `jsconfig.json` через Rego-поліс `js_run.jsconfig` (FS-existence + canonical `compilerOptions`/`include`).
2. **bunyan** — сканує JS/TS джерела на заборонені імпорти `@nitra/bunyan` / `bunyan`; замінити на `@nitra/pino`.
3. **conn-imports** — перевіряє, що фабрики підключень (Bun SQL, mssql, graphql-request) імпортуються лише з файлів у `connDir` (`src/conn` або значення `#conn/*` з `package.json.imports`).
4. **conn-file-naming** — для файлів у `connDir/` (окрім `index.*`) перевіряє канон назви (`ql-<id>`, `pg-{read|write}[-<id>]`, `mysql-…`, `mssql-…`) і що єдиний іменований експорт = camelCase від basename.
5. **check-env** — сканує на прямий `process.env.*` (заміна — `env` з `@nitra/check-env` + `checkEnv(['…'])`) і на `env.*` без відповідного `checkEnv`.
6. **promise-settimeout** — шукає `new Promise(r => setTimeout(r, ms))`; замінити на `await setTimeout(ms)` з `node:timers/promises`.
7. **temporal** — забороняє `Temporal` API у Bun runtime; альтернатива — `Date` або інʼєктований timestamp.
8. **otel-configmap** — перевіряє наявність `k8s/base/configmap.yaml` (вміст перевіряє Rego `js_run.configmap`).
9. **conn-alias** — якщо у `connDir/` є файли, `package.json.imports["#conn/*"]` має бути оголошений.

## Публічний API

- `check(cwd?)` — перевіряє всі workspace-пакети (виключає `.`); повертає `0` або `1`.

## Гарантії поведінки

- Read-only: файл не виконує операцій запису у файлову систему.
- Не звертається до мережі.
