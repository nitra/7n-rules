---
type: Rust Module
title: cli.rs
resource: crates/rules-cli/tests/cli.rs
docgen:
  crc: 46d5a1e7
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 70
---

## Огляд

cspell:ignore одруківка runn  Інтеграційні тести бінаря `rules-cli` (зрізи 1–4 фази 8): native-команди (`lint --help`, `changed-files`, `skill list`, `rename-yaml-extensions`, native-гілки `hook`) і транзитна делегація в JS-entrypoint. Byte-exact parity з JS-боком гейтиться окремо vitest-тестом `npm/scripts/lib/tests/rules-cli-parity.test.mjs` — тут перевіряється поведінка самого бінаря без node/bun (делегація — через runtime-стаб).

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
