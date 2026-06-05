---
session: 84c46362-c0e7-4c4f-bfb2-3d8308559512
captured: 2026-06-05T10:27:05+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/84c46362-c0e7-4c4f-bfb2-3d8308559512.jsonl
---

Ось вміст файлу:

```markdown
---
bump: minor
section: Changed
---
n-llm-patch: промпти вимагають change-file flow (npx @nitra/cursor change + fix changelog) замість ручного CHANGELOG.md / version bump
```

---

Тепер ADR за цією сесією:

---

## ADR n-llm-patch: change-file flow замість ручного version bump

## Context and Problem Statement
Скіл `n-llm-patch` генерував промпти, які дозволяли агенту вручну редагувати `CHANGELOG.md` або безпосередньо бампати `version` у `package.json`. Такий підхід призводить до "брудного" npm/-дерева, яке фейлить integration-repo-checks, і до пропущених релізів — бо крок `npx changelogen --bump --push` у `npm-publish.yml` не виконується коректно.

## Considered Options
* Залишити ручний `CHANGELOG.md` / version bump у промптах `n-llm-patch`
* Вимагати change-file flow: `npx @nitra/cursor change` + `npx @nitra/cursor fix changelog`

## Decision Outcome
Chosen option: "change-file flow через `npx @nitra/cursor change` + `fix changelog`", because ручний bump призводить до брудного npm/-дерева та несумісний із канонічним кроком `Release (bump + CHANGELOG + tag)` у `.github/workflows/npm-publish.yml`.

### Consequences
* Good, because версія та CHANGELOG оновлюються через офіційний `changelogen`-пайплайн, що гарантує коректний реліз-тег і чисте дерево.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Change-файл: `npm/.changes/260605-1023.md` (bump: minor, section: Changed)
- Канонічний крок у `.github/workflows/npm-publish.yml`: `run: npx changelogen --bump --push`
- Шаблон: `npm/rules/npm-module/policy/npm_publish_yml/template/npm-publish.yml.snippet.yml`, рядки 39–40
- Локальна перевірка `node npm/bin/n-cursor.js fix npm-module` лише підтверджує наявність файлу; глибоку структурну валідацію делегує в `npx @nitra/cursor fix`
