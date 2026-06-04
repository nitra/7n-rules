---
session: 889efce9-844a-483c-84fa-b12a55f91b76
captured: 2026-06-04T19:37:02+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/889efce9-844a-483c-84fa-b12a55f91b76.jsonl
---

## ADR `npm-publish.yml` обов'язково містить крок Release перед Publish

## Context and Problem Statement
Правило `n-npm-module.mdc` задає канонічний сніпет для `.github/workflows/npm-publish.yml`. Під час сесії виявлено, що незакомічена версія файлу порушує цей канон — зокрема відсутній крок `Release (bump + CHANGELOG + tag)`. Необхідно зафіксувати, чому цей крок є обов'язковим і яку роль він відіграє у моделі версіонування.

## Considered Options
* Включати `Release`-крок (`node npm/bin/n-cursor.js release`) до `npm-publish.yml` як обов'язковий перед `Publish package`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Включати `Release`-крок як обов'язковий", because без нього CI публікує пакет без bump версії, генерації `CHANGELOG.md` і git-тегу, що ламає всю модель з правила `n-changelog`.

### Consequences
* Good, because transcript фіксує очікувану користь: гарантована синхронізація `npm/package.json`, `npm/CHANGELOG.md` і git-тегу з кожним npm-publish.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Канон визначено в `.cursor/rules/n-npm-module.mdc`, рядки 70–118.
- Перевірка `npm_module.npm_publish_yml` є **deep-subset**: усі кроки канонічного сніпета обов'язкові, зайві — дозволені, порядок неважливий.
- Порушений крок: `run: node npm/bin/n-cursor.js release`.
- Закомічений HEAD уже відповідає канону (`git show HEAD:.github/workflows/npm-publish.yml` — Release-крок присутній на рядках 39–40).

---

## ADR `/n-fix` перевіряє лише закомічений стан через worktree

## Context and Problem Statement
Після успішного проходження `/n-fix` (19/19 ✅) користувач помітив, що файл `.github/workflows/npm-publish.yml` все одно не відповідає канону. Виявилось, що правило порушується лише незакоміченими локальними змінами, які `/n-fix` не бачить — тому що інструмент запускається у worktree, створеному від закоміченого `HEAD`.

## Considered Options
* Запускати `/n-fix` у worktree від закоміченого `HEAD` (поточна поведінка)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Запускати `/n-fix` у worktree від закоміченого `HEAD`", because worktree-модель ізолює перевірку від "брудного" робочого дерева й гарантує відтворюваний стан.

### Consequences
* Good, because transcript фіксує очікувану користь: `/n-fix` стабільно перевіряє канонічний стан репозиторію без впливу незбережених локальних правок.
* Bad, because незакомічені локальні зміни, що порушують правила, залишаються невидимими для `/n-fix` до моменту коміту — і можуть потрапити в репозиторій без попередження.

## More Information
- Worktree для fix: `.worktrees/main-fix`, створений від поточної гілки `main`.
- Підтверджено командою: `git show HEAD:.github/workflows/npm-publish.yml` — Release-крок присутній у закоміченій версії.
- Незакомічені зміни зафіксовано через `git diff .github/workflows/npm-publish.yml`.
- Worktree-семантика `/n-fix` описана в `.cursor/skills/n-fix/SKILL.md` та `.cursor/rules/n-worktree.mdc`.
