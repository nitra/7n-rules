//! Інструменти циклу `fix` — рівно дозволений набір, жодного shell.
//!
//! Порт toolset-профілів `agent-fix.mjs` (спека `2026-08-08-llm-lib-acp-only-rust-goose.md`,
//! §3.7 клас 3, §3.8): базовий профіль — `read`, `grep`, `find`, `ls`, `edit`, `write`,
//! `ast_facts`, `self_check`; anchored-профіль ЗАМІНЮЄ `read`/`edit` на
//! `read_anchored`/`edit_anchored` (не додає поруч) — решта набору та сама. Жодного
//! bash/shell-інструменту в жодному профілі: порожній allowlist — це і є гарантія
//! §3.7, а не забутий пункт.
//!
//! Кожен інструмент реалізує [`rig_agent::tool::Tool`]. Межі відповідальності:
//! - `read`/`grep`/`find`/`ls` читають файлову систему в межах переданого `cwd`, без
//!   зовнішніх процесів (лише `std::fs`);
//! - `edit`/`write`/`edit_anchored` виконують запис ЧЕСНО — без спроби самим
//!   вирішувати, чи можна писати в цей шлях. Межу запису перевіряє хук `on_tool_call`
//!   у runner-і (інший зріз), не цей модуль;
//! - `read_anchored`/`edit_anchored` — тонка tool-обв'язка над готовим протоколом
//!   [`crate::anchored_edit`]: самі функції хешування/валідації тут не дублюються;
//! - `ast_facts` і `self_check` — тонкі обв'язки над інʼєкціями [`FixDeps`]: коли
//!   інʼєкції немає, інструмент чесно каже «недоступний» замість мовчання чи вигадки.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::{fs, io};

use rig_agent::tool::{Tool, ToolContext, ToolExecutionError, ToolSet};
use serde::Deserialize;
use serde_json::{json, Value};

use super::{BoxFuture, FixDeps, VerifyReport};
use crate::anchored_edit::{
    apply_anchored_edits, render_anchored, stale_anchors_to_text, AnchorRange, AnchoredEdit,
};

/// Тип інʼєкції AST-фактів, як у [`FixDeps::ast_facts`] — приватний псевдонім,
/// щоб не повторювати довгий тип `dyn Fn(...)` у кожній сигнатурі.
type AstFactsFn = Arc<dyn Fn(PathBuf) -> BoxFuture<'static, String> + Send + Sync>;

/// Тип інʼєкції канонічної перевірки, як у [`FixDeps::verify`].
type VerifyFn = Arc<dyn Fn() -> BoxFuture<'static, VerifyReport> + Send + Sync>;

/// Теки, які пропускаються під час рекурсивного обходу [`collect_files`] —
/// шум, що не має стосунку до вихідного коду проєкту (VCS, залежності,
/// build-артефакти, захищені worktree-теки). Це зручність для `grep`/`find`,
/// НЕ межа безпеки: інструмент не приймає рішень про запис і не є списком заборон.
const SKIPPED_DIRS: &[&str] = &[".git", "node_modules", "target", ".worktrees"];

/// Скільки збігів `grep` повертає, перш ніж чесно обрізати вивід з приміткою
/// (не мовчки, як переповнений контекст моделі).
const GREP_MATCH_LIMIT: usize = 200;

/// Резолвить шлях tool-виклику відносно `cwd` сесії: абсолютний шлях
/// повертається як є, відносний — приєднується до `cwd`. Жодної нормалізації
/// чи перевірки меж — це чесне (без спроби «підправити» чи заблокувати шлях)
/// перетворення, межу запису перевіряє хук у runner-і.
fn resolve_path(cwd: &Path, raw: &str) -> PathBuf {
    let candidate = Path::new(raw);
    if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        cwd.join(candidate)
    }
}

/// Шлях відносно `cwd` для читабельного виводу `grep`/`find` (якщо `abs` не
/// під `cwd` — повертає `abs` без змін, теж чесно, без вигадування шляху).
fn display_relative<'a>(cwd: &Path, abs: &'a Path) -> &'a Path {
    abs.strip_prefix(cwd).unwrap_or(abs)
}

/// Рекурсивно збирає файли під `root` (файли — рекурсивно вниз по теках,
/// пропускаючи [`SKIPPED_DIRS`]; `root`, що сам є файлом, повертає один
/// елемент). Порядок — за іменем на кожному рівні, для детермінованого виводу.
fn collect_files(root: &Path) -> io::Result<Vec<PathBuf>> {
    if root.is_file() {
        return Ok(vec![root.to_path_buf()]);
    }
    let mut out = Vec::new();
    walk_dir(root, &mut out)?;
    Ok(out)
}

fn walk_dir(dir: &Path, out: &mut Vec<PathBuf>) -> io::Result<()> {
    let mut entries: Vec<_> = fs::read_dir(dir)?.collect::<io::Result<_>>()?;
    entries.sort_by_key(std::fs::DirEntry::file_name);
    for entry in entries {
        let file_type = entry.file_type()?;
        let path = entry.path();
        if file_type.is_dir() {
            let name = entry.file_name();
            if SKIPPED_DIRS
                .iter()
                .any(|skip| name == std::ffi::OsStr::new(skip))
            {
                continue;
            }
            walk_dir(&path, out)?;
        } else if file_type.is_file() {
            out.push(path);
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// read
// ---------------------------------------------------------------------------

/// Аргументи `read`: `path` обовʼязковий, `from`/`to` — опційний 1-based
/// включний діапазон рядків (без них — увесь файл).
#[derive(Debug, Deserialize)]
pub struct ReadArgs {
    pub path: String,
    #[serde(default)]
    pub from: Option<usize>,
    #[serde(default)]
    pub to: Option<usize>,
}

/// Читає вміст файлу (весь файл або діапазон рядків) у межах `cwd`.
#[derive(Clone)]
pub struct ReadTool {
    cwd: PathBuf,
}

impl ReadTool {
    #[must_use]
    pub fn new(cwd: impl Into<PathBuf>) -> Self {
        Self { cwd: cwd.into() }
    }
}

impl Tool for ReadTool {
    const NAME: &'static str = "read";
    type Args = ReadArgs;
    type Output = String;
    type Error = ToolExecutionError;

    fn description(&self) -> String {
        "Прочитати вміст файлу. Опційно — діапазон рядків from/to (1-based, включно з \
         обох боків); без них повертається весь файл. Шлях відносний до робочої \
         директорії сесії або абсолютний."
            .to_string()
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "шлях до файлу" },
                "from": { "type": "number", "description": "перший рядок, 1-based (опційно)" },
                "to": { "type": "number", "description": "останній рядок, включно (опційно)" }
            },
            "required": ["path"]
        })
    }

    async fn call(
        &self,
        _context: &mut ToolContext,
        args: Self::Args,
    ) -> Result<Self::Output, Self::Error> {
        let abs = resolve_path(&self.cwd, &args.path);
        if !abs.exists() {
            return Err(ToolExecutionError::not_found(format!(
                "файл не існує: {}",
                args.path
            )));
        }
        let content = fs::read_to_string(&abs).map_err(|error| {
            ToolExecutionError::other(format!("не вдалося прочитати {}: {error}", args.path))
        })?;
        match (args.from, args.to) {
            (None, None) => Ok(content),
            (from, to) => {
                let lines: Vec<&str> = content.split('\n').collect();
                let from = from.unwrap_or(1).max(1);
                let to = to.unwrap_or(lines.len()).min(lines.len());
                if from > to || from > lines.len() {
                    return Ok(String::new());
                }
                Ok(lines[from - 1..to].join("\n"))
            }
        }
    }
}

// ---------------------------------------------------------------------------
// grep
// ---------------------------------------------------------------------------

/// Аргументи `grep`: буквальний (без регулярних виразів) підрядок `pattern`,
/// опційний `path` (файл або тека, типово — `cwd`) для звуження пошуку.
#[derive(Debug, Deserialize)]
pub struct GrepArgs {
    pub pattern: String,
    #[serde(default)]
    pub path: Option<String>,
}

/// Шукає рядки з буквальним підрядком `pattern` у файлах під `path`,
/// рекурсивно. Бінарні чи невалідні UTF-8 файли мовчки пропускаються (як
/// нечитані текстом), решта — чесний перелік `path:рядок:текст`.
#[derive(Clone)]
pub struct GrepTool {
    cwd: PathBuf,
}

impl GrepTool {
    #[must_use]
    pub fn new(cwd: impl Into<PathBuf>) -> Self {
        Self { cwd: cwd.into() }
    }
}

impl Tool for GrepTool {
    const NAME: &'static str = "grep";
    type Args = GrepArgs;
    type Output = String;
    type Error = ToolExecutionError;

    fn description(&self) -> String {
        "Знайти рядки з буквальним підрядком pattern (без регулярних виразів) у файлах \
         під path (типово — робоча директорія сесії), рекурсивно. Повертає \
         `шлях:номер_рядка:текст` по одному збігу на рядок."
            .to_string()
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "pattern": { "type": "string", "description": "буквальний підрядок для пошуку" },
                "path": { "type": "string", "description": "файл або тека для пошуку (опційно, типово — вся робоча директорія)" }
            },
            "required": ["pattern"]
        })
    }

    async fn call(
        &self,
        _context: &mut ToolContext,
        args: Self::Args,
    ) -> Result<Self::Output, Self::Error> {
        let root = args
            .path
            .as_deref()
            .map_or_else(|| self.cwd.clone(), |raw| resolve_path(&self.cwd, raw));
        if !root.exists() {
            return Err(ToolExecutionError::not_found(format!(
                "шлях не існує: {}",
                args.path.as_deref().unwrap_or(".")
            )));
        }
        let files = collect_files(&root).map_err(|error| {
            ToolExecutionError::other(format!("не вдалося обійти {}: {error}", root.display()))
        })?;

        let mut matches = Vec::new();
        let mut truncated = false;
        'files: for file in &files {
            let Ok(content) = fs::read_to_string(file) else {
                continue; // не текстовий/не UTF-8 файл — чесно пропускаємо, не падаємо
            };
            let rel = display_relative(&self.cwd, file);
            for (i, line) in content.split('\n').enumerate() {
                if line.contains(&args.pattern) {
                    if matches.len() >= GREP_MATCH_LIMIT {
                        truncated = true;
                        break 'files;
                    }
                    matches.push(format!("{}:{}:{}", rel.display(), i + 1, line));
                }
            }
        }

        if matches.is_empty() {
            return Ok("нічого не знайдено".to_string());
        }
        if truncated {
            matches.push(format!(
                "... обрізано на {GREP_MATCH_LIMIT} збігах, звузь pattern або path"
            ));
        }
        Ok(matches.join("\n"))
    }
}

// ---------------------------------------------------------------------------
// find
// ---------------------------------------------------------------------------

/// Аргументи `find`: буквальний підрядок `pattern` у відносному шляху файлу,
/// опційний `path` для звуження обходу.
#[derive(Debug, Deserialize)]
pub struct FindArgs {
    pub pattern: String,
    #[serde(default)]
    pub path: Option<String>,
}

/// Знаходить файли, чий шлях (відносно `cwd`) містить буквальний підрядок
/// `pattern`, рекурсивно під `path`.
#[derive(Clone)]
pub struct FindTool {
    cwd: PathBuf,
}

impl FindTool {
    #[must_use]
    pub fn new(cwd: impl Into<PathBuf>) -> Self {
        Self { cwd: cwd.into() }
    }
}

impl Tool for FindTool {
    const NAME: &'static str = "find";
    type Args = FindArgs;
    type Output = String;
    type Error = ToolExecutionError;

    fn description(&self) -> String {
        "Знайти файли, чий шлях містить буквальний підрядок pattern, під path (типово \
         — робоча директорія сесії), рекурсивно."
            .to_string()
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "pattern": { "type": "string", "description": "буквальний підрядок у шляху файлу" },
                "path": { "type": "string", "description": "тека для обходу (опційно, типово — вся робоча директорія)" }
            },
            "required": ["pattern"]
        })
    }

    async fn call(
        &self,
        _context: &mut ToolContext,
        args: Self::Args,
    ) -> Result<Self::Output, Self::Error> {
        let root = args
            .path
            .as_deref()
            .map_or_else(|| self.cwd.clone(), |raw| resolve_path(&self.cwd, raw));
        if !root.exists() {
            return Err(ToolExecutionError::not_found(format!(
                "шлях не існує: {}",
                args.path.as_deref().unwrap_or(".")
            )));
        }
        let files = collect_files(&root).map_err(|error| {
            ToolExecutionError::other(format!("не вдалося обійти {}: {error}", root.display()))
        })?;

        let mut hits: Vec<String> = files
            .iter()
            .map(|file| display_relative(&self.cwd, file))
            .filter(|rel| rel.to_string_lossy().contains(&args.pattern))
            .map(|rel| rel.display().to_string())
            .collect();
        hits.sort();

        if hits.is_empty() {
            Ok("нічого не знайдено".to_string())
        } else {
            Ok(hits.join("\n"))
        }
    }
}

// ---------------------------------------------------------------------------
// ls
// ---------------------------------------------------------------------------

/// Аргументи `ls`: опційний `path` (типово — `cwd`).
#[derive(Debug, Deserialize)]
pub struct LsArgs {
    #[serde(default)]
    pub path: Option<String>,
}

/// Перелічує вміст директорії — один рівень, без рекурсії; теки позначені
/// завершальним `/`.
#[derive(Clone)]
pub struct LsTool {
    cwd: PathBuf,
}

impl LsTool {
    #[must_use]
    pub fn new(cwd: impl Into<PathBuf>) -> Self {
        Self { cwd: cwd.into() }
    }
}

impl Tool for LsTool {
    const NAME: &'static str = "ls";
    type Args = LsArgs;
    type Output = String;
    type Error = ToolExecutionError;

    fn description(&self) -> String {
        "Перелічити вміст директорії (один рівень, без рекурсії); теки позначені \
         завершальним `/`. Без path — робоча директорія сесії."
            .to_string()
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "директорія для перегляду (опційно, типово — робоча директорія)" }
            }
        })
    }

    async fn call(
        &self,
        _context: &mut ToolContext,
        args: Self::Args,
    ) -> Result<Self::Output, Self::Error> {
        let dir = args
            .path
            .as_deref()
            .map_or_else(|| self.cwd.clone(), |raw| resolve_path(&self.cwd, raw));
        if !dir.exists() {
            return Err(ToolExecutionError::not_found(format!(
                "директорія не існує: {}",
                args.path.as_deref().unwrap_or(".")
            )));
        }
        if !dir.is_dir() {
            return Err(ToolExecutionError::invalid_args(format!(
                "не директорія: {}",
                args.path.as_deref().unwrap_or(".")
            )));
        }
        let mut entries: Vec<String> = fs::read_dir(&dir)
            .map_err(|error| {
                ToolExecutionError::other(format!(
                    "не вдалося прочитати {}: {error}",
                    dir.display()
                ))
            })?
            .filter_map(Result::ok)
            .map(|entry| {
                let name = entry.file_name().to_string_lossy().into_owned();
                if entry.path().is_dir() {
                    format!("{name}/")
                } else {
                    name
                }
            })
            .collect();
        entries.sort();

        if entries.is_empty() {
            Ok("(порожньо)".to_string())
        } else {
            Ok(entries.join("\n"))
        }
    }
}

// ---------------------------------------------------------------------------
// edit
// ---------------------------------------------------------------------------

/// Одна точкова правка `edit`: `old_text` має зустрічатись у файлі РІВНО один
/// раз (як і в поширених coding-агентах) — інакше правка (і весь виклик)
/// відхиляється, щоб не редагувати випадковий збіг.
#[derive(Debug, Deserialize)]
pub struct EditOp {
    pub old_text: String,
    pub new_text: String,
}

/// Аргументи `edit`: шлях наявного файлу + послідовність точкових правок.
#[derive(Debug, Deserialize)]
pub struct EditArgs {
    pub path: String,
    pub edits: Vec<EditOp>,
}

/// Точково редагує наявний файл послідовністю `{old_text, new_text}`-правок.
/// Правки застосовуються по черзі до одного робочого тексту (кожна наступна
/// бачить результат попередньої); перша ж неоднозначна чи відсутня правка
/// відхиляє виклик атомарно — файл на диску лишається незміненим.
#[derive(Clone)]
pub struct EditTool {
    cwd: PathBuf,
}

impl EditTool {
    #[must_use]
    pub fn new(cwd: impl Into<PathBuf>) -> Self {
        Self { cwd: cwd.into() }
    }
}

impl Tool for EditTool {
    const NAME: &'static str = "edit";
    type Args = EditArgs;
    type Output = Value;
    type Error = ToolExecutionError;

    fn description(&self) -> String {
        "Точково відредагувати наявний файл: кожна правка — {old_text, new_text}, \
         old_text має зустрічатися у файлі РІВНО один раз. Для нового файлу \
         використовуй write."
            .to_string()
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "шлях до наявного файлу" },
                "edits": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "old_text": { "type": "string", "description": "унікальний фрагмент, який замінюється" },
                            "new_text": { "type": "string", "description": "текст заміни" }
                        },
                        "required": ["old_text", "new_text"]
                    }
                }
            },
            "required": ["path", "edits"]
        })
    }

    async fn call(
        &self,
        _context: &mut ToolContext,
        args: Self::Args,
    ) -> Result<Self::Output, Self::Error> {
        let abs = resolve_path(&self.cwd, &args.path);
        if !abs.exists() {
            return Err(ToolExecutionError::not_found(format!(
                "файл не існує: {} — для нового файлу використовуй write",
                args.path
            )));
        }
        if args.edits.is_empty() {
            return Err(ToolExecutionError::invalid_args("edits порожній"));
        }
        let mut content = fs::read_to_string(&abs).map_err(|error| {
            ToolExecutionError::other(format!("не вдалося прочитати {}: {error}", args.path))
        })?;

        for (i, edit) in args.edits.iter().enumerate() {
            let occurrences = content.matches(edit.old_text.as_str()).count();
            if occurrences == 0 {
                return Err(ToolExecutionError::invalid_args(format!(
                    "правка {}: old_text не знайдено у {} — перечитай файл",
                    i + 1,
                    args.path
                )));
            }
            if occurrences > 1 {
                return Err(ToolExecutionError::invalid_args(format!(
                    "правка {}: old_text неоднозначний ({occurrences} збігів) — додай більше контексту",
                    i + 1
                )));
            }
            let pos = content
                .find(edit.old_text.as_str())
                .expect("occurrences == 1 щойно перевірено вище — збіг є");
            content = format!(
                "{}{}{}",
                &content[..pos],
                edit.new_text,
                &content[pos + edit.old_text.len()..]
            );
        }

        fs::write(&abs, &content).map_err(|error| {
            ToolExecutionError::other(format!("не вдалося записати {}: {error}", args.path))
        })?;
        Ok(json!({ "ok": true, "applied": args.edits.len() }))
    }
}

// ---------------------------------------------------------------------------
// write
// ---------------------------------------------------------------------------

/// Аргументи `write`: шлях + повний новий вміст файлу.
#[derive(Debug, Deserialize)]
pub struct WriteArgs {
    pub path: String,
    pub content: String,
}

/// Записує повний вміст файлу цілком — створює файл (і батьківські теки за
/// потреби) або перезаписує наявний.
#[derive(Clone)]
pub struct WriteTool {
    cwd: PathBuf,
}

impl WriteTool {
    #[must_use]
    pub fn new(cwd: impl Into<PathBuf>) -> Self {
        Self { cwd: cwd.into() }
    }
}

impl Tool for WriteTool {
    const NAME: &'static str = "write";
    type Args = WriteArgs;
    type Output = Value;
    type Error = ToolExecutionError;

    fn description(&self) -> String {
        "Записати повний вміст файлу цілком (створює файл і батьківські теки за \
         потреби; наявний файл перезаписується повністю)."
            .to_string()
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "шлях до файлу" },
                "content": { "type": "string", "description": "повний новий вміст файлу" }
            },
            "required": ["path", "content"]
        })
    }

    async fn call(
        &self,
        _context: &mut ToolContext,
        args: Self::Args,
    ) -> Result<Self::Output, Self::Error> {
        let abs = resolve_path(&self.cwd, &args.path);
        if let Some(parent) = abs.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent).map_err(|error| {
                    ToolExecutionError::other(format!(
                        "не вдалося створити теку {}: {error}",
                        parent.display()
                    ))
                })?;
            }
        }
        fs::write(&abs, &args.content).map_err(|error| {
            ToolExecutionError::other(format!("не вдалося записати {}: {error}", args.path))
        })?;
        Ok(json!({ "ok": true, "bytes": args.content.len() }))
    }
}

// ---------------------------------------------------------------------------
// read_anchored / edit_anchored (анкерний профіль — заміна read/edit)
// ---------------------------------------------------------------------------

/// Аргументи `read_anchored` — та сама форма, що й у [`ReadArgs`].
#[derive(Debug, Deserialize)]
pub struct ReadAnchoredArgs {
    pub path: String,
    #[serde(default)]
    pub from: Option<usize>,
    #[serde(default)]
    pub to: Option<usize>,
}

/// Читає файл у anchored-форматі `якір|номер|текст` через
/// [`crate::anchored_edit::render_anchored`] — тонка tool-обв'язка, сама
/// логіка якорів лишається в одному місці.
#[derive(Clone)]
pub struct ReadAnchoredTool {
    cwd: PathBuf,
}

impl ReadAnchoredTool {
    #[must_use]
    pub fn new(cwd: impl Into<PathBuf>) -> Self {
        Self { cwd: cwd.into() }
    }
}

impl Tool for ReadAnchoredTool {
    const NAME: &'static str = "read_anchored";
    type Args = ReadAnchoredArgs;
    type Output = String;
    type Error = ToolExecutionError;

    fn description(&self) -> String {
        "Прочитати файл як анкерні рядки `якір|номер|текст`. Щоб відредагувати \
         наявний файл, спершу прочитай його ЦИМ інструментом і використай отримані \
         якорі в edit_anchored."
            .to_string()
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "шлях до файлу" },
                "from": { "type": "number", "description": "перший рядок, 1-based (опційно)" },
                "to": { "type": "number", "description": "останній рядок, включно (опційно)" }
            },
            "required": ["path"]
        })
    }

    async fn call(
        &self,
        _context: &mut ToolContext,
        args: Self::Args,
    ) -> Result<Self::Output, Self::Error> {
        let abs = resolve_path(&self.cwd, &args.path);
        if !abs.exists() {
            return Err(ToolExecutionError::not_found(format!(
                "файл не існує: {}",
                args.path
            )));
        }
        let content = fs::read_to_string(&abs).map_err(|error| {
            ToolExecutionError::other(format!("не вдалося прочитати {}: {error}", args.path))
        })?;
        let range = AnchorRange {
            from: args.from.unwrap_or(1),
            to: args.to.unwrap_or(usize::MAX),
        };
        Ok(render_anchored(&content, range))
    }
}

/// Одна анкерна правка з tool-виклику — та сама форма, що
/// [`crate::anchored_edit::AnchoredEdit`], лише з `Deserialize` для JSON-меж.
#[derive(Debug, Deserialize)]
pub struct AnchoredEditArg {
    pub anchor: String,
    pub line: usize,
    #[serde(default)]
    pub new_text: Option<String>,
}

impl From<AnchoredEditArg> for AnchoredEdit {
    fn from(edit: AnchoredEditArg) -> Self {
        Self {
            anchor: edit.anchor,
            line: edit.line,
            new_text: edit.new_text,
        }
    }
}

/// Аргументи `edit_anchored`: шлях наявного файлу + перелік анкерних правок.
#[derive(Debug, Deserialize)]
pub struct EditAnchoredArgs {
    pub path: String,
    pub edits: Vec<AnchoredEditArg>,
}

/// Строго редагує файл за анкерами рядків через
/// [`crate::anchored_edit::apply_anchored_edits`] — атомарна валідація перед
/// застосуванням, жодного fuzzy-збігу. Застарілий якір відхиляє ВЕСЬ виклик:
/// причину модель бачить через [`stale_anchors_to_text`] як текст помилки
/// (не мовчазний provider-фейл) — наступний крок моделі очевидний з тексту:
/// перечитати файл через `read_anchored` і повторити.
#[derive(Clone)]
pub struct EditAnchoredTool {
    cwd: PathBuf,
}

impl EditAnchoredTool {
    #[must_use]
    pub fn new(cwd: impl Into<PathBuf>) -> Self {
        Self { cwd: cwd.into() }
    }
}

impl Tool for EditAnchoredTool {
    const NAME: &'static str = "edit_anchored";
    type Args = EditAnchoredArgs;
    type Output = Value;
    type Error = ToolExecutionError;

    fn description(&self) -> String {
        "Строго відредагувати файл за анкерами рядків. Кожна правка — {anchor, line, \
         new_text}: new_text замінює ВЕСЬ рядок (може бути багаторядковим), \
         відсутній/null new_text — видаляє рядок. Якорі — з read_anchored. Будь-який \
         застарілий якір відхиляє ВЕСЬ виклик — перечитай файл і повтори. Без \
         fuzzy-збігів."
            .to_string()
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "шлях до наявного файлу" },
                "edits": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "anchor": { "type": "string", "description": "3-символьний якір з read_anchored" },
                            "line": { "type": "number", "description": "1-based номер рядка" },
                            "new_text": { "type": ["string", "null"], "description": "текст заміни рядка (null = видалити рядок)" }
                        },
                        "required": ["anchor", "line"]
                    }
                }
            },
            "required": ["path", "edits"]
        })
    }

    async fn call(
        &self,
        _context: &mut ToolContext,
        args: Self::Args,
    ) -> Result<Self::Output, Self::Error> {
        let abs = resolve_path(&self.cwd, &args.path);
        if !abs.exists() {
            return Err(ToolExecutionError::not_found(format!(
                "файл не існує: {} — для нового файлу використовуй write",
                args.path
            )));
        }
        if args.edits.is_empty() {
            return Err(ToolExecutionError::invalid_args("edits порожній"));
        }
        let content = fs::read_to_string(&abs).map_err(|error| {
            ToolExecutionError::other(format!("не вдалося прочитати {}: {error}", args.path))
        })?;
        let edits: Vec<AnchoredEdit> = args.edits.into_iter().map(AnchoredEdit::from).collect();
        let applied = edits.len();

        match apply_anchored_edits(&content, &edits) {
            Ok(new_content) => {
                fs::write(&abs, &new_content).map_err(|error| {
                    ToolExecutionError::other(format!("не вдалося записати {}: {error}", args.path))
                })?;
                Ok(json!({ "ok": true, "applied": applied }))
            }
            Err(stale) => Err(ToolExecutionError::invalid_args(stale_anchors_to_text(
                &stale,
            ))),
        }
    }
}

// ---------------------------------------------------------------------------
// ast_facts
// ---------------------------------------------------------------------------

/// Аргументи `ast_facts`: шлях до JS/TS-файлу.
#[derive(Debug, Deserialize)]
pub struct AstFactsArgs {
    pub path: String,
}

/// Дістає структуровані AST-факти файлу через інʼєкцію [`FixDeps::ast_facts`].
/// Крейт не носить власного парсера (§3.7): без інʼєкції інструмент чесно
/// відповідає «недоступний», а не мовчить і не вигадує факти.
#[derive(Clone)]
pub struct AstFactsTool {
    cwd: PathBuf,
    ast_facts: Option<AstFactsFn>,
}

impl AstFactsTool {
    #[must_use]
    pub fn new(cwd: impl Into<PathBuf>, deps: &FixDeps) -> Self {
        Self {
            cwd: cwd.into(),
            ast_facts: deps.ast_facts.clone(),
        }
    }
}

impl Tool for AstFactsTool {
    const NAME: &'static str = "ast_facts";
    type Args = AstFactsArgs;
    type Output = String;
    type Error = ToolExecutionError;

    fn description(&self) -> String {
        "Дістати структуровані AST-факти (імпорти, експорти, функції верхнього рівня) \
         з JS/TS-файлу. Виклич перед редагуванням, щоб зрозуміти файл без повного \
         читання."
            .to_string()
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "шлях до файлу" }
            },
            "required": ["path"]
        })
    }

    async fn call(
        &self,
        _context: &mut ToolContext,
        args: Self::Args,
    ) -> Result<Self::Output, Self::Error> {
        match &self.ast_facts {
            Some(ast_facts) => {
                let abs = resolve_path(&self.cwd, &args.path);
                Ok(ast_facts(abs).await)
            }
            None => Ok(
                json!({ "error": "ast_facts недоступний: не інʼєктовано AST-факти" }).to_string(),
            ),
        }
    }
}

// ---------------------------------------------------------------------------
// self_check
// ---------------------------------------------------------------------------

/// `self_check` не приймає обовʼязкових параметрів — канонічна перевірка
/// [`FixDeps::verify`] сама знає свій обсяг, tool лише повторно її запускає.
#[derive(Debug, Default, Deserialize)]
pub struct SelfCheckArgs {}

/// Advisory повторний прогін канонічної перевірки через [`FixDeps::verify`].
/// У відповіді ЯВНО позначено `advisory: true` — успіх ухвалює канонічна
/// перевірка runner-а поза цією сесією, заяви моделі не важать.
#[derive(Clone)]
pub struct SelfCheckTool {
    verify: VerifyFn,
}

impl SelfCheckTool {
    #[must_use]
    pub fn new(deps: &FixDeps) -> Self {
        Self {
            verify: deps.verify.clone(),
        }
    }
}

impl Tool for SelfCheckTool {
    const NAME: &'static str = "self_check";
    type Args = SelfCheckArgs;
    type Output = Value;
    type Error = ToolExecutionError;

    fn description(&self) -> String {
        "Advisory: повторно прогнати перевірку правила й побачити, чи усунено \
         порушення. НЕ є джерелом правди — фінальний вердикт ухвалює канонічна \
         перевірка поза цією сесією."
            .to_string()
    }

    fn parameters(&self) -> Value {
        json!({ "type": "object", "properties": {} })
    }

    async fn call(
        &self,
        _context: &mut ToolContext,
        _args: Self::Args,
    ) -> Result<Self::Output, Self::Error> {
        let report = (self.verify)().await;
        Ok(json!({
            "advisory": true,
            "note": "консультативний прогін — не джерело правди, фінальний вердикт ухвалює канонічна перевірка поза цією сесією",
            "ok": report.ok,
            "output": report.output,
            "infra_error": report.infra_error,
        }))
    }
}

// ---------------------------------------------------------------------------
// профілі — складання ToolSet
// ---------------------------------------------------------------------------

/// Складає `ToolSet` рівно дозволеного набору для одного attempt-у циклу
/// `fix`. `anchored_edits` перемикає профіль: builtin `read`/`edit`
/// ЗАМІНЮЮТЬСЯ на `read_anchored`/`edit_anchored` (не додаються поруч) —
/// решта набору та сама. Жодного bash/shell-інструменту в жодному профілі.
#[must_use]
pub fn build_toolset(cwd: impl Into<PathBuf>, deps: &FixDeps, anchored_edits: bool) -> ToolSet {
    let cwd = cwd.into();
    let mut set = ToolSet::default();
    if anchored_edits {
        set.add_tool(ReadAnchoredTool::new(cwd.clone()));
        set.add_tool(EditAnchoredTool::new(cwd.clone()));
    } else {
        set.add_tool(ReadTool::new(cwd.clone()));
        set.add_tool(EditTool::new(cwd.clone()));
    }
    set.add_tool(GrepTool::new(cwd.clone()));
    set.add_tool(FindTool::new(cwd.clone()));
    set.add_tool(LsTool::new(cwd.clone()));
    set.add_tool(WriteTool::new(cwd.clone()));
    set.add_tool(AstFactsTool::new(cwd.clone(), deps));
    set.add_tool(SelfCheckTool::new(deps));
    set
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Мінімальний [`FixDeps`] для тестів: `verify` завжди зелений, `ast_facts`
    /// не інʼєктований (тестує «чесно недоступний» шлях за замовчуванням).
    fn deps_without_ast() -> FixDeps {
        FixDeps {
            verify: Arc::new(|| {
                Box::pin(async {
                    VerifyReport {
                        ok: true,
                        output: String::new(),
                        infra_error: false,
                    }
                })
            }),
            ast_facts: None,
        }
    }

    // --- read ---------------------------------------------------------------

    #[tokio::test]
    async fn read_returns_full_file_content() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(dir.path().join("a.txt"), "one\ntwo\nthree").unwrap();
        let tool = ReadTool::new(dir.path());

        let out = tool
            .call(
                &mut ToolContext::new(),
                ReadArgs {
                    path: "a.txt".into(),
                    from: None,
                    to: None,
                },
            )
            .await
            .expect("read успішний");
        assert_eq!(out, "one\ntwo\nthree");
    }

    #[tokio::test]
    async fn read_returns_line_range() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(dir.path().join("a.txt"), "one\ntwo\nthree").unwrap();
        let tool = ReadTool::new(dir.path());

        let out = tool
            .call(
                &mut ToolContext::new(),
                ReadArgs {
                    path: "a.txt".into(),
                    from: Some(2),
                    to: Some(2),
                },
            )
            .await
            .expect("read успішний");
        assert_eq!(out, "two");
    }

    #[tokio::test]
    async fn read_missing_file_is_not_found_error() {
        let dir = tempfile::tempdir().expect("tempdir");
        let tool = ReadTool::new(dir.path());

        let error = tool
            .call(
                &mut ToolContext::new(),
                ReadArgs {
                    path: "nope.txt".into(),
                    from: None,
                    to: None,
                },
            )
            .await
            .expect_err("файл не існує");
        assert!(error
            .model_feedback()
            .unwrap_or_default()
            .contains("не існує"));
    }

    // --- grep -----------------------------------------------------------

    #[tokio::test]
    async fn grep_finds_matching_lines() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(dir.path().join("a.txt"), "hello\nworld\nhello again").unwrap();
        let tool = GrepTool::new(dir.path());

        let out = tool
            .call(
                &mut ToolContext::new(),
                GrepArgs {
                    pattern: "hello".into(),
                    path: None,
                },
            )
            .await
            .expect("grep успішний");
        assert!(out.contains("a.txt:1:hello"));
        assert!(out.contains("a.txt:3:hello again"));
        assert!(!out.contains(":2:"));
    }

    #[tokio::test]
    async fn grep_empty_result_is_explicit_not_silent() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(dir.path().join("a.txt"), "hello\nworld").unwrap();
        let tool = GrepTool::new(dir.path());

        let out = tool
            .call(
                &mut ToolContext::new(),
                GrepArgs {
                    pattern: "нема-такого".into(),
                    path: None,
                },
            )
            .await
            .expect("grep успішний навіть без збігів");
        assert_eq!(out, "нічого не знайдено");
    }

    // --- find -----------------------------------------------------------

    #[tokio::test]
    async fn find_matches_by_path_substring() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::create_dir_all(dir.path().join("src")).unwrap();
        fs::write(dir.path().join("src/target.rs"), "").unwrap();
        fs::write(dir.path().join("src/other.rs"), "").unwrap();
        let tool = FindTool::new(dir.path());

        let out = tool
            .call(
                &mut ToolContext::new(),
                FindArgs {
                    pattern: "target".into(),
                    path: None,
                },
            )
            .await
            .expect("find успішний");
        assert_eq!(out, "src/target.rs");
    }

    // --- ls -------------------------------------------------------------

    #[tokio::test]
    async fn ls_lists_one_level_with_trailing_slash_for_dirs() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::create_dir_all(dir.path().join("sub")).unwrap();
        fs::write(dir.path().join("file.txt"), "").unwrap();
        let tool = LsTool::new(dir.path());

        let out = tool
            .call(&mut ToolContext::new(), LsArgs { path: None })
            .await
            .expect("ls успішний");
        assert!(out.contains("sub/"));
        assert!(out.contains("file.txt"));
        assert!(!out.contains("file.txt/"));
    }

    // --- edit -------------------------------------------------------------

    #[tokio::test]
    async fn edit_applies_unique_replacement() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(dir.path().join("a.txt"), "const x = 1").unwrap();
        let tool = EditTool::new(dir.path());

        let out = tool
            .call(
                &mut ToolContext::new(),
                EditArgs {
                    path: "a.txt".into(),
                    edits: vec![EditOp {
                        old_text: "x = 1".into(),
                        new_text: "x = 2".into(),
                    }],
                },
            )
            .await
            .expect("edit успішний");
        assert_eq!(out["ok"], true);
        assert_eq!(
            fs::read_to_string(dir.path().join("a.txt")).unwrap(),
            "const x = 2"
        );
    }

    #[tokio::test]
    async fn edit_missing_file_is_not_found_error() {
        let dir = tempfile::tempdir().expect("tempdir");
        let tool = EditTool::new(dir.path());

        let error = tool
            .call(
                &mut ToolContext::new(),
                EditArgs {
                    path: "nope.txt".into(),
                    edits: vec![EditOp {
                        old_text: "a".into(),
                        new_text: "b".into(),
                    }],
                },
            )
            .await
            .expect_err("файл не існує");
        assert!(error
            .model_feedback()
            .unwrap_or_default()
            .contains("не існує"));
    }

    #[tokio::test]
    async fn edit_ambiguous_old_text_rejects_without_writing() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(dir.path().join("a.txt"), "aa").unwrap();
        let tool = EditTool::new(dir.path());

        let error = tool
            .call(
                &mut ToolContext::new(),
                EditArgs {
                    path: "a.txt".into(),
                    edits: vec![EditOp {
                        old_text: "a".into(),
                        new_text: "b".into(),
                    }],
                },
            )
            .await
            .expect_err("неоднозначний old_text мусить відхилити виклик");
        assert!(error
            .model_feedback()
            .unwrap_or_default()
            .contains("неоднозначний"));
        assert_eq!(fs::read_to_string(dir.path().join("a.txt")).unwrap(), "aa");
    }

    // --- write ------------------------------------------------------------

    #[tokio::test]
    async fn write_creates_new_file_with_parent_dirs() {
        let dir = tempfile::tempdir().expect("tempdir");
        let tool = WriteTool::new(dir.path());

        let out = tool
            .call(
                &mut ToolContext::new(),
                WriteArgs {
                    path: "nested/new.txt".into(),
                    content: "hello".into(),
                },
            )
            .await
            .expect("write успішний");
        assert_eq!(out["ok"], true);
        assert_eq!(
            fs::read_to_string(dir.path().join("nested/new.txt")).unwrap(),
            "hello"
        );
    }

    // --- read_anchored ------------------------------------------------------

    #[tokio::test]
    async fn read_anchored_renders_anchor_line_text_format() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(dir.path().join("a.txt"), "one\ntwo").unwrap();
        let tool = ReadAnchoredTool::new(dir.path());

        let out = tool
            .call(
                &mut ToolContext::new(),
                ReadAnchoredArgs {
                    path: "a.txt".into(),
                    from: None,
                    to: None,
                },
            )
            .await
            .expect("read_anchored успішний");
        let lines: Vec<&str> = out.split('\n').collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].ends_with("|1|one"));
        assert!(lines[1].ends_with("|2|two"));
    }

    #[tokio::test]
    async fn read_anchored_missing_file_is_not_found_error() {
        let dir = tempfile::tempdir().expect("tempdir");
        let tool = ReadAnchoredTool::new(dir.path());

        let error = tool
            .call(
                &mut ToolContext::new(),
                ReadAnchoredArgs {
                    path: "nope.txt".into(),
                    from: None,
                    to: None,
                },
            )
            .await
            .expect_err("файл не існує");
        assert!(error
            .model_feedback()
            .unwrap_or_default()
            .contains("не існує"));
    }

    // --- edit_anchored --------------------------------------------------

    #[tokio::test]
    async fn edit_anchored_applies_valid_anchor() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(dir.path().join("a.txt"), "one\ntwo\nthree").unwrap();
        let read_tool = ReadAnchoredTool::new(dir.path());
        let rendered = read_tool
            .call(
                &mut ToolContext::new(),
                ReadAnchoredArgs {
                    path: "a.txt".into(),
                    from: None,
                    to: None,
                },
            )
            .await
            .expect("read_anchored успішний");
        let anchor_of_line_2 = rendered
            .split('\n')
            .nth(1)
            .unwrap()
            .split('|')
            .next()
            .unwrap()
            .to_string();

        let edit_tool = EditAnchoredTool::new(dir.path());
        let out = edit_tool
            .call(
                &mut ToolContext::new(),
                EditAnchoredArgs {
                    path: "a.txt".into(),
                    edits: vec![AnchoredEditArg {
                        anchor: anchor_of_line_2,
                        line: 2,
                        new_text: Some("TWO".into()),
                    }],
                },
            )
            .await
            .expect("edit_anchored успішний");
        assert_eq!(out["ok"], true);
        assert_eq!(
            fs::read_to_string(dir.path().join("a.txt")).unwrap(),
            "one\nTWO\nthree"
        );
    }

    #[tokio::test]
    async fn edit_anchored_stale_anchor_rejects_without_writing_and_reports_reason() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(dir.path().join("a.txt"), "one\ntwo\nthree").unwrap();
        let tool = EditAnchoredTool::new(dir.path());

        let error = tool
            .call(
                &mut ToolContext::new(),
                EditAnchoredArgs {
                    path: "a.txt".into(),
                    edits: vec![AnchoredEditArg {
                        anchor: "zzz".into(),
                        line: 2,
                        new_text: Some("TWO".into()),
                    }],
                },
            )
            .await
            .expect_err("stale anchor мусить відхилити виклик");
        let feedback = error.model_feedback().unwrap_or_default();
        assert!(feedback.contains("stale anchor"), "текст: {feedback}");
        assert!(feedback.contains("\"line\":2"), "текст: {feedback}");
        assert_eq!(
            fs::read_to_string(dir.path().join("a.txt")).unwrap(),
            "one\ntwo\nthree",
            "файл на диску не має змінитись при stale anchor"
        );
    }

    #[tokio::test]
    async fn edit_anchored_missing_file_is_not_found_error() {
        let dir = tempfile::tempdir().expect("tempdir");
        let tool = EditAnchoredTool::new(dir.path());

        let error = tool
            .call(
                &mut ToolContext::new(),
                EditAnchoredArgs {
                    path: "nope.txt".into(),
                    edits: vec![AnchoredEditArg {
                        anchor: "aaa".into(),
                        line: 1,
                        new_text: Some("x".into()),
                    }],
                },
            )
            .await
            .expect_err("файл не існує");
        assert!(error
            .model_feedback()
            .unwrap_or_default()
            .contains("не існує"));
    }

    // --- ast_facts --------------------------------------------------------

    #[tokio::test]
    async fn ast_facts_returns_injected_result_when_available() {
        let dir = tempfile::tempdir().expect("tempdir");
        let deps = FixDeps {
            verify: deps_without_ast().verify,
            ast_facts: Some(Arc::new(|path: PathBuf| {
                Box::pin(async move { format!("{{\"path\":\"{}\"}}", path.display()) })
            })),
        };
        let tool = AstFactsTool::new(dir.path(), &deps);

        let out = tool
            .call(
                &mut ToolContext::new(),
                AstFactsArgs {
                    path: "a.ts".into(),
                },
            )
            .await
            .expect("ast_facts успішний з інʼєкцією");
        assert!(out.contains("a.ts"));
    }

    #[tokio::test]
    async fn ast_facts_reports_unavailable_without_injection() {
        let dir = tempfile::tempdir().expect("tempdir");
        let deps = deps_without_ast();
        let tool = AstFactsTool::new(dir.path(), &deps);

        let out = tool
            .call(
                &mut ToolContext::new(),
                AstFactsArgs {
                    path: "a.ts".into(),
                },
            )
            .await
            .expect("ast_facts не падає без інʼєкції — чесно відповідає");
        let parsed: Value = serde_json::from_str(&out).expect("валідний JSON");
        assert!(parsed["error"].as_str().unwrap().contains("недоступний"));
    }

    // --- self_check ---------------------------------------------------------

    #[tokio::test]
    async fn self_check_marks_response_as_advisory_and_reports_verify_result() {
        let deps = FixDeps {
            verify: Arc::new(|| {
                Box::pin(async {
                    VerifyReport {
                        ok: false,
                        output: "порушення лишилось".into(),
                        infra_error: false,
                    }
                })
            }),
            ast_facts: None,
        };
        let tool = SelfCheckTool::new(&deps);

        let out = tool
            .call(&mut ToolContext::new(), SelfCheckArgs {})
            .await
            .expect("self_check успішний");
        assert_eq!(out["advisory"], true);
        assert_eq!(out["ok"], false);
        assert_eq!(out["output"], "порушення лишилось");
    }

    // --- профілі: базовий/anchored --------------------------------------

    #[tokio::test]
    async fn base_profile_replaces_neither_read_nor_edit() {
        let dir = tempfile::tempdir().expect("tempdir");
        let deps = deps_without_ast();
        let set = build_toolset(dir.path(), &deps, false);

        let names: Vec<String> = set
            .get_tool_definitions()
            .into_iter()
            .map(|def| def.name)
            .collect();
        for expected in [
            "read",
            "grep",
            "find",
            "ls",
            "edit",
            "write",
            "ast_facts",
            "self_check",
        ] {
            assert!(
                names.contains(&expected.to_string()),
                "бракує {expected} у {names:?}"
            );
        }
        assert!(!names.contains(&"read_anchored".to_string()));
        assert!(!names.contains(&"edit_anchored".to_string()));
    }

    #[tokio::test]
    async fn anchored_profile_replaces_read_and_edit_not_adds_alongside() {
        let dir = tempfile::tempdir().expect("tempdir");
        let deps = deps_without_ast();
        let set = build_toolset(dir.path(), &deps, true);

        let names: Vec<String> = set
            .get_tool_definitions()
            .into_iter()
            .map(|def| def.name)
            .collect();
        for expected in [
            "read_anchored",
            "edit_anchored",
            "grep",
            "find",
            "ls",
            "write",
            "ast_facts",
            "self_check",
        ] {
            assert!(
                names.contains(&expected.to_string()),
                "бракує {expected} у {names:?}"
            );
        }
        assert!(
            !names.contains(&"read".to_string()),
            "read має бути ЗАМІНЕНИЙ, не доданий поруч"
        );
        assert!(
            !names.contains(&"edit".to_string()),
            "edit має бути ЗАМІНЕНИЙ, не доданий поруч"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn no_bash_or_shell_tool_exists_in_either_profile() {
        let dir = tempfile::tempdir().expect("tempdir");
        let deps = deps_without_ast();
        for anchored in [false, true] {
            let set = build_toolset(dir.path(), &deps, anchored);
            let names: Vec<String> = set
                .get_tool_definitions()
                .into_iter()
                .map(|def| def.name)
                .collect();
            for forbidden in ["bash", "shell", "exec", "run_command", "terminal"] {
                assert!(
                    !names.contains(&forbidden.to_string()),
                    "{forbidden} не має бути в наборі"
                );
            }
        }
    }
}
