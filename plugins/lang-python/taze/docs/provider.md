---
type: JS Module
title: provider.mjs
resource: plugins/lang-python/taze/provider.mjs
docgen:
  crc: 69856f24
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 90
  issues: internal-name:collectUvDiff,judge-refine:kept-original,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Модуль керує оновленням Python-залежностей через uv у кореневому репозиторії: знаходить `pyproject.toml`, створює резервну копію маніфесту перед змінами, виконує `bumpUvDependencies` для підняття прямих залежностей і потім очищає створені резервні копії. Це дає змогу оновлювати залежності через один узгоджений сценарій без втрати початкового стану маніфесту.

## Поведінка

Модуль працює як провайдер для Python-оновлень через uv у тандемі з оркестратором taze: `findPyprojectManifest` визначає, чи є в корені репозиторію `pyproject.toml`, після чого `backupUvManifest` зберігає стан маніфесту й lock-файла перед змінами, `bumpUvDependencies` послідовно піднімає прямі залежності, а `cleanupUvBackups` прибирає тимчасові копії після завершення. Координація розрахована на кореневий проєкт, а не на обхід підпроєктів, і спирається на конвенції, які узгоджуються з `package.json`.

`buildUvDependencyPrompt` формує інструкцію для LLM лише після того, як bump уже виконано детерміновано: промпт веде від звірки breaking changes на сторінці пакета в https://pypi.org/project/ до пошуку використань у коді, а далі — або до відсутності змін, або до точкового рефакторингу й запуску наявних перевірок. Посилання на нотатки до випуску пакета йде через сторінку PyPI, щоб мати один стабільний вхід до історії версій.

`bumpUvDependencies` працює best-effort: якщо оновлення одного пакета ламається, прогрес по решті не втрачається, а невдала спроба відновлює початковий specifier. Перевірка доступності uv базується на встановленому CLI; якщо його немає, провайдер одразу повідомляє про це з орієнтиром на https://docs.astral.sh/uv/getting-started/installation/.

## Публічний API

- buildUvDependencyPrompt — Промпт ОДНОГО ітеративного виклику для Python-пакета (кроки 4-6 SKILL.md,
Python-гілка) для ОДНОГО major-пакета. Кроки 1-3/7/8 виконує оркестратор
ядра детерміновано, без LLM.
- findPyprojectManifest — Знаходить кореневий `pyproject.toml` (крок 0.2 SKILL.md, Python-гілка).
v1: один кореневий файл, не per-package обхід, як для Cargo.toml —
поточна uv-конвенція (single-project, без workspace-обходу).
- backupUvManifest — Бекапить pyproject.toml + uv.lock (крок 1 SKILL.md, Python-гілка) —
потрібно для класифікації major/minor через `collectUvDiff` після bump-у.
- cleanupUvBackups — Прибирає бекапи pyproject.toml/uv.lock після завершення (крок 7 SKILL.md,
Python-гілка).
- bumpUvDependencies — Піднімає кожну пряму залежність pyproject.toml через `uv remove` + `uv add
<pkg>[extras] --bounds lower` (крок 2 SKILL.md, Python-гілка) — `uv` не
має єдиної команди "підняти все до latest, навіть через major", на
відміну від `bunx taze -w -r latest`/`cargo upgrade --incompatible allow`
(підтверджено емпірично: `uv add <pkg>` на вже присутній залежності —
no-op, specifier НЕ переписується без попереднього `uv remove`). Провал
одного пакета (мережа/резолюція) не втрачає прогрес по інших —
best-effort відновлення оригінального рядка, якщо `uv add` не вдався
після `uv remove`.

## Сценарії використання

- `plugins/lang-python/taze/tests/provider.test.mjs` (pythonProvider (форма контракту); buildUvDependencyPrompt) — валідний EcosystemProvider за assertEcosystemProvider ядра; available: uv відсутній → ok:false з причиною; available: uv є → ok:true; містить пакет, маніфест і версії; не змішує з Rust/npm-командами інших гілок; ще 7

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
