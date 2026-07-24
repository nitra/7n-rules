---
type: Rust Module
title: transport.rs
resource: llm-lib/crates/llm-lib/src/acp/transport.rs
docgen:
  crc: 9052b466
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  issues: judge:error
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Спільний ACP-шар готує запуск агента, створює його специфікацію та веде один prompt-хід через потік подій із захистом від зависання між update-read. Він існує як єдина основа для session-API й one-shot-фасаду, щоб обидва отримували однаковий handshake `initialize` → `session/new`, progress-логування через `summarize_update` / `N_LLM_ACP_VERBOSE`, auto-approve через `pick_auto_permission_option` та типізовані помилки [`LlmError`].

## Поведінка

`build_acp_args` формує запуск ACP-агента з env-префіксів, базової команди й додаткових аргументів; `spec_for` передає цей результат у створення спеки агента та переводить помилку провайдера в типізовану помилку крейта.

`idle_timeout` задає межу тиші між ACP-подіями. `drive_turn` читає потік через `AcpSessionUpdates`, скидає цей ліміт на кожній отриманій події й завершує хід лише після фінальної причини зупинки або помилки тиші.

Усі події ходу проходять через `drive_turn`: текст агента віддається викликачу без progress-логу, службові події стискаються через `summarize_update` і пишуться як короткий progress-сигнал. `acp_verbose` перемикає цей режим на повний діагностичний вивід.

`pick_auto_permission_option` забезпечує non-interactive дозвіл для one-shot потоку: обирає найбезпечніший доступний allow-варіант за пріоритетом, а за його відсутності повертає fallback або порожнє значення для порожнього списку.

`AcpSessionUpdates` відокремлює `drive_turn` від конкретної реалізації активної ACP-сесії, щоб один і той самий цикл читання, timeout-захист і progress-логування використовувалися session-фасадом, one-shot-фасадом і тестовими сесіями.

## Публічний API

- idle_timeout — Idle-timeout — без жодної `session/update`-події від агента, не загальна тривалість ходу (реальний хід законно триває довго, поки регулярно щось відбувається). Захист від протокольного/агентського зависання: без нього відсутність відповіді на `session/request_permission` чи будь-яка інша тиша висить назавжди (саме так провалився живий прогін `skill codex taze` до фіксу дозволів — 57+ хвилин без жодного виводу). Override: `N_LLM_ACP_IDLE_TIMEOUT_MS`.
- build_acp_args — Компонує argv, який очікує `AcpAgent::from_args`: спершу `NAME=value` env-префікси, тоді слова базової команди, тоді extra-args. Той самий контракт, що й `build_acp_args` у `tauri-plugin-agent` (env-first, бо `AcpAgent::from_args` трактує будь-які провідні `NAME=value`-елементи як env, зупиняючись на першому, що ним не є).
- spec_for — `AcpAgent`-спека для базової команди `command` з опційними тір-`env`/ extra-`args` (тір-пресети, T3). Порожні `extra_args`/`extra_env` дають точно ту саму спеку, що й колишній `AcpAgent::from_str(command)`.
- pick_auto_permission_option — Обирає варіант дозволу без участі людини: `AllowAlways` > `AllowOnce` > перший зі списку. Без цього хендлера `session/request_permission` лишається без відповіді — агент, дійшовши до першого tool-call (bash/edit), зависає назавжди в очікуванні (протокольний deadlock, не мережева/spawn-помилка). Full-trust one-shot виклик — дозволи не питаються інтерактивно (паритет із колишнім `pickAutoPermissionOptionId` у JS-шимі й офіційним `yolo_one_shot_client`-прикладом крейта).
- acp_verbose — Чи друкувати повний `{:?}`-дамп кожної non-text ACP-події замість одного короткого рядка. За замовчуванням (як `lint` без `--verbose`) — тихо: `ToolCall`/`ToolCallUpdate` несуть `raw_input`/`raw_output` (повний JSON параметрів/результату інструменту), і на прогоні `taze` з багатьма пакетами це затоплювало stderr. Override: `N_LLM_ACP_VERBOSE=1`.
- summarize_update — Один короткий рядок для non-text ACP-події — без `raw_input`/`raw_output` інструментів і без тексту чанків `AgentThoughtChunk`/`UserMessageChunk` (стрім по токенах). `N_LLM_ACP_VERBOSE=1` (`acp_verbose()`) повертає повний `{:?}` замість цього — для діагностики зависань/протокольних аномалій.
- drive_turn — Читає events одного prompt-ходу до `StopReason`, з `idle_timeout` на кожне окреме читання (а не на весь хід разом — це і є "видимість": не- текстові події (`tool_call`/`plan`/…) логуються в stderr замість мовчазного відкидання (за замовчуванням — одним коротким рядком, `N_LLM_ACP_VERBOSE=1` — повним `{:?}`), і саме кожна така подія скидає таймер — реальний прогрес не зупиняє годинник, зупиняє лише справжня тиша). Текстові `AgentThoughtChunk`/`UserMessageChunk` не логуються зовсім (лише скидають таймер) — потокенний стрім думок агента інакше затоплював stderr.  `on_update` отримує кожен `SessionUpdate` (текстові шматки включно) — викликач вирішує, що з ним робити: акумулювати текст ([`super::one_shot_acp`]) чи передати подію зовнішньому каналу ([`super::session`]). Повертає фінальний `StopReason` ходу.
- AcpSessionUpdates — Мінімальний зріз `ActiveSession`, потрібний для idle-timeout-читання — узагальнено, щоб уникнути повного generic-підпису `ActiveSession<'_, Link>` у сигнатурі [`drive_turn`]. `pub(crate)` — і [`super::session`], і `#[cfg(test)]`-фейки реалізують/використовують цю абстракцію.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.
