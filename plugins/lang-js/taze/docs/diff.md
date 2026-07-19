---
type: JS Module
title: diff.mjs
resource: plugins/lang-js/taze/diff.mjs
docgen:
  crc: e9789318
---

## Огляд

Детермінований semver-diff npm/bun-гілки taze: порівнює package.json кожного воркспейсу з `.taze-bak`-бекапом і класифікує зміни залежностей на major vs minor/patch за caret-правилом (`isBreaking`/`parseVersion` з `@7n/rules/plugin-api`).

## Поведінка

- **diffPackageJson** — порівнює два розпарсені package.json по dependencies/devDependencies/peerDependencies/optionalDependencies; не-semver специфікатори (workspace:*, git-url) ігноруються.
- **collectTazeDiff** — агрегує diff по root + воркспейсах монорепо (`getMonorepoPackageRootDirs` ядра); воркспейс без бекапу пропускається.
- **runTazeCli** — CLI-обгортка (`n-rules taze diff`): друкує компактний JSON `{ major, minorPatch, totalChanged }`.

## Гарантії поведінки

- Read-only: лише читає файли, нічого не пише.
- Відсутній або невалідний бекап/маніфест — пропуск без винятку.
