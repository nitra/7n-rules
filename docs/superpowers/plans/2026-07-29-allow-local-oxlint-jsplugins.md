# Allow Local Oxlint JS Plugins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дозволити проєктам додавати локальні Oxlint JS plugin wrappers без втрати канонічних plugins під час T0 merge.

**Architecture:** Канонічний `jsPlugins` лишається обов'язковим мінімумом, аналогічно до `ignorePatterns`. Перевірка приймає масив, який містить усі canonical entries, а `planOxlintrcFix()` доповнює existing array відсутніми canonical entries, не перезаписуючи local entries.

**Tech Stack:** ESM, Vitest, Oxlint JSON configuration.

## Global Constraints

- Інші поля `.oxlintrc.json` лишаються exact canonical.
- `rules` та `ignorePatterns` зберігають чинну поведінку.
- `jsPlugins` не може втратити жоден canonical entry.

---

### Task 1: Canonical JS plugin extension point

**Files:**
- Modify: `plugins/lang-js/rules/js/tooling/main.mjs`
- Test: `plugins/lang-js/rules/js/tooling/tests/tooling.test.mjs`

**Interfaces:**
- Consumes: `verifyOxlintRcAgainstCanonical(cfg, canonical)` і `planOxlintrcFix(actual, canonical)`.
- Produces: `jsPlugins` superset validation and deterministic merge.

- [ ] **Step 1: Write failing tests**

```javascript
test('додатковий локальний jsPlugin дозволений — ok', () => {
  const extended = {
    ...canonicalOxlint,
    jsPlugins: [...canonicalOxlint.jsPlugins, './npm/oxlint-e18e-plugin.mjs']
  }
  expect(verifyOxlintRcAgainstCanonical(extended, canonicalOxlint).ok).toBe(true)
})

test('merge зберігає локальний jsPlugin і додає canonical entry', () => {
  const merged = planOxlintrcFix(
    { ...canonicalOxlint, jsPlugins: ['./npm/oxlint-e18e-plugin.mjs'] },
    canonicalOxlint
  )
  expect(merged.jsPlugins).toEqual(['./npm/oxlint-e18e-plugin.mjs', ...canonicalOxlint.jsPlugins])
})
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `bun run --bun vitest run plugins/lang-js/rules/js/tooling/tests/tooling.test.mjs`

Expected: local `jsPlugins` are rejected or replaced.

- [ ] **Step 3: Implement the minimal comparison and merge helpers**

```javascript
function compareOxlintJsPlugins(expected, actual, failures) {
  // Require every canonical entry while allowing local entries.
}

// In planOxlintrcFix:
if (key === 'jsPlugins') {
  const existing = Array.isArray(merged.jsPlugins) ? merged.jsPlugins : []
  const canonicalPlugins = Array.isArray(expected) ? expected : []
  merged.jsPlugins = [...existing, ...canonicalPlugins.filter(plugin => !existing.includes(plugin))]
  continue
}
```

- [ ] **Step 4: Run the focused test and confirm it passes**

Run: `bun run --bun vitest run plugins/lang-js/rules/js/tooling/tests/tooling.test.mjs`

Expected: PASS.

### Task 2: Release metadata and verification

**Files:**
- Create: `npm/.changes/<generated>.md`
- Modify: `plugins/lang-js/rules/js/tooling/docs/main.md` only if the generated documentation requires an index update.

- [ ] **Step 1: Create patch change-file**

Run: `npx @7n/n ch --bump patch --section Fixed --message "дозволено локальні Oxlint jsPlugins"`.

- [ ] **Step 2: Generate file-level docs and retain only documentation relevant to modified source**

Run: `npx @7n/rules lint doc-files`.

- [ ] **Step 3: Run focused and delta verification**

Run: `bun run --bun vitest run plugins/lang-js/rules/js/tooling/tests/tooling.test.mjs && npx @7n/rules lint && npx @7n/rules lint changelog`.

Expected: all commands exit `0`.
