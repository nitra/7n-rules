# Заборона `bun build --compile` для проєктів з нативними `.node`-аддонами

**Status:** Accepted
**Date:** 2026-06-01

## Context and Problem Statement

`bun build --compile` не трейсить динамічний `require()` для нативних біндингів і не вшиває їх у standalone-бінарник. Компільований бінарник падає у рантаймі (`Could not load the "sharp" module`) на musl і darwin-arm64 (bun 1.3.14, sharp 0.34.5). `apk add vips` не рятує — бракує `sharp.node`, а не системного libvips.

## Considered Options

* Заборонити `bun build --compile` для проєктів з нативними аддонами; канон — `node_modules` + `bun <entry>` на `oven/bun:alpine`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Заборонити `bun build --compile` для проєктів з нативними аддонами; канон — `node_modules` + `bun <entry>` на `oven/bun:alpine`", because реальні docker-збірки підтвердили: efes-стиль (`node_modules` + `bun`) працює (avif згенеровано), `--compile` дає runtime-краш незалежно від платформи.

### Consequences

* Good, because `fix docker` на антипатерні (`sharp` + `--compile`) репортує помилку; на каноні — чисто.
* Good, because правило standalone-бінарника для проєктів без нативних аддонів не зламано.
* Bad, because `oven/bun:alpine` як фінальний runtime — явний виняток до правила мінімальних образів; задокументовано в `docker.mdc` і `isAllowedFinalRuntimeImage`.

## More Information

- Нові файли: `npm/rules/docker/lib/docker-native-addon.mjs`, `lib/tests/docker-native-addon.test.mjs`, `js/tests/lint/tests/check-native-addon.test.mjs`
- `npm/rules/docker/js/lint.mjs` — `readNearestPackageJson` + `getNativeAddonCompileHint` + `isAllowedFinalRuntimeImage`
- `docker.mdc` секція «компіляція», v1.10 → v1.11
- Тригер: `package.json#dependencies` містить `sharp`, `@img/*` або `argon2` **і** Dockerfile містить `bun build --compile`
- `NATIVE_ADDON_PACKAGES` — розширювана константа в `docker-native-addon.mjs`
- `readNearestPackageJson` шукає `package.json` від каталогу Dockerfile вгору до кореня репо
- Перевірено: 117 тестів пройдено
- Change-файл: `npm/.changes/1780296726453-d6014e.md` (minor / Added)
