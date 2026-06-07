---
session: d943f92b-e895-4110-8ae0-338380a03c95
captured: 2026-06-06T21:47:35+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d943f92b-e895-4110-8ae0-338380a03c95.jsonl
---

I need to synthesize these decisions into ADR documents now.

---

## ADR Спрощення tier-routing у docgen — видалення Haiku-рефері, додавання 5-хв timeout

## Context and Problem Statement
Пайплайн `docgen-gen.mjs` використовував три рівні якісного контролю для файлів з `sym < 4`: детермінований скорер, Haiku як хмарний рефері, і умовний fallback на Claude Sonnet. У реальних даних (52 файли) мінімальний det-score був 80, ескалація Haiku не спрацювала жодного разу — рефері додавав вартість без відчутного приросту якості.

## Considered Options
* Залишити Haiku як рефері + додати timeout
* Видалити Haiku, залишити лише det-scorer як gate + додати timeout → Tier 2
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Видалити Haiku, залишити лише det-scorer як gate + додати timeout → Tier 2", because даних із реального прогону показали: Haiku ніколи не ескалував (min det-score=80), тому видалення дає нульову регресію якості при зниженні вартості й складності.

### Consequences
* Good, because transcript фіксує очікувану користь: прибрано Haiku API-виклики (вартість і затримка), pipeline став простішим.
* Good, because 5-хв timeout через `Promise.race` захищає batch від зависання на одному файлі.
* Bad, because якщо local модель поверне структурно коректний але семантично неправильний результат зі score ≥ 70, документ пройде без перевірки — детермінований скорер не перевіряє семантику.

## More Information
- Файл: `npm/skills/docgen/js/docgen-gen.mjs`
- Константи: `LOCAL_TIMEOUT_MS = 5 * 60 * 1000`, `QUALITY_THRESHOLD = 7` (det-score gate)
- Прибрано: `BORDERLINE_SYM_LOW`, `cloudScoreDoc`, `scoreModel` / `scoreCloud` параметри
- Коміти: `668d1877` (видалення Haiku, timeout), `2184724a` (поле `model` у return value)

---

## ADR Реформування flow під архітектуру "думка md-graph як оркестра"

## Context and Problem Statement
Пайплайн `docgen-gen.mjs` використовував Anthropic SDK (`new Anthropic()`) напряму для Tier 2 генерації та `cloudScoreDoc` (Haiku) для оцінки якості. ADR `260606-2124` (глобальна класифікація моделей) вимагає, щоб усі скіли посилалися на глобальні тири з `npm/lib/models.mjs` замість хардкоджених назв моделей, і використовували `pi` як провайдер-нейтральний транспорт.

## Considered Options
* Залишити Anthropic SDK, але підставляти `LOCAL_MIN` / `CLOUD_AVG` з `models.mjs` і знімати `provider/` префікс
* Замінити SDK на `pi` transport (`spawnSync`) як у `llm-worker.mjs`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Замінити SDK на `pi` transport (`spawnSync`) як у `llm-worker.mjs`", because це відповідає еталонному патерну репозиторію і забезпечує провайдер-нейтральність — `CLOUD_AVG` може вказувати на будь-якого провайдера, не лише Anthropic.

### Consequences
* Good, because transcript фіксує очікувану користь: `import Anthropic from '@anthropic-ai/sdk'` видалено, модель конфігурується через env vars `N_CURSOR_DOCGEN_MODEL` / `N_CURSOR_DOCGEN_CLOUD_MODEL`.
* Good, because `localModelId()` знімає `ollama/` префікс для прямого HTTP до ollama — внутрішня деталь прихована від зовнішнього конфігу.
* Bad, because `piOneShot` синхронний (`spawnSync`) — блокує event loop на час виклику хмарної моделі; для batch-прогону це прийнятно, але не для серверного контексту.

## More Information
- Файл: `npm/skills/docgen/js/docgen-gen.mjs`
- Імпорти: `import { LOCAL_MIN, CLOUD_AVG } from '../../../lib/models.mjs'`, `import { spawnSync } from 'node:child_process'`
- Функція `piOneShot(facts, src, model)` — конкатенує `STYLE` + `oneShotPromptText`, викликає `pi -p <prompt> --model <model> --no-session --mode text`
- Per-skill overrides: `env.N_CURSOR_DOCGEN_MODEL ?? LOCAL_MIN`, `env.N_CURSOR_DOCGEN_CLOUD_MODEL ?? CLOUD_AVG`
- Еталон: `npm/skills/fix/js/llm-worker.mjs`
- Коміт: `abaeaa08`

---

## ADR Видалення Haiku-рефері і спрощення tier-routing у docgen — визначений gate-замість-threshold

## Context and Problem Statement
`npm/scripts/coverage-classify/index.mjs` використовував Anthropic SDK напряму (`new Anthropic()`, `client.messages.create`) з хардкодованою моделлю `claude-sonnet-4-6` і перевіркою `ANTHROPIC_API_KEY`. Це суперечить ADR `260606-2124` про глобальні тири моделей і не давало можливості безкоштовної локальної класифікації.

## Considered Options
* Замінити SDK на `pi` з `CLOUD_MIN` (haiku/flash) — дешевше ніж Sonnet
* Двотировий routing: `LOCAL_MIN` → якщо fail → `CLOUD_MIN`
* Залишити Sonnet, тільки перейти на `pi` transport
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Двотировий routing: LOCAL_MIN → якщо fail → CLOUD_MIN", because більшість мутантів прості (glue/wrapper) — local модель їх класифікує безкоштовно; складні (`equivalent`/`defensive`) ескалюються на cloud при невалідному JSON або Zod-помилці.

### Consequences
* Good, because transcript фіксує очікувану користь: класифікація простих мутантів безкоштовна; `ANTHROPIC_API_KEY` більше не потрібен; cache key `LOCAL_MIN+CLOUD_MIN` автоматично інвалідується при зміні тирів.
* Good, because `opts.callPi` injection дає можливість тестувати без реального `pi` процесу (замість `vi.mock('@anthropic-ai/sdk')`).
* Bad, because для мутантів де local видав валідний JSON з неправильним вердиктом (структурно коректний але семантично хибний) — ескалація не спрацює; threshold по confidence не реалізований.

## More Information
- Файли: `npm/scripts/coverage-classify/index.mjs`, `npm/scripts/coverage-classify/tests/index.test.mjs`
- Routing: `callPi(prompt, LOCAL_MIN)` → `parseVerdict` (Zod) → якщо throw → `callPi(prompt, CLOUD_MIN)` → якщо throw → `FALLBACK_VERDICT` (worth-testing, confidence=0)
- Cache key: `` `${LOCAL_MIN}+${CLOUD_MIN}` `` — при зміні будь-якого тира кеш інвалідується
- Тести: 7 сценаріїв (tier-1 success, tier-1 fail → tier-2, обидва fail, cache hit/miss, write)
- Коміт: `a883b44d`
