# Repo CI Debt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Відновити green стан repo-wide `eslint`, `text` і `lint-repo` на актуальному `main` окремим PR.

**Architecture:** Зберігати поведінку модулів; змінювати лише код, JSDoc, конфіг або generated docs, необхідні для поточних детекторів. Дрібні незалежні виправлення групувати за модулем, а не за правилом linter-а.

**Tech Stack:** Bun, Vitest, ESLint/Oxlint, `@7n/rules`.

## Global Constraints

- Не переносити код із PR #262, #263, #264 або #266.
- Не змінювати version чи CHANGELOG вручну; додати change-file тільки для помітної зміни runtime behavior.
- Для кожного зміненого `.mjs` оновити docs через `npx @7n/rules lint doc-files`.

---

### Task 1: Зафіксувати точний baseline

**Files:**
- Modify: немає — лише evidence у PR description.

- [ ] **Step 1: Запустити три CI-команди на свіжому `origin/main`**

Run: `bunx n-rules lint js --no-fix && bunx n-rules lint text --no-fix && bunx n-rules lint repo --no-fix`

Expected: той самий набір failures, що й у GitHub Actions; кожен finding має файл і rule id.

- [ ] **Step 2: Розбити failures за модулями**

Створити в PR body таблицю `module | detector | finding count | behavior changed` і позначити `false` для суто style/JSDoc fixes.

- [ ] **Step 3: Перевірити, що diff порожній**

Run: `git diff --check && git status --short`

Expected: жодних змін після baseline.

### Task 2: Виправити doc-files lint debt

**Files:**
- Modify: `npm/rules/doc-files/docgen-files-batch/main.mjs`
- Modify: `npm/rules/doc-files/docgen-gen/main.mjs`
- Modify: `npm/rules/doc-files/docgen-prompts/main.mjs`
- Test: відповідні `tests/*.test.mjs` в кожному модулі, якщо змінюється алгоритм.

- [ ] **Step 1: Написати failing regression test лише для поведінкової зміни**

```js
test('preserves the documented result for the affected input', () => {
  expect(subject(input)).toEqual(expected)
})
```

- [ ] **Step 2: Внести мінімальні безпечні виправлення**

Замінити `for (const item of values.filter(predicate))` на цикл із guard; винести складні регулярні вирази або спростити їх без зміни accepted input; додати відсутні JSDoc tags; замінити nested ternary явними гілками.

- [ ] **Step 3: Перевірити модулі**

Run: `bunx vitest run npm/rules/doc-files/**/tests/*.test.mjs && bunx n-rules lint js --no-fix`

Expected: findings для цих трьох модулів зникають, тести green.

### Task 3: Виправити lint-surface, k8s та lang-js debt

**Files:**
- Modify: `npm/scripts/lib/lint-surface/{lint-lock,run-detectors,run-fix}.mjs`
- Modify: `npm/scripts/lib/lint-surface/tests/{lint-lock,run-fix}.test.mjs`
- Modify: `npm/scripts/lib/{concern-meta,tests/concern-meta.test}.mjs`
- Modify: `npm/rules/k8s/{manifests/main.mjs,tests/run-roots.test.mjs}`
- Modify: `plugins/lang-js/coverage-provider/{fix/coverage-fix,js-collector}.mjs`
- Modify: їхні наявні test files.

- [ ] **Step 1: Додати або оновити regression tests для кожної поведінкової правки**

```js
test('keeps the existing public result after lint-driven refactor', async () => {
  await expect(runCase(fixture)).resolves.toEqual(expected)
})
```

- [ ] **Step 2: Виправити findings без послаблення lint policy**

Перемістити декларації після guard, зберегти `cause` у rethrow, санітизувати dynamic import boundary, замінити небезпечні null comparisons та складні conditionals еквівалентними явними гілками.

- [ ] **Step 3: Запустити focused suites і JS lint**

Run: `bunx vitest run npm/scripts/lib/lint-surface/tests npm/scripts/lib/tests plugins/lang-js/coverage-provider/tests npm/rules/k8s/tests && bunx n-rules lint js --no-fix`

Expected: у цих шляхах немає findings; усі focused tests green.

### Task 4: Виправити manifest і repo-wide checks

**Files:**
- Modify: `plugins/lang-js/package.json`
- Modify: один із `plugins/lang-{python,rust}/package.json`, лише якщо можна прибрати exact duplicate без зміни published package contract.

- [ ] **Step 1: Перевірити джерело knip і jscpd findings**

Run: `bunx knip --workspace plugins/lang-js` та targeted duplicate detector через `bunx n-rules lint js --no-fix`.

Expected: підтверджене невикористане `oxlint` dependency та exact duplicate fragment.

- [ ] **Step 2: Зробити мінімальну manifest-зміну**

Видалити `oxlint` лише коли його немає в scripts/config; винести або скоротити duplicate лише коли package metadata лишається семантично тотожною.

- [ ] **Step 3: Перевірити publish surface**

Run: `npm pack --dry-run --workspace plugins/lang-js && bunx n-rules lint js --no-fix`

Expected: package surface не змінюється неочікувано, JS lint green.

### Task 5: Завершити окремий CI PR

**Files:**
- Modify: generated `docs/` поруч із кожним зміненим code file.
- Create: `npm/.changes/<timestamp>.md`, лише якщо зміни виходять за межі internal tooling debt.

- [ ] **Step 1: Оновити doc-files**

Run: `npx @7n/rules lint doc-files --path <each-changed-code-directory>`

Expected: docs CRC синхронні для кожного зміненого code file.

- [ ] **Step 2: Запустити final gates**

Run: `bunx n-rules lint js --no-fix && bunx n-rules lint text --no-fix && bunx n-rules lint repo --no-fix && npx @7n/rules lint changelog && git diff --check`

Expected: усі команди exit 0.

- [ ] **Step 3: Commit і push окремої гілки**

```bash
git add <changed-files>
git commit -m "fix(ci): resolve repo-wide lint debt"
git push origin codex/pr-triage-ci
```
