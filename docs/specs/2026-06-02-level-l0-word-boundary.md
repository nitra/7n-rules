---
kind: nitra-spec
status: draft
adr: null
plan: ../plans/2026-06-02-level-l0-word-boundary.md
risk: low
---

# detectLevel: word-boundary для ASCII L0-дієслів

Дата: 2026-06-02
Беклог: #2 (вузька гігієна; complexity-guard уже на main, лишаємо як є)

## Проблема

`L0_KEYS` матчаться підрядком → `fix` ловиться в `prefix`/`fixture`/`suffix`:
`detectLevel('add prefix validation') === 0` (хибний L0).

## Рішення

ASCII L0-дієслова (fix/typo/bump/rename/hotfix) — матч цілим словом (межі ≠ [a-z0-9]),
без regex; кириличні (опечат/перейменув) — підрядком (стемінг). Решта (L3/L2/guard) без змін.

## Зміни

`level.mjs`: L0_WORD_KEYS (ASCII) + L0_SUBSTR_KEYS (кирилиця); `hasWord` (indexOf + isAlnum-межі);
detectLevel L0 = word-match ASCII || substr Cyrillic.

## Тести

prefix/fixture/suffix → 1 (не 0); fix typo/bump/hotfix/перейменування → 0; guard-кейси (fix mdc→1) без регресу.

## Ризики

Low. Звуження матчу; кирилиця й guard незмінні.
