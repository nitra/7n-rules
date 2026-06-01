---
session: c893caa2-5ff0-49f2-878b-bcb1acbae65e
captured: 2026-06-01T22:09:21+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/c893caa2-5ff0-49f2-878b-bcb1acbae65e.jsonl
---

(note - the transcript ends here)

---

## ADR Видалення суперечливих перевірок version/CHANGELOG з npm-module

## Context and Problem Statement

`npm/rules/npm-module/npm-module.mdc` (v1.13) містив секції «Build версія» і «CHANGELOG», що наказували агенту вручну підвищувати `version` у `package.json` і додавати нову секцію зверху `CHANGELOG.md`. Це прямо суперечило правилу `changelog.mdc` (v3.1, alwaysApply), яке забороняє будь-яке ручне редагування `version` і `CHANGELOG.md`, лишаючи за єдиний артефакт зміни change-файл (`npx @nitra/cursor change …`). Як наслідок, `npx @nitra/cursor fix` видавав взаємовиключні підказки при drift `version` ≠ CHANGELOG-top.

## Considered Options

* Видалити суперечливі перевірки (`checkDirtyNpmRequiresVersionBump`, `checkChangelogTopMatchesPackageVersion`) з `package_structure.mjs`; делегувати всю відповідальність `changelog/js/consistency.mjs`.
* Залишити перевірки, лише переписати тексти повідомлень.
* Ввести механізм `backfill` у формат change-файлу для покриття edge case «version опублікована без CHANGELOG-секції».

## Decision Outcome

Chosen option: "Видалити обидві суперечливі перевірки; делегувати consistency.mjs", because перевірки були функціонально інвертованими (`checkDirtyNpmRequiresVersionBump` фейлила у правильному стані — зміни є, version не зрушено), а `consistency.mjs` вже коректно покривала обидва сценарії (drift і відсутність change-файлу) без дублювання.

### Consequences

* Good, because `package_structure.mjs` більше не порушує change-file-флоу і не штовхає агента до ручного bump.
* Good, because `npm-module.mdc` (v1.13→1.14) та `changelog.mdc` (v3.1→3.2) тепер узгоджені: єдиний артефакт змін — change-файл; post-release-інваріант «top секція CHANGELOG == version» описано як гарантію CI, а не локальну перевірку.
* Bad, because механізм `backfill` (edge case «version опублікована в реєстрі без CHANGELOG-секції») не реалізований — такий стан вимагає ручної процедури, описаної в `n-changelog.mdc`, а не автоматизованого change-файлу.

## More Information

Змінені файли: `npm/rules/npm-module/js/package_structure.mjs`, `npm/rules/npm-module/npm-module.mdc`, `npm/rules/changelog/changelog.mdc`, `npm/rules/npm-module/js/tests/package_structure.test.mjs`, `npm/tests/integration-repo-checks.test.mjs`.
Change-файл: `npm/.changes/1780340632393-1db2fa.md` (bump: patch, section: Fixed).
Гілка: `changelog-npm-module-align`, коміти `fe08579`, `38828ad`.
Специфікація: `docs/specs/2026-06-01-changelog-npm-module-align.md`.
Відхилено: введення мітки `backfill: <version>` у формат change-файлу — механізму `backfill` в `npm/rules/release/lib/change-file.mjs` не існує; meta-перевірку regex-по-`.mdc` відхилено як YAGNI.
