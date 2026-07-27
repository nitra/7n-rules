---
type: JS Module
title: extractors.mjs
resource: plugins/lang-python/doc-files/extractors.mjs
docgen:
  crc: 8c2d8b4d
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Витягує Python module/class/function docstring-и для дослівної doc-files-документації.
Завдяки цьому повністю прокоментований Python-файл не потребує LLM-генерації.

## Поведінка

extractFactsPython повертає факт-лист лише для переданого вмісту файлу та відносного шляху; у результаті окремо зберігаються header, exports, imports, markers і порожні списки для внутрішніх та локальних символів.

Для імпортів свідомо не розрізняються stdlib, external та internal: stdlib залишається порожнім, а всі знайдені import-згадки потрапляють до external.

Markers відображають лише наявні в коді сигнали поведінки: read-only, catchesErrors, returnsFalsyOnFail, network і caches; список skips у результаті завжди порожній.

## Публічний API

- extractFactsPython — Витягує факт-лист Python без AST-залежності: module/class/function docstring-и
стають авторитетними полями `header` та `exports` для zero-LLM doc-files.

## Сценарії використання

- `plugins/lang-python/doc-files/tests/extractors.test.mjs` (extractFactsPython) — module та public def docstring-и стають дослівними facts; підтримує багаторядкові module та class docstring-и; не вважає непокритий public API повною документацією; handler декларує Python extension

## Гарантії поведінки

- Кешує результати в межах одного прогону.
