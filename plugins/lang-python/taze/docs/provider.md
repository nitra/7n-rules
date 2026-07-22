---
type: JS Module
title: provider.mjs
resource: plugins/lang-python/taze/provider.mjs
docgen:
  crc: 701a208f
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 90
  issues: internal-name:collectUvDiff,judge:error
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл забезпечує uv-гілку оновлення Python-залежностей у репозиторії: `findPyprojectManifest` визначає кореневий `pyproject.toml`, `backupUvManifest` і `cleanupUvBackups` делегують підготовку та прибирання резервних копій, `bumpUvDependencies` запускає оновлення прямих залежностей через uv із мережевими зверненнями, а `buildUvDependencyPrompt` формує завдання для LLM-аналізу major-міграції на основі вже підготовленої зміни. Це відокремлює автоматичний bump від подальшого аналізу сумісності.

## Поведінка

findPyprojectManifest визначає, чи є в репозиторії Python-проєкт для uv-гілки оновлення залежностей; потік свідомо обмежений кореневим pyproject.toml і не виконує per-package чи workspace-обхід.

Перед змінами backupUvManifest зберігає стан маніфеста й lock-файла, щоб після bumpUvDependencies можна було порівняти попередній і новий стан залежностей та відокремити major-оновлення від решти. bumpUvDependencies працює з прямими залежностями проєкту, звертається до uv і мережевих джерел пакетів на кшталт https://pypi.org/project/, а прогрес передає назовні через журналювання; якщо окреме оновлення не вдається, потік намагається не блокувати інші пакети.

buildUvDependencyPrompt використовується після детермінованого bump-етапу для одного major-пакета: отримує вже підготовлений запис зміни й формує текстове завдання для LLM-аналізу міграції, не виконуючи самостійно оновлення чи перевірки. Наявність uv очікується як частина середовища, встановленого за https://docs.astral.sh/uv/getting-started/installation/, а загальні команди проєкту узгоджуються з package.json.

Після завершення Python-гілки cleanupUvBackups прибирає тимчасові копії, щоб наступний запуск починався з актуального стану репозиторію. Власний стан між викликами не зберігається: дані переходять через файли проєкту, результати зовнішніх команд, журнал прогресу та сформований prompt.

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

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
