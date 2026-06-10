---
session: 1690e3a1-2584-4296-ba8a-06744b7c2f1a
captured: 2026-06-10T14:32:42+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/1690e3a1-2584-4296-ba8a-06744b7c2f1a.jsonl
---

[assistant]
Специфікацію записано у `docs/specs/2026-06-10-docgen-split-doc-files-doc-aggregate-design.md`.

**Зведення рішень:**

- **doc-files** — Tier 1, не worktree, обов'язковий крок (PostToolUse hook, matcher `Edit|Write|MultiEdit`). CLI: `doc-files scan|check`. Hook флагує застарілу доку, скіл генерує.
- **doc-aggregate** — Tier 2+3, worktree-only, за запитом. CLI: `doc-aggregate modules`.
- **Freshness** — CRC32 над байтами джерела, зберігається у frontmatter (`docgen.crc`) doc-файлу.
- **Розподіл CLI** — без fallback; старий `npm/skills/docgen` та namespace `docgen` видаляються повністю.

Наступний крок — окремий worktree для реалізації.
---

## ADR Розділення docgen на doc-files і doc-aggregate

## Context and Problem Statement
Поточний скіл `n-docgen` є worktree-only монолітом, що послідовно генерує документацію на рівні файлів (Tier 1), модулів (Tier 2) і доменів (Tier 3). Файлова документація (Tier 1) має запускатись автоматично як обов'язковий крок кожної задачі (аналогічно lint), а агрегуюча частина (Tier 2+3) — лише за запитом. Єдиний скіл не дозволяє розмежувати ці режими запуску.

## Considered Options
* Розділити `n-docgen` на два окремих скіли: `doc-files` (Tier 1, обов'язковий, не worktree) та `doc-aggregate` (Tier 2+3, worktree-only, за запитом)
* CRC-звірка freshness у frontmatter doc-файлу
* git-diff для визначення застарілих doc-файлів
* Зберегти `n-docgen` як alias поверх нових скілів

## Decision Outcome
Chosen option: "Розділити на `doc-files` + `doc-aggregate`, CRC у frontmatter, без fallback", because цей вибір підтверджено в transcript: worktree-only рухає Tier 1 до поточного дерева (як lint), CRC детерміновано виявляє stale без залежності від git-стану, а alias/fallback явно відхилено.

### Consequences
* Good, because `doc-files check` може виконуватись у PostToolUse hook (matcher `Edit|Write|MultiEdit`) без git-контексту — CRC рахується безпосередньо над байтами змінного файлу.
* Good, because CRC у frontmatter дозволяє хуку у O(1) визначити, чи дока свіжа, без обчислення git-diff.
* Good, because `doc-aggregate` залишається worktree-only, що захищає від випадкового запуску важкого агрегату.
* Bad, because видалення `npm/skills/docgen` (без alias) — Breaking change: будь-які зовнішні посилання на CLI `docgen scan` / `docgen modules` припиняють працювати. transcript не містить підтверджених негативних наслідків окрім цього.

## More Information
- Spec: `docs/specs/2026-06-10-docgen-split-doc-files-doc-aggregate-design.md`
- Новий CLI namespace: `npx @nitra/cursor doc-files scan|check`, `npx @nitra/cursor doc-aggregate modules`
- CRC frontmatter schema: `docgen.source` + `docgen.crc` (crc32 hex) у YAML frontmatter doc-файлу
- PostToolUse hook wired via `.claude/settings.json`, точка входу `npx @nitra/cursor post-tool-use-fix`
- Старий `npm/skills/docgen` + CLI namespace `docgen` — видаляються повністю, без fallback
