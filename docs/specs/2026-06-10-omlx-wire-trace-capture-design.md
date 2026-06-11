# Захоплення omlx wire-trace (reasoning + сліди) — дизайн-спека

Дата: 2026-06-10
Власник: @vitaliytv
Статус: Approved (2026-06-10)

## Мета

Фіксувати на **єдиній wire-точці** прямих omlx-викликів обидва канали даних:

- **reasoning** — текст думок моделі (для thinking-моделей),
- **спостережуваний слід** — request/response/usage/latency/retry/помилки,

у **проєктно-локальний** append-лог, щоб згодом (окрема спека) будувати з нього висновки про покращення проєкту: де правила/скіли недовизначені, де модель борсається, які виклики дорогі.

Ключова теза: це **два окремі канали**. Слід існує незалежно від того, thinking модель чи ні; reasoning — опціональний канал, що виживає лише на прямому HTTP. Прямий omlx-curl — найвища точка точності (на відміну від `pi`, який конкатенує ролі в plain-text, і Codex, який шифрує reasoning).

## Передісторія

`callOmlx` (`npm/lib/omlx.mjs:56`) — **єдиний** транспорт прямих omlx-викликів. Через нього йде весь прямий трафік: `docgen-gen.callOmlxMessages` (рядок 100) делегує саме в нього; так само llm-worker, coverage-classify.

Зараз `callOmlx` **повертає лише** `choices[0].message.content` (рядок 94) і **викидає** все інше: `usage`, `reasoning_content`, `finish_reason`, latency, кількість retry, сам request. Тобто найцінніший сигнал генерується сервером і одразу втрачається.

### Жива перевірка (2026-06-10)

Пробний виклик до `http://127.0.0.1:8000/v1/chat/completions` на моделі `Qwen3-4B-Thinking-2507-4bit` підтвердив форму відповіді:

- **reasoning приходить окремим полем** `message.reasoning_content` (НЕ `<think>`-теги; `content` чистий: `391`).
- `message` keys: `['role', 'content', 'reasoning_content']`.
- `usage` багатий: `prompt_tokens, completion_tokens, total_tokens, prompt_tokens_details.cached_tokens, model_load_duration, total_time`.
- `finish_reason: stop`.

Висновок: reasoning-канал **реальний і структурований**; основне джерело — поле `reasoning_content`, `<think>`-форму лишаємо як fallback для інших моделей.

## Scope

**In:**

- Один **wrapper навколо curl-блоку** в `callOmlx` — виклики вище не знають про логування.
- **Нормалізований JSONL-запис** на кожен виклик (обидва канали).
- Витяг reasoning: `message.reasoning_content` (primary) → `<think>…</think>` з `content` (fallback).
- Захоплення повного `usage` verbatim.
- Запис у **проєктно-локальний** append-лог `.n-cursor/omlx-trace.jsonl` (gitignored, **сирий шар**).
- **Always-on** з **недеструктивною** ротацією за розміром (історія не губиться до агрегації).
- Cap великих/чутливих `messages` + hash для дедуплікації.

### Двошарова модель даних (raw → aggregate)

Накопичення «назавжди» стосується **агрегату знань**, а не сирого потоку:

| Шар                                             | Що                                                  | Доля                                                                                                                                   |
| ----------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Raw** `.n-cursor/omlx-trace.jsonl` (+ архіви) | потік wire-записів: код, reasoning, великий, шумний | **gitignored**, локальний; у git не комітиться (роздув історії + вихідний код у кожному коміті). Лежить, доки батч-агрегація не спожиє |
| **Aggregate**                                   | дистильовані висновки після батч-аналізу            | **коммітиться в git, назавжди** (`docs/omlx-insights/`) — історія + code-review                                                        |

Сира ротація тому **недеструктивна**: дані доживають до агрегації, а не перезаписуються.

**Out (окремі спеки / задачі):**

- Детектор сигналів + LLM-аналіз «що покращити» — **друга спека** (consume цього логу).
- Фікс відсутнього `Authorization`-хедера в `callOmlx` — **окрема задача** (див. Ризики).
- Трасування `pi`-шляху та глобальний колектор Claude Code / Codex — поза цією спекою.

## Рішення 1: wrapper навколо curl-блоку в `callOmlx`

Логування — внутрішня деталь `callOmlx`. Жоден з викликів (`callOmlxMessages`, llm-worker тощо) не змінюється. Wrapper:

1. Стартує таймер перед retry-циклом.
2. У точці успіху (рядок 99 `return content`) і в кожній точці кидка помилки — формує запис.
3. Дописує один рядок у лог через append (`appendFileSync`), помилку запису **ковтає** (трасування ніколи не валить основний виклик).

Щоб не міняти контракт повернення (`callOmlx` повертає `string`), парсимо повний `j` всередині й логуємо `j.usage` / `j.choices[0].message.reasoning_content` / `finish_reason` поряд з уже наявним `content`.

## Рішення 2: схема запису

Один JSONL-рядок на виклик:

```jsonc
{
  "ts": "2026-06-10T...", // ISO, момент завершення виклику
  "caller": "docgen|fix|coverage|unknown", // opts.caller ?? env.N_CURSOR_TRACE_CALLER ?? 'unknown'
  "model": "Qwen3-4B-Thinking-2507-4bit", // після omlxModelId(), уже без префікса
  "url": "http://127.0.0.1:8000/v1/chat/completions",
  "temperature": 0.2,
  "max_tokens": 4096,

  "messages": [
    // ролі ЗБЕРЕЖЕНІ — наша перевага над pi
    { "role": "system", "content": "…(cap 8000 симв.)…" }
  ],
  "messages_sha256": "…", // hash повного messages-масиву (дедуплікація)
  "messages_truncated": false, // true, якщо хоч одне content обрізане

  "content": "391", // фінальна відповідь
  "reasoning": "Okay, the user…", // reasoning_content АБО <think>-вміст; null якщо нема
  "reasoning_source": "field|think_tag|null",
  "finish_reason": "stop",
  "usage": { "...": "verbatim з відповіді" },

  "ms": 12740, // latency навколо retry-циклу
  "attempts": 1, // скільки спроб curl зайняло
  "ok": true,
  "error": null // або рядок помилки на невдачі
}
```

Правила полів:

- `messages`: кожен `content` обрізається до **8000 символів**; `messages_truncated` фіксує факт обрізки; `messages_sha256` рахується з **повного** (необрізаного) масиву.
- `reasoning`: спершу `message.reasoning_content`; якщо порожнє — regex-витяг `<think>(.*?)</think>` з `content` (тоді `reasoning_source: "think_tag"`, тег із `content` не чіпаємо). **Edge-case (перевірено 2026-06-10):** на `finish_reason: "length"` thinking-модель може **обірвати думку в `content` без закриваючого тегу** — `reasoning_content` лишиться порожнім, а сирий reasoning буде в `content`. Тому при `finish_reason == "length"` і порожньому reasoning ставимо `reasoning_source: "truncated"` (сигнал «думку зрізав max_tokens»), а не губимо факт.
- `usage`: пишеться як є, без нормалізації (там корисні `model_load_duration`, `total_time`, `cached_tokens`).
- На помилці: `ok:false`, `error` = повідомлення; `content`/`reasoning`/`usage` = null; `attempts` відображає, на якій спробі впало.

## Рішення 3: куди писати + ротація

- Шлях: `<PROJECT_ROOT>/.n-cursor/omlx-trace.jsonl`. Корінь — від місця модуля (resolve до кореня репо, як у `docgen-compare`).
- Каталог `.n-cursor/` додається в `.gitignore`.
- **Недеструктивна ротація за розміром**: перед append, якщо активний файл > **50 MB**, перейменувати його в `omlx-trace.<seq>.jsonl` (наступний вільний `<seq>`, **без перезапису** наявних архівів), почати новий активний. Жоден сирий запис не губиться до батч-агрегації; прибирання архівів — відповідальність агрегатора (друга спека), а не ротації.

## Рішення 4: always-on

Логування ввімкнене **завжди**, без env-прапорця. Підстави: обсяг тримає cap (8k/повідомлення) + ротація 50 MB; ціль — пасивне накопичення без «забув увімкнути». ENV `N_CURSOR_OMLX_TRACE=0` лишаємо як **аварійний вимикач** (kill-switch), не як умову ввімкнення.

## Deliverable

1. **`npm/lib/omlx.mjs`**: wrapper навколо curl-блоку в `callOmlx` — збір запису, append, ротація, kill-switch. Парсинг `j` розширити на `usage`/`reasoning_content`/`finish_reason` (контракт повернення `string` незмінний).
2. **`npm/lib/omlx-trace.mjs`** (новий): чиста логіка — `buildTraceRecord({...})`, `writeTrace(record)`, `rotateIfNeeded()`, `extractReasoning(message)`, `capMessages(messages)`. Винесено окремо для тестованості (як `check-{id}.mjs`-патерн).
3. **`.gitignore`**: додати `.n-cursor/`.
4. **Тести** `npm/lib/tests/omlx-trace.test.mjs`: cap+hash, обидві форми reasoning, схема запису на ok/error, ротація за розміром. Wire-виклик мокаємо (без живого сервера).
5. **CHANGELOG** через `.changes/` (правило n-changelog).

## Ризики / суміжні знахідки

- **~~Відсутній `Authorization` у `callOmlx`.~~ ВИРІШЕНО (2026-06-10).** Сервер вимагав `Authorization: Bearer …`, а `callOmlx` auth-хедера не шле. Замість додавати ключ у клієнт — auth **вимкнено на сервері**: `~/.omlx/settings.json` → `auth.skip_api_key_verification: true` + `omlx restart`. Перевірено: прямі виклики без хедера повертають контент. `callOmlx` лишається без змін.
- **Чутливість логу.** `messages` містять вихідний код файлів. Лог проєктно-локальний і gitignored, але великий; cap 8k + ротація обмежують обсяг. Якщо знадобиться — у другій спеці додати редакцію.
- **caller невідомий за замовчуванням.** `callOmlx` не знає, хто його викликав. Поки що `caller` опційний (`opts.caller`/env); за потреби протягнути явно з кожного скіла — дрібна правка, не блокер.

## Вирішені рішення

- **Місце зберігання агрегату — git, `docs/omlx-insights/`** (2026-06-10). Дистильовані знання коммітяться в репо назавжди (історія + code-review). Власник самої логіки агрегації — друга (аналітична) спека; ця спека лише фіксує **призначення** (git) і відповідно тримає raw-шар gitignored, щоб у git ішов тільки чистий агрегат, не сирий потік.

## Відкриті питання

- Чи протягувати `caller` явно з docgen/fix/coverage одразу, чи лишити `unknown` до другої спеки? (Дефолт: лишити `unknown`, протягнути в аналітичній фазі.)
- Поріг ротації 50 MB і cap 8k — стартові значення, уточнити після перших днів накопичення.
