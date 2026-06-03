---
session: af57cc42-83b5-48b4-aa90-2e6dcfada6b4
captured: 2026-06-03T11:28:03+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/af57cc42-83b5-48b4-aa90-2e6dcfada6b4.jsonl
---

Прогон успішний. Покажу стисло, що змінилось.

**Операції (applied 10):**
- **rewrite** `20260531-081526-дата-орієнтований-auto-…md` → `20260531-081526-auto-skills-meta-json-автоактивація.md`
- **merge-into** ×9: 9 чернеток злито до існуючих clean-файлів (`20260531-070618-n-cursor-worktree-cli.md`, `20260531-080938-rules-meta-json-auto-glob-type-a.md`, `20260530-201158-скіли-у-git-worktree.md`, `20260531-133534-lint-quick-ci-split-meta-json-data-driven.md`)

Знято мітку `session:` з 10 чернеток (9 видалено як `merge-into`-джерела, 1 перейменовано).

Нові файли в `docs/adr/`: `20260531-081526-auto-skills-meta-json-автоактивація.md` (rewrite) і `20260603-111954-nginx-errorlog-замінa-off-на-dev-null-crit.md` (новий capture цієї сесії).

**Прийняти зміни:**
```bash
cd /Users/vitalii/www/nitra/cursor
git add docs/adr/ && git commit -m "adr: normalize batch"
```

**Відкотити весь батч:**
```bash
git checkout -- docs/adr/ && git clean -f docs/adr/
```

---

Тепер я маю описати рішення з цієї сесії у форматі MADR. Аналізую transcript.

---

## ADR Видалення bespoke rego та перехід на generic snippet-driven check для npm_publish_yml

## Context and Problem Statement

Канонічний сніпет `npm-publish.yml.snippet.yml` описував повну форму `release-publish`-job, але `npm_publish_yml.rego` перевіряв лише 4 поля (`on.push.paths`, `on.push.branches`, `id-token: write`, наявність кроку `npm-publish`). Legacy-workflow задовольняв усі 4 умови → `fix npm-module` завершувався без помилок, хоча workflow не відповідав канону. Додатково, редагування сніпета не змінювало enforce-surface: бespoke rego необхідно оновлювати вручну.

## Considered Options

* Generic snippet-driven check: `target.json "check":"template"`, `checkSnippet`/structural-subset проти повного сніпета, видалення `npm_publish_yml.rego`
* Gated enforcement: strict check вмикається лише коли репо на release-flow (сигнал: `npm/.changes/`, `npm/bin/n-cursor.js`)
* Детермінований JS-мігратор: концерн сам переписує `jobs.publish` → `release-publish` за зразком `nginx-default-tpl`

## Decision Outcome

Chosen option: "Generic snippet-driven check (варіант A — канон для всіх)", because сніпет стає єдиним джерелом enforce: будь-яка зміна `npm-publish.yml.snippet.yml` автоматично стає вимогою без правок rego або міграторів; це пряма відповідь на вимогу «fix завжди порівнює з актуальним сніпетом».

### Consequences

* Good, because редагування сніпета одразу змінює enforce без правок rego.
* Good, because transcript фіксує очікувану користь: legacy-форма `jobs.publish` тепер дає `❌ concurrency має бути об'єктом` + `❌ jobs."release-publish" має бути об'єктом`, тоді як канонічний workflow проходить чисто (`✅ відповідає канону (template subset)`).
* Good, because механізм перевикористовний: інші концерни з `template/*.snippet.*` можна перевести на `"check":"template"` без нового rego.
* Bad, because усі consumer-репо без `release-publish`-job тепер отримають `❌` (навмисна зміна, але breaking для тих, хто не мігрував).

## More Information

Змінені файли:
- `npm/scripts/lib/template.mjs`: масивна гілка `checkSnippet` переписана з `JSON.stringify`-рівності на structural-subset presence (рекурсивний пошук кожного елемента сніпета в масиві джерела).
- `npm/scripts/lib/run-rule.mjs`: доданий `export async function runTemplateSubsetConcern(...)` — executor для концернів із `"check":"template"` у `target.json`.
- `npm/schemas/target.json`: додано поле `check` (enum `"template"`).
- `npm/rules/npm-module/policy/npm_publish_yml/target.json`: `"check":"template"` замість bespoke rego.
- `npm/rules/npm-module/policy/npm_publish_yml/npm_publish_yml.rego` + `*_test.rego`: видалені через `git rm`.
- `npm/rules/npm-module/npm-module.mdc` + `.cursor/rules/n-npm-module.mdc`: оновлено опис (прибрано фразу «subset-of», mirror регенеровано).
- Change-файл: `npm/.changes/1780474216612-d0dd34.md` (bump: minor).
- Тести: +4 кейси в `template.test.mjs`, +7 кейсів `runTemplateSubsetConcern` у `run-rule.test.mjs`.
