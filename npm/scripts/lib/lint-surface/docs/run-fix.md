---
type: JS Module
title: run-fix.mjs
resource: npm/scripts/lib/lint-surface/run-fix.mjs
docgen:
  crc: 7aab9641
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 55
---

## Огляд

Central fix-pipeline unified lint surface (spec 2026-06-29 §Fix Role / §Tier Ladder).

Послідовно, per concern:
  detect → (clean: keep) → T0 (permanent, поза rollback) → snapshot S1 →
  detect → (clean: keep) → ladder[restore S1 → worker → detect]* → (exhausted: rollback S1)

Ролі чесні: detector тільки виявляє; T0 і worker тільки змінюють; success визначає
ВИКЛЮЧНО canonical re-detect. Worker не володіє rollback/tier/ladder — лише один attempt.

## Поведінка

resolveFixLadderModels повертає структуровані моделі fix-ladder для побудови шляху вирішення проблем.
loadT0Patterns повертає масив T0-патернів, ієрархія яких залежить від пріоритету джерел: native-fix → wasm-мапа → dynamic JS-модулі.
fixConcern повертає булеве значення, що інформує про повне усунення проблем в межах одного concern.
runFixPipeline повертає цілочисельний код виходу: 0 (чистий), 1 (залишились порушення), 2 (DetectorError).

## Публічний API

- resolveFixLadderModels — Будує моделі центральної fix-ladder через єдиний policy resolver.
Локальна rung існує лише коли старт від `N_LOCAL_MIN_MODEL` справді дав
локальну модель: cloud fallback не повинен маркуватися як local і обходити
`skipLocalTier`. Хмарні rung-и стартують зі своїх меж policy ladder.
- loadT0Patterns — Завантажує structured T0-патерни concern-а. Пріоритет джерел — дзеркало
`runConcernDetector` (`detect.mjs`: native → wasm → JS):

1. native-fix реєстр (`NATIVE_FIXES`, T1 зрізу 4 фази 7) — абсолютний
   пріоритет: синтетичний T0Pattern над native-планом ([`nativeFixPattern`]);
2. wasm-мапа концернів (`resolveWasmConcernMap`, fix-контур contract v3) —
   синтетичний T0Pattern над планом `export fix` плагіна
   ([`wasmFixPattern`]); на відміну від detect-shadowing (wasm ПОВНІСТЮ
   заміняє main.mjs), тут wasm-патерн ДОДАЄТЬСЯ ПЕРЕД можливим
   `fix-<concern>.mjs` — плагін із fix-заглушкою (порожній план — сумісна
   поведінка v3.0, доккомент `wit/world.wit` біля `export fix`) не має
   мовчки вимикати чинний JS T0-фікс концерну;
3. dynamic import() `fix-<concern>.mjs`, якщо файл є.
- fixConcern — Проводить ОДИН concern по pipeline: T0 → S1 → ladder. Повертає чи закрито.
- runFixPipeline — Повний fix-pipeline: detect усе → fix кожен провальний concern → exit code.

## Сценарії використання

- `npm/scripts/lib/lint-surface/tests/run-fix.test.mjs` (resolveFixLadderModels; runFixPipeline — базові вердикти) — підхоплює local-average для запиту local-min і не дублює cloud rung; не додає cloud fallback у local rung; clean → 0, worker не викликається; ctx.verify (Фаза A1): item-scoped canonical вердикт доступний worker-у, verifyMax заданий; worker закриває на першому rung → 0; ще 33

## Гарантії поведінки

- Кешує результати в межах одного прогону.
