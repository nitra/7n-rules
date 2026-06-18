---
session: 1dd7a063-8226-4e5a-b9e9-d850a757cc93
captured: 2026-06-18T16:26:30+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/1dd7a063-8226-4e5a-b9e9-d850a757cc93.jsonl
---

## ADR Анотовані git-теги в `n-cursor release`

## Context and Problem Statement
Команда `n-cursor release` створювала легкі теги (`git tag <name>`), а вже наявний `git push --follow-tags` надсилає на `origin` лише **анотовані** теги. Через це жоден реліз-тег не потрапляв на remote: `git ls-remote --tags origin` повертало порожній вихід навіть після успішного релізу.

## Considered Options
* Замінити легкі теги на анотовані (`git tag -a <name> -m <msg>`)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Замінити легкі теги на анотовані (`git tag -a <name> -m <msg>`)", because лише анотовані теги переносяться через `git push --follow-tags`; зміна мінімальна і не ламає вже наявний push-потік із retry.

### Consequences
* Good, because `git push --follow-tags` тепер доправляє теги на `origin` без додаткового явного push-кроку — перевірено умовою задачі (`git ls-remote --tags origin` повинен повертати тег після релізу).
* Good, because повідомлення тегу (`-m <name>@<version>`) задовольняє вимогу non-interactive CI: git не відкриває редактор.
* Good, because пересув тегу після rebase (`git tag -f -a <name> -m <msg>`) також стає анотованим, тобто перезаписаний тег на новому хеші знову підхоплюється `--follow-tags`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли:
- `npm/rules/release/release.mjs:152` — `runGit(['tag', tag])` → `runGit(['tag', '-a', tag, '-m', tag])`
- `npm/rules/release/release.mjs:98` — `runGit(['tag', '-f', tag])` → `runGit(['tag', '-f', '-a', tag, '-m', tag])`
- `npm/rules/release/js/tests/release.test.mjs` — assertions оновлено: `'tag -a p@1.3.0 -m p@1.3.0'`, `'tag -f -a p@1.0.1 -m p@1.0.1'`, multi-package варіант аналогічно.

Change-файл: `npm/.changes/260618-1624.md` (bump `patch`, section `Fixed`, ws `npm`).

Верифікація: `cd npm && npx vitest run rules/release/js/tests/release.test.mjs` → 14/14 passed; `npx @nitra/cursor fix changelog` → exit 0. Lint-помилки у тестовому файлі підтверджені як pre-existing (існували до правки).
