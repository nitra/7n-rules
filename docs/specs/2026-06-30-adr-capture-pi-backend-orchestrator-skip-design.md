# Spec: ADR capture — pi як перший бекенд + skip оркестраторних сесій

**Дата:** 2026-06-30
**Статус:** Draft
**Тип:** Non-breaking — нова поведінка за наявності `pi`, існуючий `claude`-шлях не змінюється

---

## Проблема

Два незалежних болі в `capture-decisions.sh`:

**1. Оркестраторні сесії потрапляють у capture.**
`npx @nitra/cursor lint`, `/n-lint`, `/n-doc-files` та інші JS-оркестровані активності запускають Claude-сесію і породжують транскрипт. Stop hook розцінює їх як звичайні сесії та викликає LLM щоб витягти рішення. Рішень там немає — це технічний шум, а не людська думка.

**2. `claude` CLI як єдиний бекенд з фіксованим пріоритетом.**
`capture-decisions.sh` вибирає бекенд жорстко: `claude` → `cursor-agent` → skip. Немає можливості використати `pi` (локальну модель через omlx) без правки скрипту. При нульовому балансі claude — capture повністю мовчить.

---

## Рішення

### Частина A — `ADR_CAPTURE_SKIP`: флаг оркестраторних сесій

JS-оркестратор (`npm/bin/n-cursor.js`) виставляє env-змінну **до** будь-якого запуску дочірнього процесу, що може породити сесію:

```js
process.env.ADR_CAPTURE_SKIP = '1'
```

`capture-decisions.sh` перевіряє на початку (одразу після recursion guard):

```bash
if [[ -n "${ADR_CAPTURE_SKIP:-}" ]]; then
  exit 0
fi
```

**Де виставляти в JS** — у точках входу оркестратора (всі `case`-гілки `n-cursor.js` що запускають реальну роботу): `lint`, `hook`, `adr-normalize-local`, `skill`, `doc-aggregate`, `taze`, `release`. Найчистіше — один виклик на початку `main()` перед `switch (command)`.

**Normalize не чіпаємо.** `normalize-decisions.sh` має власний `ADR_NORMALIZE_RUNNING` recursion guard і threshold. Оркестраторний запуск normalize (через `adr-normalize-local`) вже захищений тим що він не породжує нової Claude-сесії.

**pi-extension (`npm/.pi-template/extensions/n-cursor-adr/index.ts`) вже перевіряє `CAPTURE_DECISIONS_RUNNING` і `ADR_NORMALIZE_RUNNING`** — `ADR_CAPTURE_SKIP` додаємо поряд у тому ж guard-блоці.

---

### Частина B — `pi` як перший бекенд у capture

#### Новий пріоритет бекендів

```
pi (local omlx) → skip
```

`claude` і `cursor-agent` **прибираємо** з capture. Якщо `pi` недоступний або повернув порожньо → `exit 0` (тихий skip, не помилка).

**Ратіонал:** capture — найменш критичний процес (чернетки, не кінцеві ADR). Краще не зловити рішення, ніж витратити хмарний баланс і сповільнити сесію. Локальна модель достатня для витягнення заголовків і контексту.

#### Вибір pi-бінарника

```bash
PI_CMD="${PROJECT_ROOT}/node_modules/.bin/pi"
if [ ! -x "$PI_CMD" ]; then
  PI_CMD="$(command -v pi 2>/dev/null || true)"
fi
if [ -z "$PI_CMD" ]; then
  log "  → pi not found, skipping capture"
  exit 0
fi
```

Пріоритет: npm-локальна версія (`node_modules/.bin/pi`) → системна (`which pi`) → skip.

#### Виклик

```bash
CAPTURE_PI_MODEL="${CAPTURE_DECISIONS_PI_MODEL:-omlx/gemma-4-e4b-it-OptiQ-4bit}"

log "  → using pi (model: $CAPTURE_PI_MODEL)"
RESPONSE=$(printf '%s' "$PROMPT_FULL" \
  | "$PI_CMD" -p \
      --no-context-files \
      --model "$CAPTURE_PI_MODEL" \
  2>>"$LOG" || true)
```

`--no-context-files` — обов'язково: без нього `pi` підтягне `AGENTS.md`/`CLAUDE.md` і забруднить контекст capture-промпту.

Модель перемикається через `CAPTURE_DECISIONS_PI_MODEL` (аналогічно `CAPTURE_DECISIONS_CLAUDE_MODEL`).

#### Поведінка при порожній відповіді

```bash
if [[ -z "$RESPONSE_TRIMMED" ]]; then
  log "  → empty response from pi"
  exit 0
fi
```

Без fallback. Логіка валідації відповіді (`NONE`, перевірка `## `) — без змін.

---

## Зміни по файлах

| Файл                                                           | Зміна                                                      |
| -------------------------------------------------------------- | ---------------------------------------------------------- |
| `npm/bin/n-cursor.js`                                          | `process.env.ADR_CAPTURE_SKIP = '1'` на початку `main()`   |
| `.claude/hooks/capture-decisions.sh`                           | guard `ADR_CAPTURE_SKIP` + pi-бекенд замість claude/cursor |
| `npm/.pi-template/extensions/n-cursor-adr/index.ts`            | `env.ADR_CAPTURE_SKIP` у recursion guard                   |
| `npm/rules/adr/tests/capture-decisions-cross-project.test.mjs` | тест що оркестраторна сесія скіпається                     |

`normalize-decisions.sh` і `lib/tooling-only.sh` — **не змінюємо**.

---

## ENV-змінні (нові)

| Змінна                       | Дефолт                           | Опис                                          |
| ---------------------------- | -------------------------------- | --------------------------------------------- |
| `ADR_CAPTURE_SKIP`           | —                                | Якщо виставлено — capture-хук одразу виходить |
| `CAPTURE_DECISIONS_PI_MODEL` | `omlx/gemma-4-e4b-it-OptiQ-4bit` | Модель для pi-бекенду                         |

---

## Що НЕ змінюється

- `normalize-decisions.sh` — бекенди, логіка, ENV
- `lib/tooling-only.sh` — файловий фільтр лишається як додатковий захист
- `ADR_CAPTURE_SKIP_CROSS_PROJECT` — cross-project guard лишається
- Формат чернеток (`session:` frontmatter), slug-генерація, запис файлів

---

## Відкриті питання

- Чи варто `ADR_CAPTURE_SKIP` логувати у `capture-decisions.log` (для діагностики) чи виходити мовчки як recursion guard?
- Чи потрібен тест що перевіряє саме pi-виклик (mock), чи достатньо інтеграційного тесту зі справжнім pi?
