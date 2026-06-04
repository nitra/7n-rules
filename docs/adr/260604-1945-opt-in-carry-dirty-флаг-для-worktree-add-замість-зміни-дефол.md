---
session: 889efce9-844a-483c-84fa-b12a55f91b76
captured: 2026-06-04T19:45:33+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/889efce9-844a-483c-84fa-b12a55f91b76.jsonl
---

## ADR Opt-in `--carry-dirty` флаг для `worktree add` замість зміни дефолту

## Context and Problem Statement

`/n-fix` відпрацював без помилок (19/19 ✅), хоча в основному робочому дереві був незакомічений `.github/workflows/npm-publish.yml` з видаленим обов'язковим кроком `Release`. Виявилося, що `npm/scripts/worktree-cli.mjs` викликає `git worktree add … -b <branch>` без будь-якого base-ref — git чекаутить виключно HEAD-коміт, тому незакомічені зміни залишаються в основному дереві і є невидимими для worktree-only скілів. Користувач запросив змінити цю поведінку.

## Considered Options

* Зміна дефолту: `worktree add` **завжди** переносить незакомічені зміни (tracked-modified, staged, untracked) в новий checkout
* Opt-in флаг `--carry-dirty`: перенесення лише за явним запитом; дефолтна поведінка (чистий HEAD) лишається незміненою

## Decision Outcome

Chosen option: "opt-in флаг `--carry-dirty`", because зміна дефолту порушила б семантику ізоляції, на якій тримаються всі worktree-only скіли (`n-fix`, `flow`-механіка з `base_commit`); флаг дозволяє отримати потрібну поведінку точково, не зачіпаючи решту.

> **Примітка:** transcript закінчується до фінального підтвердження вибору користувачем — зафіксовано рекомендацію асистента.

### Consequences

* Good, because скіли, яким потрібна ізоляція (n-fix, flow init), продовжують валідувати закомічений стан і не отримують шум від робочого дерева.
* Bad, because `git apply` (механізм перенесення diff) кладе зміни як unstaged, тому staging-розподіл втрачається; це прийнятно для поточного use-case але може дивувати.

## More Information

Файли в межах запланованого скоупу: `npm/scripts/worktree-cli.mjs` (парсинг флага + функція `carryDirty`), `npm/scripts/lib/tests/worktree-cli.test.mjs`, `.cursor/rules/n-worktree.mdc` (додати документацію флага). Також обов'язковий change-файл (`npx @nitra/cursor change`) — ручний bump `version`/`CHANGELOG` заборонено правилом `n-changelog`. Реалізація перенесення: `git diff HEAD --binary | git apply` для tracked-modified/staged; `git ls-files --others --exclude-standard -z` + ручне копіювання для untracked-файлів.
