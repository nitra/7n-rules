---
session: fce1d1c2-4217-4a3a-bb26-649747c9653b
captured: 2026-06-15T09:57:54+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/fce1d1c2-4217-4a3a-bb26-649747c9653b.jsonl
---

[thinking]
</thinking>

Дякую за transcript. Аналізую ключові дизайнові рішення.

## ADR Видалення надлишкових CLI-точок входу (`lint-ci`, `doc-files <sub>`)

## Context and Problem Statement
`@nitra/cursor` CLI накопичив дві надлишкові публічні команди: `lint-ci` (чистий аліас `lint --read-only --full` із нулем живих callerів) і `doc-files <sub>` (deprecated-аліас `scan|check|gen|stamp` → `lint-doc-files`/`fix-doc-files`, також без живих callerів). Задекларована ціль — мінімальна поверхня API.

## Considered Options
* Видалити обидві команди (breaking change)
* Лишити `lint-ci` для зворотньої сумісності, видалити лише `doc-files <sub>`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Видалити обидві команди", because `lint-ci` — чистий аліас із нулем реальних callerів у `.github`, `package.json` і коді правил; `doc-files <sub>` мертвий у живій проводці (hook і скіл вже звуть `lint-doc-files`/`fix-doc-files`). Обидва суперечать цілі «мінімальна поверхня».

### Consequences
* Good, because transcript фіксує очікувану користь: CLI-поверхня зменшена; `default`-помилка більше не перелічує нежиттєздатні команди; `rule-meta.json` enum виправлено на реальні значення `per-file|full`.
* Bad, because видалення публічних команд — breaking change (bump `major`), зафіксовано у `npm/.changes/260615-0638.md`.

## More Information
- `npm/bin/n-cursor.js`: видалено `case 'lint-ci'` і `case 'doc-files'`, виправлено шапку і `default`-помилку
- `npm/schemas/rule-meta.json`: enum `["quick","ci"]` → `["per-file","full"]`
- `npm/rules/js-lint-ci/js-lint-ci.mdc`: посилання `lint-ci` → `lint --full`
- `npm/.changes/260615-0638.md`: bump `major`, section `Removed`
- Перевірка: `node --check` OK; `vitest` orchestrate-тести 6/6

---

## ADR Opportunistic LLM-fix tier у lint-кроці doc-files

## Context and Problem Statement
Lint-крок `doc-files` (`js/lint.mjs`) не приймав `readOnly` і ніколи не фіксив у fix-by-default: він лише виводив список застарілих файлів і делегував у `fix-doc-files`. Користувач поставив ціль зробити doc-files референсною реалізацією «detect → detfix → opportunistic LLM-fix» — єдиного патерну для всіх lint-правил.

## Considered Options
* Opportunistic LLM-fix у lint-кроці: omlx up → генерує stale → re-detect; omlx down → skip + exit 1
* Лишити lint-крок detect-only, залишити генерацію виключно в `fix-doc-files`
* Перемістити всю генерацію у `lint` за допомогою прапора `--doc-files`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Opportunistic LLM-fix у lint-кроці", because це усуває асиметрію «єдине правило без fix у fix-by-default» і закладає референс-патерн для інших правил; при цьому `readOnly`-гейт тримається (CI детермінований), а omlx-down деградує до «skip + exit 1» без краша.

### Consequences
* Good, because transcript фіксує очікувану користь: fix-by-default поведінка уніфікована з іншими правилами; спільне ядро `runGenerationBatch`/`preflightProblem` витягнуто з `docgen-files-batch.mjs` і готово до перевикористання у наступних інстансах.
* Bad, because lint-крок стає side-effecting і залежним від локальної моделі; герметичність detect-юніт-тестів порушується (виправлено переходом на `{readOnly:true}` + stable mock-wrapper через quirk `vi.fn`+`mockReset` із dynamic-import).

## More Information
- `npm/rules/doc-files/js/lint.mjs`: `lint(files, cwd, {readOnly})` — новий контракт
- `npm/rules/doc-files/js/docgen-files-batch.mjs`: експортовано `runGenerationBatch`, `preflightProblem`
- `npm/rules/doc-files/meta.json`: додано `llmFix: true`
- `npm/schemas/rule-meta.json`: нова властивість `llmFix` (opt-in, з застереженням про логічні лінтери)
- `npm/rules/doc-files/js/tests/lint.test.mjs`: переписано; 131/131 passed
- `npm/.changes/260615-0907.md`: bump `minor`, section `Changed`
- Спека: `docs/specs/2026-06-15-opportunistic-llm-fix-tier.md`

---

## ADR Єдина уніфікована абстракція LLM-fix для lint-правил

## Context and Problem Statement
На момент обговорення C-кроку виявилося, що doc-files і cspell реалізували opportunistic LLM-fix незалежно: doc-files через `runGenerationBatch`/`preflightProblem`, cspell через `llmLintFix` (`scripts/lib/fix/llm-lint-fix.mjs`) і `N_CURSOR_FIX_MODEL`. Дві реалізації розійшлися: cspell не має preflight (при omlx-down робить N приречених викликів), немає circuit-breaker, і використовує інший environment-knob для моделі.

## Considered Options
* Одна уніфікована абстракція (спільна інфра: preflight, маршрут моделі, circuit-breaker, cap) із двома формами операції (`generate` vs `fix-findings`)
* Дві легітимно різні абстракції, лише з частковим перевикористанням

## Decision Outcome
Chosen option: "Одна уніфікована абстракція", because користувач явно визначив: це повинна бути одна абстракція; `N_LOCAL_MIN_MODEL` — єдиний knob для всіх LLM-fix тирів; opt-in через єдиний механізм `meta.json: llmFix: true`.

### Consequences
* Good, because усувається розбіжність двох knob'ів моделі (`N_LOCAL_MIN_MODEL` vs `N_CURSOR_FIX_MODEL`) і брак preflight у cspell; doc-files стає перевіреним референсом для уніфікації.
* Bad, because transcript не містить підтверджених негативних наслідків (реалізація C не завершена в межах сесії — зупинились на дизайн-обговоренні та експерименті з `cspell` на поточному проекті).

## More Information
- Експеримент: `bunx cspell .` на репо → 1406 знахідок у 292 файлах; топ-файл `npm/CHANGELOG.md` (116 знахідок) — переважно валідні укр/тех-слова, не одруки
- Спека-референс: `docs/specs/2026-06-15-opportunistic-llm-fix-tier.md`
- Наступний крок за спекою: text/cspell як 2-й інстанс → виніс спільного хелпера у `lib/llm.mjs`; opt-in `meta.json: llmFix: true` для правила `text`
