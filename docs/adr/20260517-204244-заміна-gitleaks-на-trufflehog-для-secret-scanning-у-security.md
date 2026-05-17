---
session: 3e24d1f5-91f5-4ecb-8cd8-a93d4121e0a5
captured: 2026-05-17T20:42:44+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/3e24d1f5-91f5-4ecb-8cd8-a93d4121e0a5.jsonl
---

## ADR Заміна gitleaks на TruffleHog для secret scanning у `security` rule

## Context and Problem Statement
Правило `security` використовувало `gitleaks detect` як канонічний скрипт `lint-security`. Виявилося, що без прапора `--no-git` gitleaks читає git-індекс і пропускає untracked/gitignored файли. Прийнято рішення мігрувати на TruffleHog із вибором конкретного режиму сканування, фільтра результатів і механізму allowlist.

## Considered Options
* gitleaks з доданим `--no-git`
* TruffleHog у режимі `filesystem` (без git-history)
* TruffleHog у режимі `git` (сканування git-history)

## Decision Outcome
Chosen option: "TruffleHog filesystem . --no-update --exclude-paths .trufflehog-exclude --results=verified,unknown --fail", because користувач явно обрав: режим `filesystem` (аналог `gitleaks detect --no-git`, сканує робоче дерево без git-history), фільтр `--results=verified,unknown` (показує верифіковані й невизначені знахідки), allowlist через файл `.trufflehog-exclude` (plain-text regex-patterns, не TOML). Попередній `.gitleaks.toml` видалено, патерни allowlist перенесені у `.trufflehog-exclude`.

### Consequences
* Good, because transcript фіксує очікувану користь: `npx @nitra/cursor check security` проходить чисто; усі 740 npm-тестів зелені; режим `filesystem` не залежить від git-індексу і покриває untracked-файли.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли, змінені внаслідок рішення:
- `npm/rules/security/fix/trufflehog/check.mjs` + `check.test.mjs` + `template/.trufflehog-exclude.snippet.txt` (новий JS-концерн)
- `npm/rules/security/policy/package_json/template/package.json.snippet.json` — канонічний snippet: `"lint-security": "trufflehog filesystem . --no-update --exclude-paths .trufflehog-exclude --results=verified,unknown --fail"`
- `npm/rules/security/policy/package_json/template/package.json.deny.json` — deny для `trufflehog` у `dependencies`/`devDependencies`
- `npm/rules/security/security.mdc` — bump version `1.1` → `2.0`, оновлено `globs`, пояснення flags
- `.cursor/rules/n-security.mdc` — пересинхронізовано
- `.trufflehog-exclude` — створено в корені репо
- `.gitleaks.toml` — видалено з корені репо
- `npm/rules/security/fix/gitleaks/`, `npm/rules/security/policy/gitleaks/` — видалено
- `package.json` (корінь) — `scripts.lint-security` оновлено
- `npm/package.json` — bump `1.13.25` → `1.13.26`

---

## ADR Канонічний workflow lint-security.yml перенесено до `policy/lint_security_yml/` з Rego-enforcement

## Context and Problem Statement
Workflow YAML для `.github/workflows/lint-security.yml` був прописаний як inline fenced block у `security.mdc` з анотацією `title=`. Усі інші rules (php, docker, ga, style-lint, js-lint) зберігають workflow-канон у `policy/<concern>/template/<name>.yml.snippet.yml` і валідують реальний файл через Rego policy. `security` rule був винятком без пояснення.

## Considered Options
* Залишити inline у `security.mdc` (поточний стан)
* Перенести у `template/` як документ-канон без Rego-enforcement
* Перенести у `template/` з повним Rego-enforcement (`policy/lint_security_yml/`)

## Decision Outcome
Chosen option: "Перенести у `policy/lint_security_yml/` з Rego-enforcement", because користувач явно обрав варіант «Перенести + Rego полісі (повний canon)», щоб бути послідовним з іншими rules.

### Consequences
* Good, because transcript фіксує очікувану користь: `conftest verify` проходить для нового policy; `npx @nitra/cursor check security` — чистий.
* Bad, because `.github/workflows/lint-security.yml` у самому репо `cursor` відсутній, тому Rego-check на наявність workflow поки не активний — policy вступить у силу лише після додавання цього файлу.

## More Information
Створені файли:
- `npm/rules/security/policy/lint_security_yml/target.json` — `{ "files": { "single": ".github/workflows/lint-security.yml" } }`
- `npm/rules/security/policy/lint_security_yml/lint_security_yml.rego` + `lint_security_yml_test.rego`
- `npm/rules/security/policy/lint_security_yml/template/lint-security.yml.snippet.yml` — канон workflow: trigger на `push`/`pull_request` до `dev`/`main`, `concurrency`, job `security` з `trufflehog/actions@main`
- `npm/scripts/utils/inline-template-links.test.mjs` — integration test оновлено з «4 template links» на «5 template links»
