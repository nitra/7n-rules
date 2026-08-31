# Розвідка: поверхня `docgen` (крок 7 порядку реалізації спеки v5)

**Дата:** 2026-08-31. **Контекст:** блокер знято — host-бік
`n-rules:caps/llm-consumer@1.0.0` реалізовано (§2.124 реєстру, PR #625,
`crates/rules-plugin-host/src/caps_llm_consumer.rs`). Разом із раніше
реалізованим `n-rules:caps/file-reader@1.0.0` (§2.116) `docgen` тепер має
ОБИДВА world-и повноважень, яких потребує (спека §12.1, доккомент
`llm-consumer.wit`: «жоден наявний споживач не показав потреби в
system/тир/стрімінг, порт `docgen` покаже»).

Це документ РОЗВІДКИ й КАРТИ — не план порту всього обсягу. Задача, яку він
супроводжує, портує РІВНО один етап (§4 нижче) і називає решту явно
незробленою (§5), а не мовчки звуженою.

## 1. Де живе чинна реалізація

`npm/rules/doc-files/` — **12 639 рядків** (усі `.mjs`, разом із тестами;
відтворювано: `find npm/rules/doc-files -name '*.mjs' | xargs wc -l`), не
`crates/rules-docs` (14 410 рядків Rust, окрема — і вже мертва, §3
основного плану міграції, чекає на проводку, не на порт). `n-rules docs`
(→ `crates/rules-docs`) і `n-doc-files`/`docgen` (→ `npm/rules/doc-files`)
— ДВІ РІЗНІ поверхні під схожими назвами; ця розвідка стосується лише
другої (`docgen`, §12 порядку реалізації спеки, крок 7).

Без тестів — **3 870 рядків** у 10 продуктивних `main.mjs` (+1
допоміжний `lang-extensions.mjs`) під `npm/rules/doc-files/docgen-*/`.

## 2. Карта етапів

| етап | рядків (без тестів) | LLM? | що робить |
|---|---:|:-:|---|
| `docgen-ignore` | 53 | ні | предикат ignore-glob (```DOCGEN_IGNORE_GLOBS``` + пакетний `ignore`-рушій) |
| `docgen-scan` (+`lang-extensions.mjs`) | 348 | ні | обхід дерева, пари джерело↔дока (`docPathForSource`), фільтр кандидатів — читає диск напряму (`readdirSync`/`existsSync`) |
| `docgen-crc` | 219 | ні | CRC32 джерела, парсинг frontmatter доки, `staleness()` — звірка застарілості за CLAUDE.md-конвенцією |
| `docgen-extract-anchors` | 118 | ні | текстовий екстрактор посилань/анкорів (URL, `export const`, `.mdc`-маркери) для post-generation валідації |
| `docgen-test-context` | 212 | ні | індекс test-evidence (які тести покривають джерело) — читає тестові файли з диска |
| `docgen-prompts` | 341 | непрямо | будує system/user текст промптів для `docgen-gen`/`docgen-judge`; сам мережі не кличе |
| **`docgen-judge`** | **135** | **так, 1 виклик** | LLM-суддя: `runOneShot` ОДИН раз на пару (джерело, згенерована дока) → verdict `accurate\|generic\|inaccurate` |
| `docgen-gen` | 1 106 | так, ланцюг | головний оркестратор генерації: кілька LLM-стадій під `startChain` (`candidate`/`claims`/`entailment`/`gap-mappings`, доккомент `crates/rules-docs/src/lib.rs`), retry/backoff, парсинг помилок моделі |
| `docgen-files-batch` | 797 | так, batch | пакетна відправка (`submitBatch` з `@7n/llm-lib/batch`) генерації по багатьох файлах одразу, локальні провайдери |
| `docgen-wave-batch` | 541 | так, batch | те саме для «хвиль» (wave) — масовий judge+gen у батчі |
| `docgen-fix-worker` | 0 (лише `concern.json`) | — | тонкий диспетчер, без власної логіки |

**Класифікація «що справді потребує LLM» проти «чиста трансформація»:**
шість із десяти етапів (`ignore`/`scan`/`crc`/`extract-anchors`/
`test-context`/`prompts`) — детермінований текст/FS-код, без мережі.
Чотири (`judge`/`gen`/`files-batch`/`wave-batch`) реально кличуть модель;
з них `judge` — єдиний, що робить це РІВНО одним `one-shot`-викликом на
одиницю роботи (пряме дзеркало форми `llm-consumer.wit`: один `prompt` →
один `text`). Решта три — batch/chain оркестрація поверх кількох викликів,
структурно складніша за мінімальний `llm-call`.

## 3. Чому `docgen-judge` — перший ported етап

1. **Найменший реальний LLM-споживач** (135 рядків, один `runOneShot`) —
   мінімальний ризик для першого наскрізного порту через новий world.
2. **Форма 1:1 з `llm-consumer.wit`.** `judgeMessages(src, doc)` будує
   `system` + `user` — WIT-форма (§2.124, доккомент
   `caps_llm_consumer.rs`) свідомо не несе окремого `system`-поля, тому
   порт зливає system+user в один `prompt` (той самий підхід, що
   `LocalCloud::one_shot(Tier::Local, None, &prompt)` — жоден наявний
   Rust-споживач `n7n-llm-lib` у цьому репо не передає системний текст
   окремо).
3. **Не залежить від `file-reader`.** І `src`, і `doc` уже приходять як
   рядки в чинному JS (аргументи `judgeDoc(src, doc, …)`) — на відміну від
   `docgen-scan`/`docgen-crc`, які самі читають диск. Порт `judge`
   ізольований від ще не вирішеного питання «як гість читає ПАРУ
   джерело+дока з host-batch» (детально — §5.2 нижче).
4. **Чисті допоміжні функції теж переносяться 1:1**, без спрощення:
   `detectRefusalFiller` (детермінований пре-гейт нуль-токенів,
   курований список regex — живий кейс з doc-коментаря JS-оригіналу),
   `parseDocVerdict` (валідація JSON-відповіді судді), `judgeFailsDoc`
   (поріг впевненості).

## 4. Що зроблено цим кроком

- `crates/plugin-docgen/` — новий first-party wasm-гість, контракт
  `n-rules:plugin@5.0.0`, world `docgen-guest` (`include plugin; include
  n-rules:caps/llm-consumer@1.0.0 with { domain-error as
  llm-consumer-domain-error }` — постійний файл
  `crates/rules-contract/wit/docgen-guest.wit`, той самий прийом, що
  `plugin-file-reader.wit`/`rust-coverage-provider-guest.wit`, НЕ
  тимчасовий tempdir-скаффолд гейт-тесту).
- Концерн `docgen/judge` — порт `judgeMessages`/`detectRefusalFiller`/
  `parseDocVerdict`/`judgeFailsDoc`/`judgeDoc` 1:1 у Rust
  (`crates/plugin-docgen/src/lib.rs`), виклик реального host-імпорту
  `llm-call` (не заглушки).
- Гейт `crates/rules-plugin-host/tests/plugin_docgen_judge_gate.rs` —
  дзеркало `caps_llm_consumer_gate.rs`: `FakeLlmCaller` (жодного мережевого
  виклику), обидві половини критерію готовності (§12.1 спеки): гість із
  оголошеним `n-rules:caps/llm-consumer@1.0.0` інстанціюється й реально
  дістає verdict крізь host-імпорт; той самий `.wasm` без оголошення
  world-а падає гучно на інстанціації.

## 5. Що НЕ зроблено цим кроком — явно, не мовчки

### 5.1. Три LLM-етапи лишились непортованими

`docgen-gen` (1 106), `docgen-files-batch` (797), `docgen-wave-batch`
(541) — 2 444 рядки. Спільна причина відкладення: усі три оркеструють
КІЛЬКА викликів моделі (ланцюг стадій або паралельний batch), а
`llm-consumer.wit` дає лише один синхронний `llm-call` за раз — форма
навмисно мінімальна (доккомент world-а). Порт цих трьох вимагає або
послідовних `llm-call` у циклі гостя (найпростіше, але втрачає
паралелізм/native-batch API `@7n/llm-lib/batch`, який чинний JS
використовує саме для пропускної здатності), або розширення
`llm-consumer.wit` під пакетний виклик — рішення навмисно відкладене до
того, як буде видно, що варіант «цикл `llm-call`» справді неприйнятний на
практиці (той самий принцип, що вже застосований до самого `llm-consumer`:
«не вигадувати потребу, а відповісти на неї», §2.124).

### 5.2. Читання пари (джерело, дока) через `file-reader` — не портовано

Шість «чистих» етапів (`scan`/`crc`/`ignore`/`extract-anchors`/
`test-context`) читають диск НАПРЯМУ (`readFileSync`/`readdirSync`) — у
гості це має йти через `n-rules:caps/file-reader@1.0.0` (уже реалізований,
§2.116), а не через `detect-batch.files`, бо `docgen` обходить усе дерево,
не лише передані host-ом файли (спека §12.1, «file-reader… docgen (сканує
все дерево)»). Порт `docgen-judge` цим кроком НЕ читає диск сам — `src`/
`doc` приходять як єдиний рядок-батч з роздільником (тестова/демонстраційна
форма гейта, `crates/rules-plugin-host/tests/plugin_docgen_judge_gate.rs`).
Реальне включення `docgen/judge` у batch, зібраний `docgen-scan`, вимагає
або (а) `docgen-scan` теж портованого на `file-reader` першим, або (б)
окремого host-механізму пар (джерело, дока) у `detect-batch` — обидва поза
обсягом цього кроку.

### 5.3. Шість детермінованих етапів — не LLM-порти, а звичайний Rust-порт

`docgen-scan`/`docgen-ignore`/`docgen-crc`/`docgen-extract-anchors`/
`docgen-test-context`/`docgen-prompts` (1 291 рядок разом) не потребують
жодного нового world-а — вони кандидати на порт незалежно від
`llm-consumer`, тим самим шляхом, що вже пройшли `plugin-lang-*`. Порядок
не заданий цим документом: логічно `docgen-scan`+`docgen-ignore` йдуть
ПЕРШИМИ (вони годують усі інші), але це рішення наступного кроку, не
цього.

### 5.4. `docgen-stage` (слотовий world, `crates/rules-contract/wit/deps/surfaces/docgen-stage.wit`) — не задіяний

Слот уже оголошений (host ЩЕ не має host-боку диспетчера для нього —
`KNOWN_CAPABILITY_WORLDS` §12.1 покриває лише world-и ПОВНОВАЖЕНЬ, не
слотові export-и). Дзеркало ситуації `coverage-provider` ДО кроку 6: форма
оголошена, реалізації host-боку нема. Диспетчеризація `run-stage` за
`stage`-рядком (`candidate`/`claims`/…/`judge`) — окрема майбутня робота,
не покрита ні цим документом, ні цим PR.

## 6. Пропонований порядок продовження (не рішення, орієнтир)

1. Port `docgen-scan`+`docgen-ignore` на `file-reader` (найбільший важіль —
   годує решту).
2. Port `docgen-crc`/`docgen-extract-anchors`/`docgen-test-context`
   (чиста трансформація, залежить від (1) лише для читання файлів).
3. Розширити `llm-consumer.wit` під потреби `docgen-gen` (ланцюг стадій) —
   або підтвердити, що цикл `llm-call` достатній, вимірявши на реальному
   ланцюгу.
4. Port `docgen-gen`, потім `docgen-files-batch`/`docgen-wave-batch`.
5. Host-бік `docgen-stage` (слот) — диспетчер `run-stage`, аналогічний
   `collect-coverage`.
