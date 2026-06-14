---
session: 8bd801e6-c1ea-4e77-887f-47d0a8dd4c9c
captured: 2026-06-14T17:32:24+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/8bd801e6-c1ea-4e77-887f-47d0a8dd4c9c.jsonl
---

Тепер у мене достатньо інформації для ADR. Сесія містить два окремих рішення: заміна `N_LOCAL_MIN_MODEL` та додавання поля `model` у frontmatter.

## ADR Зміна N_LOCAL_MIN_MODEL на gemma-4-e4b-it-OptiQ-4bit

## Context and Problem Statement
Користувач захотів оновити локальну модель тир-`min`, яку використовує `fix-doc-files` (і весь стек `resolveModel('min')`), замінивши стару `gemma-4-e2b-it-4bit` на новішу `gemma-4-e4b-it-OptiQ-4bit`.

## Considered Options
* Оновити `N_LOCAL_MIN_MODEL` у `~/.zshenv` з новим id
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Оновити `N_LOCAL_MIN_MODEL` у `~/.zshenv`", because це єдина точка конфігурації tier-`min` — `resolveModel('min')` (`npm/lib/models.mjs:42`) читає саме цю змінну оточення.

### Consequences
* Good, because transcript фіксує очікувану користь: нова модель `omlx/gemma-4-e4b-it-OptiQ-4bit` підхоплюється в нових shell-сесіях без змін у коді; health-check підтвердив `{"ok":true}`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінений файл: `~/.zshenv:4`. Попереднє значення: `omlx/gemma-4-e2b-it-4bit`. Нове: `omlx/gemma-4-e4b-it-OptiQ-4bit`. `resolveModel` (`npm/lib/models.mjs:28`) зберігає резервний каскад: `N_LOCAL_MIN_MODEL` → `N_LOCAL_AVG_MODEL` → `N_LOCAL_MAX_MODEL` → `N_CLOUD_MIN_MODEL`. Хардкод-fallback в `npm/lib/omlx.mjs:49` лишається `mlx-community--gemma-4-e2b-it-4bit`.

---

## ADR Запис model-id у frontmatter файлової документації (Phase 1)

## Context and Problem Statement
Фронтматер файлових доків (`docgen-crc.mjs`) фіксував лише `source` і `crc` (плюс опційний quality-блок), але не зберігав, якою моделлю згенеровано документ. Оскільки локальні моделі еволюціонують, без цього поля неможливо визначити «вік» доки відносно моделі-генератора.

## Considered Options
* Phase 1: пасивний запис `model` у frontmatter; drift-детектор — пізніше
* Обидва: запис і drift-детектор (`lint-doc-files` позначає доку stale при зміні моделі) — одразу
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Phase 1: пасивний запис `model` у frontmatter; drift-детектор — пізніше", because користувач явно сказав «Phase 1 зараз, а drift-детектор пізніше».

### Consequences
* Good, because transcript фіксує очікувану користь: після зміни моделі буде видно, які доки згенеровано старою моделлю (поле `model` у frontmatter).
* Bad, because без drift-детектора `lint-doc-files` не помічає розбіжності моделі — старі доки лишатимуться «свіжими» за CRC, поки не буде реалізовано фазу 2.

## More Information
Змінені файли: `npm/rules/doc-files/js/docgen-crc.mjs`, `npm/rules/doc-files/js/docgen-files-batch.mjs`, `npm/rules/doc-files/js/tests/docgen-crc.test.mjs`.

Нові/змінені символи в `docgen-crc.mjs`: `MODEL_RE`, `readDocModel()`, `buildDocFrontmatter(source, crc, quality=null, model=null)`, `stampDoc(md, source, crc, quality=null, model=null)`, `parseDocFrontmatter` → `data.model`.

Формат нового поля у frontmatter:
```yaml
docgen:
source: src/lib/foo.js
crc: a3f1c9e0
model: omlx/gemma-4-e4b-it-OptiQ-4bit
```

Значення — повний model-id з префіксом провайдера (`omlx/…`), як повертає `resolveModel`. Поле опційне (back-compat): старі доки парсяться з `model: null`. У gen-шляху: `result.model` з `generateDoc` → `stampDoc`. У `--stamp`-шляху (без LLM): `readDocModel(docAbs)` зберігає наявне значення з frontmatter. Тести: 19/19 пройдено після змін.
