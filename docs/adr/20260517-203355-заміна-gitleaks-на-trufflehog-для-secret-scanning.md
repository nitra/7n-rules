---
session: 3e24d1f5-91f5-4ecb-8cd8-a93d4121e0a5
captured: 2026-05-17T20:33:55+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/3e24d1f5-91f5-4ecb-8cd8-a93d4121e0a5.jsonl
---

## ADR Заміна gitleaks на TruffleHog для secret scanning

## Context and Problem Statement
Проєкт використовував gitleaks як канонічний інструмент secret scanning через скрипт `lint-security` у `package.json`. Виникло рішення перейти на TruffleHog.

## Considered Options
* Залишити gitleaks
* Перейти на TruffleHog

## Decision Outcome
Chosen option: "Перейти на TruffleHog", because так вирішив користувач (команда «давай замінимо gitleaks на TruffleHog»).

### Consequences
* Good, because канонічний скрипт `lint-security` і всі пов'язані артефакти (`.trufflehog-exclude`, шаблони, Rego-политики, тести) оновлено узгоджено: `npm/rules/security/`, `package.json`, `.cursor/rules/n-security.mdc`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Видалено: `npm/rules/security/fix/gitleaks/`, `npm/rules/security/policy/gitleaks/`, `.gitleaks.toml`.
Додано: `npm/rules/security/fix/trufflehog/check.mjs`, `check.test.mjs`, `template/.trufflehog-exclude.snippet.txt`, `.trufflehog-exclude`.
Bump: `npm/package.json` 1.13.25 → 1.13.26.

---

## ADR Режим сканування `trufflehog filesystem` (без git-history)

## Context and Problem Statement
TruffleHog підтримує кілька режимів сканування (`filesystem`, `git`, `github` тощо). Потрібно було вибрати режим для `lint-security`, аналогічний попередньому `gitleaks detect --no-git` (сканування робочого дерева без читання git-об'єктів).

## Considered Options
* `trufflehog filesystem` — сканує робоче дерево як директорію (аналог `--no-git`)
* `trufflehog git` — сканує git-history
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`trufflehog filesystem`", because користувач явно обрав цей варіант як аналог `--no-git` — сканує uncommitted і untracked файли без читання git-history.

### Consequences
* Good, because transcript фіксує очікувану користь: поведінка відповідає попередньому `gitleaks detect --no-git` — сканує робоче дерево включно з untracked/gitignored файлами.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Канонічна команда: `trufflehog filesystem . --no-update --exclude-paths .trufflehog-exclude --results=verified,unknown --fail`.
Файл: `npm/rules/security/policy/package_json/template/package.json.snippet.json`.

---

## ADR Фільтр результатів `--results=verified,unknown`

## Context and Problem Statement
TruffleHog може повертати результати трьох категорій: `verified` (підтверджені живі секрети), `unknown` (неможливо верифікувати), `unverified` (секрети, верифікація яких не вдалась). Потрібно вибрати рівень фільтрації для `lint-security`.

## Considered Options
* Без фільтра — всі знахідки
* `--only-verified` — лише підтверджені живі секрети
* `--results=verified,unknown` — підтверджені + невідомі

## Decision Outcome
Chosen option: "`--results=verified,unknown`", because користувач явно обрав цей варіант (відповідь на `AskUserQuestion`).

### Consequences
* Good, because transcript фіксує очікувану користь: менше false positives порівняно з «усі знахідки», але менше false negatives ніж `--only-verified`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Канонічна команда: `trufflehog filesystem . --no-update --exclude-paths .trufflehog-exclude --results=verified,unknown --fail`.

---

## ADR Файл `.trufflehog-exclude` через `--exclude-paths` як allowlist

## Context and Problem Statement
gitleaks використовував `.gitleaks.toml` з секцією `[allowlist]` для виключення тестових фікстур і службових шляхів. Після переходу на TruffleHog потрібен аналогічний механізм.

## Considered Options
* Виключення прямо в команді `lint-security`
* Файл `.trufflehog-exclude` через `--exclude-paths`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Файл `.trufflehog-exclude` через `--exclude-paths`", because користувач явно обрав цей варіант (відповідь на `AskUserQuestion`); файл у корені проєкту дзеркалить патерн `.gitleaks.toml`.

### Consequences
* Good, because transcript фіксує очікувану користь: project-level allowlist файл перевіряється Rego/check-механізмом через `npm/rules/security/fix/trufflehog/template/.trufflehog-exclude.snippet.txt`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `.trufflehog-exclude` (корінь репо), `npm/rules/security/fix/trufflehog/template/.trufflehog-exclude.snippet.txt` (канонічний шаблон).
Перевірка наявності та підмножини рядків реалізована у `npm/rules/security/fix/trufflehog/check.mjs` через `checkTextSubset`.
