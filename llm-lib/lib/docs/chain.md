---
type: JS Module
title: chain.mjs
resource: llm-lib/lib/chain.mjs
docgen:
  crc: 3953cb0a
---

## Огляд

Ланцюжок (chain) групує кілька LLM-викликів у одну задачу з фінальним результатом: виклики й перевиклики local/cloud моделей отримують спільний `chainId`, а `chain.end()` пише підсумковий запис `kind:'chain'` у глобальний trace. Основа аналітики: escalation-rate local→cloud, cloud-вартість per задача, кандидати на T0-дистиляцію. Явний handle без прихованого контексту; один chain = послідовне використання (по одному на одиницю роботи).

## Поведінка

startChain — створює handle: id (hex16), nextStep (монотонний лічильник кроків; кличе раннер), note (акумуляція local/cloud лічильників, usage, usageCloud, errors, finalModel; local/cloud визначає isLocalModel), headers (X-Chain-Id/Step/Kind/Cwd для локального проксі myllm), traceFields (chainId/chainKind/chainUnit/chainStep у per-call trace-запис), end (ідемпотентний фінальний запис kind:'chain' з outcome/steps/localCalls/cloudCalls/escalated/wallMs/usage/usageCloud/meta/extra через writeTrace).
promptHash — sha256 hex16 lowercase від trim(text) останнього user-повідомлення. КОНТРАКТ кореляції з myllm (дзеркальна реалізація у chains.rs) — не міняти односторонньо.

## Публічний API

startChain({kind, unit, cwd?, meta?, deps?}) — chain handle; deps.trace/clock/isLocal — інжекти для тестів.
promptHash(text) — хеш за контрактом кореляції.

## Гарантії поведінки

- end ідемпотентний: рівно один фінальний запис на chain.
- Раннери без opts.chain працюють як раніше — chain-поля в trace зʼявляються лише з chain.
- escalated = localCalls>0 && cloudCalls>0.
