---
type: ADR
title: ""
---

## ADR: Застосування CLI-оркестратора до `n-docgen`

**Status:** Proposed
**Date:** 2026-06-06

## Context and Problem Statement

Скіл `n-docgen` обходить проєкт і генерує поведінкову md-документацію для кожного кодового файлу.
Поточна реалізація диспатчить окремого LLM-субагента на кожен файл — агент витрачає токени на
обхід директорій, читання файлів і запис результатів. Після впровадження CLI-оркестратора для `n-fix`
(convergence-loop: check → T0-auto → LLM → recheck) встановлено єдиний принцип:
`meta.json: "orchestrator": true` означає, що CLI-скрипт, а не агент, виконує цикл.

## Considered Options

* Залишити агента оркестратором: агент обходить файли, диспатчить субагентів, записує docs
* CLI-оркестратор: js-скрипт будує індекс файлів → для кожного файлу викликає `pi` → записує результат

## Decision Outcome

Chosen option: "CLI-оркестратор: js-скрипт будує індекс → `pi` → записує результат", because
це узгоджено з єдиним принципом оркестратора (з `260606-1553-autonomous-cli-orchestrators.md`):
CLI-скрипт виконує важкий I/O (обхід файлів, читання, запис), LLM через `pi` отримує лише
контекст одного файлу (C1-патерн).

### Очікуваний результат

```
npx @nitra/cursor docgen [path/to/file.mjs]     # один файл або весь проєкт
```

**Вивід (без порушень / все задокументовано):**
```
✅ docgen: 42 файли — документація актуальна
```

**Вивід (є нові/змінені файли):**
```
🔄 docgen: 7/42 файлів потребують оновлення
  ⚙️  T0 (без LLM): 2 файли — видалено застарілі docs
  ⚡ LLM (N_LOCAL_MIN): foo.mjs ✅
  ⚡ LLM (N_LOCAL_MIN): bar.mjs ✅
  ⚡ LLM (N_CLOUD_MIN): baz.mjs ✅   ← ескалація при помилці local
  ...
✅ docgen: 42 файли — все задокументовано
```

### Ключові технічні рішення

| Рішення | Значення |
|---|---|
| Модель для генерації | `N_LOCAL_MIN` (gemma3:4b) — tier 1; `N_CLOUD_MIN` — ескалація |
| Tier routing | sym-threshold: `sym < 4` → local, `sym ≥ 4` → cloud (з `260606-1654`) |
| Перевірка актуальності | mtime файлу vs mtime docs — детерміністично (T0, 0 LLM) |
| Формат промпта | C1: повний зміст файлу → `pi` → markdown відповідь |
| Запис результату | скрипт пише `docs/<same-path>.md` поряд із кодом |
| `meta.json` | `{ "orchestrator": true }` — декларація |

### Consequences

* Good, because обхід файлів і запис docs — нульові токени агента (CLI I/O).
* Good, because `N_LOCAL_MIN` (gemma3:4b) дозволяє масову генерацію offline/безкоштовно.
* Good, because єдиний принцип — `orchestrator: true` — для всіх скілів (fix, docgen, taze, lint).
* Bad, because gemma3:4b не завжди дотримується поведінкового стилю документації — потрібна перевірка якості або ескалація на cloud.

## More Information

- `npm/skills/docgen/` — поточна реалізація
- `npm/skills/fix/js/orchestrator.mjs` — зразок convergence-loop
- `npm/lib/models.mjs` — `CLOUD_MIN`, `LOCAL_MIN` тири
- ADR `260606-1553-autonomous-cli-orchestrators.md` — загальний принцип
- ADR `260606-2124-глобальна-класифікація-моделей-n-local-n-cloud.md` — тири моделей
- Memory `feedback_docgen_style.md` — стиль: Огляд/Поведінка/Гарантії; без stdlib/сигнатур
