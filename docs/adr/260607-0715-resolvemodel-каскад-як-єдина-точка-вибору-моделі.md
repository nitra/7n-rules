---
session: 8e669f3c-28f9-4b13-9f55-6a6ec894debe
captured: 2026-06-07T07:15:11+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/8e669f3c-28f9-4b13-9f55-6a6ec894debe.jsonl
---

## ADR `resolveModel()` каскад як єдина точка вибору моделі

## Context and Problem Statement
У проєкті є 6 глобальних тирів (`N_LOCAL_MIN_MODEL`, `N_LOCAL_AVG_MODEL`, `N_LOCAL_MAX_MODEL`, `N_CLOUD_MIN_MODEL`, `N_CLOUD_AVG_MODEL`, `N_CLOUD_MAX_MODEL`). Коли локальні змінні не задані, кожен споживач вирішував fallback самостійно — без єдиного контракту. Потрібна прозора деградація без змін у коді споживачів.

## Considered Options
* Додати helper `resolveModel(tier)` із задокументованим каскадом у `npm/lib/models.mjs` і замінити всі прямі звернення до констант
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати helper `resolveModel(tier)` із задокументованим каскадом", because це єдина точка контракту: `'min' → LOCAL_MIN → LOCAL_AVG → LOCAL_MAX → CLOUD_MIN`, `'avg' → LOCAL_AVG → LOCAL_MAX → CLOUD_AVG`, `'max' → LOCAL_MAX → CLOUD_MAX`. Споживачі (coverage-classify, fix/llm-worker, coverage-fix, subagent-runner, docgen-gen) замінили прямі константи на виклик helper-функції.

### Consequences
* Good, because transcript фіксує очікувану користь: система прозоро деградує до хмарної моделі коли локальні env-змінні відсутні — без змін у коді кожного споживача.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл контракту: `npm/lib/models.mjs`. Споживачі оновлені: `npm/scripts/coverage-classify/index.mjs`, `npm/skills/fix/js/llm-worker.mjs`, `npm/scripts/coverage-fix.mjs`, `npm/scripts/dispatcher/lib/subagent-runner.mjs`, `npm/skills/docgen/js/docgen-gen.mjs`.

---

## ADR Повернення до direct ollama HTTP замість pi orchestrated для docgen Tier 1

## Context and Problem Statement
Проводився бенчмарк 10 файлів (sym=0..3) для docgen Tier 1: OLD (direct ollama HTTP з per-section викликами через `ollamaChat`) проти NEW (pi orchestrated — окремий `spawnSync('pi', ...)` на кожну секцію). Метрики: час генерації і score детермінованого `scoreDoc`.

## Considered Options
* OLD: direct ollama HTTP orchestrated (`localhost:11434/api/chat`, streaming, per-section)
* NEW: pi orchestrated (`spawnSync('pi', ['--no-session','--mode','text','--no-tools', ...])` per section)

## Decision Outcome
Chosen option: "OLD: direct ollama HTTP orchestrated", because при однаковій загальній якості (94.0 vs 94.0) pi orchestrated давав ×2 уповільнення в середньому (68 s → 135 s) і погіршення для sym=1 файлів на −20 балів через cache-hallucination. Переваги pi (universality) не компенсують регресію.

### Consequences
* Good, because transcript фіксує очікувану користь: менший latency на всіх sym-групах; sym=0 ×2.9 швидше, sym=1 ×3.4 швидше, якість sym=1 на 20 балів краща.
* Bad, because transcript фіксує: `location.mjs` тайм-аутнувся у NEW за 200 s (sym=3), тож деякі великі файли повільніші і з pi; прямий HTTP прив'язує Tier 1 до `localhost:11434` і вимагає окремого fallback-шляху коли ollama недоступна.

## More Information
Результати round 1 (10 парних файлів): `OLD avg 68106 ms score 94.0`, `NEW avg 135446 ms score 94.0`. OLD-код: `npm/skills/docgen/js/docgen-gen.mjs` (HEAD). NEW-код тимчасово збережений у `/tmp/docgen-gen-new.mjs`. Бенчмарк-скрипт: `/tmp/docgen-bench.sh`. Виміряні файли: `discover-check-rules-from-cursor.mjs`, `cache.mjs`, `timing-summary.mjs`, `check-reporter.mjs`, `run-lint-step.mjs`, `trufflehog.mjs`, `resolve-target-files.mjs`, `with-lock.mjs`, `http-route.mjs`, `run-standard-lint.mjs`.

---

## ADR `withTimeout` в docgen не завершує Node.js процес природно

## Context and Problem Statement
Під час бенчмарку виявлено, що OLD `docgen-gen.mjs` виводить результат у stderr через ~44-96 s, але сам Node.js процес залишається живим ще ~5 хвилин. Це блокувало послідовний bash-бенчмарк, де `wait $PID` зависав до 5 хвилин після отримання виводу.

## Considered Options
* Background process + polling stderr-файлу + `kill -9` одразу після появи виводу
* `perl -e "alarm($N); exec ..."` timeout wrapper
* GNU `timeout` / `gtimeout`
* Інші варіанти не дали результату (perl alarm ігнорується Node.js, `gtimeout` не встановлений на macOS)

## Decision Outcome
Chosen option: "Background process + polling stderr-файлу + `kill -9`", because на macOS `timeout` відсутній, `gtimeout` не встановлений, perl `alarm(N)` через `exec` не вбиває Node.js (SIGALRM ігнорується), тоді як `kill -9` надійно завершує процес одразу після появи виводу.

### Consequences
* Good, because transcript фіксує очікувану користь: бенчмарк-скрипт успішно завершує кожен файл протягом MAX_WAIT секунд (200-300 s) без зависань.
* Bad, because transcript фіксує: root-причина (pending `setTimeout` у `withTimeout` тримає event loop) залишається невиправленою у `docgen-gen.mjs`; process.exit() або `.unref()` на таймері вирішили б проблему чистіше, але у transcript рішення про виправлення не прийнялось.

## More Information
Причина: `Promise.race([resultPromise, new Promise(reject => setTimeout(reject, 300_000))])` — таймер 5 хв тримає event loop після того як `resultPromise` вже resolve-нувся. Підтверджено емпірично: вивід з'являється через ~51 s, процес живий до ~300 s. Workaround у скрипті `/tmp/docgen-bench.sh`: `kill -9 "$pid"` одразу після `[ -s "$TMPOUT" ]`.

---

## ADR Архітектура ollama fallback → pi + kubeai для K8s

## Context and Problem Statement
Прямий ollama HTTP працює лише коли `localhost:11434` доступний. Для CI без GPU, розробників без ollama і K8s-деплою потрібен fallback. Також постало питання: чим замінити ollama у K8s-середовищі?

## Considered Options
* `checkOllama()` upfront-перевірка + pi orchestrated як fallback коли ollama недоступна
* kubeai (K8s operator з Ollama-сумісним API) як K8s-замінник ollama
* vllm (OpenAI API, не Ollama-сумісний; потребує proxy або зміни провайдера в pi)

## Decision Outcome
Chosen option: "checkOllama() + pi fallback локально; kubeai як K8s-замінник", because kubeai підтримує Ollama-сумісний API (`/api/chat`) через `ollamaBackend` — тобто `OLLAMA_HOST=http://kubeai-svc.kubeai.svc:11434` і нульова зміна в `ollamaChat` коді. pi orchestrated активується лише коли ollama/kubeai недоступні. vllm не розглядався детально через потребу в proxy.

### Consequences
* Good, because transcript фіксує очікувану користь: один `OLLAMA_HOST` env-var перемикає між local ollama і kubeai без змін коду; pi fallback вкриває CI і dev без GPU.
* Bad, because Neutral, because transcript не містить підтвердження наслідку — рішення запропоноване наприкінці сесії, реалізація не підтверджена.

## More Information
Запропонований код перевірки: `fetch(\`${OLLAMA_HOST}/api/tags\`, { signal: AbortSignal.timeout(3000) })` кешується через `_ollamaOk` на рівні процесу. Файл для зміни: `npm/skills/docgen/js/docgen-gen.mjs`. Конфігурація K8s: kubeai operator, `ollamaBackend`, env `OLLAMA_HOST` як service endpoint.
