---
session: e800dd7d-78c5-4ff9-beb6-73dd449846ce
captured: 2026-06-05T10:24:05+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/e800dd7d-78c5-4ff9-beb6-73dd449846ce.jsonl
---

---

## ADR n-llm-patch: заміна ручного CHANGELOG.md / version bump на change-file flow

## Context and Problem Statement
Скіл `n-llm-patch` генерував промпти для зовнішніх агентів, де як приклад фігурувала застаріла інструкція: "додати запис у `CHANGELOG.md`; bump `version` (minor)". Це суперечить прийнятому release flow, де `CHANGELOG.md` і `version` керуються виключно CI через `.changes`-файли та команду `npx @nitra/cursor fix changelog`.

## Considered Options
* Замінити застарілий приклад на `npx @nitra/cursor change ...` + `npx @nitra/cursor fix changelog`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Замінити застарілий приклад на `npx @nitra/cursor change ...` + `npx @nitra/cursor fix changelog`", because завдання явно вимагало привести приклади та правила `n-llm-patch` у відповідність до `n-changelog.mdc` і заборонити будь-яке ручне редагування `CHANGELOG.md` чи `package.json#version` у генерованих промптах.

### Consequences
* Good, because transcript фіксує очікувану користь: згенеровані промпти більше не містять стару інструкцію, `npx @nitra/cursor fix changelog` проходить після доданого change-файлу, всі 30 тестів проходять.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Змінені файли: `npm/skills/llm-patch/SKILL.md`, `.cursor/skills/n-llm-patch/SKILL.md` (ідентична копія).
- Доданий change-файл: `npm/.changes/260605-1023.md` (`bump: minor`, `section: Changed`).
- Верифікація: `grep -rn "CHANGELOG.md.*bump\|bump.*version"` у `npm/skills/llm-patch/SKILL.md` і `.cursor/skills/n-llm-patch/SKILL.md` не повертає застарілих прикладів (лише рядки з явним формулюванням заборони та посиланням на `n-changelog.mdc`).
- Команди перевірки: `node npm/bin/n-cursor.js fix changelog` (exit 0), `npx vitest run npm/scripts/tests/auto-skills.test.mjs` (30/30 passed).
- Source синхронізовано через `cp npm/skills/llm-patch/SKILL.md .cursor/skills/n-llm-patch/SKILL.md` — генератор `npm/scripts/auto-skills.mjs` не займається вмістом `SKILL.md`, тому пряме копіювання є коректним підходом.
