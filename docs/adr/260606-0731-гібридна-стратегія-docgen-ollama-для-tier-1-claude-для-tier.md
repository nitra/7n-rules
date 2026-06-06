---
session: d943f92b-e895-4110-8ae0-338380a03c95
captured: 2026-06-06T07:31:13+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d943f92b-e895-4110-8ae0-338380a03c95.jsonl
---

`gemma4:4b` підтверджено — ollama і pi бачать її під чистою назвою.

## Підсумок стану

```
ollama list:
gemma4:4b           5.3 GB   ← новий canonical alias (ID d682bf87)
batiai/gemma4-e4b:q4 5.3 GB  ← оригінальний тег (той самий blob)
gemma3:4b           3.3 GB   ← швидкість-first варіант

pi --list-models gemma4:
ollama  gemma4:4b  128K  ← перший (дефолтний) у провайдері ollama
ollama  gemma3:4b  128K
```

Тепер для docgen можна використовувати `--model gemma4:4b` у pi або напряму в ollama — коротко і без `batiai/`-префікса.

---

Тепер видаю ADR-документацію на підставі сесії:

---

## ADR Гібридна стратегія docgen: Ollama для Tier 1, Claude для Tier 2/3

## Context and Problem Statement
Скіл `n-docgen` генерує документацію трьома рівнями (файли → модулі → домени) виключно через Claude-субагенти. Для проєкту з 1442 файлами повний Tier 1 коштує ~26 M хмарних токенів (~$300–570). Виникло питання: чи можна знизити вартість, перенісши масовий Tier 1 на локальну Ollama.

## Considered Options
* Tier 1 — локальна Ollama, Tier 2/3 — Claude (гібрид)
* Усе через Claude (поточний стан)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Tier 1 — локальна Ollama, Tier 2/3 — Claude", because Tier 1 складається з 1042+ незалежних і механічних задач (один файл → один `.md`), де локальна модель дає прийнятну якість (~85–92% vs еталон), а вартість хмари обнуляється; Tier 2/3 лишається на Claude через синтетичний характер задач і малу кількість одиниць (~2.6 M токенів, некритично).

### Consequences
* Good, because transcript фіксує очікувану користь: Tier 1 ~26 M токенів → $0, Claude-навантаження скорочується до ~2.6 M (Tier 2/3 + хвіст quality-gate).
* Bad, because Tier 1 через Ollama стає послідовним (concurrency=1 на одній машині) і займає ~14–30 год замість паралельних хмарних батчів; крім того, якість обмежена стелею локальної моделі (~85–92% vs еталон).

## More Information
Реалізаційний патерн: `npx @nitra/cursor docgen scan --root <dir>` → послідовний цикл `POST http://localhost:11434/api/chat` → quality-gate (непорожній, починається з `# <stem>`, є обов'язкові секції) → хвіст провалів іде в Claude-субагенти. Tier 1 промпт має бути винесений у спільний модуль `docgen-prompt.mjs` (`buildTier1Prompt`) — єдине джерело правди для обох двигунів. Додаткової інформації в transcript не зафіксовано.

---

## ADR Вибір моделей для локального Tier 1 на 8 GB M2

## Context and Problem Statement
На машині Apple M2 / 8 GB unified memory необхідно обрати локальну модель для генерації docgen Tier 1. Ключові обмеження: модель має фізично вміщатися в RAM (інакше своп → катастрофічна деградація до 0.4 tok/s, як підтверджено для `gemma4:e4b` 9.6 GB), підтримувати українську мову й дотримуватися структурних інструкцій (без сигнатур/stdlib/реалізаційних деталей).

## Considered Options
* `gemma4:4b` (q4-квант, 5.3 GB) — якість-first
* `gemma3:4b` (3.3 GB) — швидкість-first
* `qwen2.5-coder:3b` (2.4 GB) — максимум швидкості, слабка мова
* `gemma4:e4b` (9.6 GB), `qwen2.5:7b`/`:coder:7b` (5.1 GB), `llama3.1:8b` (5.7 GB) — виключені: не вміщаються або деградують до CPU-офлоаду
* `qwen3:4b` — виключена: ігнорує `/no_think`, не видає фінальний вивід
* `llama3.2:3b`, `gemma2:2b`, `phi3.5` — виключені: слабка українська

## Decision Outcome
Chosen option: "два варіанти залежно від пріоритету — `gemma4:4b` (якість-first) або `gemma3:4b` (швидкість-first)", because вимірювання показали: `gemma4:4b` дає ~92% vs еталон проти ~85% у `gemma3:4b`, але вдвічі повільніша (~11 tok/s, 56%/44% CPU/GPU-офлоад) через 5.3 GB при 8 GB бюджеті; `gemma3:4b` повністю в GPU (100%), ~20 tok/s, ~14.5 год на 1042 файли проти ~30 год для `gemma4:4b`.

### Consequences
* Good, because transcript фіксує очікувану користь: `gemma4:4b` реально слухає негативні обмеження промпта (не виводить сигнатури/stdlib/regex), яких `gemma3:4b` частково ігнорує; обидві моделі задовільні для чорнового Tier 1.
* Bad, because `gemma4:4b` частково офлоадиться на CPU (56%) і при будь-якому зовнішньому навантаженні (IDE, інші процеси) деградує — thrashing підтверджено в марафоні. На 8 GB жодна модель не досягає Tier-3-якості (стеля ~92%).

## More Information
Канонічні ollama-назви: `gemma4:4b` (alias на `batiai/gemma4-e4b:q4`, ID `d682bf87e3a3`, 5.3 GB), `gemma3:4b` (ID `a2af6cc3eb7f`, 3.3 GB). Обидві зареєстровані в `~/.pi/agent/models.json` провайдера `ollama`. Бенчмарк проводився на файлах `firebase_hosting.mjs`, `overlay-paths.mjs`, `k8s-tree.mjs`; еталон — ручна дока у стилі Огляд/Поведінка/Публічний API/Гарантії поведінки.

---

## ADR System-prompt як ключовий чинник якості локальної docgen

## Context and Problem Statement
Порівняння трьох способів виклику `gemma3:4b` (прямий `/api/generate` без system, `pi --provider ollama`, прямий `/api/chat` + system-prompt) показало різкий розкид якості (71% vs 87% vs 85%). Потрібно було встановити, що саме підіймає якість — сам pi як інструмент чи вміст system-prompt.

## Considered Options
* Прямий `ollama /api/chat` + сильний system-prompt (без pi)
* `pi --provider ollama --model gemma3:4b` (зі своїм вбудованим system-prompt)
* Прямий `ollama /api/generate` без system-prompt (baseline)
* pi RPC-сесія + `--append-system-prompt` (персистентна сесія на батч)

## Decision Outcome
Chosen option: "прямий `/api/chat` + system-prompt як технічно рівноцінний pi, а pi per-file — як ергономічний варіант для тих, кому важливий UX", because контрольований експеримент підтвердив: прямий+system (85%) впритул до pi (87%); різниця 2 п.п. — в межах суб'єктивного шуму оцінювання (~±3 п.п.) і пояснюється тим, що pi має відшліфованіший вбудований system-prompt. Pi-RPC-сесія відкинута: накопичення контексту між незалежними файлами забруднює генерацію.

### Consequences
* Good, because transcript фіксує очікувану користь: system-prompt дає +14–16 п.п. якості (71% → 85–87%) — це більший приріст, ніж різниця між моделями в fit-класі. Прямий API дає повний контроль `num_ctx`/`num_predict` (усуває обрізання виводу, що трапилось у варіанті A).
* Bad, because pi per-file додає ~4 с node-старту на файл (+~1.1 год на 1042 файли) і схильний до довших виводів (до +69% символів vs прямий), що прямо збільшує час генерації при однаковому tok/s.

## More Information
Обраний рецепт system-prompt містить заборони: без ` ``` `-обгортки, без сигнатур/типів, без переліку stdlib, без regex і приватних імен; акцент на крайових деталях (що свідомо пропускається, що НЕ перевіряється, fail-safe). Пост-обробка: `sed '/^```/d'` для зрізання fence. pi зареєстрований через `~/.pi/agent/models.json` з `"api": "openai-completions"` та `"baseUrl": "http://localhost:11434/v1"`.
