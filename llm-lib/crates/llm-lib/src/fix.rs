//! Власний агентний цикл контуру `fix` — клас 3 спеки
//! `2026-08-08-llm-lib-acp-only-rust-goose.md` (§3.7), двигун — `rig-agent`
//! (§3.8: спайк підтвердив кодом усі шість вимог класу).
//!
//! Чому власний цикл, а не зовнішній ACP-агент: контур `fix` вимагає гарантій,
//! яких чужий coding-агент не дає принципово — порожній allowlist інструментів
//! (жодного shell), перехоплення КОЖНОГО запису до побічного ефекту з
//! pre-image і повним editLog (корпус дистиляційного маховика), анкерний
//! протокол замість fuzzy-редагування, verify-петля з інʼєкцією канонічної
//! перевірки в ту саму сесію.
//!
//! Розподіл відповідальності: rig дає механіку ходів і хуки, а поведінку
//! задаємо ми — [`crate::write_guard`] (межа запису), [`crate::anchored_edit`]
//! (протокол правок), [`tools`] (рівно дозволений набір інструментів),
//! [`runner`] (складання циклу, бюджети, verify-петля).

/// Інструменти циклу — рівно дозволений набір, жодного shell.
pub mod tools;

/// Складання агента, хуки (write-guard veto, editLog, verify-петля,
/// chain-заголовки, per-turn maxTokens) і запуск ходу.
pub mod runner;

use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use crate::tiers::Tier;
use crate::write_guard::EditRecord;

/// Boxed-future для інʼєктованих залежностей (перевірка/AST-факти) —
/// консюмер (lint-surface) дає власну асинхронну реалізацію.
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Режим редагування (порт `editMode` з `agent-fix.mjs`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EditMode {
    /// `targetFiles` — єдині файли, які дозволено редагувати.
    Generic,
    /// Джерельні файли read-only; редагувати можна лише `*.test.*`.
    TestGeneration,
}

/// Чому цикл зупинився. `stopReason` синтезуємо самі — у rig такого поняття
/// немає (§3.8), а зовнішній abort через drop future не повідомляє причини.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StopReason {
    /// Модель завершила хід і канонічна перевірка зелена.
    Completed,
    /// Уперлись у стелю ходів.
    TurnCeiling,
    /// Вийшов бюджет часу рунга.
    Timeout,
    /// Вичерпані ітерації verify-петлі, перевірка й далі червона.
    VerifyExhausted,
    /// Помилка провайдера/транспорту.
    ProviderError,
}

/// Результат канонічної перевірки між ходами.
#[derive(Debug, Clone)]
pub struct VerifyReport {
    /// Перевірка зелена — порушення закрите.
    pub ok: bool,
    /// Точний вивід перевірки — подається моделі фідбеком при `ok == false`.
    pub output: String,
    /// Помилка САМОЇ перевірки (не результат «червоно»): інфраструктурна
    /// проблема не має палити ітерацію verify-петлі. rig списує хід завжди
    /// (§3.8), тож облік такого випадку — наш.
    pub infra_error: bool,
}

/// Інʼєктовані залежності циклу — усе, що знає консюмер, але не знає крейт.
#[derive(Clone)]
pub struct FixDeps {
    /// Канонічна перевірка (повторний прогін детектора) — єдине джерело
    /// правди про успіх; заяви моделі не важать.
    pub verify: Arc<dyn Fn() -> BoxFuture<'static, VerifyReport> + Send + Sync>,
    /// AST-факти файлу (у JS — oxc-екстрактор із консюмера). `None` —
    /// інструмент чесно відповідає «недоступний», а не мовчить.
    pub ast_facts: Option<Arc<dyn Fn(PathBuf) -> BoxFuture<'static, String> + Send + Sync>>,
}

/// Запит на один attempt циклу (один рунг драбини ззовні).
#[derive(Debug, Clone)]
pub struct FixRequest {
    /// Ідентифікатор правила — для промпта і телеметрії.
    pub rule_id: String,
    /// Текст порушення (повідомлення детектора).
    pub violation_text: String,
    /// Файли, які дозволено редагувати.
    pub target_files: Vec<PathBuf>,
    /// Корінь роботи агента.
    pub cwd: PathBuf,
    /// Тір моделі.
    pub tier: Tier,
    /// Бюджет часу всього attempt-у.
    pub timeout: Duration,
    /// Стеля ходів (backstop проти зациклення).
    pub turn_ceiling: usize,
    /// Скільки разів verify-петля може подати фідбек у ту саму сесію.
    pub verify_max: usize,
    /// Анкерний профіль: builtin read/edit ЗАМІНЮЮТЬСЯ на anchored-варіанти.
    pub anchored_edits: bool,
    /// Режим редагування.
    pub edit_mode: EditMode,
}

/// Результат attempt-у. Рішення про rollback і ескалацію ухвалює викликач —
/// цикл лише чесно звітує, що сталося.
#[derive(Debug, Clone)]
pub struct FixOutcome {
    /// Канонічна перевірка зелена наприкінці.
    pub ok: bool,
    /// Файли, яких торкнувся агент.
    pub touched_files: Vec<PathBuf>,
    /// Повний editLog — корпус дистиляційного маховика.
    pub edit_log: Vec<EditRecord>,
    /// Скільки ходів моделі виконано.
    pub turns: usize,
    /// Скільки викликів інструментів виконано.
    pub tool_calls: usize,
    /// Відповідь без жодного tool-виклику і без записів — окремий сигнал,
    /// бо usage віддають не всі провайдери.
    pub empty_completion: bool,
    /// Чому зупинились.
    pub stop_reason: StopReason,
    /// Текст помилки, якщо була.
    pub error: Option<String>,
}
