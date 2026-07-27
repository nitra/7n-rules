---
type: JS Module
title: provider.mjs
resource: plugins/lang-js/taze/provider.mjs
docgen:
  crc: a10f1940
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 90
  issues: internal-name:collectTazeDiff,judge-refine:kept-original,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Під час оновлення залежностей у межах одного прогону він збирає дані для окремого запиту на розбір розбіжностей, використовує кеш для повторних звернень і працює через мережу. Це дає змогу відділяти вже відомі результати від нових перевірок і підтримувати послідовність обробки воркспейсів без зайвих повторів.

## Поведінка

Під час оновлення залежностей `backupWorkspacePackageFiles` спершу знімає локальні копії `package.json` для воркспейсів, щоб зафіксувати стан до зміни версій і далі відрізнити major-зміни від minor у межах одного прогону. Після цього `buildDependencyPrompt` формує промпт лише для одного запису major-розбіжності, спираючись на збережений початковий стан, цільовий стан після bump і дані маніфесту з `package.json`; цей промпт передається далі як вхід для ітеративної частини процесу, де мережевий виклик залежить від доступності зовнішнього сервісу `https://bun.sh`. Завершення циклу забезпечує `cleanupWorkspaceBackups`, яке прибирає тимчасові копії `package.json` у всіх воркспейсах, щоб не залишати проміжний стан після проходу. Уся логіка працює як кеш у межах одного прогону: результати збереження й промптів використовуються лише для поточної сесії, без збереження між запусками.

## Публічний API

- buildDependencyPrompt — Промпт ОДНОГО ітеративного виклику для npm/bun-пакета (кроки 4-6 SKILL.md)
для ОДНОГО major-запису. Кроки 1-3/7/8 виконує оркестратор ядра
детерміновано, без LLM.
- backupWorkspacePackageFiles — Бекапить package.json кожного воркспейсу (крок 1 SKILL.md) — потрібно для
класифікації major/minor через `collectTazeDiff` після bump-у.
- cleanupWorkspaceBackups — Прибирає бекапи package.json усіх воркспейсів (крок 7 SKILL.md).

## Сценарії використання

- `plugins/lang-js/taze/tests/provider.test.mjs` (jsProvider (форма контракту); buildDependencyPrompt) — валідний EcosystemProvider за assertEcosystemProvider ядра; detect: кореневий package.json → один маніфест; без нього — тиша; available: bun відсутній → ok:false з причиною; bump: bunx taze -w -r latest + bun install; bump: провал команди → кидає з exit-кодом+stderr; ще 4

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Кешує результати в межах одного прогону.
