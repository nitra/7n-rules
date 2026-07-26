---
type: JS Module
title: provider.mjs
resource: plugins/lang-js/taze/provider.mjs
docgen:
  crc: 6135f3c4
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 90
  issues: internal-name:collectTazeDiff,judge-refine:kept-original,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл реалізує npm/bun-провайдер для taze: формує цільовий prompt для одного major-оновлення, запускає оновлення та керує резервними копіями `package.json` у workspace. Це дає оркестратору детермінований diff версій і безпечне прибирання тимчасового стану.

## Поведінка

backupWorkspacePackageFiles фіксує початковий стан workspace-маніфестів із `package.json` перед оновленням залежностей, щоб подальший крок міг відрізнити major-зміни від безпечніших bump-ів. Після оновлення через `bunx taze` і `bun install` buildDependencyPrompt формує текстове завдання для одного major-переходу: воно передає LLM лише контекст конкретного пакета, його версій і маніфесту, а не весь репозиторій.

Промпт відрізняє неоднозначну міграцію від підтвердженої peer-перешкоди. Для останньої він вимагає повернути сумісну версію залежності, синхронізувати lockfile і точково, без дублювання, записати нативний `packageMode`-виняток у кореневий `taze.config.ts` з посиланням на конкретну причину.

cleanupWorkspaceBackups завершує цикл після застосування або перевірки змін: прибирає тимчасові копії workspace-маніфестів і повертає репозиторій до штатного стану без службових артефактів.

## Публічний API

- buildDependencyPrompt — Промпт ОДНОГО ітеративного виклику для npm/bun-пакета (кроки 4-6 SKILL.md)
для ОДНОГО major-запису. Кроки 1-3/7/8 виконує оркестратор ядра
детерміновано, без LLM.
- backupWorkspacePackageFiles — Бекапить package.json кожного воркспейсу (крок 1 SKILL.md) — потрібно для
класифікації major/minor через `collectTazeDiff` після bump-у.
- cleanupWorkspaceBackups — Прибирає бекапи package.json усіх воркспейсів (крок 7 SKILL.md).

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Кешує результати в межах одного прогону.
