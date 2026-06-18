---
type: ADR
title: "Розчистка cspell-словника та ініціалізація CHANGELOG у workspace"
---

# Розчистка cspell-словника та ініціалізація CHANGELOG у workspace

**Status:** Accepted
**Date:** 2026-05-09

## Контекст

Після додавання нових модулів і документації `bun run lint-text` накопичив близько 680 cspell-попереджень у 91 файлі: суміш реальних друкарських помилок, легітимних технічних термінів (OPA `rego`, `conftest`, `Styra`, `taze` тощо) і україномовних неологізмів, яких не було у словнику. Мініфіковані Vite-артефакти (`demo/dist/`) не були виключені з перевірки. Одночасно правило `n-changelog` вимагало наявності `CHANGELOG.md` у кожному workspace з `package.json#workspaces`, але після додавання `demo` до `workspaces` обидва файли були відсутні і `npx @nitra/cursor check changelog` падав із помилкою.

## Рішення/Процедура/Факт

1. Виправлено 5 реальних друкарських помилок у сирцях: `тuplіе` → `tuple` і `патчa` → `патча` у `npm/scripts/check-k8s.mjs`, `незакоммічених` → `незакомічених` у `npm/skills/taze/SKILL.md`, `intergation` → `integration` у `npm/CHANGELOG.md`, `деps` → `deps` у `npm/tests/check-image-avif.test.mjs`.
2. Додано `dist/` до `.gitignore`; у `.cspell.json#ignorePaths` додано `**/dist/**` — прибрало 19 хибних спрацювань із мініфікованого Vue-runtime.
3. У `.cspell.json#words` додано 139 легітимних термінів: технічні (`rego`, `conftest`, `Styra`, `taze`, `tsandall`, `KVCMS` тощо) та україномовні неологізми (`нейминг`, `таргет`, `шим`, `воркспейс`, `бекап`, `симлінки` тощо).
4. У `.markdownlint-cli2.jsonc` додано `"ignores": ["**/adr/**"]` — ADR-чернетки мають вільний формат і не повинні перевірятися markdownlint.
5. Для відповідності правилу `n-changelog`: версію кореневого пакету підвищено `1.0.0` → `1.0.1`; створено `CHANGELOG.md` із записом `[1.0.1] - 2026-05-09` та `demo/CHANGELOG.md` із початковим записом `[0.0.0] - 2026-05-09`.
6. Фінальний стан: `bun run lint-text` → exit 0 (cspell: 0 issues / 218 файлів; markdownlint: 0 помилок / 70 файлів); `npx @nitra/cursor check` → 14/14.

## Обґрунтування

Слова з кириличними символами серед латинських (`тuplіе`, `деps`) вводять в оману при читанні коду — виправлення безпосередньо у сирцях обов'язкові. Решта 139 слів — легітимні терміни домену (OPA, Kubernetes, проєктний жаргон); виправляти їх у сирцях немає сенсу, словник — правильне місце. ADR-чернетки ігноруються markdownlint, оскільки мають вільний формат (cspell ігнорував їх раніше через `**/adr/**` в `ignorePaths`). Правило `n-changelog` є `alwaysApply: true` і охоплює всі workspace без винятків, зокрема `demo` (`private: true`).

## Розглянуті альтернативи

Виправити всі 139 слів безпосередньо у файлах — відхилено: це були б штучні зміни у CHANGELOG-записах і коментарях, де `rego`, `conftest` є власними назвами. Виключити `demo` із перевірки `n-changelog` — не розглядалося, правило явно охоплює всі workspace.

## Зачіпає

`.cspell.json`, `.gitignore`, `.markdownlint-cli2.jsonc`, `npm/scripts/check-k8s.mjs`, `npm/skills/taze/SKILL.md`, `npm/CHANGELOG.md`, `npm/tests/check-image-avif.test.mjs`, `package.json` (version bump), `CHANGELOG.md` (новий), `demo/CHANGELOG.md` (новий)
