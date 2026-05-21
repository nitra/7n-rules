# Автоматичне захоплення рішень через Stop-хук Claude Code — виправлення початкових багів

**Status:** Accepted
**Date:** 2026-05-05

## Контекст

Команда впровадила Stop-хук (`async: true`, timeout 180s) у `.claude/settings.local.json`, що запускає `.claude/hooks/capture-decisions.sh` для автоматичного збереження ADR/Runbook/Knowledge-чернеток із транскриптів сесій Claude Code. Початкова реалізація повертала NONE на всі реальні сесії.

## Рішення/Процедура/Факт

Виявлено та виправлено три root-cause баги:

1. **`claude --bare` не читає OAuth-авторизацію** — лише `ANTHROPIC_API_KEY` → порожня відповідь виглядала як NONE. Виправлення: прибрати `--bare`.
2. **jq-екстракт пропускав `thinking` і `tool_use`** — модель бачила майже порожню сесію і правомірно повертала NONE. Виправлення: додати витяг блоків `thinking` та назв `tool_use`-блоків.
3. **grep-фільтр перевіряв `^## \[`** (з квадратними дужками), а модель генерує `## ADR Title` без них → всі валідні відповіді відкидались. Виправлення: змінити фільтр на `^##`.

Додаткові виправлення:
- Модель перемкнуто з haiku (надто консервативний) на sonnet.
- Апостроф у тексті промпту всередині `$(…heredoc…)` ламав bash-парсинг — замінено на безапострофні конструкції.
- Рекурсію зупиняє env-var `CAPTURE_DECISIONS_RUNNING=1`.

## Обґрунтування

Кожен із трьох основних багів унеможливлював роботу хука самостійно: відсутність авторизації давала порожні відповіді, відсутність `thinking`/`tool_use` у контексті робила сесію беззмістовною для LLM, а неправильний grep відкидав усі валідні відповіді.

## Розглянуті альтернативи

`asyncRewake` замість `async` — відхилено (потреби у зворотному зв'язку немає); `--bare` для уникнення рекурсії — не працює з OAuth; haiku-модель — виявилась надто консервативною для класифікації рішень.

## Зачіпає

`.claude/hooks/capture-decisions.sh`, `.claude/settings.local.json`, `docs/adr/_inbox/` (вихідний каталог чернеток).

## Update 2026-05-20

### Підтримка двох форматів JSONL: Claude Code (`.type`) та Cursor Agent (`.role`)

`capture-decisions.sh` парсив transcript лише за полем `.type` (`{"type":"user",...}`) — формат Claude Code. Cursor Agent записує рядки у форматі `{"role":"user",...}`. Коли хук отримував Cursor-transcript, `jq`-фільтр повертав 0 байт і скрипт виходив мовчки без виклику LLM.

Chosen option: "Підтримувати обидва поля в одному `select`-вираженні", because сесії Claude Code й Cursor Agent генерують різний JSONL, а одна умова `select` охоплює обидва випадки без гілки коду.

```jq
select(
  .type == "user" or .type == "assistant"
  or .role == "user" or .role == "assistant"
)
```

- Good, because після виправлення capture для сесії Cursor Agent (`5b23f892`) успішно записав `docs/adr/20260520-085803-зворотний-звязок-зі-скілів-через-зворотний-канал-у-nitra-cur.md`.
- Bad, because transcript не містить підтверджених негативних наслідків.

Додано лог-рядок `empty transcript after jq (Claude Code: .type; Cursor Agent: .role)` для діагностики. Змінені файли: `npm/.claude-template/hooks/capture-decisions.sh` (канон), `.claude/hooks/capture-decisions.sh` (проєктна копія). Баг проявлявся лише в Cursor Agent-сесіях — сесія Claude Code (369795cd, 08:40) успішно створила ADR і проблеми не виявляла.

## Update 2026-05-20

### Розташування transcript-файлів за типом агента

- Cursor Agent: `~/.cursor/projects/<project>/agent-transcripts/<session-id>/*.jsonl`
- Claude Code: `~/.claude/projects/<project>/<session-id>.jsonl`

Ці шляхи є діагностичним орієнтиром при зборі transcript вручну або при налагодженні хука.
