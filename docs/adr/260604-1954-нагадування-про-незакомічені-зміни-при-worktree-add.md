---
session: 889efce9-844a-483c-84fa-b12a55f91b76
captured: 2026-06-04T19:54:54+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/889efce9-844a-483c-84fa-b12a55f91b76.jsonl
---

## ADR Нагадування про незакомічені зміни при `worktree add`

## Context and Problem Statement
Команда `npx @nitra/cursor worktree add` створює worktree через `git worktree add … -b <branch>` від HEAD — незакомічені зміни з основного дерева в новий checkout не потрапляють. Це несподівано для користувача: він редагує файл (наприклад, `.github/workflows/npm-publish.yml`), запускає worktree-скіл, а скіл перевіряє старіший committed-стан і не бачить нових правок.

## Considered Options
* Opt-in флаг `--carry-dirty` — стейджингова копія uncommitted-змін у новий worktree через `git diff HEAD --binary` + `git apply` + ручне копіювання untracked-файлів
* Змінити дефолтну поведінку `worktree add` — завжди переносити незакомічені зміни
* Показувати нагадування на екрані — повідомити про файли, які не потрапили у worktree, без жодного переміщення стану

## Decision Outcome
Chosen option: "Показувати нагадування на екрані", because перенесення стану ламає семантику ізоляції, на якій побудовані всі worktree-only-скіли (`n-fix`, `flow init`): вони навмисно валідують committed-стан гілки, а не робочий стан. Нагадування є безпечним і не мутує жодного дерева.

### Consequences
* Good, because transcript фіксує очікувану користь: користувач одразу бачить список файлів (або їх кількість), які лишилися поза worktree, і може свідомо вирішити — закомітити чи відкинути.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Нова чиста функція `buildDirtyNotice(porcelain, limit=10)` у `npm/scripts/lib/worktree.mjs`: ≤10 файлів — перелік, >10 — лише кількість (поріг `DIRTY_LIST_LIMIT = 10`).
- `cmdAdd` у `npm/scripts/worktree-cli.mjs` знімає `git status --porcelain` і після успішного `worktree add` виводить:
```
⚠️  Основне дерево має N незакомічених змін — вони НЕ потрапили в цей worktree (створено від HEAD).
```
- Тести: `+5` юніт на `buildDirtyNotice` у `npm/scripts/lib/tests/worktree.test.mjs`, `+2` інтеграційних у `npm/scripts/tests/worktree-cli.test.mjs` (разом 29 зелених).
- Оновлено `.cursor/rules/n-worktree.mdc` — додано рядок про поведінку нагадування.
- Change-файл: `.changes/260604-1950.md` (bump `minor`, секція `Added`).

---

## ADR Знімок `git status` до, а не після `git worktree add`

## Context and Problem Statement
У `cmdAdd` потрібно зібрати список незакомічених файлів основного дерева, щоб сформувати нагадування. Якщо `git status --porcelain` знімати після `git worktree add`, новостворений `.worktrees/<name>/` сам потрапляє у вивід статусу — коли `.worktrees/` не входить до `.gitignore` тестового temp-репо.

## Considered Options
* Знімати `git status` до виклику `git worktree add`
* Знімати `git status` після виклику `git worktree add`

## Decision Outcome
Chosen option: "Знімати `git status` до виклику `git worktree add`", because інтеграційний тест виявив, що знімок після призводить до хибнопозитивного нагадування навіть для чистого дерева: щойно створений checkout з'являється у статусі, якщо `.worktrees/` не прописаний у `.gitignore` тестового середовища.

### Consequences
* Good, because transcript фіксує очікувану користь: тест «чисте основне дерево → без нагадування» проходить зелено після переміщення знімку до `worktree add`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Регресія виявлена тестом `чисте основне дерево → без нагадування` у `npm/scripts/tests/worktree-cli.test.mjs` (`AssertionError: expected … not to contain 'незакомічених змін'`).
- Виправлення: у `cmdAdd` (`npm/scripts/worktree-cli.mjs`) порядок змінено на `status → worktree add → notice`.
- Продакшн-репо має `.worktrees/` у `.gitignore` (рядки 10–11), тому там проблема прихована; тест-середовище — fresh temp-dir без цього запису.
