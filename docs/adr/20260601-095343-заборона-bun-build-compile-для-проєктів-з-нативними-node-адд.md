---
session: 1f6e8efd-8fd4-4c82-a60d-e2a2eae3552a
captured: 2026-06-01T09:53:43+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/1f6e8efd-8fd4-4c82-a60d-e2a2eae3552a.jsonl
---

## ADR Заборона `bun build --compile` для проєктів з нативними `.node`-аддонами

## Context and Problem Statement
`bun build --compile` не трейсить динамічний `require(\`@img/sharp-${platform}/sharp.node\`)` і не вшиває нативний біндинг у standalone-бінарник. Компільований бінарник падає у рантаймі (`Could not load the "sharp" module using the linuxmusl-arm64 runtime`), і це відтворюється не лише на musl, а й на darwin-arm64 (bun 1.3.14, sharp 0.34.5). `apk add vips` не рятує, бо бракує саме `sharp.node`, а не системного libvips.

## Considered Options
* Заборонити `bun build --compile` для проєктів з нативними аддонами; канон — `node_modules` + `bun <entry>` на `oven/bun:alpine`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Заборонити `bun build --compile` для проєктів з нативними аддонами; канон — `node_modules` + `bun <entry>` на `oven/bun:alpine`", because доведено реальними docker-збірками: efes-стиль (`node_modules` + `bun`) у тій самій збірці працює (avif згенеровано), тоді як `--compile` дає runtime-краш незалежно від платформи.

### Consequences
* Good, because transcript фіксує очікувану користь: `npx @nitra/cursor fix docker` на антипатерні (`sharp` + `--compile`) репортує `❌ Dockerfile (native-addon)`, а на каноні — пасує чисто.
* Good, because існуюче правило «компіляція» для проєктів **без** нативних аддонів не зламано — standalone-бінарник на alpine лишається каноном для них.
* Bad, because `oven/bun:alpine` як фінальний runtime-образ є явним винятком до загального правила мінімальних образів (`alpine`/`scratch`); виняток задокументовано в `docker.mdc` і в `isAllowedFinalRuntimeImage`.

## More Information
- Нові файли: `npm/rules/docker/lib/docker-native-addon.mjs`, `npm/rules/docker/lib/tests/docker-native-addon.test.mjs`, `npm/rules/docker/js/tests/lint/tests/check-native-addon.test.mjs`
- Змінені файли: `npm/rules/docker/js/lint.mjs` (import + `readNearestPackageJson` + `getNativeAddonCompileHint` + `isAllowedFinalRuntimeImage` + оновлено `checkDockerfile`), `npm/rules/docker/docker.mdc` (секція «компіляція», bump `version: '1.10'` → `'1.11'`)
- Change-file: `npm/.changes/1780296726453-d6014e.md` (bump `minor`, section `Added`)
- Тригер: `package.json#dependencies` містить `sharp`, `@img/*` або `argon2` **і** Dockerfile містить `bun build --compile`
- Список нативних аддонів винесено у розширювану константу `NATIVE_ADDON_PACKAGES` у `docker-native-addon.mjs`
- `readNearestPackageJson` шукає `package.json` від каталогу Dockerfile вгору до кореня репо (через `git rev-parse --show-toplevel`)
- Перевірено: 117 тестів пройдено; CLI smoke — антипатерн репортує помилку, канон — чисто; регрес (проєкт без нативних аддонів + `--compile`) — правило мовчить
