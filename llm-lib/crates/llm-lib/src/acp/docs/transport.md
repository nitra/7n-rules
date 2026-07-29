---
type: Rust Module
title: transport.rs
resource: llm-lib/crates/llm-lib/src/acp/transport.rs
docgen:
  crc: 8dd90870
  model: omlx/gemma-4-e2b-it-4bit
  tier: local-min
  score: 90
---

## Огляд

Спільний спавн/init/session-шар для всіх ACP-фасадів крейта.  Портовано зі скелету `tauri-plugin-agent/src/acp/mod.rs` (`build_acp_args`, handshake `initialize` → `session/new`), але без Tauri-специфіки (`AppHandle`/`Emitter`/`State`) і з обов'язковою операційною бронею cascade, якої плагін не мав: semantic idle-timeout, `summarize_update`/`N_LLM_ACP_VERBOSE` progress-логування, типізований [`LlmError`] замість `String`.  Обидва фасади крейта йдуть через нього: [`super::session::create_session`] напряму (публічний session-API: create/prompt/update-стрім/зовнішній permission-responder/cancel), а [`super::one_shot_acp`] — уже поверх `session`, як тонкий фасад (один prompt + auto-approve + акумуляція тексту, задача T2). Спільний [`drive_turn`] дає обом idle-timeout- читання й progress-логування одного prompt-ходу.

## Поведінка

idle_timeout повертає тривалість часу для ігнорування затримки при роботі з сесією.
build_acp_args компілює аргументи команд для формування викликів.
spec_for створює спеку для об'єкта агента.
pick_auto_permission_option вибирає ідентифікатор дозволу без участі людини.
acp_verbose визначає, чи слід друкувати детальний лог.
log_line надсилає рядок у потік логування.
acp_progress_enabled перевіряє, чи доступно логування прогресу.
summarize_update генерує короткий рядок з оновлення сесії.
drive_turn керує циклом читання оновлень сесії до визначеного ліміту.
AcpSessionUpdates визначає інтерфейс для читання оновлень сесії.

## Публічний API

- idle_timeout — Semantic idle-timeout — без нового tool-call або agent output, не загальна тривалість ходу. Usage/thought/config/tool-update шум не подовжує deadline, тому завислий агент не може жити вічно лише завдяки progress events. Захист також зупиняє повну протокольну тишу. Override: `N_LLM_ACP_IDLE_TIMEOUT_MS`.
- build_acp_args — Компонує argv, який очікує `AcpAgent::from_args`: спершу `NAME=value` env-префікси, тоді слова базової команди, тоді extra-args. Той самий контракт, що й `build_acp_args` у `tauri-plugin-agent` (env-first, бо `AcpAgent::from_args` трактує будь-які провідні `NAME=value`-елементи як env, зупиняючись на першому, що ним не є).
- spec_for — `AcpAgent`-спека для базової команди `command` з опційними тір-`env`/ extra-`args` (тір-пресети, T3). Порожні `extra_args`/`extra_env` дають точно ту саму спеку, що й колишній `AcpAgent::from_str(command)`.
- pick_auto_permission_option — Обирає варіант дозволу без участі людини: `AllowAlways` > `AllowOnce` > перший зі списку. Без цього хендлера `session/request_permission` лишається без відповіді — агент, дійшовши до першого tool-call (bash/edit), зависає назавжди в очікуванні (протокольний deadlock, не мережева/spawn-помилка). Full-trust one-shot виклик — дозволи не питаються інтерактивно (паритет із колишнім `pickAutoPermissionOptionId` у JS-шимі й офіційним `yolo_one_shot_client`-прикладом крейта).
- acp_verbose — Чи друкувати повний `{:?}`-дамп кожної non-text ACP-події замість одного короткого рядка. За замовчуванням (як `lint` без `--verbose`) — тихо: `ToolCall`/`ToolCallUpdate` несуть `raw_input`/`raw_output` (повний JSON параметрів/результату інструменту), і на прогоні `taze` з багатьма пакетами це затоплювало stderr. Override: `N_LLM_ACP_VERBOSE=1`.
- log_line — Неблокуюче логування ACP-шляху — заміна прямого `eprintln!` у tokio-задачах сесії (див. [`log_sender`]).
- acp_progress_enabled — Чи друкувати короткі non-text ACP progress events. Оркестратори з власним progress UI можуть вимкнути дубльований stderr через `N_LLM_ACP_PROGRESS=0`; verbose завжди має пріоритет.
- summarize_update — Один короткий рядок для non-text ACP-події — без `raw_input`/`raw_output` інструментів і без тексту чанків `AgentThoughtChunk`/`UserMessageChunk` (стрім по токенах). `N_LLM_ACP_VERBOSE=1` (`acp_verbose()`) повертає повний `{:?}` замість цього — для діагностики зависань/протокольних аномалій.
- drive_turn — Читає events одного prompt-ходу до `StopReason`, з semantic `idle_timeout`: deadline скидають лише новий tool-call або текст/контент відповіді агента. Usage/thought/config/tool-update events логуються за чинною progress-політикою, але не можуть тримати завислий хід живим.  `on_update` отримує кожен `SessionUpdate` (текстові шматки включно) — викликач вирішує, що з ним робити: акумулювати текст ([`super::one_shot_acp`]) чи передати подію зовнішньому каналу ([`super::session`]). Повертає фінальний `StopReason` ходу.
- AcpSessionUpdates — Мінімальний зріз `ActiveSession`, потрібний для idle-timeout-читання — узагальнено, щоб уникнути повного generic-підпису `ActiveSession<'_, Link>` у сигнатурі [`drive_turn`]. `pub(crate)` — і [`super::session`], і `#[cfg(test)]`-фейки реалізують/використовують цю абстракцію.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
- Кешує результати в межах одного прогону.
