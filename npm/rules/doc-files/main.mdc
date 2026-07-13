---
description: Файлова документація — обовʼязковий крок задачі (як lint); unified lint surface, concern doc-files/check — детект застарілості за CRC джерела + fix-by-default генерація local-only конвеєром (omlx)
globs: "**/*.{js,mjs,ts,vue,py,rs},**/docs/**"
alwaysApply: true
version: '2.0'
---

Кожен кодовий файл (`.js .mjs .ts .vue .py .rs`, крім тестів і `.d.ts`) має **актуальну**
файлову доку поряд: `<dir>/docs/<stem>.md`. Це **обовʼязковий крок кожної задачі**, нарівні
з lint. Актуальність детермінується за **CRC** джерела, записаним у frontmatter доки.

## Одна команда — unified lint surface

Як і решта правил проєкту (`.cursor/rules/scripts.mdc`, секція «Діагностика»), doc-files —
concern `doc-files/check` у unified lint surface: **одна** команда, fix-by-default.

- **`npx @7n/rules lint doc-files`** — детект **і одразу fix**: T0 (детермінований
  CRC-stamp для `crc-mismatch`) → LLM-worker (генерація для `missing`/degraded, local-only
  конвеєр omlx) → purge сирітських док.
- **`npx @7n/rules lint doc-files --no-fix`** — лише детект, **0 викликів LLM**, без
  мутацій. Це форма для CI-гейта й hook'ів.

Окремих команд `lint-doc-files` / `fix-doc-files` **немає** — вони існували до міграції на
unified lint surface (spec `docs/specs/2026-06-29-unified-lint-surface.md`) і видалені.

## Stale = `missing` ∪ `crc-mismatch`

Дока застаріла, якщо її **немає** (`missing`) або `crc(джерело) ≠ crc` у frontmatter
(`crc-mismatch`). Це і є `violations`, які повертає `lint(ctx)` концерну.

Алгоритм детекту (кандидати, ignore-дерево, CRC, реверс-мапінг доки→джерело) — у
`docgen-scan/main.mjs` / `docgen-crc/main.mjs` / `docgen-ignore/main.mjs`, детектор — у
`check/main.mjs` (`lint(ctx)`), fix — у `check/fix-check.mjs` (T0) і `check/fix-worker.mjs`
(LLM); тут — лише людинозрозумілий контракт, без дублювання логіки.

## Hook'и

PostToolUse (`hook --post-tool-use` → `detectAll` для зміненого файлу) **сигналить** про
дрейф одразу після правки кодового файлу; Stop-гейт (`hook --stop` → `detectAll` по `git diff`
HEAD) **блокує завершення** задачі за наявності застарілих док. Обидва — read-only детект,
без fix. Ручна регенерація — `npx @7n/rules lint doc-files` (fix-by-default) або скіл
`/n-doc-files`. Агрегуюча дока (module-summary, доменні) — окремий скіл `/doc-aggregate`.

## Серіалізація

Як і решта unified lint surface — через спільний `withGlobalLintLock`/`ProgressReporter`
(`.cursor/rules/scripts.mdc`, секції «Серіалізація важких CLI-команд» і «Прогрес довгих
lint/fix-прогонів»). Окремого локу для doc-files немає — це один concern серед інших, що
проходять через `npx @7n/rules lint`.
