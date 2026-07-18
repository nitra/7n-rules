---
description: Локальний та CI-секюріті-лінт через TruffleHog — `.trufflehog-exclude`, канонічний placeholder `sample-secret` у прикладних файлах
globs: "**/.trufflehog-exclude,**/package.json,**/.github/workflows/**/*.yml"
alwaysApply: false
version: '2.1'
---

Правило **security** забезпечує сканування секретів через [TruffleHog](https://github.com/trufflesecurity/trufflehog) локально та на CI, а також правильне використання placeholder-значень у прикладних файлах.

## Перевірка

`npx @7n/rules fix security`

- `package.json`:

```json
{
  "dependencies": { "trufflehog": "глобальний CLI — не додавай у dependencies" },
  "devDependencies": { "trufflehog": "глобальний CLI — не додавай у devDependencies" }
}
```

## Заборона `trufflehog` у залежностях `package.json`

Rego-пакет: `security.package_json`

Цільові файли: `package.json`

Перевіряє, що пакет `trufflehog` відсутній у `dependencies` та `devDependencies` — він є глобальним CLI і не має бути npm-залежністю. Список заборонених пакетів надходить через `--data` з [package.json.deny.json](./template/package.json.deny.json).

## Placeholder для секретів — `sample-secret`

Фейкові credential-значення у **прикладних файлах** (`.env.example`, `.env.dist`, `*.example`, `*.sample`, `*.template`, вміст каталогів `fixtures/`) пиши як `sample-secret`, а не як bare `secret`.

`sample-secret` містить підрядок `sample` із вшитого списку `DefaultFalsePositives` TruffleHog — таке значення сканер відсіює **гарантовано** й незалежно від версії. Bare `secret` наразі не фіксується сканером лише тому, що випадково присутнє у словнику `fp_words.txt`; це крихка поведінка, що залежить від версії інструмента.

### Приклади

- Правильно: `DB_PASSWORD=sample-secret`, `password: "sample-secret"`
- Неправильно: `DB_PASSWORD=secret`, `password: "secret"`

### Що перевіряється

Перевіряється лише `secret` у позиції значення (після `=`, `:`, `=>`); імена ключів на кшталт `client_secret` не чіпаються.

Concern `security.sample_secret` (`js/sample_secret.mjs`) сканує всі прикладні файли:

- суфікс basename'а: `.example`, `.sample`, `.template`, `.dist`
- інфікс у basename'і: `.example.`, `.sample.`, `.template.`
- сегмент шляху: `fixtures/`, `fixture/`, `__fixtures__/`

## TruffleHog — налаштування та `.trufflehog-exclude`

[TruffleHog](https://github.com/trufflesecurity/trufflehog) — глобальний CLI (як `shellcheck`, `conftest`); **не** додавай до `dependencies`/`devDependencies`.

Скан запускається через `n-rules lint security` (CI — `n-rules lint security --no-fix`); окремого `lint-*` скрипта в `package.json` немає.

### Ключові прапори запуску

- `trufflehog filesystem .` — сканує робоче дерево як директорію (включно з untracked/gitignored файлами); підкоманда `git file://.` лишається на CI для аудиту історії.
- `--no-update` — вимикає self-update check (CI-friendly).
- `--exclude-paths .trufflehog-exclude` — файл з regex-patterns, які треба пропускати (аналог `[allowlist].paths` із gitleaks).
- `--results=verified,unknown` — показує лише верифіковані секрети + ті, що TruffleHog не зміг перевірити (`unverified` дублікат відсіюється).
- `--fail` — exit-code `183` за наявності знахідок (щоб лінт падав).

### `.trufflehog-exclude` (рекомендована основа)

Канон (допускає розширення): [.trufflehog-exclude.snippet.txt](./templates/trufflehog/.trufflehog-exclude.snippet.txt)

**Важливо:** один regex-pattern на рядок, без TOML-обгортки; коментарі починаються з `#`.

Перевірка (JS): `js/trufflehog.mjs` — впевнюється, що файл `.trufflehog-exclude` існує в корені й містить канонічні шаблони.

## Наявність кроку TruffleHog у CI workflow

Rego-пакет: `security.lint_security_yml`

Цільові файли: `.github/workflows/lint-security.yml`

Перевіряє, що серед `uses:` у workflow присутній крок `trufflesecurity/trufflehog@main`. Очікуваний перелік action-refs (не-`actions/*`) береться з `--data` через [lint-security.yml.snippet.yml](./template/lint-security.yml.snippet.yml). Універсальні кроки (`actions/*`) перевіряє `ga.workflow_common`.
