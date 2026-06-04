---
session: 07733932-6418-491f-a9b3-8f94fb6836d9
captured: 2026-06-04T19:22:02+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/07733932-6418-491f-a9b3-8f94fb6836d9.jsonl
---

## ADR Автоматичне створення change-файлу у pre-commit хуку `npm-changelog`

## Context and Problem Statement
Pre-commit хук `npm-changelog` (через `hk.pkl`) перевіряє наявність change-файлу в `<workspace>/.changes/*.md` для кожного workspace із релевантними змінами. Якщо файлу немає — хук блокує коміт з помилкою `❌ npm: є релевантні зміни, але немає change-файлу`. Це вимагає ручного запуску `npx @nitra/cursor change --bump ... --section ... --message "..."` перед кожним комітом.

## Considered Options
* Залишити поточну поведінку (хук фейлить, користувач кладе change-файл вручну або через агента)
* Модифікувати `npm/rules/changelog/js/consistency.mjs` (або `fix.mjs`) так, щоб при відсутності change-файлу він **автоматично його створював** і не повертав помилку

## Decision Outcome
Chosen option: "Модифікувати правило `changelog`, щоб воно автоматично створювало change-файл", because користувач явно заявив: «хочу щоб хук якщо баче що немає changes файлу, сам його створював і не фейлився».

### Consequences
* Good, because transcript фіксує очікувану користь: pre-commit більше не блокує коміт через відсутній change-файл, потік коміту стає безперервним.
* Bad, because автоматично згенерований change-файл вимагає вгадування `--bump` / `--section` / `--message` без семантичного введення від розробника — transcript явно фіксує це як технічну проблему: «`fix changelog` мав би сам вгадувати bump/section/message — а він цього не вміє».

## More Information
- Файл перевірки: `npm/rules/changelog/js/consistency.mjs`
- Файл точки входу правила: `npm/rules/changelog/fix.mjs`
- CLI для ручного створення change-файлу: `npx @nitra/cursor change --bump <major|minor|patch> --section <Added|Changed|Fixed|Removed> --message "<…>"`
- Хук запускається через `hk.pkl` крок `npm-changelog`, команда: `bun ./npm/bin/n-cursor.js check changelog` (deprecated `check`, реально маршрутизується через `fix`)
- `post-tool-use-fix.mjs` — існуючий PostToolUse-хук — **не** містить маршруту для правила `changelog`, тому поточна автоматизація через нього неможлива без доробки
- Сесія перервана до реалізації; файл `npm/rules/changelog/js/consistency.mjs` є точкою змін
