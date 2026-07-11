# Dev-design Фази A: run-harness у @7n/llm-lib

**Дата:** 2026-07-11
**Статус:** чернетка на ревʼю
**Батьківська спека:** `docs/specs/2026-07-11-pi-harness-mt-fix-graph.md` (рішення Г: evidence+re-check gate, hash-anchored edits, web-access; субагенти — ні)

## 1. Відправна точка (що вже є)

`@7n/llm-lib@2.x` (`llm-lib/` цього монорепо) — pi-шар уже тут:

| Модуль | Роль | Що бракує до harness |
| --- | --- | --- |
| `lib/agent-fix.mjs` `runAgentFix()` | один agentic rung: write-guard fail-closed, turn-ceiling, advisory `self_check`, телеметрія turns/tool-calls, chain | verify — лише advisory; «done» = завершення `session.prompt`, без доказу |
| `lib/agent-skill.mjs` `runAgentSkill()` | user-trust скіл-раннер (повний toolset + bash), одна тира | поза скоупом A (міняти не треба) |
| `lib/one-shot.mjs` `runOneShot()` | bounded не-agentic виклик | поза скоупом A |
| `lib/write-guard.mjs` | tracked-only захист + rollback + editLog | лишається як є |
| `lib/internal/compress-context.mjs` | компресія pi-контексту (порт myllm compress.rs) | вже покриває «компресію» з brainstorm — нічого не робимо |
| consumer-seam (cursor) | `npm/scripts/lib/lint-surface/run-fix.mjs` (detect→T0→ladder→canonical re-detect) + `default-worker.mjs` (адаптер `fixWorker→runAgentFix`) | verify-петля всередині rung відсутня: фейл re-detect = одразу наступний щабель драбини |

Ключовий наявний інваріант (зберігаємо): **success визначає ВИКЛЮЧНО canonical re-detect** runner-а; worker не володіє tier/ladder/rollback.

## 2. Проєктні рішення

### 2.1 Evidence-гейт = структурний verify-loop, не model-контракт

Не вводимо tool `report_done` (слабкі моделі погано тримають протокольні зобовʼязання; cloud їх не потребує). Натомість гейт структурний — harness сам жене перевірку:

```
session.prompt(fixPrompt)
loop (≤ verifyMax, дефолт 2 додаткові ітерації):
  evidence = await opts.verify({ touchedFiles })   // canonical check від consumer-а
  evidence.ok → success (у телеметрію: verifyAttempts)
  !ok && ітерації лишились →
      session.prompt(feedbackPrompt(evidence.output))   // ТА САМА сесія, контекст спроби живий
  !ok && вичерпано → error 'verify failed', rollback як зараз
```

- `opts.verify: (({touchedFiles}) => Promise<{ok, output}>)` — інʼєктується consumer-ом; для lint це **той самий** concern-детектор, що й canonical re-detect (однакове джерело правди, звужене до item-у). Немає `verify` → поведінка як зараз (один прохід, зворотна сумісність).
- `self_check` (advisory) лишається — він веде агента ДО verify; verify — після, як гейт.
- Відмінність від ladder-retry: фейл verify з фідбеком у **ту саму сесію** (агент бачить свої правки і точний вивід перевірки) — дешевше й точніше, ніж новий rung з fresh-сесією + feedback-параграфом у промпті. Драбина зовні незмінна: вичерпаний verify-loop = звичайний фейл rung-а.
- Бюджет: verify-ітерації живуть під наявними `timeoutMs` rung-а і turn-ceiling (нових taймерів не вводимо; [[fail-fast-over-waiting]]).

### 2.2 Hash-anchored edits — власна реалізація, не залежність

`pi-hashline-edit-pro` — референс (MIT, peer `@earendil-works/pi-coding-agent ≥0.74` сумісний), але тягнемо патерн, не пакет: наш обсяг — 2 tools, чуже ядро 0.16.x зі своїм read/replace-воркфлоу і зайвими deps (file-type, diff) — security-ревʼю дорожче за реімплементацію.

Новий `lib/anchored-edit.mjs` (~150 рядків + тести):

- `read_anchored {path, range?}` → рядки з якорями: `a3f|42|const x = 1` (якір = перші 3 base36-символи xxhash(вміст рядка + номер); собі xxhash уже транзитивно є, інакше — `node:crypto` sha1-префікс, вирішується на імплементації).
- `edit_anchored {path, edits: [{anchor, line, newText}]}` — застосовується ЛИШЕ якщо якір збігається з поточним вмістом рядка; будь-який mismatch → structured error `stale anchor, re-read` без часткового застосування (атомарно на файл). Жодного fuzzy-match/автокорекції.
- Вмикається профілем: `edits: 'anchored'` → toolset `read_anchored/edit_anchored` замість built-in `edit` (built-in `write` лишається для нових файлів, під write-guard як зараз).
- **Гіпотеза для A/B:** anchored піднімає точність cloud і топить слабку 4B (протокол складніший за oldText/newText). Тому дефолт: `anchored` лише для cloud-тирів; вимірюється наявним `tier-sampling-bench.mjs` до зміни дефолтів.

### 2.3 Web-access — мінімальне ядро, лише cloud-профілі

Новий `lib/web-tools.mjs`:

- `web_search {query}` — один настроюваний провайдер (порядок: `N_LLM_SEARCH_PROVIDER` → перший наявний ключ із `BRAVE_API_KEY`/`TAVILY_API_KEY`/`EXA_API_KEY`), без fallback-ланцюгів pi-web-access (це його складність і поверхня довіри).
- `web_fetch {url}` — fetch → readability-екстракція → markdown, ліміт розміру відповіді; блок non-http(s) і приватних адрес (SSRF-guard).
- Вмикається профілем `web: true`; фікс-профілі local — ніколи. Телеметрія: webCalls у trace.

### 2.4 `createHarness` — тонкий фасад над наявними раннерами

Новий `lib/harness.mjs`, БЕЗ ламання наявних exports:

```js
const harness = createHarness({ profiles })       // profiles — декларативний JSON
await harness.run({ kind: 'fix', profile: 'fix-cloud', ruleId, violation, cwd, verify, targetFiles, chain })
```

- Профіль = `{ tools?, edits: 'anchored'|'builtin', web: false, tier|model, timeoutMs, turnCeiling?, verifyMax }` — серіалізований у JSON, щоб Фаза B мапила `a.md` (model_tier/skills) → профіль без коду.
- Усередині — делегація в `runAgentFix` (kind: fix) / `runAgentSkill` (kind: skill) / `runOneShot` (kind: one-shot); фабрика сесії виноситься в `lib/internal/session-factory.mjs` (параметризована toolset-ом/anchored/web), `defaultCreateSession` обох раннерів стають її викликами.
- Наявні прямі імпорти працюють без змін; harness — новий рекомендований вхід, міграція споживачів — поступова. Мапа споживачів (розвідка 2026-07-11): cursor — `lint-surface/{run-fix,default-worker,tier-sampling-bench}.mjs`, `adr/normalize-pipeline.mjs`, `docgen-{gen,judge}`, `cspell-fix`, `skills-cli`; 7n-test — адаптер `npm/src/lib/llm.mjs` (runOneShot/runAgentSkill) + `coverage-classify`, `coverage-fix`, `fix-tests`, `gen-tests` (model-tiers/chain/prompt-budget).
- Нові subpath-exports у `llm-lib/package.json`: `./harness` (публічний), `./anchored-edit` і `./web-tools` — публічні лише якщо consumer захоче standalone-використання, інакше wiring через `internal/session-factory.mjs`; pi лишається optional peerDependency `~0.80.2` (нових hard-deps не додаємо).

## 3. Порядок реалізації (підфази, кожна мержиться окремо)

1. **A1 — verify-loop у `runAgentFix`** (opts.verify + verifyMax + телеметрія verifyAttempts; wiring у cursor `default-worker.mjs`: ctx.verify з item-scoped детектора). Найменший diff, найбільший очікуваний приріст pass-rate. Вимір: `tier-sampling-bench` до/після.
2. **A2 — `anchored-edit.mjs`** + профільне вмикання + A/B на bench (cloud-тири). Дефолт міняється лише за результатами.
3. **A3 — `web-tools.mjs`** (cloud-профілі; перший споживач — правила з зовнішнім знанням: ga pin-перевірки, taze-подібні).
4. **A4 — `harness.mjs` + `session-factory.mjs`** (фасад + профілі; рефактор defaultCreateSession обох раннерів на спільну фабрику). Після A4 — Фаза B (адаптер MT) говорить лише з harness.

Кожна підфаза: vitest (scripted provider seam уже канон), doc-files (`lib/docs/<stem>.md`), lint.

## 4. Ризики

- **Verify-loop роздуває wall-time рунга** на повільній локальній 4B → verifyMax=1 для local-тирів (конфіг профілю), 2 для cloud.
- **Anchored-протокол заскладний для 4B** — очікувано; тому cloud-only дефолт і bench-гейт перед розширенням.
- **Web-tools = нова поверхня довіри** (SSRF, prompt-injection через сторінки) → allowlist схем/адрес, розмір-ліміт, web лише в cloud-профілях, вміст сторінок у промпт іде як tool-result (pi tool-результати вже не інструкції системного рівня).
- **Рефактор session-factory (A4)** зачіпає обидва раннери → лишається останнім, після стабілізації A1-A3.

## Відкриті питання

- Хеш для якорів: xxhash-wasm (транзитивно?) чи `node:crypto`-префікс — вирішити на A2 за фактичним deps-деревом.
- Чи давати `verify`-петлі право на `bash` для прогону тестів у fix-профілях (зараз fix-toolset без bash) — відкладено, поки не зʼявиться правило, якому це потрібно.
- Формат profile-JSON: чи version-нути схему одразу (Фаза B захоче стабільності) — схилятись до `schema_version: 1` з дня 1.
