---
type: JS Module
title: provider.mjs
resource: plugins/lang-python/taze/provider.mjs
docgen:
  crc: 747b1c8b
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 90
  issues: internal-name:collectUvDiff,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Python/uv-провайдер (EcosystemProvider, контракт `@7n/rules/plugin-api`) для taze-оркестратора ядра; реєструється маніфестом `n-rules.contributes.handlers.taze` у package.json плагіна. Він потрібен, щоб знайти Python-маніфест, зробити резервні копії маніфестів перед змінами, прибрати службові копії після завершення та зібрати текстову основу для оновлення Python-залежностей. Для перевірки актуальності пакетів використовується сторінка пакета в `https://pypi.org/project/`, а для орієнтації в установці uv — `https://docs.astral.sh/uv/getting-started/installation/`.

## Поведінка

- `buildUvDependencyPrompt` — формує текст завдання для перевірки major-оновлення одного Python-пакета: просить звірити breaking changes на сторінці пакета в PyPI (`https://pypi.org/project/`) між двома версіями, знайти зачеплене використання в коді й за потреби підготувати сумісний рефакторинг.
- `findPyprojectManifest` — знаходить кореневий `pyproject.toml` у репозиторії; якщо файл є, повертає його як маніфест для подальшої обробки, якщо ні — нічого не повертає.
- `backupUvManifest` — створює резервні копії `pyproject.toml` і `uv.lock`, щоб можна було безпечно порівнювати стан до й після оновлення залежностей.
- `cleanupUvBackups` — прибирає резервні копії `pyproject.toml` і `uv.lock` після завершення роботи.
- `bumpUvDependencies` — по черзі піднімає прямі залежності `pyproject.toml` через `uv`, зберігаючи прогрес навіть якщо для окремого пакета оновлення не вдалося; у разі збою відновлює початковий запис.
- `pythonProvider` — описує Python/uv-провайдер для оркестратора taze: визначає, чи є проєкт Python-маніфестом, чи доступний `uv`, як робити backup/bump/diff/cleanup.

## Публічний API

- buildUvDependencyPrompt — готує промпт для одного ітеративного проходу по одному Python-major пакету в uv-гілці; ядро саме робить детерміновані кроки 1–3 і 7–8, а LLM бере лише середину процесу.
- findPyprojectManifest — знаходить єдиний кореневий `pyproject.toml` для single-project uv-конвенції; не шукає workspace-структури, бо орієнтується на поточний формат проєктів.
- backupUvManifest — зберігає копії `pyproject.toml` і `uv.lock` перед змінами, щоб потім можна було розрізнити major і minor через `collectUvDiff` після bump.
- cleanupUvBackups — видаляє тимчасові бекапи `pyproject.toml` і `uv.lock` після завершення оновлення.
- bumpUvDependencies — послідовно піднімає прямі залежності в `pyproject.toml` через `uv remove` і `uv add <pkg>[extras] --bounds lower`; зберігає прогрес інших пакетів, якщо один bump не проходить, і намагається відновити початковий запис при збоях мережі чи резолюції.
- pythonProvider — підключає Python/uv як `taze`-провайдер через `@7n/rules/plugin-api` і реєструється в `package.json` плагіна через `n-rules.contributes.handlers.taze`.

Згадані орієнтири: https://pypi.org/project/, https://docs.astral.sh/uv/getting-started/installation/, `package.json`.

## Гарантії поведінки

- Виконує файлові операції (бекапи `pyproject.toml`/`uv.lock`) і запускає зовнішню команду `uv` — НЕ read-only.
- Провал bump одного пакета не зупиняє інших; після невдалого `uv add` виконується best-effort відновлення оригінального запису.
