---
session: 27bcf8ad-3d79-4564-975c-e30f0be45f1d
captured: 2026-06-01T06:53:07+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/27bcf8ad-3d79-4564-975c-e30f0be45f1d.jsonl
---

Транскрипт містить дві поводжені рішення: (1) мінімальна версія `@nitra/eslint-config` перенесена в `package.json.snippet.json` як єдине джерело, і (2) банер `worktree: true` у `SKILL.md` перетворено з поради на жорсткий fail-fast preflight. Це два окремі ADR.

## ADR Мінімальна версія `@nitra/eslint-config` — єдине джерело в snippet-шаблоні

## Context and Problem Statement
Мінімально допустима версія `@nitra/eslint-config` (`>= 3.10.0`) була захардкоджена в трьох місцях Rego-правила `js-lint/policy/package_json/package_json.rego` (коментарі, `deny`-повідомлення, дві semver-клаузи) і дублювалась у тексті обох `.mdc`-копій. Бамп порогу вимагав синхронних правок у ≥5 файлах і ризикував drift-ом.

## Considered Options
* Поріг лишається в Rego як магічні числа (статус-кво)
* Поріг виноситься в `template/package.json.snippet.json` як єдине джерело; Rego читає його через `data.template.snippet`

## Decision Outcome
Chosen option: "Поріг виноситься в `template/package.json.snippet.json`", because Rego вже отримує `data.template.snippet` через механізм `--data`; додати `devDependencies["@nitra/eslint-config"]` в snippet — це нульова накладна, а Rego-клауза `eslint_min_range` читає поріг звідти, eliminating hardcode.

### Consequences
* Good, because наступний бамп порогу = зміна одного значення в `template/package.json.snippet.json`; Rego, deny-повідомлення, тест `test_eslint_floor_driven_by_snippet` і текст `.mdc` підхоплюють автоматично.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Ключові файли: `npm/rules/js-lint/policy/package_json/template/package.json.snippet.json` (поле `devDependencies`), `npm/rules/js-lint/policy/package_json/package_json.rego` (хелпери `eslint_min_range`, `semver_gte`, `eslint_config_meets_min`), `npm/rules/js-lint/policy/package_json/package_json_test.rego` (тест `test_eslint_floor_driven_by_snippet`).
- Перевірки: `opa test` 8/8, `opa fmt` чисто, `regal lint` 0 порушень.
- `regal` знайшов і виправлено: `var-shadows-builtin` (`floor` → `min_parts`), `defer-assignment`, `messy-rule` (helper-присвоєння поза блоком `deny`).

---

## ADR Жорсткий fail-fast preflight для worktree-only skills

## Context and Problem Statement
Скіли з `"worktree": true` у `meta.json` (`n-fix`, `n-coverage-fix`, `n-fix-tests`, `n-taze`, `n-adr-normalize`) вшивали в `SKILL.md` лише прозовий банер-пораду (`> **Worktree:** виконуй цей скіл в окремому git-worktree…`). Агент (Claude Code) двічі трактував його як рекомендацію — «чисте робоче дерево спокусило», «STOP/ABORT не було явного» — і запускав скіл прямо в основному дереві. Помилка системна, не одноразова.

## Considered Options
* Жорсткіший текст у SKILL.md з явним STOP/ABORT і runnable preflight-командою
* PreToolUse/Stop-хук у `.claude/settings.json`
* Правило в CLAUDE.md (текстове, читається щосесії)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Жорсткіший текст у SKILL.md з явним STOP/ABORT і runnable preflight-командою" (основний) + "Правило в CLAUDE.md" (додатковий шар), because PreToolUse-хук бачить session cwd (корінь проєкту), а не bash-cwd агента після `cd .worktrees/...`, тому завжди рапортував би «не в worktree» і блокував би навіть коректний запуск; хук ненадійний для цього інваріанту.

### Consequences
* Good, because transcript фіксує очікувану користь: агент отримує виконуваний preflight (`git rev-parse --show-toplevel | grep -q '/\.worktrees/'`) як Крок 0, що або проходить, або виводить `ABORT` і завершується з кодом 1 — без можливості «прочитати й проігнорувати». Зміна централізована в `worktree-notice.mjs` → всі 5 скілів оновлюються синхронно.
* Bad, because runnable preflight ефективний лише якщо агент дійсно виконує Крок 0 як bash-команду; якщо агент читає SKILL.md як документацію і не запускає блоки коду, гейт не спрацює.

## More Information
- Ключові файли: `npm/scripts/lib/worktree-notice.mjs` (`NOTICE_BODY` — `[!IMPORTANT]` callout + Крок 0 preflight), `.cursor/skills/n-fix/SKILL.md`, `.cursor/skills/n-coverage-fix/SKILL.md`, `.cursor/skills/n-fix-tests/SKILL.md`, `.cursor/skills/n-taze/SKILL.md`, `.cursor/skills/n-adr-normalize/SKILL.md`.
- Генератор CLAUDE.md: `npm/bin/n-cursor.js` — новий `buildClaudeWorktreeEnforcementSectionLines()` + вставка після секції «Лінт і ESLint».
- Preflight-команда: `git rev-parse --show-toplevel | grep -q '/\.worktrees/' || { echo "ABORT: не у worktree. Спершу: npx @nitra/cursor worktree add <branch> \"<навіщо>\" && cd .worktrees/<branch>"; exit 1; }`.
- Тести: `bun test scripts/lib/tests/worktree-notice.test.mjs scripts/lib/tests/generated-markdown.test.mjs` → 11/11; change-файл `npm/.changes/1780285755419-9af9c4.md` (minor).
