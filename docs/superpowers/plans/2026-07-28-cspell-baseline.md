# CSpell Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Зробити актуальний `bunx n-rules lint text --no-fix` green без послаблення CSpell policy.

**Architecture:** Використати `.cspell.json` тільки для vendor name `Bitnami`; решту українських слів замінити природними формулюваннями без зміни behavior.

**Tech Stack:** CSpell, Bun, Markdown, JavaScript JSDoc.

## Global Constraints

- Змінювати лише `.cspell.json` і вісім шляхів, перелічених у CI baseline report.
- Не додавати до словника звичайні українські слова.
- Не змінювати runtime code: JSDoc-коментар у `plugin-slots.mjs` змінюється лише текстово.

---

### Task 1: Виправити CSpell findings

**Files:**
- Modify: `.cspell.json`
- Modify: `llm-lib/crates/llm-lib-napi/src/docs/lib.md`
- Modify: `npm/rules/doc-files/docgen-scan/docs/{lang-extensions,main}.md`
- Modify: `npm/rules/k8s/dremio_logging/dremio_logging.mdc`
- Modify: `npm/scripts/lib/{docs/plugin-slots.md,plugin-slots.mjs}`
- Modify: `plugins/lang-python/taze/docs/provider.md`
- Modify: `plugins/lang-rust/doc-files/docs/extractors.md`

- [ ] **Step 1: Зафіксувати failing check**

Run: `bunx n-rules lint text --no-fix`

Expected: рівно 11 unknown-word CSpell findings, включно з `Bitnami`, `одиночні`, `плагіновий`, `кандидатності`, `мутабельну`, `релізні` та `верхньорівневого`.

- [ ] **Step 2: Зробити мінімальні зміни**

Додати тільки `Bitnami` до `.cspell.json#words`. Замінити решту слів на формулювання з baseline report: `окремі запити`, `контекст плагінів`, `декларацій плагінів`, `розширень від доступних плагінів`, `правила придатності`, `змінювану референцію`, `нотатки до випуску`, `опису найвищого рівня`.

- [ ] **Step 3: Перевірити regression**

Run: `bunx n-rules lint text --no-fix && bunx n-rules lint js --no-fix && bunx n-rules lint repo --no-fix && npx @7n/rules lint changelog && git diff --check`

Expected: усі команди exit 0; diff містить лише дозволені paths.

- [ ] **Step 4: Commit**

```bash
git add .cspell.json llm-lib/crates/llm-lib-napi/src/docs/lib.md npm/rules/doc-files/docgen-scan/docs npm/rules/k8s/dremio_logging/dremio_logging.mdc npm/scripts/lib/docs/plugin-slots.md npm/scripts/lib/plugin-slots.mjs plugins/lang-python/taze/docs/provider.md plugins/lang-rust/doc-files/docs/extractors.md
git commit -m "fix(text): resolve CSpell baseline findings"
```
