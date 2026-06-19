---
session: 92b92f8f-d999-4638-807d-e743dbb88c8b
captured: 2026-06-19T13:53:59+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/92b92f8f-d999-4638-807d-e743dbb88c8b.jsonl
---

---

## ADR Статистика викликів LLM у stdout `lint --full`

## Context and Problem Statement
Наприкінці прогону `npx @nitra/cursor lint --full` корисник не мав жодного агрегованого summary по LLM-витратах: скільки разів викликалась локальна модель, cloud-min і cloud-avg у процесі fix-конформності. Без цих даних важко оцінити вартість прогону або помітити, що певне правило постійно ескалює в хмару.

## Considered Options
* Вивести статистику у stdout наприкінці фази конформності (реалізовано через `summarizeCalls` + `reportRunStats` у `analyze-escalation.mjs`).
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Вивести статистику у stdout наприкінці фази конформності", because корисник прямо попросив «загальну статистику по кількості викликів локальної моделі і кількості викликів хмарних в розрізі min та avg» в резюме `--full`.

### Consequences
* Good, because transcript фіксує очікувану користь: рядок `📊 LLM-виклики fix-конформності (цей прогін): локальна 2 · cloud-min 1 · cloud-avg 1` успішно виводиться — підтверджено smoke-тестом на реальному escalation-лозі.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Нові функції: `summarizeCalls(records)` і `reportRunStats(records, log)` у `npm/scripts/lib/fix/analyze-escalation.mjs`.
- `reportRunStats` викликається з `runFullConformancePhase` (`npm/rules/lint/js/orchestrate.mjs`) після конформності, перед аналітичним хуком.
- Тест: `describe('summarizeCalls', ...)` у `npm/scripts/lib/fix/tests/analyze-escalation.test.mjs` — 63 тести, усі проходять.
- Коміт: `d911daf4`, запушено в `main` як `71ddcebd`.

---

## ADR Fail-fast у lint лише для `--read-only`

## Context and Problem Statement
У fix-режимі `lint --full` перший per-file правило з ненульовим кодом (наприклад, `js-lint` із 33 передіснуючими помилками) спиняло весь прогін — конформність-фаза, драбина ескалації й аналітичний хук ніколи не досягалися. Це унеможливлювало авто-виправлення й збір escalation-статистики.

## Considered Options
* Fail-fast лише в `--read-only`; у fix-режимі — продовжувати до кроку виправлення.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Fail-fast лише в `--read-only`", because корисник прямо вказав: «fail-fast це потрібно тільки з прапором read-only, без цього прапору не повинна бути зупинка, а повинен починатись крок виправлення».

### Consequences
* Good, because transcript фіксує очікувану користь: прогін `lint --full` пройшов js-lint і cspell (1304 issues) й дійшов до конформності — підтверджено у `/tmp/lf3.txt`.
* Bad, because у fix-режимі накопичуються помилки всіх per-file правил, а не лише першого — виправлення одного правила може конфліктувати зі змінами іншого; проте transcript цього ризику не фіксує як явний недолік.

## More Information
- Зміна в `runLint` / `runPerFileRules` у `npm/rules/lint/js/orchestrate.mjs`: `if (readOnly && code !== 0) return { stop: true, code }`.
- Коміт: `fac8f5b2` на `main`.
- ADR-файл: `docs/adr/260619-fail-fast-lint-лише-read-only.md`.

---

## ADR T0-патерн `changelog-create-change-file`

## Context and Problem Statement
Порушення `changelog` («є релевантні зміни, але немає change-файлу») щоразу проходило через всю драбину LLM-ескалації (local-min → cloud-avg), хоча виправлення детерміноване: викликати `writeChange` з відомими параметрами. Це марнувало LLM-токени й час.

## Considered Options
* Додати T0-патерн у `t0.mjs`, що ловить текст violation regex-ом і детерміновано створює change-файл через `writeChange`.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати T0-патерн `changelog-create-change-file`", because аналітичний звіт (`fix-escalation-analysis.md`) запропонував рекомендацію **(A)**: детермінований T0-патерн для цього кейсу — і реалізація підтверджена тестами.

### Consequences
* Good, because порушення `changelog` тепер закривається до LLM, без ескалації в хмару.
* Bad, because `writeChange` async, тож `applyT0Auto` / `applyT0ToFailed` і весь T0-pipeline стали async — це breaking change для всіх викликачів `applyT0Auto`.

## More Information
- `MISSING_CHANGE_RE` і `MISSING_CHANGE_MATCH_ALL_RE` у `npm/scripts/lib/fix/t0.mjs`.
- `writeChange` з `npm/rules/release/change.mjs` — bump=patch, section=Changed, message = subject останнього коміту.
- `applyT0Auto` / `applyT0ToFailed` / `runT0AutoCli` стали `async`.
- Тести: `describe('applyT0Auto: changelog-create-change-file', ...)` у `npm/scripts/lib/fix/tests/t0.test.mjs`.
- Коміт: `fac8f5b2`.

---

## ADR `mkdirSync` у `applyChanges` перед записом файлу

## Context and Problem Statement
`applyChanges` у `llm-fix-apply.mjs` записував файли через `writeFileSync` без попереднього створення батьківської теки. LLM-моделі інколи пропонували шляхи у неіснуючих каталогах (наприклад, `npm/.changes/…`), що завершувалося `ENOENT` і провалом cloud-рунгів.

## Considered Options
* Додати `mkdirSync(dirname(absPath), { recursive: true })` перед `writeFileSync`.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати `mkdirSync` перед `writeFileSync`", because аналітичний звіт (`fix-escalation-analysis.md`) виявив реальний баг: *«applyChanges пише файл без mkdirSync батьківської теки → ENOENT на cloud-рунгах»* — рекомендація **(C)** зі звіту, підтверджена diagnosis-полями escalation-логу.

### Consequences
* Good, because transcript фіксує очікувану користь: LLM-фікс тепер може безпечно пропонувати нові файли у нових каталогах без `ENOENT`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `import { mkdirSync } from 'node:fs'` додано до `npm/scripts/lib/fix/llm-fix-apply.mjs`.
- `mkdirSync(dirname(absPath), { recursive: true })` перед `writeFileSync` у `applyChanges`.
- Коміт: `fac8f5b2`.
