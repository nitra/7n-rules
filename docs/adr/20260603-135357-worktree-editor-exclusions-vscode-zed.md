# Worktree-виключення у редакторах VSCode і Zed через правило worktree

**Status:** Accepted
**Date:** 2026-06-03

## Context and Problem Statement

Worktree-каталоги (`.worktrees/`, `.claude/worktrees/`) є вкладеними копіями всього дерева репо. Без exclude-налаштувань у редакторах (VSCode, Zed) вони індексуються файлвотчером, дають дублікати в пошуку й навантажують CPU. Правило `text` вже мало `.vscode/settings.json`-concern без worktree-exclusions; Zed як редактор узагалі не охоплювався.

## Considered Options

- Додати worktree-excludes у правило `text` (поруч із наявним `policy/vscode_settings/`)
- Додати worktree-excludes у правило `worktree` як окремі concern-и (нові `policy/vscode_settings/` і `policy/zed_settings/`)

## Decision Outcome

Chosen option: "Додати worktree-excludes у правило `worktree`", because відповідальність за editor-exclusions worktree-каталогів семантично належить до worktree-конвенції, а не до `text`-правила (oxfmt, cspell). Два правила, що пишуть той самий файл — технічно можливо, але дробить контекст; worktree-правило консолідує всі worktree-специфічні артефакти.

### Consequences

- Good, because enforcement підтверджено: видалення `**/.worktrees` із `.zed/settings.json` фейлить `bun npm/rules/worktree/fix.mjs` з `❌ .zed/settings.json: file_scan_exclusions має містити "**/.worktrees"`.
- Good, because exclusions потрапляють у `.vscode/settings.json` та `.zed/settings.json` автоматично при `n-fix`, без ручного редагування кожного проєкту.
- Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Нові файли: `npm/rules/worktree/policy/vscode_settings/target.json`, `npm/rules/worktree/policy/vscode_settings/template/settings.json.snippet.json`, `npm/rules/worktree/policy/zed_settings/target.json`, `npm/rules/worktree/policy/zed_settings/template/settings.json.snippet.json`
- Обидва concern-и використовують `"check": "template"` (без власного `.rego`) — `checkSnippet` перевіряє structural-subset для об'єктів і масивів.
- VSCode snippet: `search.exclude` + `files.exclude` → `{ "**/.worktrees/**": true }`. `node_modules` у `search.exclude` — не включений (VSCode виключає дефолтно).
- Zed snippet: повний масив `file_scan_exclusions` (7 елементів: дефолти Zed + `**/.worktrees` + `**/.claude/worktrees`) — повна перевірка, бо Zed замінює дефолтний масив, а не зливає.
- Дзеркало `.cursor/rules/n-worktree.mdc` регенеровано через `expectedMirrorContent` з `npm/scripts/lib/mirror-parity.mjs`.
- Self-apply: `.vscode/settings.json` оновлено, `.zed/settings.json` створено, `.cspell.json` (додано `.zed` до `ignorePaths`).

## Update 2026-06-03

Початково розглядалось розширення наявного concern `policy/vscode_settings/` у правилі `text` — додати `search.exclude` та `files.exclude` для `.worktrees` і створити новий concern `zed_settings` там само. Від цього підходу відмовились: відповідальність за editor-exclusions worktree-каталогів семантично належить до worktree-правила, щоб не дробити контекст між `text` і `worktree`. Конкретні JSON-блоки, визначені користувачем для VSCode і Zed, перенесено в нові concern-и правила `worktree`.
