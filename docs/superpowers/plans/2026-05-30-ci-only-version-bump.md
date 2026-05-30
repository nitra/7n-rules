# CI-only version bump — заборона ручного/агентського bump — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Зробити change-файл (`.changes/*.md`) єдиним дозволеним способом зафіксувати зміну пакета; будь-яка зміна `version` поза CI завалює перевірку `check changelog` на будь-якій гілці.

**Architecture:** Посилюємо `npm/rules/changelog/js/consistency.mjs`: прибираємо всі гілки, що зеленили ручний bump, і замінюємо їх на `fail` із вказівкою покласти change-файл. Прибираємо dev-сторонню верифікацію CHANGELOG (його єдине джерело — `release.mjs` у CI). Синхронно правимо правило (`changelog.mdc` + дзеркало `n-changelog.mdc`), тести, agent-facing документи та memory.

**Tech Stack:** Node ESM (`.mjs`), vitest, bun, smol-toml; правила Cursor (`.mdc`).

**Spec:** `docs/superpowers/specs/2026-05-30-ci-only-version-bump-design.md`

---

## File Structure

| Файл | Роль | Дія |
|---|---|---|
| `npm/rules/changelog/js/consistency.mjs` | ядро перевірки | Modify — переписати 3 функції, прибрати мертві хелпери, додати `missingChangeFileMessage` |
| `npm/rules/changelog/js/tests/consistency/tests/check.test.mjs` | тести перевірки | Modify — перевести bump→pass кейси на fail/change-файл, додати явні fail-кейси |
| `npm/rules/changelog/changelog.mdc` | джерело правила | Modify — прибрати legacy, посилити STOP, `version 3.0→3.1` |
| `.cursor/rules/n-changelog.mdc` | синхронізоване дзеркало | Modify — ідентично до джерела |
| `~/.claude/.../memory/feedback_changelog.md` + `MEMORY.md` | memory | Modify — переформулювати на change-файл-флоу |
| `npm/.changes/<unique>.md` | change-файл релізу | Create — описати цю зміну (`bump: minor`) |

---

## Task 1: Переписати ядро перевірки `consistency.mjs`

**Files:**
- Modify: `npm/rules/changelog/js/consistency.mjs`

Нова семантика (для workspace з релевантними змінами): `pass` лише якщо є change-файл; будь-який діф `version` → `fail` з явним «ручний bump заборонено»; зміни без change-файлу → `fail` «поклади change-файл». Dev-сторона **не** звіряє CHANGELOG. `checkNpmFilesArrayContainsChangelog` лишається, але викликається тільки на change-файл-pass-шляху published-пакета (релиз наближається → CHANGELOG має пакуватися).

- [ ] **Step 1: Додати спільний хелпер повідомлення про відсутній change-файл**

Після функції `workspaceLabel` (≈ рядок 397) додати:

```js
/**
 * Повідомлення «поклади change-файл» для workspace з релевантними змінами без change-файлу.
 * @param {string} label мітка воркспейсу
 * @param {string} mf шлях до маніфесту
 * @returns {string} текст fail
 */
function missingChangeFileMessage(label, mf) {
  return (
    `${label}: є релевантні зміни, але немає change-файлу (version у ${mf} не чіпай вручну). ` +
    `Поклади change-файл: npx @nitra/cursor change --bump <major|minor|patch> --section <Added|Changed|Fixed|Removed> --message "<…>"; ` +
    `bump зробить CI на main (n-changelog.mdc)`
  )
}
```

- [ ] **Step 2: Переписати `checkPublishedWorkspacePendingGitChanges`**

Замінити тіло функції (рядки ≈419–471) на:

```js
async function checkPublishedWorkspacePendingGitChanges(manifest, Vcurrent, subWorkspaces, pass, fail, cwd) {
  const label = workspaceLabel(manifest)
  const mf = manifestFilePath(manifest.ws, manifest)
  if (await hasPendingChangeFiles(manifest.ws, cwd)) {
    pass(`${label}: є change-файл(и) у .changes/ — bump зробить CI (n-changelog.mdc)`)
    // Реліз наближається → CHANGELOG має публікуватися разом із пакетом.
    checkNpmFilesArrayContainsChangelog(manifest, pass, fail)
    return
  }
  if (!(await isInsideGitRepo(cwd))) {
    return
  }

  const branch = await currentBranchName(cwd)

  if (branch === LOCAL_ONLY_SKIP_BRANCH) {
    if (await workspaceHasRelevantChangesAgainstBase('HEAD', manifest.ws, subWorkspaces, cwd)) {
      fail(missingChangeFileMessage(label, mf))
    }
    return
  }

  const comparison = await resolveChangelogComparisonPoint(branch, cwd)
  if (comparison && (await workspaceHasRelevantChangesAgainstBase(comparison.ref, manifest.ws, subWorkspaces, cwd))) {
    fail(missingChangeFileMessage(label, mf))
    return
  }

  if (branch === 'main' && (await workspaceHasRelevantChangesAgainstBase('HEAD', manifest.ws, subWorkspaces, cwd))) {
    fail(missingChangeFileMessage(label, mf))
  }
}
```

> Параметр `Vcurrent` лишається в сигнатурі (його передає виклик), хоч тіло його більше не вживає — прибирати виклик не треба. Якщо ESLint лається на невживаний аргумент, перейменуй на `_Vcurrent`.

- [ ] **Step 3: Переписати `checkPublishedWorkspace`**

Замінити тіло функції (рядки ≈482–508) на:

```js
async function checkPublishedWorkspace(manifest, subWorkspaces, getPublishedVersion, pass, fail, cwd) {
  const label = workspaceLabel(manifest)
  const mf = manifestFilePath(manifest.ws, manifest)
  const Vcurrent = manifest.version
  if (!Vcurrent) {
    fail(`${label}: у ${mf} відсутнє поле version (registry-published воркспейс)`)
    return
  }
  const name = manifest.name
  if (!name) {
    fail(`${label}: у ${mf} відсутнє ім'я пакета (registry-published воркспейс)`)
    return
  }
  const Vpublished = await resolvePublishedVersion(manifest, getPublishedVersion)
  if (Vpublished === null) {
    pass(`${label}: ${name} — опублікована версія недоступна (мережа/реєстр), перевірку пропущено`)
    return
  }
  if (Vpublished !== Vcurrent) {
    fail(
      `${label}: version у ${mf} (${Vcurrent}) розходиться з опублікованою (${Vpublished}) — ` +
        `ручний bump заборонено. Відкоти version і поклади change-файл ` +
        `(npx @nitra/cursor change …); bump зробить CI на main (n-changelog.mdc)`
    )
    return
  }
  pass(`${label}: ${name}@${Vcurrent} збігається з реєстром — перевіряємо git на незрелізні зміни`)
  await checkPublishedWorkspacePendingGitChanges(manifest, Vcurrent, subWorkspaces, pass, fail, cwd)
}
```

- [ ] **Step 4: Переписати `checkLocalOnlyChangedWorkspace`**

Замінити тіло функції (рядки ≈518–546) на:

```js
async function checkLocalOnlyChangedWorkspace(comparisonRef, manifest, baseLabel, pass, fail, cwd) {
  const label = workspaceLabel(manifest)
  const mf = manifestFilePath(manifest.ws, manifest)
  if (await hasPendingChangeFiles(manifest.ws, cwd)) {
    pass(`${label}: є change-файл(и) у .changes/ — bump зробить CI (n-changelog.mdc)`)
    return
  }
  const Vcurrent = manifest.version
  const Vbase = await readBaseVersion(comparisonRef, manifest, cwd)
  if (Vbase !== null && Vcurrent !== null && Vbase !== Vcurrent) {
    fail(
      `${label}: version у ${mf} змінено поза CI (${Vbase} → ${Vcurrent}) — ручний bump заборонено (на ${baseLabel} — ${Vbase}). ` +
        `Відкоти version і поклади change-файл (npx @nitra/cursor change …); bump зробить CI (n-changelog.mdc)`
    )
    return
  }
  fail(missingChangeFileMessage(label, mf))
}
```

- [ ] **Step 5: Прибрати мертві хелвери `verifyChangelogEntry` і `changelogHasVersionEntry`**

Після Steps 2–4 ці дві функції більше не викликаються. Видалити:
- `changelogHasVersionEntry` (рядки ≈285–288);
- `verifyChangelogEntry` (рядки ≈374–389);
- константу `join` лишити (вживається деінде), а `existsSync`/`readFile` лишити лише якщо їх вживають інші функції (вживає `verifyChangelogEntry` — після видалення перевір через `grep`; якщо `existsSync`/`readFile` стали невживані — прибрати їхні імпорти з рядків 20–21).

Перевірка вживаності:

Run: `grep -nE "existsSync|readFile|changelogHasVersionEntry|verifyChangelogEntry" npm/rules/changelog/js/consistency.mjs`
Expected: лише визначення/імпорти, що лишилися вживаними; жодного виклику видалених функцій.

- [ ] **Step 6: Запустити цільові тести — мають впасти (ще старі очікування)**

Run: `cd npm && bunx vitest run rules/changelog/js/tests/consistency/tests/check.test.mjs`
Expected: FAIL — кілька кейсів, що очікували `pass` на ручному bump, тепер червоні. Це нормально: тести оновлюємо в Task 2.

- [ ] **Step 7: Commit**

```bash
git add npm/rules/changelog/js/consistency.mjs
git commit -m "feat(changelog): заборонити ручний bump version — лише change-файли (CI bump)"
```

---

## Task 2: Оновити тести `check.test.mjs`

**Files:**
- Modify: `npm/rules/changelog/js/tests/consistency/tests/check.test.mjs`

Принцип: усі кейси, що раніше зеленіли на **ручному bump**, або перетворюємо на «change-файл → pass», або репрофілюємо на «ручний bump → fail». Кейси «зміни без bump → fail» лишаються. Додаємо явні нові fail-кейси.

Реюзабельний снипет «покласти change-файл у `<sub>`» (де `sub` = `'.'` для кореня або підкаталог):

```js
await mkdir(join(dir, sub, '.changes'), { recursive: true })
await writeFile(join(dir, sub, '.changes', '1-a.md'), '---\nbump: patch\nsection: Changed\n---\nx\n', 'utf8')
```

- [ ] **Step 1: npm-published — репрофілювати «feature: bump + CHANGELOG → pass» на change-файл**

Тест на рядку ≈153 `'version = опублікованій, feature-гілка: bump + CHANGELOG → pass'`: прибрати ручний bump `package.json`→1.0.1 та переписування CHANGELOG; замість них після зміни `lib/x.js` додати change-файл у корінь:

```js
await git(['checkout', '-q', '-b', 'feat/x'], dir)
await writeFile(join(dir, 'lib/x.js'), 'changed\n', 'utf8')
await mkdir(join(dir, '.changes'), { recursive: true })
await writeFile(join(dir, '.changes', '1-a.md'), '---\nbump: patch\nsection: Changed\n---\nx\n', 'utf8')
const code = await checkChangelog({ cwd: dir, getPublishedVersion: publishedStub({ '@x/lib': '1.0.0' }) })
expect(code).toBe(0)
```

Перейменувати тест на `'version = опублікованій, feature-гілка: change-файл → pass'`.

- [ ] **Step 2: npm-published (no-git) — «version != опублікованій + CHANGELOG → pass» стає fail**

Тест на рядку ≈183 `'локальна version != опублікованій + CHANGELOG + files=["CHANGELOG.md"] → pass'`: лишити тіло як є, але змінити очікування й назву:

```js
expect(code).toBe(1)
```
Назва → `'локальна version != опублікованій (ручний bump) → fail'`.

- [ ] **Step 3: npm-published — додати dedicated files-check кейс**

Замість тесту на рядку ≈221 `'локальна version != опублікованій, files без "CHANGELOG.md" → fail'` (його причина тепер «ручний bump», що дублює Step 2) переписати на перевірку files-check через change-файл у sync-стані:

```js
test('version = опублікованій, є change-файл, але files без "CHANGELOG.md" → fail', async () => {
  await withTmpDir(async dir => {
    await writeJson(join(dir, 'package.json'), {
      name: '@x/lib',
      version: '1.0.0',
      files: ['types']
    })
    await mkdir(join(dir, '.changes'), { recursive: true })
    await writeFile(join(dir, '.changes', '1-a.md'), '---\nbump: patch\nsection: Added\n---\nFix\n', 'utf8')
    const code = await checkChangelog({ cwd: dir, getPublishedVersion: publishedStub({ '@x/lib': '1.0.0' }) })
    expect(code).toBe(1)
  })
})
```

- [ ] **Step 4: local-only — репрофілювати «feature: bump + запис → pass» на «ручний bump → fail»**

Тест на рядку ≈350 `'feature-гілка: bump + запис → pass'`: лишити ручний bump (1.0.0→1.1.0) і запис у CHANGELOG, але змінити очікування й назву:

```js
expect(await checkChangelog({ cwd: dir })).toBe(1)
```
Назва → `'feature-гілка: ручний bump version → fail (заборонено)'`.

- [ ] **Step 5: local-only — новий воркспейс має вимагати change-файл**

Тест на рядку ≈443 `'feature-гілка: новий воркспейс з CHANGELOG для початкової version → pass без bump'`: додати change-файл у `demo` і лишити pass:

```js
await ensureDir(join(dir, 'demo'))
await writeJson(join(dir, 'demo', 'package.json'), { name: 'demo', version: '0.0.0', private: true })
await writeFile(join(dir, 'demo', 'app.js'), 'x\n', 'utf8')
await mkdir(join(dir, 'demo', '.changes'), { recursive: true })
await writeFile(join(dir, 'demo', '.changes', '1-a.md'), '---\nbump: minor\nsection: Added\n---\nновий пакет\n', 'utf8')
expect(await checkChangelog({ cwd: dir })).toBe(0)
```
Назва → `'feature-гілка: новий воркспейс із change-файлом → pass'`.

Додатково — окремий fail-кейс «новий воркспейс без change-файлу → fail»:

```js
test('feature-гілка: новий воркспейс без change-файлу → fail', async () => {
  await withTmpDir(async dir => {
    await git(['init', '-q', '-b', 'dev'], dir)
    await writeJson(join(dir, 'package.json'), { name: 'mono', version: '1.0.0', private: true, workspaces: ['demo'] })
    await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
    await git(['add', '-A'], dir)
    await git(['commit', '-q', '-m', 'init'], dir)
    await git(['checkout', '-q', '-b', 'feat/demo'], dir)
    await ensureDir(join(dir, 'demo'))
    await writeJson(join(dir, 'demo', 'package.json'), { name: 'demo', version: '0.0.0', private: true })
    await writeFile(join(dir, 'demo', 'app.js'), 'x\n', 'utf8')
    expect(await checkChangelog({ cwd: dir })).toBe(1)
  })
})
```

- [ ] **Step 6: local-only — «зміна в одному воркспейсі» через change-файл**

Тест на рядку ≈463 `'зміна тільки в одному з воркспейсів — інший не вимагає bump'`: замість ручного bump `a`→1.0.1 + CHANGELOG покласти change-файл у `a`:

```js
// змінюємо лише `a`
await writeFile(join(dir, 'a', 'x.js'), 'x\n', 'utf8')
await mkdir(join(dir, 'a', '.changes'), { recursive: true })
await writeFile(join(dir, 'a', '.changes', '1-a.md'), '---\nbump: patch\nsection: Changed\n---\nx\n', 'utf8')
expect(await checkChangelog({ cwd: dir })).toBe(0)
```

- [ ] **Step 7: Python local-only — «bump + CHANGELOG → pass» через change-файл**

Тест на рядку ≈505 `'local-only: bump + CHANGELOG → pass'`: замість `writePyproject({version:'1.0.1'})` + CHANGELOG покласти change-файл у корінь:

```js
await git(['checkout', '-q', '-b', 'feat/x'], dir)
await writeFile(join(dir, 'app.py'), 'print(1)\n', 'utf8')
await mkdir(join(dir, '.changes'), { recursive: true })
await writeFile(join(dir, '.changes', '1-a.md'), '---\nbump: patch\nsection: Changed\n---\nx\n', 'utf8')
expect(await checkChangelog({ cwd: dir })).toBe(0)
```
Назва → `'local-only (python): change-файл → pass'`.

- [ ] **Step 8: PyPI-published — «version != реєстру + CHANGELOG → pass» стає fail**

Тест на рядку ≈525 `'PyPI-published: version != реєстру + CHANGELOG → pass'`: змінити очікування й назву:

```js
expect(code).toBe(1)
```
Назва → `'PyPI-published: version != реєстру (ручний bump) → fail'`.

- [ ] **Step 9: Mixed — app через change-файл замість bump**

Тест на рядку ≈557 `'npm-published в sync, app з bump+entry → pass'`: замість ручного bump `app`→1.0.1 + CHANGELOG покласти change-файл у `app`:

```js
// local-only зміна в app з change-файлом
await writeFile(join(dir, 'app', 'bar.js'), 'y\n', 'utf8')
await mkdir(join(dir, 'app', '.changes'), { recursive: true })
await writeFile(join(dir, 'app', '.changes', '1-a.md'), '---\nbump: patch\nsection: Changed\n---\nx\n', 'utf8')

const code = await checkChangelog({ cwd: dir, getPublishedVersion: publishedStub({ '@x/lib': '2.0.0' }) })
expect(code).toBe(0)
```
Назва → `'npm-published в sync, app з change-файлом → pass'`.

- [ ] **Step 10: Додати явний крос-гілковий fail-кейс «ручний bump на main → fail»**

Наприкінці `describe('check-changelog (local-only merge-base логіка)')` додати:

```js
test('main: ручний bump version поза CI → fail', async () => {
  await withTmpDir(async dir => {
    await git(['init', '-q', '-b', 'main'], dir)
    await writeJson(join(dir, 'package.json'), { name: 'mono', version: '1.0.0', private: true })
    await writeFile(join(dir, 'CHANGELOG.md'), changelogWithVersion('1.0.0'), 'utf8')
    await git(['add', '-A'], dir)
    await git(['commit', '-q', '-m', 'init'], dir)
    await git(['update-ref', 'refs/remotes/origin/main', 'HEAD'], dir)
    // ручний bump на main без change-файлу
    await writeFile(join(dir, 'app.js'), 'x\n', 'utf8')
    await writeJson(join(dir, 'package.json'), { name: 'mono', version: '1.1.0', private: true })
    await git(['add', '-A'], dir)
    await git(['commit', '-q', '-m', 'manual bump'], dir)
    expect(await checkChangelog({ cwd: dir })).toBe(1)
  })
})
```

- [ ] **Step 11: Прогнати весь файл — має бути зелено**

Run: `cd npm && bunx vitest run rules/changelog/js/tests/consistency/tests/check.test.mjs`
Expected: PASS — усі кейси зелені.

- [ ] **Step 12: Commit**

```bash
git add npm/rules/changelog/js/tests/consistency/tests/check.test.mjs
git commit -m "test(changelog): change-файл — єдиний pass; ручний bump → fail"
```

---

## Task 3: Оновити правило `changelog.mdc` + дзеркало

**Files:**
- Modify: `npm/rules/changelog/changelog.mdc`
- Modify: `.cursor/rules/n-changelog.mdc`

- [ ] **Step 1: Підняти version у frontmatter (джерело)**

У `npm/rules/changelog/changelog.mdc` рядок 3:

```
version: '3.1'
```

- [ ] **Step 2: Прибрати legacy-рядок (джерело)**

Видалити повністю рядок 15:

```
**Legacy / hotfix:** ручний bump `version` + новий запис у `CHANGELOG.md` усе ще приймається перевіркою як альтернатива change-файлу.
```

- [ ] **Step 3: Посилити STOP-крок 2 (джерело)**

Рядок 12 замінити на:

```
2. **Ніколи** не редагуй `version` і `CHANGELOG.md` вручну — навіть для hotfix. Єдиний артефакт зміни — change-файл; `version`/CHANGELOG формує `n-cursor release` у CI на `main` (агрегує change-файли, ставить git-тег `<name>@<version>`). Ручна зміна `version` поза CI завалює `check changelog`.
```

- [ ] **Step 4: Прибрати «release-крок» з інверсії (джерело)**

У блоці інверсії (рядок 19) і в «Чеклист агента» (рядок 44) прибрати пункт про «правки **лише** `CHANGELOG.md` або поля `version` … як сам релізний крок» — релізного кроку у feature-флоу більше немає (він лише в CI). Рядок 44 видалити; у рядку 19 прибрати фрагмент «лише сам релізний крок (`CHANGELOG.md` + `version`)».

- [ ] **Step 5: Синхронізувати дзеркало**

Скопіювати підсумковий зміст джерела у дзеркало:

Run: `cp npm/rules/changelog/changelog.mdc .cursor/rules/n-changelog.mdc`

> Якщо у репо є канонічний синк-скрипт для `.cursor/` — використати його замість `cp`. Перевір: `grep -rn "n-changelog" npm/scripts` та `.cursor/skills`.

- [ ] **Step 6: Перевірити синхронність**

Run: `diff npm/rules/changelog/changelog.mdc .cursor/rules/n-changelog.mdc`
Expected: без різниці (exit 0).

- [ ] **Step 7: Commit**

```bash
git add npm/rules/changelog/changelog.mdc .cursor/rules/n-changelog.mdc
git commit -m "docs(changelog): прибрати legacy ручний bump — лише change-файли (v3.1)"
```

---

## Task 4: Аудит agent-facing документів і memory

**Files:**
- Modify: `~/.claude/projects/-Users-vitaliytv-www-nitra-cursor/memory/feedback_changelog.md`
- Modify: `~/.claude/projects/-Users-vitaliytv-www-nitra-cursor/memory/MEMORY.md`
- (за наявності) Modify: скіли під `.cursor/skills/*/SKILL.md`, що згадують ручний bump

- [ ] **Step 1: Знайти agent-facing заклики бампити вручну**

Run: `grep -rniE "підвищ.*version|bump.*version|version.*\+ ?1|нову секцію.*CHANGELOG" .cursor/skills AGENTS.md CLAUDE.md cursor/CLAUDE.md 2>/dev/null`
Expected: список згадок. Для кожної — переписати на «поклади change-файл `n-cursor change`, не чіпай `version`/`CHANGELOG`». (`AGENTS.md` лише посилається на правило — змін не потребує.)

- [ ] **Step 2: Переписати memory `feedback_changelog.md`**

Замінити вміст файлу на change-файл-флоу:

```markdown
---
name: feedback-changelog
description: "Перед завершенням кодової задачі покласти change-файл (`npx @nitra/cursor change …`) у кожному торкнутому workspace; ніколи не бампати version/CHANGELOG вручну; підтвердити через `npx @nitra/cursor fix changelog`"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 344f127f-0f8d-475c-9cef-7c259d7fc757
---

Перед тим, як заявити «зроблено» в цьому монорепо, для **кожного** workspace, де зачеплено код/конфіг/правила/rego/тести:

1. Поклади **change-файл**: `npx @nitra/cursor change --bump <major|minor|patch> --section <Added|Changed|Fixed|Removed> --message "<…>" [--ws <шлях>]`.
2. **Ніколи** не редагуй `version` у `package.json`/`pyproject.toml` і `CHANGELOG.md` вручну — навіть для hotfix. Bump + CHANGELOG + git-тег робить `n-cursor release` лише в CI на `main`.
3. Прогнати `npx @nitra/cursor fix changelog` — має бути `exit 0`.

**Виключення (без change-файлу):** правки лише під `docs/`/`doc/`, синхронізований tooling під `.cursor/`/`.claude/`, файли в `.gitignore`, корінь монорепо.

**Why:** ручний bump `version` у feature-гілках/worktree — джерело merge-конфліктів при паралельній роботі субагентів (усі редагують той самий рядок `version`). Change-файли мають унікальні імена → нуль спільних рядків. У сесії 2026-05-30 користувач прямо вимагав прибрати ручний і агентський bump — bump лише в CI. Перевірка `consistency.mjs` тепер **завалює** будь-яку зміну `version` поза CI.

**How to apply:** робити цей чек **завжди**, коли остання дія — Edit/Write по файлах у `npm/`, `demo/` чи будь-якому каталозі з власним `package.json`/`pyproject.toml`. Якщо торкнуто кілька workspace — окремий change-файл у кожному. Пов'язано з [[project-rules-restructure]].
```

- [ ] **Step 2b: Оновити рядок у `MEMORY.md`**

У `~/.claude/projects/-Users-vitaliytv-www-nitra-cursor/memory/MEMORY.md` рядок про changelog замінити на:

```
- [change-файл перед фінішем](feedback_changelog.md) — у кожному workspace покласти change-файл через `n-cursor change`; ніколи не бампати version/CHANGELOG вручну (bump лише в CI)
```

- [ ] **Step 3: Commit (лише файли репо; memory — поза git)**

```bash
git add -A
git commit -m "docs: прибрати agent-facing заклики до ручного bump version"
```

> Memory-файли (`~/.claude/...`) у git репо не входять — їх не комітимо, лише оновлюємо на диску.

---

## Task 5: Change-файл релізу + фінальна верифікація

**Files:**
- Create: `npm/.changes/<unique>.md`

- [ ] **Step 1: Покласти change-файл для самого пакета**

Run:
```bash
node npm/bin/n-cursor.js change --bump minor --section Changed \
  --message "changelog: ручний/агентський bump version заборонено — change-файли стають єдиним способом, bump робить лише CI (n-changelog v3.1)" \
  --ws npm
```
Expected: `✅ npm/.changes/<timestamp>-<rand>.md`

> **Не** редагувати `npm/package.json#version` вручну.

- [ ] **Step 2: Перевірити changelog-консистентність**

Run: `node npm/bin/n-cursor.js fix changelog`
Expected: exit `0` (для `npm` — `є change-файл(и) у .changes/ — bump зробить CI`).

- [ ] **Step 3: Прогнати повний набір тестів пакета**

Run: `cd npm && bunx vitest run`
Expected: PASS — увесь набір зелений (зокрема `check.test.mjs`).

- [ ] **Step 4: Commit**

```bash
git add npm/.changes
git commit -m "chore(npm): change-файл — заборона ручного bump version"
```

- [ ] **Step 5: Лінт (один послідовний прогон)**

Лінт запускати **окремо** через `/n-lint` (правило: жодних паралельних eslint). Після всіх комітів виконати `/n-lint`, виправити порушення, підтвердити чистий вихід.

---

## Self-Review

**Spec coverage:**
- «consistency.mjs: ручний bump → fail на будь-якій гілці; change-файл → pass» → Task 1 (Steps 2–4) + Task 2 (Steps 1–10).
- «n-changelog.mdc без legacy-лазівки, v3.1, дзеркало синхронне» → Task 3.
- «оновити тести, додати кейси на заборону» → Task 2 (Steps 4, 5, 10).
- «зняти agent-facing заклики бампити, оновити memory» → Task 4.
- «покласти npm/.changes/*.md; fix changelog → 0» → Task 5.
- «без main-винятку» → Task 1 Step 3 (`Vpublished !== Vcurrent` без гілкового винятку) + Task 2 Step 10.
- «dev-сторона не звіряє CHANGELOG» → Task 1 Step 5 (видалення `verifyChangelogEntry`).

**Placeholder scan:** усі кроки містять конкретний код/команди; рядкові орієнтири позначені `≈` бо файл редагується по ходу — звіряти за іменами функцій, не за номерами.

**Type/identifier consistency:** `missingChangeFileMessage(label, mf)`, `checkNpmFilesArrayContainsChangelog(manifest, pass, fail)`, `hasPendingChangeFiles(ws, cwd)`, `readBaseVersion(ref, manifest, cwd)`, `resolveChangelogComparisonPoint(branch, cwd)`, `workspaceHasRelevantChangesAgainstBase(ref, ws, subWorkspaces, cwd)` — імена збігаються з наявними в `consistency.mjs`. Change-файл frontmatter (`bump`/`section`) відповідає `release/lib/change-file.mjs`.
