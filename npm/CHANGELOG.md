# Changelog

Усі помітні зміни цього модуля документуються тут.

Формат — [Keep a Changelog](https://keepachangelog.com/uk/1.1.0/), нумерація — [SemVer](https://semver.org/lang/uk/).

## [1.8.163] - 2026-05-01

### Changed

- `check-js-lint.mjs`: `ignorePatterns` у `.oxlintrc.json` тепер звіряється як `rules` — канонічні патерни мають бути присутні, додаткові локальні glob-и дозволені (раніше була строга рівність — будь-який зайвий запис зламував перевірку).
- `check-text.mjs`: `OXFMT_REQUIRED_IGNORE_PATTERNS` доповнено `**/auto-imports.d.ts` (узгоджено з каноном oxlint); перевірка `.oxfmtrc.json` уже працює як subset, тому локальні розширення не падають.
- `js-lint.mdc` / `n-js-lint.mdc`, `text.mdc` / `n-text.mdc`: документовано, що канон задає мінімум `ignorePatterns`, локальне розширення дозволене.

## [1.8.162] - 2026-05-01

### Changed

- `oxlint-canonical-skeleton.json` (та перебудований `oxlint-canonical.json`): `ignorePatterns` тепер містить `["**/schema.graphql", "**/auto-imports.d.ts"]` (узгоджено з `.oxfmtrc.json`). Споживачі мають синхронізувати корінь `.oxlintrc.json` із каноном — `check-js-lint` падатиме, поки масив не збігається.

## [1.8.161] - 2026-05-01

### Added

- `js-bun-db.mdc` (v1.5): нова секція «Прибирати pg-leftover виклики (`.connect()`, `.end()`)». У файлах з Bun SQL прапоруються `<obj>.connect(...)` і `<obj>.end(...)` як ручний lifecycle, який Bun SQL робить за тебе. Opt-out — маркер `// allow-pg-leftover: <причина>` (line- або block-коментар на тому ж рядку чи безпосередньо перед викликом).
- `bun-sql-scan.mjs`: новий сканер `findBunSqlPgLeftoverCallInText` (скоп — лише файли з `import { sql|SQL } from 'bun'`, щоб не давати false-positive на WebSocket/Stream `.end()`). Виділено спільний `hasMarkerCommentNear` для обох opt-in маркерів (`allow-unsafe`, `allow-pg-leftover`).

## [1.8.160] - 2026-05-01

### Changed

- `js-bun-db.mdc` (v1.4): `sql.unsafe(...)` тепер заборонено за замовчуванням — допустимо лише для підстановки назви таблиці/колонки чи dynamic SQL/DDL з code-controlled значенням; інакше переробляємо на tagged template `sql\`...${value}...\``. Кожен легітимний виклик має супроводжуватись маркером `// allow-unsafe: <причина>` на тому ж рядку або рядком вище.
- `check-js-bun-db.mjs`: замість вузької перевірки `sql.unsafe(\`...${expr}...\`)` тепер сканер `findBunSqlUnsafeUseWithoutAllowMarkerInText` падає на будь-якому `<obj>.unsafe(...)` без маркера-коментаря з непорожньою причиною (line- або block-коментар на тому ж рядку чи безпосередньо перед викликом).
- `ast-scan-utils.mjs`: додано `parseProgramAndCommentsOrNull` — окремий вхід для перевірок, яким потрібні коментарі поряд з AST.

## [1.8.159] - 2026-05-01

### Added

- Інтеграція з Claude Code: новий каталог `npm/.claude-template/` із `settings.template.json` (Stop hook + permissions allowlist), `npm-CLAUDE.md` (path-scoped нагадування для роботи в `npm/`) і slash-команду `/n-check`.
- `sync-claude-config.mjs`: під час `npx @nitra/cursor` синхронізує `.claude/settings.json` (merge — користувацькі поля зберігаються, наші hooks ідентифікуються маркером і перезаписуються), `npm/CLAUDE.md` і slash-команди checks.
- Subcommand `npx @nitra/cursor stop-hook` — точка входу Stop hook Claude Code (читає stdin, виходить 0 при `stop_hook_active=true` для захисту від рекурсії, інакше викликає `check`).
- Поле `claude-config` у `.n-cursor.json` (default `true`) для опт-ауту.
- Тести `npm/tests/sync-claude-config.test.mjs` — merge allow-list/hooks, інтеграція, ідемпотентність, опт-аут (12 кейсів).

### Changed

- `npm/schemas/n-cursor.json`: додано опис поля `claude-config`.
- `npm/package.json`: `.claude-template` додано в масив `files`, щоб публікувався з пакетом.

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
