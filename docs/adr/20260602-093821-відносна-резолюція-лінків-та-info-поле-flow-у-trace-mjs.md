---
session: b9921680-39ee-4901-abe4-7fad90901fad
captured: 2026-06-02T09:38:21+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor--worktrees-flow-trace-relative-links/b9921680-39ee-4901-abe4-7fad90901fad.jsonl
---

## ADR Відносна резолюція лінків та info-поле `flow` у `trace.mjs`

## Context and Problem Statement
У `npm/scripts/dispatcher/trace.mjs` усі LINK_FIELDS (`adr`, `spec`, `plan`, `flow`, `change`, `task`) раніше резолвилися однаково: `exists(join(root, target))`. Це не враховувало ні конвенцію file-relative шляхів у front-matter (`../plans/a.md`), ні те, що `flow` вказує на runtime-артефакт `.worktrees/<branch>.flow.json`, який gitignored і відсутній у clean checkout/CI — що хибно рахувалося розривом ланцюга.

## Considered Options
* File-relative резолюція з fallback на root-relative для всіх лінків + маркування `flow` як не-breaking
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "File-relative резолюція з fallback на root-relative + `INFO_LINK_FIELDS` для `flow`", because transcript показує дві незалежні, але одночасно введені зміни: (1) функція `resolveLink` спершу пробує `join(root, dirname(artifactFile), target)`, потім `join(root, target)`; (2) `INFO_LINK_FIELDS = new Set(['flow'])` — поля з цього набору отримують `breaking: false` і не впливають на exit-code та символ рендера (`~` замість `✗`).

### Consequences
* Good, because `../plans/a.md` у `docs/specs/x.md` тепер резолвиться коректно без зміни конвенції написання лінків у front-matter.
* Good, because відсутній `flow`-файл у CI більше не дає exit 1 і не забруднює звіт хибними розривами.
* Bad, because `resolveLink` приймає обидва варіанти (file-relative і root-relative) як рівноцінно валідні без діагностики — семантично некоректний шлях може «пройти» через fallback без попередження (зафіксовано в review diff).

## More Information
- Змінені файли: `npm/scripts/dispatcher/trace.mjs`, `npm/scripts/dispatcher/tests/trace.test.mjs`
- Нова функція: `resolveLink(root, artifactFile, target, exists)` — `node:path` `dirname` + `join`
- Нова константа: `const INFO_LINK_FIELDS = new Set(['flow'])`
- `analyze` перейменовує параметр `exists` → `resolve`; сигнатура тепер `(target, artifactFile) => boolean`
- `runTraceCli` передає `(target, file) => resolveLink(root, file, target, exists)` замість `target => exists(join(root, target))`
- Exit-code умова змінилася: `l.breaking && !l.ok` замість `!l.ok`
- Рендер: `renderLink(l)` повертає `→` / `✗ … (РОЗРИВ)` / `~ … (runtime-стан, не перевіряється)` залежно від `ok` і `breaking`
