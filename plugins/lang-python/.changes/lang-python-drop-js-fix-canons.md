---
bump: minor
section: Removed
---

Знято всі ТРИ JS-канони T0-фікса плагіна: `rules/python/doc_comments/fix-doc_comments.mjs`, `rules/python/ruff/fix-ruff.mjs`, `rules/python/vscode_extensions/fix-vscode_extensions.mjs`. Кожен із цих концернів має фікс у wasm-гості `crates/plugin-lang-python`, і тепер гість — ЄДИНА реалізація, а не пріоритетна з JS-fallback-ом. Борг «спершу парність» на цьому плагіні закрито повністю.

Спостережувана поведінка `--fix` не змінилась: гість і доти мав пріоритет (`T0Pattern.guestFix`). Окремо звірено `python/ruff` — його канон був єдиним місцем, де жив `test()`-предикат за `reason` (`ruff-check-violation`/`ruff-format-violation`). У гостя такого предиката немає й не має бути: `fix()` диспатчиться за concern-id, а «нічого робити» вирішує підготовчий крок `prepare_python_run`. Перебрано ВЕСЬ перелік reason-ів `detect_ruff` — на `ruff-unavailable` і `uv-missing` цей крок дає той самий no-op, що й `test() === false`. Поведінкової дірки немає.

Канони-ДЖЕРЕЛА лишились на місці: `concern.json`, `vscode_extensions.rego`, `template/**` — гість вшиває їх `include_str!`-ом, тож detect-парність через справжній `conftest` і далі жива.

Практичний наслідок, який варто знати: fallback-у більше немає. Якщо wasm-компонент `lang-python` у консюмері не резолвиться (плагін не зібрано, розбіжність піна, хост без wasm), кожен із трьох концернів деградує з «автофікс» у «порушення показано, концерн пішов у LLM-ладдер» — раніше цей випадок гасив JS-канон.

Деталі, порядкова звірка й повний облік тестів — §2.91 `docs/plans/2026-08-05-open-questions-register.md`.
