---
session: ce241b83-2df1-4d44-a9d8-959a5dfb611f
captured: 2026-06-06T21:08:39+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/ce241b83-2df1-4d44-a9d8-959a5dfb611f.jsonl
---

## ADR Adaptive thinking замість ручного extended thinking на Opus/Sonnet 4.6+

## Context and Problem Statement
Механізм `thinking: {type: "enabled", budget_tokens: N}` вимагав від розробника вручну задавати жорсткий ліміт токенів на розмірковування. На Opus 4.6 і Sonnet 4.6 цей підхід оголошено deprecated; на Opus 4.7 і новіших він повертає 400.

## Considered Options
* Зберегти `budget_tokens` з фіксованим лімітом (ручний extended thinking)
* Замінити на `thinking: {type: "adaptive"}` з керуванням глибиною через `effort`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Замінити на `thinking: {type: "adaptive"}`", because adaptive thinking на внутрішніх оцінках перевершує ручний extended thinking, а модель сама вирішує, коли і скільки думати — без ризику перевитрат токенів через неправильно вибраний `budget_tokens`.

### Consequences
* Good, because transcript фіксує очікувану користь: adaptive thinking вмикає interleaved thinking автоматично (beta-заголовок `interleaved-thinking-2025-05-14` більше не потрібен); глибина контролюється через `effort` (`low`/`medium`/`high`/`xhigh`/`max`), що зручніше за ручний підбір токенів.
* Bad, because transcript не містить підтверджених негативних наслідків. Перехідна підтримка `budget_tokens` поряд із `effort` збережена на 4.6 як короткострокове escape hatch для поступової міграції.

## More Information
Файли зачіпаються: будь-який файл із `client.messages.create()` або `client.beta.messages.create()` з параметром `thinking`. Команда: `thinking={"type": "adaptive"}` + `output_config={"effort": "high"}`. Beta-заголовок `interleaved-thinking-2025-05-14` видаляється при переході на adaptive. На Opus 4.7+: `thinking: {type: "enabled", budget_tokens: N}` → 400, поле `budget_tokens` видаляється повністю.

---

## ADR Видалення sampling-параметрів на Opus 4.7+

## Context and Problem Statement
Параметри `temperature`, `top_p`, `top_k` використовувалися для управління варіативністю і «детермінованістю» відповідей. На Claude Opus 4.7 і новіших усі три параметри повертають 400 — вони більше не приймаються API.

## Considered Options
* Залишити sampling-параметри як на попередніх моделях
* Видалити `temperature`/`top_p`/`top_k`; перенести управління стилем у prompt
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Видалити `temperature`/`top_p`/`top_k` і перенести управління поведінкою у prompt", because prompting є рекомендованим способом впливати на поведінку Opus 4.7, а `temperature = 0` ніколи не гарантувало ідентичних відповідей на попередніх моделях.

### Consequences
* Good, because transcript фіксує очікувану користь: спрощення API-контракту; `effort: "low"` разом із чіткіше сформульованим prompt замінює `temperature = 0` для сценаріїв, де потрібна менша варіативність.
* Bad, because creative-variance сценарії потребують рефакторингу prompt — transcript рекомендує pattern «propose 4 visual directions» для frontend/design-завдань замість `temperature`-based варіативності.

## More Information
Стосується Opus 4.7 і Opus 4.8 (Sonnet/Haiku не згадані як такі, що забороняють ці параметри на відповідних версіях). Кандидати на заміну: `effort: "low"` для детермінованості; явні prompt-інструкції (`"Vary your phrasing and structure across responses"`) для варіативності. Перевіряється через 400 під час першого тестового запиту.

---

## ADR Видалення assistant-turn prefills на 4.6-сім'ї, заміна на structured outputs

## Context and Problem Statement
Практика завершувати масив `messages` записом `{role: "assistant", content: "..."}` використовувалася для примусового форматування виводу (JSON, YAML), пропуску преамбул і обходу небажаних відмов. На Opus 4.6, Sonnet 4.6, Opus 4.7 і Opus 4.8 такий prefill повертає 400.

## Considered Options
* Залишити підтримку last-assistant-turn prefills
* Видалити prefills; замінити на `output_config.format` (structured outputs) і системно-промптові інструкції
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Видалити prefills і замінити на `output_config.format` + system-prompt instructions", because 4.6-сім'я відмовляє значно коректніше, ніж попередні моделі, тому обхід через prefill більше не потрібен; структуровані виходи через `json_schema` надають надійніший контракт, ніж ручне примусове форматування через prefill.

### Consequences
* Good, because transcript фіксує очікувану користь: structured outputs (`output_config: {format: {type: "json_schema", schema: ...}}`) гарантують валідний JSON без хаків; system-prompt-інструкції (`"Respond directly without preamble"`) покривають усі інші сценарії.
* Bad, because continuation-сценарії (відновлення перерваної відповіді) потребують рефакторингу: переміщення `[last text]. Continue from there.` у user-turn.

## More Information
Таблиця замін у transcript охоплює: JSON/YAML форматування → `output_config.format`; пропуск преамбул → system-prompt інструкція; небажані відмови → не потрібні (4.6 відмовляє точніше); continuation → user-turn. Параметр `output_format` (top-level) deprecated API-wide незалежно від моделі — замінюється на `output_config.format`.
