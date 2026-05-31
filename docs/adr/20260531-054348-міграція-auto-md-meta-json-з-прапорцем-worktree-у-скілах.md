---
session: 09dcb1bc-929b-4d88-90b0-c0611bed3d2f
captured: 2026-05-31T05:43:48+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/09dcb1bc-929b-4d88-90b0-c0611bed3d2f.jsonl
---

[assistant]
[tool: Write] {"file_path":"/Users/vitaliytv/www/nitra/cursor/docs/superpowers/plans/2026-05-30-skill-meta-json-worktree-flag.md","content":"# Plan: міграція `auto.md` → `meta.json` + прапорець `worktree` у скілах\n\n## Objective\n\nЗамінити `npm/skills/<id>/auto.md` на `npm/skills/<id>/meta.json` (поля `auto` + опційний `worktree`). Прапорець `worktree: true` ін'єктується у frontmatter `SKILL.md` під час `syncSkills`. JSON Schema + check-concern забезпечують консистентність. Spec: `docs/superpowers/specs/2026-05-30-skill-meta-json-worktree-flag-design.md`.\n\n---\n\n## Step 1: JSON Schema\n\n- [ ] Створити `npm/schemas/skill-meta.schema.json`:\n\n```json\n{\n  \"$schema\": \"http://json-schema.org/draft-07/schema#\",\n  \"type\": \"object\",\n  \"required\": [\"auto\"],\n  \"additionalProperties\": false,\n  \"properties\": {\n    \"auto\": {\n      \"oneOf\": [\n        { \"type\": \"string\", \"const\": \"завжди\" },\n        { \"type\": \"array\", \"items\": { \"type\": \"string\" }, \"minItems\": 1 }\n      ]\n    },\n    \"worktree\": { \"type\": \"boolean\" }\n  }\n}\n```\n\n### Verification\n- [ ] `node -e \"JSON.parse(require('fs').readFileSync('npm/schemas/skill-meta.schema.json','utf8'))\"` → без помилок\n\n---\n\n## Step 2: Створити `meta.json`, видалити `auto.md` (паралельно зі Step 1)\n\nСтворити у кожній `npm/skills/<id>/`:\n\n| Скіл | `auto` | `worktree` |\n|------|--------|------------|\n| `fix` | `\"завжди\"` | `true` |\n| `lint` | `\"завжди\"` | `true` |\n| `taze` | `[\"bun\"]` | `true` |\n| `fix-tests` | `\"завжди\"` | `true` |\n| `coverage-fix` | `\"завжди\"` | `true` |\n| `adr-normalize` | `[\"adr\"]` | — (відсутнє) |\n| `llm-patch` | `\"завжди\"` | — (відсутнє) |\n| `publish-telegram` | `\"завжди\"` | — (відсутнє) |\n| `start-check` | `\"завжди\"` | — (відсутнє) |\n\n- [ ] Створити `npm/skills/fix/meta.json`: `{ \"auto\": \"завжди\", \"worktree\": true }`\n- [ ] Створити `npm/skills/lint/meta.json`: `{ \"auto\": \"завжди\", \"worktree\": true }`\n- [ ] Створити `npm/skills/taze/meta.json`: `{ \"auto\": [\"bun\"], \"worktree\": true }`\n- [ ] Створити `npm/skills/fix-tests/meta.json`: `{ \"auto\": \"завжди\", \"worktree\": true }`\n- [ ] Створити `npm/skills/coverage-fix/meta.json`: `{ \"auto\": \"завжди\", \"worktree\": true }`\n- [ ] Створити `npm/skills/adr-normalize/meta.json`: `{ \"auto\": [\"adr\"] }`\n- [ ] Створити `npm/skills/llm-patch/meta.json`: `{ \"auto\": \"завжди\" }`\n- [ ] Створити `npm/skills/publish-telegram/meta.json`: `{ \"auto\": \"завжди\" }`\n- [ ] Створити `npm/skills/start-check/meta.json`: `{ \"auto\": \"завжди\" }`\n- [ ] Видалити всі 9 `npm/skills/<id>/auto.md`\n\n### Verification\n- [ ] `ls npm/skills/*/auto.md 2>&1` → «No such file» (жоден не залишився)\n- [ ] `ls npm/skills/*/meta.json` → 9 файлів\n\n---\n\n## Step 3: Оновити `auto-skills.mjs` + тести (після Step 2)\n\n### `npm/scripts/auto-skills.mjs`\n\n- [ ] Видалити `parseSkillAutoSpec` — усі виклики лише в цьому файлі та `auto-skills.test.mjs`\n- [ ] Змінити `discoverSkillAutoActivation`: читати `meta.json[\"auto\"]` замість `auto.md`:\n  ```js\n  export function discoverSkillAutoActivation(skillDir) {\n    const metaFile = join(skillDir, 'meta.json')\n    if (!fs.existsSync(metaFile)) return null\n    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'))\n    return meta.auto ?? null\n  }\n  ```\n- [ ] Оновити JSDoc-коментар у шапці файлу (замінити посилання на `auto.md` → `meta.json`)\n\n### `npm/scripts/tests/auto-skills.test.mjs`\n\n- [ ] Замінити фікстури: у тимчасових директоріях `auto.md` → `meta.json` з полем `auto`\n- [ ] Видалити тести `parseSkillAutoSpec` (функції більше не існує)\n\n### Verification\n- [ ] `npx vitest run scripts/tests/auto-skills.test.mjs` → все зелено\n\n---\n\n## Step 4: Оновити `syncSkills` у `npm/bin/n-cursor.js` (після Step 2)\n\nЦільова ділянка: `n-cursor.js:744–768` (функція `syncSkills`).\n\n### Новий хелпер `injectWorktreeField(content, worktree)`\n\n- [ ] Додати функцію **вище `syncSkills`** (рядкова маніпуляція, без YAML-парсера):\n\n```js\nfunction injectWorktreeField(content, worktree) {\n  if (!worktree) return content\n  const fm = 'worktree: true'\n  const note = '> **worktree: true** — скіл передбачає ізоляцію у git-worktree. Перед виконанням перевір, чи вже існує відповідний worktree (`git worktree list`); якщо ні — створи новий (`git worktree add`). Не запускай паралельно в кількох worktree скіли, що навантажують CPU/диск (eslint, Stryker).\\n'\n  if (content.startsWith('---\\n')) {\n    // прибрати старе worktree: якщо є\n    const clean = content.replace(/^worktree:.*\\n/m, '')\n    // вставити поле у frontmatter\n    const withFm = clean.replace(/^---\\n/, `---\\n${fm}\\n`)\n    // вставити note після закриваючого ---\n    return withFm.replace(/^(---\\n[\\s\\S]*?---\\n)/, `$1\\n${note}\\n`)\n  }\n  return `---\\n${fm}\\n---\\n\\n${note}\\n${content}`\n}\n```\n\n### Зміни у `syncSkills`\n\n- [ ] Рядок 754: замінити `f !== 'auto.md'` → `f !== 'meta.json'`\n- [ ] При копіюванні файлу: якщо `file === 'SKILL.md'` — замість `copyFileSync` читати вміст, викликати `injectWorktreeField`, записувати результат:\n  ```js\n  const metaPath = join(bundledSkillDir, 'meta.json')\n  const skillMeta = fs.existsSync(metaPath)\n    ? JSON.parse(fs.readFileSync(metaPath, 'utf8'))\n    : {}\n  // ...\n  for (const file of files) {\n    const src = join(bundledSkillDir, file)\n    const dst = join(targetDir, file)\n    if (!fs.statSync(src).isFile()) continue\n    if (file === 'SKILL.md') {\n      const content = fs.readFileSync(src, 'utf8')\n      fs.writeFileSync(dst, injectWorktreeField(content, skillMeta.worktree ?? false))\n    } else {\n      fs.copyFileSync(src, dst)\n    }\n  }\n  ```\n\n### Verification\n- [ ] `npx vitest run scripts/tests/skills-cli.test.mjs` → зелено\n- [ ] Вручну перевірити: синкнути `lint` → `.cursor/skills/n-lint/SKILL.md` містить `worktree: true` і note\n\n---\n\n## Step 5: `check-skill-meta.mjs` + тести (після Step 1, 2)\n\n### `npm/rules/npm-module/js/check-skill-meta.mjs`\n\n- [ ] Реалізувати `checkSkillMeta(cwd)` — перевіряє усі `npm/skills/<id>/`:\n  - `meta.json` існує\n  - `meta.json` є валідним JSON\n  - `meta.json` відповідає схемі (manual validation: `auto` = `'завжди'` | непорожній `string[]`; `worktree` = `boolean` якщо є; no extra keys)\n  - `auto.md` відсутній\n- [ ] Повертає `{ exitCode: number, messages: string[] }` (паттерн аналогічний `checkPackageStructure`)\n\n### `npm/rules/npm-module/js/tests/check-skill-meta.test.mjs`\n\n- [ ] Тест: всі 9 поточних `npm/skills/<id>/` → exitCode 0 (реальна директорія після Step 2)\n- [ ] Тест: відсутній `meta.json` → exitCode 1 + повідомлення\n- [ ] Тест: присутній `auto.md` поруч із `meta.json` → exitCode 1\n- [ ] Тест: `auto: \"ніколи\"` (не `\"завжди\"`) → exitCode 1\n- [ ] Тест: `worktree: \"yes\"` (рядок) → exitCode 1\n- [ ] Тест: `meta.json` без `worktree` → exitCode 0 (опційне поле)\n\n### Verification\n- [ ] `npx vitest run rules/npm-module/js/tests/check-skill-meta.test.mjs` → все зелено\n\n---\n\n## Step 6: Інтегрувати `check-skill-meta` у `fix.mjs` (після Step 5)\n\nФайл: `npm/rules/npm-module/fix.mjs`\n\n- [ ] Додати імпорт: `import { checkSkillMeta } from './js/check-skill-meta.mjs'`\n- [ ] Викликати поряд з `checkNpmModule` й об'єднати exitCode:\n  ```js\n  const result = await checkNpmModule(ctx.cwd)\n  const metaResult = checkSkillMeta(ctx.cwd)\n  const exitCode = Math.max(result.exitCode, metaResult.exitCode)\n  const messages = [...result.messages, ...metaResult.messages]\n  ```\n\n### Verification\n- [ ] `npx @nitra/cursor fix npm-module` → виходить з кодом 0 (після міграції всіх `meta.json`)\n\n---\n\n## Step 7: Повний тест-сюїт + changeset\n\n- [ ] `npx vitest run` → не більше 2 передіснуючих флакових падінь (readStdin timeout + integration-repo-checks за dirty tree)\n- [ ] `npx @nitra/cursor change --bump minor --section Changed --message \"skills: міграція auto.md → meta.json з прапорцем worktree; ін'єкція worktree: true в SKILL.md при syncSkills\"`\n- [ ] Перевірити `npx @nitra/cursor fix changelog` → exit 0\n"}
[u
[user]
[tool_result] File created successfully at: /Users/vitaliytv/www/nitra/cursor/docs/superpowers/plans/2026-05-30-skill-meta-json-worktree-flag.md (file state is current in your context — no need to Read it back)
[assistant]
[tool: Bash] {"command":"cd /Users/vitaliytv/www/nitra/cursor && git add docs/superpowers/plans/2026-05-30-skill-meta-json-worktree-flag.md && git commit -m \"$(cat <<'EOF'\ndocs: план реалізації міграції auto.md → meta.json зі прапорцем worktree\n\nCo-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>\nEOF\n)\" 2>&1 | tail -4","description":"Commit implementation plan"}
[u
[user]
[tool_result] [main 6f81a15] feat: withLock крос-worktree серіалізація + test rule v2.7
Date: Fri May 30 20:44:02 EEST 2026
2 files changed, 12 insertions(+), 11 deletions(-)
[assistant]
[tool: Bash] {"command":"cd /Users/vitaliytv/www/nitra/cursor && git add docs/superpowers/plans/2026-05-30-skill-meta-json-worktree-flag.md && git commit -m \"docs: план реалізації міграції auto.md → meta.json зі прапорцем worktree

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>\" 2>&1 | tail -4","description":"Commit plan file"}
[u
[user]
[tool_result] [main 1e7a9a7] docs: план реалізації міграції auto.md → meta.json зі прапорцем worktree
1 file changed, 152 insertions(+)
[assistant]
Специфікацію й план закомічено. Два файли готові:

- **Spec:** `docs/superpowers/specs/2026-05-30-skill-meta-json-worktree-flag-design.md`
- **Plan:** `docs/superpowers/plans/2026-05-30-skill-meta-json-worktree-flag.md`

Щоб почати реалізацію, запускай `/executing-plans docs/superpowers/plans/2026-05-30-skill-meta-json-worktree-flag.md`.

---

## ADR: Міграція `auto.md` → `meta.json` з прапорцем `worktree` у скілах

## Context and Problem Statement

Кожен скіл у `npm/skills/<id>/` мав файл `auto.md` з одним рядком (`завжди` або `[rule-id]`), що визначав умову автоактивації у `.n-cursor.json`. Формат — plain-текст без JSON Schema. Одночасно `withLock` виявився не крос-worktree: лок зберігався у `node_modules/.cache/n-cursor/<key>/`, а `node_modules` у кожного worktree свій. Агент не мав стандартного сигналу «цей скіл призначений для ізоляції у git-worktree».

## Considered Options

* `meta.json` з двома полями (`auto` + `worktree`) + JSON Schema + check-concern
* Зберегти `auto.md`, додати окремий `worktree.json`
* Винести `worktree` прямо у frontmatter пакетного `SKILL.md` (без окремого файлу конфігурації)

## Decision Outcome

Chosen option: "`meta.json` з двома полями + JSON Schema + check-concern", because формат структурований (валідується схемою `npm/schemas/skill-meta.schema.json`), єдиний файл замість двох (одне джерело правди), `auto` не потребує парсингу, а `worktree` ін'єктується у frontmatter `SKILL.md` під час `syncSkills` — агент отримує прапорець у вже прочитаному файлі без зайвих файлів у `.cursor/skills/n-<id>/`.

Якщо `worktree` відсутнє у `meta.json` — вважається `false`.

### Consequences

* Good, because JSON Schema (`skill-meta.schema.json`) гарантує консистентність; `check-skill-meta.mjs` у `fix npm-module` перевіряє наявність та структуру, відсутність залишків `auto.md`.
* Good, because `injectWorktreeField` вставляє у `SKILL.md` frontmatter і пояснювальний note для агента: «перевір `git worktree list`, не запускай паралельно CPU-важкі скіли».
* Bad, because `syncSkills` (`npm/bin/n-cursor.js:744`) набуває нову відповідальність — маніпуляцію frontmatter при копіюванні `SKILL.md` (рядкова маніпуляція без YAML-парсера).

## More Information

- Spec: `docs/superpowers/specs/2026-05-30-skill-meta-json-worktree-flag-design.md`
- Plan: `docs/superpowers/plans/2026-05-30-skill-meta-json-worktree-flag.md`
- `syncSkills` — `npm/bin/n-cursor.js:744–768`
- `discoverSkillAutoActivation` — `npm/scripts/auto-skills.mjs:40–45`
- Скіли з `worktree: true`: `fix`, `lint`, `taze`, `fix-tests`, `coverage-fix`
- JSON Schema: `draft-07`, `additionalProperties: false`
