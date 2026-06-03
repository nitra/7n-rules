---
session: af57cc42-83b5-48b4-aa90-2e6dcfada6b4
captured: 2026-06-03T10:47:56+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/af57cc42-83b5-48b4-aa90-2e6dcfada6b4.jsonl
---

## ADR Зробити сніпет єдиним джерелом істини для check/fix npm-publish workflow

## Context and Problem Statement
`check npm_publish_yml` свідомо є `subset-of`-перевіркою: enforce-ить лише чотири поля (`on.push.paths`, `on.push.branches`, `id-token: write`, крок `npm-publish`). Коміт `c5acbe5` ("release-publish") підняв канонічний сніпет до форми `release-publish` з повним набором кроків (`contents: write`, `persist-credentials: true`, `fetch-depth: 0`, `setup-bun-deps`, `Configure git identity`, крок `Release`), але rego-gate залишився на старій підмножині. Як наслідок, legacy-workflow (`jobs.publish`), що задовольняє всі чотири поля, проходить `fix npm-module` з `exit 0`, хоча розходиться з template-сніпетом. Будь-яка зміна сніпета без супутнього оновлення rego повторює цей gap.

## Considered Options
* Gated строгий deny у rego/JS-концерні з умовним gate-ом на release-flow (варіант 1 з аналізу асистента)
* Детермінований JS-мігратор `publish`→`release-publish` за зразком `nginx-default-tpl` (варіант 2 з аналізу асистента)
* **Generic deep-subset перевірка проти повного сніпета** — без окремих мігратора чи rego-правил

## Decision Outcome
Chosen option: "Generic deep-subset перевірка проти повного сніпета", because користувач прямо сказав: «fix завжди порівнювати з актуальним сніпетом — міграції не потрібні при змінах сніпетів». Сніпет (`template/npm-publish.yml.snippet.yml`) стає єдиним джерелом істини; зміна сніпета автоматично стає enforce-правилом без додаткових rego-рядків чи JS-мігратора.

### Consequences
* Good, because зміна сніпета автоматично підтягує строгість check/fix без жодних супутніх змін у rego чи JS.
* Bad, because transcript не містить підтверджених негативних наслідків. (Потенційно: простий consumer без release-flow отримає `❌` на поля, що не стосуються його; потребує окремого вирішення через applies-gate або два профілі сніпета — але це в transcript не обговорювалося.)

## More Information
* Канонічний сніпет: `npm/rules/npm-module/policy/npm_publish_yml/template/npm-publish.yml.snippet.yml`
* Поточний gate: `npm/rules/npm-module/policy/npm_publish_yml/npm_publish_yml.rego` (subset-of, ~4 поля)
* Target-файл single: `.github/workflows/npm-publish.yml` (`target.json`)
* Commit що підняв канон без оновлення gate: `c5acbe5` ("release-publish")
* Generic механізм для реалізації вже є: `checkSnippet`/`checkTextSubset` у `npm/scripts/lib/template.mjs`; прецедент — `npm/rules/security/js/trufflehog.mjs` (використовує `checkTextSubset`)
* Структурна властивість системи: всі whole-file концерни з `subset-of` семантикою (включно з `npm_package_json`, `root_package_json`, `docker/lint_docker_yml` та ін.) латентно вразливі до того самого gap при зміні сніпета
