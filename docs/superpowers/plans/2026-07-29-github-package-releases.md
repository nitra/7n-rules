# GitHub Package Releases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Автоматично створювати окремий GitHub Release для кожного опублікованого npm package-тегу з описом відповідної версії з `CHANGELOG.md`.

**Architecture:** Новий tag-triggered GitHub Actions workflow викликає тестований Node-скрипт із `npm/scripts`. Скрипт без hardcoded списку обходить publishable package manifests, знаходить package за тегом, витягує точну changelog-секцію й записує notes для `gh release create`.

**Tech Stack:** GitHub Actions, Node.js ESM, `gh` CLI, Vitest, Bun.

## Global Constraints

- Підтримати всі publishable npm workspaces і scoped package-теги.
- Не змінювати `npm-publish.yml` та не робити GitHub Release залежністю npm publish.
- Не переписувати вже створений GitHub Release.
- Не хардкодити список пакетів або версій.
- Опис Release дорівнює changelog-секції з однойменною версією.

---

### Task 1: Pure release-note resolver

**Files:**

- Create: `npm/scripts/github-package-release.mjs`
- Create: `npm/scripts/tests/github-package-release.test.mjs`
- Create: `npm/scripts/docs/github-package-release.md`

**Interfaces:**

- Consumes: repository root, tag string `<package-name>@<version>`, filesystem `package.json` and `CHANGELOG.md`.
- Produces: `parsePackageTag(tag)`, `findPublishablePackage(root, name)`, `extractChangelogSection(text, version)`, `prepareGitHubRelease(root, tag)`.

- [ ] **Step 1: Write failing unit tests for scoped tags, manifest lookup and changelog extraction**

```js
expect(parsePackageTag('@7n/rules@1.54.0')).toEqual({ name: '@7n/rules', version: '1.54.0' })
expect(parsePackageTag('tool@2.0.0')).toEqual({ name: 'tool', version: '2.0.0' })
expect(extractChangelogSection('# Changelog\n\n## [1.2.0] - 2026-07-29\n\n### Added\n\n- New\n\n## [1.1.0] - 2026-07-01\n', '1.2.0')).toContain('- New')
```

- [ ] **Step 2: Confirm the test fails before implementation**

Run: `bunx vitest run npm/scripts/tests/github-package-release.test.mjs`

Expected: FAIL with a module-not-found error for `../github-package-release.mjs`.

- [ ] **Step 3: Implement deterministic resolver helpers**

```js
export function parsePackageTag(tag) {
  const at = tag.lastIndexOf('@')
  if (at <= 0 || at === tag.length - 1) throw new Error(`Unsupported package tag: ${tag}`)
  return { name: tag.slice(0, at), version: tag.slice(at + 1) }
}
```

Traverse manifests with `readdirSync(..., { withFileTypes: true })`; skip `.git`, `node_modules`, `.worktrees`, invalid JSON and `private: true`. Require exactly one name match and a sibling `CHANGELOG.md`. Extract Markdown from `## [<version>]` until the next `## [` heading; write only this text to the CLI-provided notes path.

- [ ] **Step 4: Verify focused tests and required behavioral docs**

Run: `bunx vitest run npm/scripts/tests/github-package-release.test.mjs`

Expected: PASS.

Run: `npx @7n/rules lint doc-files --path npm/scripts/github-package-release.mjs`

Expected: generated or refreshed `npm/scripts/docs/github-package-release.md`.

- [ ] **Step 5: Commit resolver and tests**

Run: `git add npm/scripts/github-package-release.mjs npm/scripts/tests/github-package-release.test.mjs npm/scripts/docs/github-package-release.md && git commit -m "feat(release): prepare package GitHub releases"`

### Task 2: Add tag-triggered GitHub Release workflow

**Files:**

- Create: `.github/workflows/package-release.yml`
- Modify: `npm/scripts/tests/github-package-release.test.mjs`

**Interfaces:**

- Consumes: `github.ref_name`, `GITHUB_TOKEN`, and a Markdown notes file from Task 1.
- Produces: a GitHub Release named `<package>@<version>` for the pushed tag.

- [ ] **Step 1: Add a failing workflow contract test**

```js
const workflow = readFileSync('.github/workflows/package-release.yml', 'utf8')
expect(workflow).toContain("tags:\n      - '@*@*'")
expect(workflow).toContain('contents: write')
expect(workflow).toContain('gh release view')
expect(workflow).toContain('gh release create')
```

- [ ] **Step 2: Confirm the workflow contract fails before the workflow exists**

Run: `bunx vitest run npm/scripts/tests/github-package-release.test.mjs`

Expected: FAIL because `.github/workflows/package-release.yml` does not exist.

- [ ] **Step 3: Implement a standalone tag workflow**

```yaml
name: package-release
on:
  push:
    tags:
      - '@*@*'
permissions:
  contents: write
```

Checkout the tag with `actions/checkout@v6`, set up Node 24, call `node npm/scripts/github-package-release.mjs "$GITHUB_REF_NAME" "$RUNNER_TEMP/release-notes.md"`, then use `gh release view "$GITHUB_REF_NAME"` as the idempotency guard and `gh release create "$GITHUB_REF_NAME" --title "$GITHUB_REF_NAME" --notes-file "$RUNNER_TEMP/release-notes.md"` only when absent. Keep all shell variables quoted.

- [ ] **Step 4: Verify tests and workflow syntax**

Run: `bunx vitest run npm/scripts/tests/github-package-release.test.mjs && npx @7n/rules lint ga --no-fix`

Expected: PASS.

- [ ] **Step 5: Commit workflow**

Run: `git add .github/workflows/package-release.yml npm/scripts/tests/github-package-release.test.mjs && git commit -m "feat(ci): publish GitHub package releases"`

### Task 3: Full verification and handoff

**Files:**

- Verify: `.github/workflows/package-release.yml`
- Verify: `npm/scripts/github-package-release.mjs`
- Verify: `npm/scripts/docs/github-package-release.md`

- [ ] **Step 1: Exercise all resolver error and success paths**

Run: `bunx vitest run npm/scripts/tests/github-package-release.test.mjs`

Expected: PASS for scoped and unscoped packages, workspace discovery, missing changelog, missing version section and duplicate names.

- [ ] **Step 2: Run repository checks**

Run: `npx @7n/rules lint ga --no-fix && npx @7n/rules lint doc-files --no-fix --path npm/scripts/github-package-release.mjs && npx @7n/rules lint changelog`

Expected: all checks exit 0.

- [ ] **Step 3: Run complete unit suite and record existing baseline status**

Run: `bun run test`

Expected: new release tests pass; record separately the pre-existing two `docgen-scan` failures if they remain.
