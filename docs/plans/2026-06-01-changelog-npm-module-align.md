---
kind: nitra-plan
spec: ../specs/2026-06-01-changelog-npm-module-align.md
flow: ../../.worktrees/changelog-npm-module-align.flow.json
status: draft
---

# План: узгодження n-changelog.mdc ↔ n-npm-module.mdc

Дата: 2026-06-01
Spec: [2026-06-01-changelog-npm-module-align](../specs/2026-06-01-changelog-npm-module-align.md)

## Кроки

1. Видалити суперечливі перевірки з `npm/rules/npm-module/js/package_structure.mjs`
   (`checkDirtyNpmRequiresVersionBump`, `checkChangelogTopMatchesPackageVersion`) разом із
   їхніми викликами та осиротілими хелперами/regex/імпортами —
   acceptance: у файлі немає згаданих функцій і мертвого коду; `package_structure` не торкається теми version/CHANGELOG.
2. Оновити тести `npm/rules/npm-module/js/tests/package_structure.test.mjs` — прибрати кейси
   видалених функцій —
   acceptance: `bun test` у `npm/` зелений; жоден тест не посилається на видалені функції.
3. Переписати `npm/rules/npm-module/npm-module.mdc` секції «Build версія» і «CHANGELOG»: єдиний
   артефакт змін — change-файл; жодних «підвищ version»/«додай секцію»; інваріант top==version
   делеговано в `n-changelog.mdc` —
   acceptance: `grep -nE 'підвищ.*version|version.*\+1|додай секцію' npm/rules/npm-module/npm-module.mdc` порожньо.
4. Доповнити `npm/rules/changelog/changelog.mdc` post-release-твердженням «top секція == version
   після релізу (гарантує CI)» і межею «інструкції bump живуть лише тут» —
   acceptance: твердження присутнє; mirror-чекери `.cursor/rules/` лишаються валідними.
5. Покласти change-файл під `npm/.changes/` (зміни в `npm/` вимагають його) і прогнати
   `npx @nitra/cursor fix changelog npm-module` —
   acceptance: обидва ✅; `grep` ручного-bump по всіх `npm/rules/**/*.mdc` порожньо крім `changelog.mdc`.
