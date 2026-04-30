# Changelog

Усі помітні зміни цього модуля документуються тут.

Формат — [Keep a Changelog](https://keepachangelog.com/uk/1.1.0/), нумерація — [SemVer](https://semver.org/lang/uk/).

## [1.8.158] - 2026-05-01

### Changed

- `check-hasura.mjs`: файл `.env` без імені (локальний файл розробника) виключено з перевірки `HASURA_GRAPHQL_ENDPOINT` — скануються лише `*.env` із префіксом (`dev.env`, `production.env` тощо).
- `hasura.mdc`: явно зафіксовано виключення для `.env` без імені.

## [1.8.157] - 2026-04-30

### Added

- Правило `npm-module.mdc`: секція **CHANGELOG** — разом із bump build-версії в `npm/package.json` обовʼязково оновлювати `npm/CHANGELOG.md` (Keep a Changelog).
- `check-npm-module.mjs`: перевірка наявності `npm/CHANGELOG.md`, наявності в `files` у `npm/package.json` і запису для поточної версії.
- `check-hasura.mjs`: перевірка `HASURA_GRAPHQL_ENDPOINT` у `*.env` для проєктів **nitra** і **abie** — має бути внутрішнім кластерним URL виду `http://<service>.<namespace>.svc.<cluster>.internal:<port>`; за наявності `hasura/k8s/base/svc-hl.yaml` та `hasura/k8s/base/namespace.yaml` додатково звіряється `<service>` і `<namespace>`.

### Changed

- `npm/package.json`: `CHANGELOG.md` додано в масив `files`, щоб публікувався разом із пакетом.
- `hasura.mdc`: текст правила переформульовано як людинозрозумілий з прикладом і посиланням на `check-hasura.mjs`.
