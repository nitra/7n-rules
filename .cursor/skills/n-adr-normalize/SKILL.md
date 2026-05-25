---
name: n-adr-normalize
description: >-
  Ручний запуск ADR-нормалізації — обхід порогу й min-interval, прогон одного
  батчу чернеток через LLM, перегляд результату через git diff
---

# n-adr-normalize — ручна нормалізація ADR-чернеток

Скіл запускає `.claude/hooks/normalize-decisions.sh` поза звичайним Stop-hook-тригером. Корисно, коли:

- Поріг `ADR_NORMALIZE_THRESHOLD` ще не досягнуто, але хочеш почистити inbox.
- Минулого разу LLM відмовився, тепер минув ще не весь `ADR_NORMALIZE_MIN_INTERVAL_HOURS` — хочеш повторити одразу.
- Спочатку треба побачити, що саме LLM зробить (`ADR_NORMALIZE_DRY=1`).

## Передумови

- Правило `adr` увімкнене у `.n-cursor.json` (`"adr"` у `rules`).
- `.claude/hooks/normalize-decisions.sh` існує (`npx @nitra/cursor` поклав його сюди).
- У `PATH` доступний `claude` або `cursor-agent` (інакше скрипт мовчки вийде).
- У `docs/adr/` є чернетки — файли з `session: …` у YAML frontmatter.

## Кроки

1. **Dry-run** (не міняє файли, лише пише план у `.claude/hooks/normalize-decisions.log`):

   ```bash
   ADR_NORMALIZE_THRESHOLD=0 \
   ADR_NORMALIZE_MIN_INTERVAL_HOURS=0 \
   ADR_NORMALIZE_DRY=1 \
     bash .claude/hooks/normalize-decisions.sh
   ```

   Потім переглянь план: `tail -100 .claude/hooks/normalize-decisions.log`.

2. **Реальний прогон одного батчу** (за замовчуванням до 30 чернеток):

   ```bash
   ADR_NORMALIZE_THRESHOLD=0 \
   ADR_NORMALIZE_MIN_INTERVAL_HOURS=0 \
     bash .claude/hooks/normalize-decisions.sh
   ```

3. **Перегляд результату** — скрипт нічого не комітить:

   ```bash
   git status docs/adr/
   git diff docs/adr/
   ```

   Видалені файли — `delete`-операція. Нові файли `<timestamp>-<slug>.md` (timestamp-префікс чернетки збережено) — `rewrite`. Модифіковані clean-файли — `merge-into`.

4. **Прийняти / відкотити:**
   - Прийняти все: `git add docs/adr/ && git commit -m "adr: normalize batch"`.
   - Відкотити конкретний файл: `git checkout -- docs/adr/<file>` (для `rewrite` цього мало — треба ще `git restore --staged` і `rm` нового).
   - Відкотити весь батч: `git checkout -- docs/adr/ && git clean -f docs/adr/` (видалить і untracked rewrite-результати).

5. **Повторити для наступного батчу**, якщо чернеток ще багато. Кожен запуск обробляє до `ADR_NORMALIZE_BATCH` файлів (default 10, найстарші за часовою позначкою у назві).

## Tuning через ENV

- `ADR_NORMALIZE_BATCH=30` — більший батч (менше викликів LLM, більше токенів за раз).
- `ADR_NORMALIZE_MODEL=opus` — інша модель `claude -p`.
- `ADR_NORMALIZE_CURSOR_MODEL=…` — інша модель для cursor-agent fallback.
- `ADR_NORMALIZE_SKIP_TOOLING_ONLY=0` — вимкнути structural skip для tooling-only сесій (default `1`). Корисно лише якщо хочеш зберегти чернетки навіть для правок у `.cspell.json` / `CHANGELOG.md` / `version`-bump-ів.

## Якщо щось пішло не так

- LLM повернув криву JSON → у логу буде `invalid JSON response (first 200 chars): …`. Запусти ще раз — нерідко це разовий збій.
- Скрипт виходить миттєво без логу → перевір `ADR_NORMALIZE_RUNNING` у env (recursion guard) і чи репо не у стані merge/rebase.
- Перейменування зробило дублі імен (`<timestamp>-<slug>-2.md`) → це нормально, скрипт детермінований; під час review можна обʼєднати руками й видалити `-2`.
- ADR-чернетки видаляються мовчки → це structural tooling-only skip. Перевір лог: `tail .claude/hooks/normalize-decisions.log | grep tooling-only`. Для діагностики на capture-стороні: `tail .claude/hooks/capture-decisions.log | grep tooling-only`. Аби тимчасово вимкнути — `ADR_NORMALIZE_SKIP_TOOLING_ONLY=0 bash .claude/hooks/normalize-decisions.sh`.
