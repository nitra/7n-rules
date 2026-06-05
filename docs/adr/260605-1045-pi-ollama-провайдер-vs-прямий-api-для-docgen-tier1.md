## ADR pi (ollama-провайдер) vs прямий ollama API для docgen Tier 1

## Context and Problem Statement
Після вибору `gemma3:4b` як локальної моделі для Tier 1 скіла `docgen` виникло питання транспорту: викликати модель напряму через `http://localhost:11434/api/chat` чи через `pi --provider ollama --model gemma3:4b` (pi-coding-agent, підключений до Ollama через OpenAI-сумісний ендпойнт). Різниця не в самій моделі, а в агентному середовищі: прямий виклик отримує лише текст файлу у промпті, pi запускає модель з інструментами (`read`, `grep`, `bash`).

## Considered Options
* Прямий ollama API: `POST http://localhost:11434/api/chat`, `stream:false`, промпт = source file text
* pi (ollama-провайдер): `pi -p --provider ollama --model gemma3:4b @<sourcePath>`, модель має доступ до інструментів

## Decision Outcome
Chosen option: "pi (ollama-провайдер)", because на однакових 3 файлах (firebase_hosting, overlay-paths, k8s-tree) і однаковому Tier-1 промпті pi дав якість **98%** проти **86%** у прямого API — на 12 п.п. вище. Різниця пояснюється тим, що pi виконує модель в агентному циклі: вона може використати `grep`/`read` для пошуку споживачів файлу в суміжних файлах (секція `## Де використовується`), яку прямий API не може заповнити (бачить лише переданий файл). Прямий API також галюцинував на `k8s-tree.mjs` (стверджував «stale-стану є ризик між прогонами», тоді як кеш — module-level singleton).

### Consequences
* Good, because pi із tools знаходить крос-файловий контекст (хто викликає модуль), що дає коректну секцію `## Де використовується` і виключає клас галюцинацій про поведінку модуля.
* Bad, because pi повільніший: середній wall-час/файл ~68 с проти ~51 с (прямий API), тобто Tier 1 займе ~20 год замість ~15 год (послідовно, concurrency=1 на 8 GB M2).

## More Information
Конфігурація pi: `~/.pi/agent/models.json` — провайдер `"ollama"` із `baseUrl: "http://localhost:11434/v1"`, `api: "openai"`, `apiKey: "ollama"`, `compat: {supportsDeveloperRole: false, noSystemRole: true}`. Модель видно через `pi --list-models gemma` як `ollama / gemma3:4b / 128K ctx`.

Виміряні дані: бенчмарк `/tmp/docgen-bench3/run.py`; результати `/tmp/docgen-bench3/results.jsonl` (3 моделі × 2 транспорти × 3 файли); еталонні доки — `/tmp/docgen-bench3/etalon/`.

Архітектурний наслідок: щоб pi мав доступ до інструментів, йому потрібне CWD = корінь репозиторію; CLI `docgen gen --engine pi-ollama` має запускатися з кореня.
