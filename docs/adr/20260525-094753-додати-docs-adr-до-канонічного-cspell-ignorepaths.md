---
session: 2ce74495-ae37-461c-a696-487f7361df48
captured: 2026-05-25T09:47:53+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/2ce74495-ae37-461c-a696-487f7361df48.jsonl
---

## ADR Додати `docs/adr/**` до канонічного cspell `ignorePaths`

## Context and Problem Statement
Правило `n-text` формує обов'язковий `.cspell.json` у споживацьких репо через snippet-файл `rules/text/policy/cspell/template/.cspell.json.snippet.json`. ADR-чернетки у `docs/adr/` генеруються машинно stop-хуком `capture-decisions.sh` і перезаписуються `normalize-decisions.sh` — ручна правка правопису в них безглузда. Без виключення cspell повертає помилки саме у цих файлах, що запускає нову Claude-сесію → новий ADR → нову помилку (нескінченний цикл).

## Considered Options
* Додати `"docs/adr/**"` до snippet-файлу (канонічний ignorePath, що поширюється через rego-subset перевірку).
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати `docs/adr/**` до snippet-файлу", because одного запису у `rules/text/policy/cspell/template/.cspell.json.snippet.json` достатньо — rego вже формує deny через `data.template.snippet.ignorePaths` як subset-of, тому новий елемент автоматично стає обов'язковим у кожного споживача без змін логіки rego.

### Consequences
* Good, because transcript фіксує очікувану користь: `npx @nitra/cursor fix text` пропише `docs/adr/**` у споживацькому репо автоматично, розриваючи лінт-петлю.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Файл для зміни: `npm/rules/text/policy/cspell/template/.cspell.json.snippet.json` — додати `"docs/adr/**"` після `"**/k8s/**/*.yaml"`.
- Rego логіка без змін: `npm/rules/text/policy/cspell/cspell.rego` — subset-of по `data.template.snippet`.
- Тест-файл для оновлення: `npm/rules/text/policy/cspell/cspell_test.rego` — додати `"docs/adr/**"` у `template_data.snippet.ignorePaths`.
- Документація: `npm/rules/text/text.mdc` — дописати параграф про причину виключення.

---

## ADR Детермінований pre-LLM фільтр tooling-only сесій у capture / normalize хуках

## Context and Problem Statement
Stop-хуки `capture-decisions.sh` і `normalize-decisions.sh` покладалися виключно на LLM-інструкцію `OUTPUT NONE ONLY IF the session is genuinely trivial`. На практиці модель (sonnet/cursor-agent) повертала ADR навіть для сесій, де змінювались лише `.cspell.json`, файли `docs/adr/`, `CHANGELOG.md` або `package.json#version`. Це призводило до ADR-чернеток про суто технічні операції й повторно запускало лінт-цикл.

## Considered Options
* Додати детермінований bash-фільтр `is_tooling_only_change` до обох хуків — перевірка списку змінених файлів *до* виклику LLM.
* Покластися лише на промпт-інструкцію (існуючий підхід).
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Детермінований bash-фільтр", because промпт-інструкція недостатньо надійна — модель регулярно ігнорувала `OUTPUT NONE ONLY IF`. Детермінований фільтр гарантує пропуск ще до виклику LLM і не залежить від поведінки конкретної моделі.

### Consequences
* Good, because transcript фіксує очікувану користь: `capture-decisions.sh` виходить з `exit 0` до виклику `claude -p`, `normalize-decisions.sh` видаляє tooling-only чернетки без LLM-запиту; лінт-петля перестає виникати.
* Good, because введено ENV-перемикач `ADR_NORMALIZE_SKIP_TOOLING_ONLY` (default `1`) — споживачі зі старим behavior можуть виставити `0`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Файли: `npm/.claude-template/hooks/capture-decisions.sh`, `npm/.claude-template/hooks/normalize-decisions.sh`.
- Allowlist-glob'и: `.cspell.json`, `docs/adr/*.md`, `AGENTS.md`, `CLAUDE.md` (кореневі), `CHANGELOG.md` (будь-який workspace), `*/package.json` (лише якщо `git diff` торкнувся тільки ключа `"version"`).
- Перевірка `package.json` через `git diff --unified=0` + grep `^\(+\|-\)\s*"version":`.
- Документація: `npm/skills/adr-normalize/SKILL.md` — розділ **Tuning через ENV** + діагностика `grep tooling-only .claude/hooks/*.log`.
- Документація: `npm/rules/adr/adr.mdc` — параграф про skip tooling-only.

---

## ADR Inline-дублювання bash-хелпера замість винесення у спільний файл

## Context and Problem Statement
Функції `is_tooling_only_change` і `git_diff_only_version_field` потрібні в обох хуках — `capture-decisions.sh` і `normalize-decisions.sh`. Класичний підхід — виокремити у спільний `lib.sh` і підключити через `source`.

## Considered Options
* Inline-дублювання функцій у кожному з двох скриптів.
* Виокремити у `npm/.claude-template/hooks/lib.sh` і підключати через `source`.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Inline-дублювання", because директорія `.claude-template/hooks/` копіюється **плоско** командою `npx @nitra/cursor` у споживацькі репо як `.claude/hooks/`. Окремий `lib.sh` не є частиною специфікації hooks-контракту й може не скопіюватись або порушити `source`-шлях у різних CWD споживача. Bash 3.2 (macOS) ускладнює обхідні рішення.

### Consequences
* Good, because кожен хук є самодостатнім — не залежить від присутності сусідніх файлів після копіювання.
* Bad, because transcript фіксує навмисний дублікат коду між двома скриптами; будь-яка зміна allowlist-логіки вимагає синхронного оновлення обох файлів.

## More Information
- Обмеження: bash 3.2 (macOS `/bin/bash`) — без `mapfile`, без асоціативних масивів.
- Директорія джерела: `npm/.claude-template/hooks/`.
- Директорія призначення у споживача: `.claude/hooks/` (плоска копія).
