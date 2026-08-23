//! wasm-компонент `n-rules:plugin@3.1.0` — `python/wasm-concerns`, ДРУГИЙ
//! first-party wasm-гість репозиторію (перший — `crates/plugin-lang-js`,
//! доккомент того `src/lib.rs`), створений за тим самим флоу скіла
//! `npm/skills/wasm-plugin/`. ПЕРША ХВИЛЯ порту: рівно три концерни
//! `python/*` — обрані навмисно як найпростіші з семи (`plugins/lang-python/
//! rules/python/*`): жоден не спавнить зовнішній тул і не читає складних
//! маніфестів (на відміну від `mypy`/`ruff`, які тягнуть `run-tool`, і
//! `project`/`workspace_root`, які тягнуть `uv-workspace.mjs`/`blue-oak.mjs`
//! — наступна хвиля).
//!
//! - `python/applies` (full-scope) — порт
//!   `plugins/lang-python/rules/python/applies/main.mjs`: чистий
//!   context-pass, реальний гейт застосовності декларативний
//!   (`python/main.json:applies`), цей концерн НІКОЛИ не видає діагностику
//!   ([`detect_applies`]).
//! - `python/tooling` (full-scope) — порт
//!   `plugins/lang-python/rules/python/tooling/main.mjs`: presence-перевірки
//!   кореня uv-проєкту (`uv.lock` є, `poetry.lock`/`poetry.toml` відсутні,
//!   `package.json` є) — жодного читання вмісту, лише факт присутності
//!   шляху в батчі ([`detect_tooling`], [`batch_file`]).
//! - `python/doc_comments` (per-file) — порт
//!   `plugins/lang-python/rules/python/doc_comments/main.mjs`: рекомендовані
//!   вимоги до docstring-ів (module-level + top-level публічний def/class).
//!   T0-фіксер (`fix-doc_comments.mjs`, 64 рядки) СВІДОМО поза обсягом цієї
//!   хвилі — `Guest::fix` повертає порожній план для цього концерну, як і
//!   для решти ([`Guest::fix`]).
//!
//! # Обхід дерева — чому в гості немає `globby`
//!
//! JS-оригінал `python/doc_comments` викликає `globby(SOURCE_GLOBS, { cwd,
//! gitignore: true, ignore: IGNORE_GLOBS })` сам, коли `ctx.files ===
//! undefined` (`lint --full` без дельти). У wasm-гості обхід файлової
//! системи робить ВИКЛЮЧНО хост — той самий принцип, що вже живе в
//! `plugin-lang-js` для його per-file концернів ([`CONCERN_TFM` в
//! `crates/plugin-lang-js/src/lib.rs`], доккомент модуля того крейта):
//! `ConcernContribution { scope: ConcernScope::PerFile, glob: ["**/*.py"] }`
//! у [`build_manifest`] — той самий структурний контракт, що `concern.json`
//! (`{"lint": {"scope": "per-file", "glob": ["**/*.py"]}}`). Коли виклик не
//! передає явний список файлів, хост (`crates/rules-napi::run_wasm_concern`)
//! самостійно будує `detect-batch.files` за цим glob-ом — [`detect_doc_comments`]
//! лише фільтрує вже надані host-ом файли через [`is_doc_comment_target`]
//! (порт `EXCLUDED_FILE_RE`), точнісінько як `.py`-розширення й тестові
//! каталоги фільтрує JS-оригінал ПІСЛЯ `globby`. Поведінка ідентична:
//! відмінність лише в тому, ХТО ходить диском (хост, не гість) — жодного
//! семантичного дрейфу для звичайного репозиторію (`.gitignore`-фільтрація
//! host-обходу — та сама розбіжність full-scope мосту, що вже задокументована
//! й прийнята для `js/utils_imports` у `plugin-lang-js`).
//!
//! # Unicode-фічі regex
//!
//! Той самий скорочений набір, що `crates/plugin-lang-js/Cargo.toml`, мінус
//! `unicode-case`: `unicode-perl` — НЕ опційна size-оптимізація тут (на
//! відміну від сусіднього крейта, де вона обирає МІЖ двома семантично
//! коректними варіантами) — без неї `\w`/`\s` у `PUBLIC_DEF_RE`
//! (`main.mjs`) не компілюються взагалі: `regex::Regex::new` повертає
//! `Syntax`-помилку `Unicode-aware Perl class not found` (перевірено
//! емпірично при першій спробі зібрати без цієї фічі — доккомент
//! `Cargo.toml`). `unicode-case` не потрібен: жоден патерн цього крейта не
//! має `(?i)`.
//!
//! # Наступна хвиля
//!
//! `python/mypy`, `python/ruff`, `python/project`, `python/workspace_root`
//! лишаються JS — усі спавнять зовнішній тул (`run-tool`) чи читають
//! workspace-маніфести (`uv-workspace.mjs`, `blue-oak.mjs`), поза
//! мінімальним обсягом цієї хвилі.

wit_bindgen::generate!({
    path: "../rules-contract/wit",
    world: "plugin",
    generate_all,
});

/// Ключ контрибуції `python/applies` — точний відповідник
/// `${ctx.ruleId}/${ctx.concernId}` (`runConcernDetector`,
/// `npm/scripts/lib/lint-surface/detect.mjs`).
const CONCERN_APPLIES: &str = "python/applies";

/// Ключ контрибуції `python/tooling`.
const CONCERN_TOOLING: &str = "python/tooling";

/// Ключ контрибуції `python/doc_comments`.
const CONCERN_DOC_COMMENTS: &str = "python/doc_comments";

/// Дефолтний `reason` violation-ів `python/tooling` — точний відповідник
/// `ctx.concernId` (bare, БЕЗ префікса `ruleId/`): `fail(msg)` у
/// `main.mjs` ніде не передає другий аргумент `opts`, тож
/// `createViolationReporter` підставляє `defaultReason = ctx.concernId`
/// (`'tooling'`, доккомент `violation-reporter.mjs`).
const TOOLING_REASON: &str = "tooling";

/// `reason` `missing-module-docstring` (`python/doc_comments`) — точний
/// відповідник літерала `checkFileDocComments` (`main.mjs`).
const DOC_COMMENTS_MISSING_MODULE_REASON: &str = "missing-module-docstring";

/// `reason` `missing-def-docstring` (`python/doc_comments`).
const DOC_COMMENTS_MISSING_DEF_REASON: &str = "missing-def-docstring";

/// Пояснювальна підказка для `missing-module-docstring` — точний відповідник
/// `MODULE_DOC_HINT` (`main.mjs`): doc-files копіює цей docstring дослівно.
const DOC_COMMENTS_MODULE_DOC_HINT: &str = "Глобальний сенс: конвеєр doc-files копіює цей docstring ДОСЛІВНО в секцію «Огляд» автоматично згенерованої документації файлу (0 LLM-токенів) — без нього «Огляд» вигадує LLM із самого коду.";

/// Пояснювальна підказка для `missing-def-docstring` — точний відповідник
/// `DEF_DOC_HINT` (`main.mjs`).
const DOC_COMMENTS_DEF_DOC_HINT: &str = "Глобальний сенс: конвеєр doc-files бере цей docstring ДОСЛІВНО в секцію «Публічний API» автоматично згенерованої документації файлу (0 LLM-токенів) — без нього опис вигадує LLM.";

/// Тестові файли/каталоги — поза вимогою docstring-ів. Точний порт
/// `EXCLUDED_FILE_RE` (`plugins/lang-python/rules/python/doc_comments/main.mjs`).
const DOC_COMMENTS_EXCLUDED_PATTERN: &str =
    r"(?:(?:^|/)tests?/)|(?:(?:^|/)test_[^/]*\.py$)|(?:_test\.py$)|(?:(?:^|/)conftest\.py$)";

/// Top-level публічний `def`/`class` (колонка 0, ім'я без `_`-префікса).
/// Точний порт `PUBLIC_DEF_RE` (`main.mjs`).
const DOC_COMMENTS_PUBLIC_DEF_PATTERN: &str = r"^(?:async\s+)?(def|class)\s+([A-Za-z]\w*)";

/// Docstring: перший непорожній рядок тіла — потрійні лапки, опційно з
/// string-префіксами. Точний порт `DOCSTRING_START_RE` (`main.mjs`).
const DOC_COMMENTS_DOCSTRING_START_PATTERN: &str = r#"^\s*[bB]?[fF]?[rR]?[uU]?("""|''')"#;

/// Рядок-коментар (колонка 0). Точний порт `COMMENT_LINE_RE` (`main.mjs`).
const DOC_COMMENTS_COMMENT_LINE_PATTERN: &str = r"^#";

/// Рядок, який пропускається при пошуку module-docstring (коментар або
/// порожній рядок). Точний порт `HEADER_SKIP_RE` (`main.mjs`).
const DOC_COMMENTS_HEADER_SKIP_PATTERN: &str = r"^(?:#|\s*$)";

/// `from __future__ import ...` — теж пропускається при пошуку
/// module-docstring. Точний порт `FUTURE_IMPORT_RE` (`main.mjs`).
const DOC_COMMENTS_FUTURE_IMPORT_PATTERN: &str = r"^from\s+__future__\s+import\s";

/// Шукає файл у батчі за точним posix-relative шляхом — batch-відповідник
/// `existsSync` JS-оригіналу (host уже надав вміст батчу, спека §3.2;
/// доккомент [`crates::plugin-lang-js::batch_file`] — той самий helper,
/// продубльований тут, бо крейти не діляться кодом через wasm-межу).
fn batch_file<'a>(files: &'a [SourceFile], path: &str) -> Option<&'a SourceFile> {
    files.iter().find(|f| f.path == path)
}

/// Мінімальне (без сторонніх крейтів) JSON string-екранування — точний
/// набір спецсимволів `JSON.stringify` для рядків (`"`, `\`, control chars),
/// той самий helper, що `crates/plugin-lang-js/src/lib.rs::json_escape_string`.
fn json_escape_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Діагностика форми `fail(msg)` (без `file`/`data`) — точний відповідник
/// дефолтної гілки `createViolationReporter.fail`.
fn plain_violation(reason: &str, message: String) -> Diagnostic {
    Diagnostic {
        reason: reason.to_string(),
        message,
        file: None,
        severity: Severity::Error,
        data: None,
    }
}

/// Точний порт `lint()` `python/applies`
/// (`plugins/lang-python/rules/python/applies/main.mjs`): чистий
/// context-pass — `reporter.pass(...)` `createViolationReporter` завжди
/// no-op (доккомент `npm/scripts/lib/lint-surface/violation-reporter.mjs`),
/// тож цей концерн НІКОЛИ не видає діагностику. Формально WHOLE-BATCH
/// (`glob = ["pyproject.toml"]`), але вміст батчу навіть не читається.
fn detect_applies(_files: &[SourceFile]) -> Vec<Diagnostic> {
    Vec::new()
}

/// Точний порт `lint()` `python/tooling`
/// (`plugins/lang-python/rules/python/tooling/main.mjs`) — WHOLE-BATCH,
/// суто presence-перевірки кореня репо (host уже звузив
/// `detect-batch.files` за `ConcernContribution::glob`, доккомент модуля).
/// Порядок діагностик — точний порядок гілок JS-оригіналу.
fn detect_tooling(files: &[SourceFile]) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();

    // JS-оригінал повертає РАННІЙ порожній результат, коли `pyproject.toml`
    // відсутній (не python-проєкт) — `existsSync(join(cwd,
    // 'pyproject.toml'))` замінено на присутність шляху в батчі.
    if batch_file(files, "pyproject.toml").is_none() {
        return diagnostics;
    }

    if batch_file(files, "uv.lock").is_some() {
        // `pass('uv.lock є')` — no-op, як і решта `pass`-гілок нижче.
    } else {
        diagnostics.push(plain_violation(
            TOOLING_REASON,
            "uv.lock не знайдено — згенеруй `uv lock` (python.mdc, без Poetry)".to_string(),
        ));
    }

    // Poetry-артефакти заборонені: uv — єдиний пакет-менеджер (python.mdc).
    for poetry_file in ["poetry.lock", "poetry.toml"] {
        if batch_file(files, poetry_file).is_some() {
            diagnostics.push(plain_violation(
                TOOLING_REASON,
                format!("{poetry_file} знайдено — прибери Poetry, мігруй на uv (python.mdc)"),
            ));
        }
    }

    if batch_file(files, "package.json").is_none() {
        diagnostics.push(plain_violation(
            TOOLING_REASON,
            "package.json не знайдено в корені — додай (python.mdc)".to_string(),
        ));
    }

    // Existence/структуру `lint-python.yml` вимагає провайдер-плагін
    // `@7n/rules-ci-github` (mixin `python/lint_python_yml`) — ядро
    // провайдер-агностичне, той самий коментар, що JS-оригінал.
    diagnostics
}

/// Один top-level публічний `def`/`class`. Дзеркало JS-об'єкта `{ line,
/// kind, name }` (`collectDefs`, `main.mjs`).
struct PyDef {
    /// 0-індексований номер рядка сигнатури.
    line: usize,
    /// `"def"` або `"class"` — точний захоплений текст групи 1.
    kind: String,
    /// Ім'я символу — точний захоплений текст групи 2.
    name: String,
}

/// Точний порт циклу збору `defs` у `checkFileDocComments`
/// (`main.mjs`): [`DOC_COMMENTS_PUBLIC_DEF_PATTERN`] застосовується
/// ПОРЯДКОВО (кожен рядок — окремий матч, як `line.match(PUBLIC_DEF_RE)`
/// у JS).
fn find_public_defs(lines: &[&str], def_re: &regex::Regex) -> Vec<PyDef> {
    let mut defs = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        if let Some(captures) = def_re.captures(line) {
            defs.push(PyDef {
                line: index,
                kind: captures[1].to_string(),
                name: captures[2].to_string(),
            });
        }
    }
    defs
}

/// Точний порт `headerEndLine` (`main.mjs`): індекс рядка, де закінчується
/// заголовок `def`/`class` (рядок із завершальним `:` ПОЗА коментарем), у
/// межах 20 рядків від старту (багаторядкові сигнатури).
fn header_end_line(lines: &[&str], start_line: usize) -> Option<usize> {
    let end = (start_line + 20).min(lines.len());
    for (i, line) in lines.iter().enumerate().take(end).skip(start_line) {
        let no_comment = line.split('#').next().unwrap_or("").trim_end();
        if no_comment.ends_with(':') {
            return Some(i);
        }
    }
    None
}

/// Точний порт `hasDocstringAfter` (`main.mjs`): перший непорожній рядок
/// після заголовка — це docstring?
fn has_docstring_after(lines: &[&str], header_end: usize, docstring_re: &regex::Regex) -> bool {
    for line in &lines[header_end + 1..] {
        if line.trim().is_empty() {
            continue;
        }
        return docstring_re.is_match(line);
    }
    false
}

/// Точний порт `hasModuleDocstring` (`main.mjs`): перший значущий рядок
/// (після shebang/encoding/коментарів/порожніх/`from __future__`) —
/// потрійні лапки?
fn has_module_docstring(
    lines: &[&str],
    header_skip_re: &regex::Regex,
    future_import_re: &regex::Regex,
    docstring_re: &regex::Regex,
) -> bool {
    for line in lines {
        if header_skip_re.is_match(line) || future_import_re.is_match(line) {
            continue;
        }
        return docstring_re.is_match(line);
    }
    false
}

/// Точний порт `commentBlockAbove` (`main.mjs`): суцільний `#`-блок
/// (колонка 0) впритул над рядком `line` (декоратори `@...` між
/// коментарем і `def`/`class` пропускаються) — кандидат на T0-промоцію.
/// Повертає `(fromLine, toLine)`, обидва 0-індексовані включно.
fn comment_block_above(
    lines: &[&str],
    line: usize,
    comment_re: &regex::Regex,
) -> Option<(usize, usize)> {
    let mut i = line as isize - 1;
    while i >= 0 && lines[i as usize].starts_with('@') {
        i -= 1;
    }
    if i < 0 || !comment_re.is_match(lines[i as usize]) {
        return None;
    }
    let to = i as usize;
    while i >= 1 && comment_re.is_match(lines[(i - 1) as usize]) {
        i -= 1;
    }
    Some((i as usize, to))
}

/// Точний порт `checkFileDocComments` (`main.mjs`): module-docstring +
/// docstring над кожним top-level публічним `def`/`class`; файл без
/// публічних `def`/`class` — поза вимогою (рання порожня відповідь).
#[allow(clippy::too_many_arguments)]
fn check_file_doc_comments(
    src: &str,
    rel_posix: &str,
    def_re: &regex::Regex,
    docstring_re: &regex::Regex,
    comment_re: &regex::Regex,
    header_skip_re: &regex::Regex,
    future_import_re: &regex::Regex,
) -> Vec<Diagnostic> {
    let lines: Vec<&str> = src.split('\n').collect();
    let defs = find_public_defs(&lines, def_re);
    if defs.is_empty() {
        return Vec::new();
    }

    let mut violations = Vec::new();
    if !has_module_docstring(&lines, header_skip_re, future_import_re, docstring_re) {
        violations.push(Diagnostic {
            reason: DOC_COMMENTS_MISSING_MODULE_REASON.to_string(),
            message: format!(
                "{rel_posix}: модуль із публічними def/class без module-docstring. {DOC_COMMENTS_MODULE_DOC_HINT}"
            ),
            file: Some(rel_posix.to_string()),
            severity: Severity::Error,
            // JS-оригінал будує violation напряму (не через
            // `createViolationReporter.fail`) — `data: {}` завжди присутнє,
            // навіть порожнім (доккомент `crates/plugin-lang-js`, розділ
            // «Зріз 4», той самий мотив для `missing-file-header`).
            data: Some("{}".to_string()),
        });
    }

    for def in &defs {
        let Some(header_end) = header_end_line(&lines, def.line) else {
            // «незвично довга сигнатура — не ризикуємо» (точний коментар
            // JS-оригіналу).
            continue;
        };
        if has_docstring_after(&lines, header_end, docstring_re) {
            continue;
        }
        let block = comment_block_above(&lines, def.line, comment_re);
        let data = match block {
            Some((from_line, to_line)) => format!(
                "{{\"promotable\":true,\"fromLine\":{from_line},\"toLine\":{to_line},\"headerEnd\":{header_end},\"name\":{}}}",
                json_escape_string(&def.name)
            ),
            None => format!("{{\"name\":{}}}", json_escape_string(&def.name)),
        };
        violations.push(Diagnostic {
            reason: DOC_COMMENTS_MISSING_DEF_REASON.to_string(),
            message: format!(
                "{rel_posix}: {} {} без docstring. {DOC_COMMENTS_DEF_DOC_HINT}",
                def.kind, def.name
            ),
            file: Some(rel_posix.to_string()),
            severity: Severity::Error,
            data: Some(data),
        });
    }
    violations
}

/// Точний порт `isDocCommentTarget` (`main.mjs`).
fn is_doc_comment_target(rel_posix: &str, excluded_re: &regex::Regex) -> bool {
    rel_posix.ends_with(".py") && !excluded_re.is_match(rel_posix)
}

/// Точний порт гілки `lint()` `python/doc_comments` із переданими `files`
/// (`main.mjs`) — PER-FILE (доккомент модуля, розділ «Обхід дерева»): host
/// уже надав batch за `**/*.py`, [`is_doc_comment_target`] лише повторює
/// `.py`-фільтр і виняток тестових файлів JS-оригіналу.
fn detect_doc_comments(files: &[SourceFile]) -> Vec<Diagnostic> {
    let excluded_re = regex::Regex::new(DOC_COMMENTS_EXCLUDED_PATTERN)
        .expect("DOC_COMMENTS_EXCLUDED_PATTERN валідний");
    let def_re = regex::Regex::new(DOC_COMMENTS_PUBLIC_DEF_PATTERN)
        .expect("DOC_COMMENTS_PUBLIC_DEF_PATTERN валідний");
    let docstring_re = regex::Regex::new(DOC_COMMENTS_DOCSTRING_START_PATTERN)
        .expect("DOC_COMMENTS_DOCSTRING_START_PATTERN валідний");
    let comment_re = regex::Regex::new(DOC_COMMENTS_COMMENT_LINE_PATTERN)
        .expect("DOC_COMMENTS_COMMENT_LINE_PATTERN валідний");
    let header_skip_re = regex::Regex::new(DOC_COMMENTS_HEADER_SKIP_PATTERN)
        .expect("DOC_COMMENTS_HEADER_SKIP_PATTERN валідний");
    let future_import_re = regex::Regex::new(DOC_COMMENTS_FUTURE_IMPORT_PATTERN)
        .expect("DOC_COMMENTS_FUTURE_IMPORT_PATTERN валідний");

    let mut out = Vec::new();
    for file in files {
        if !is_doc_comment_target(&file.path, &excluded_re) {
            continue;
        }
        out.extend(check_file_doc_comments(
            &file.content,
            &file.path,
            &def_re,
            &docstring_re,
            &comment_re,
            &header_skip_re,
            &future_import_re,
        ));
    }
    out
}

/// Чистий (без host-імпортів `log`/`report-progress`) конструктор
/// маніфеста — винесений з [`Guest::describe`] окремо, щоб host-таргет
/// unit-тести могли звірити форму маніфеста без реального wasmtime-хоста
/// (той самий мотив, що `crates/plugin-lang-js/src/lib.rs::build_manifest`).
fn build_manifest() -> Manifest {
    Manifest {
        id: "python/wasm-concerns".to_string(),
        version: "0.1.0".to_string(),
        world_version: "3.1.0".to_string(),
        domains: vec![Domain::Lint],
        concerns: vec![
            ConcernContribution {
                key: CONCERN_APPLIES.to_string(),
                scope: ConcernScope::Full,
                glob: vec!["pyproject.toml".to_string()],
            },
            ConcernContribution {
                key: CONCERN_TOOLING.to_string(),
                scope: ConcernScope::Full,
                glob: vec![
                    "pyproject.toml".to_string(),
                    "uv.lock".to_string(),
                    "poetry.lock".to_string(),
                    "poetry.toml".to_string(),
                    "package.json".to_string(),
                    ".github/workflows/lint-python.yml".to_string(),
                ],
            },
            ConcernContribution {
                key: CONCERN_DOC_COMMENTS.to_string(),
                scope: ConcernScope::PerFile,
                glob: vec!["**/*.py".to_string()],
            },
        ],
        ci_artifacts: vec![],
        // Вміст файлів хост передає inline (per-file чи host-побудований
        // full-scope batch, доккомент `wit/world.wit`) — плагін не читає
        // диск сам (той самий мотив, що `crates/plugin-lang-js`).
        capabilities: Capabilities {
            fs_read: vec![],
            network: false,
        },
        tools: vec![],
    }
}

/// Guest-реалізація `n-rules:plugin@3.1.0` для `python/wasm-concerns` —
/// три контрибуції першої хвилі (доккомент модуля).
struct LangPython;

impl Guest for LangPython {
    fn describe() -> Manifest {
        log(LogLevel::Info, "plugin-lang-python: describe()");
        build_manifest()
    }

    fn detect(batch: DetectBatch) -> Vec<Diagnostic> {
        let total = batch.files.len() as u32;
        let diagnostics = match batch.concern_id.as_str() {
            CONCERN_APPLIES => {
                report_progress(total, total);
                detect_applies(&batch.files)
            }
            CONCERN_TOOLING => {
                report_progress(total, total);
                detect_tooling(&batch.files)
            }
            // PER-FILE: кожен файл — свій крок прогресу (той самий мотив,
            // що `CONCERN_DOC_COMMENTS`/дефолтна гілка `plugin-lang-js`).
            CONCERN_DOC_COMMENTS => {
                let mut diagnostics = Vec::new();
                for (index, file) in batch.files.iter().enumerate() {
                    report_progress(index as u32 + 1, total);
                    diagnostics.extend(detect_doc_comments(std::slice::from_ref(file)));
                }
                diagnostics
            }
            _ => Vec::new(),
        };
        log(
            LogLevel::Info,
            &format!(
                "plugin-lang-python: detect({}) опрацював {total} файл(ів)",
                batch.concern_id
            ),
        );
        diagnostics
    }

    /// Перша хвиля не портує жодного fix-контуру (T0 `python/doc_comments`
    /// — `fix-doc_comments.mjs`, 64 рядки — лишається JS, доккомент модуля):
    /// порожній план для КОЖНОГО концерну, сумісна заглушка (доккомент
    /// `wit/world.wit` біля `export fix`).
    fn fix(_request: FixRequest) -> FixPlan {
        FixPlan { edits: vec![] }
    }

    fn ecosystem_outdated(_request: EcosystemRequest) -> Result<Vec<OutdatedDep>, DomainError> {
        Err(DomainError::NotSupported)
    }

    fn docgen_render(_request: DocgenRequest) -> Result<DocOutput, DomainError> {
        Err(DomainError::NotSupported)
    }
}

export!(LangPython);

#[cfg(test)]
mod tests {
    //! Юніт-тести на host-таргеті (`cargo test -p plugin-lang-python`, без
    //! wasm-збірки) — лише чисті helper-и, НЕ `Guest::describe`/
    //! `Guest::detect` напряму (host-імпорти `log`/`report-progress`
    //! абортують поза реальним wasmtime-хостом — той самий мотив, що
    //! `crates/plugin-lang-js/src/lib.rs`). Живий end-to-end прогін через
    //! `PluginHost` — поза обсягом цієї хвилі (мінімальний перший крок,
    //! доккомент задачі); JS-vs-wasm parity —
    //! `npm/scripts/lib/lint-surface/tests/wasm-plugin-parity-python.test.mjs`.
    use super::*;

    fn sf(path: &str, content: &str) -> SourceFile {
        SourceFile {
            path: path.to_string(),
            content: content.to_string(),
        }
    }

    // --- python/applies ---

    #[test]
    fn detect_applies_never_reports_anything() {
        let files = vec![sf("pyproject.toml", "[project]\nname = \"demo\"\n")];
        assert!(detect_applies(&files).is_empty());
        assert!(detect_applies(&[]).is_empty());
    }

    // --- python/tooling ---

    #[test]
    fn detect_tooling_empty_batch_is_not_a_python_project() {
        // `pyproject.toml` відсутній у батчі → рання порожня відповідь.
        let files = vec![sf("package.json", "{\"name\":\"x\"}")];
        assert!(detect_tooling(&files).is_empty());
    }

    #[test]
    fn detect_tooling_passes_on_valid_uv_project() {
        let files = vec![
            sf(
                "pyproject.toml",
                "[project]\nname = \"demo\"\nversion = \"0.1.0\"\n",
            ),
            sf("uv.lock", "version = 1\n"),
            sf("package.json", "{\"name\":\"demo\",\"private\":true}"),
        ];
        assert!(detect_tooling(&files).is_empty());
    }

    #[test]
    fn detect_tooling_flags_missing_uv_lock() {
        let files = vec![
            sf("pyproject.toml", "[project]\nname = \"demo\"\n"),
            sf("package.json", "{\"name\":\"demo\"}"),
        ];
        let diagnostics = detect_tooling(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, TOOLING_REASON);
        assert!(diagnostics[0].message.contains("uv.lock"));
    }

    #[test]
    fn detect_tooling_flags_poetry_lock_and_toml_independently() {
        let files = vec![
            sf("pyproject.toml", "[project]\nname = \"demo\"\n"),
            sf("uv.lock", "version = 1\n"),
            sf("package.json", "{\"name\":\"demo\"}"),
            sf("poetry.lock", ""),
            sf("poetry.toml", ""),
        ];
        let diagnostics = detect_tooling(&files);
        assert_eq!(diagnostics.len(), 2);
        assert!(diagnostics.iter().all(|d| d.reason == TOOLING_REASON));
        assert!(diagnostics[0].message.contains("poetry.lock"));
        assert!(diagnostics[1].message.contains("poetry.toml"));
    }

    #[test]
    fn detect_tooling_flags_missing_package_json() {
        let files = vec![
            sf("pyproject.toml", "[project]\nname = \"demo\"\n"),
            sf("uv.lock", "version = 1\n"),
        ];
        let diagnostics = detect_tooling(&files);
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0].message.contains("package.json"));
    }

    #[test]
    fn detect_tooling_ignores_missing_workflow_file() {
        // `.github/workflows/lint-python.yml` відсутність нічого не
        // тригерить — той самий коментар, що JS-оригінал (провайдер
        // ci-github перевіряє існування окремо).
        let files = vec![
            sf("pyproject.toml", "[project]\nname = \"demo\"\n"),
            sf("uv.lock", "version = 1\n"),
            sf("package.json", "{\"name\":\"demo\"}"),
        ];
        assert!(detect_tooling(&files).is_empty());
    }

    // --- python/doc_comments ---

    #[test]
    fn detect_doc_comments_flags_missing_module_and_def_docstring() {
        let files = vec![sf("pkg/mod.py", "def run():\n    return 1\n")];
        let diagnostics = detect_doc_comments(&files);
        assert_eq!(diagnostics.len(), 2);
        assert_eq!(diagnostics[0].reason, DOC_COMMENTS_MISSING_MODULE_REASON);
        assert_eq!(diagnostics[0].data.as_deref(), Some("{}"));
        assert_eq!(diagnostics[1].reason, DOC_COMMENTS_MISSING_DEF_REASON);
        assert!(diagnostics[1].message.contains("def run"));
    }

    #[test]
    fn detect_doc_comments_passes_when_module_and_def_docstring_present() {
        let files = vec![sf(
            "pkg/mod.py",
            "\"\"\"Модуль.\"\"\"\n\n\ndef run():\n    \"\"\"Опис.\"\"\"\n    return 1\n",
        )];
        assert!(detect_doc_comments(&files).is_empty());
    }

    #[test]
    fn detect_doc_comments_ignores_files_without_public_defs() {
        let files = vec![sf("pkg/mod.py", "x = 1\ny = 2\n")];
        assert!(detect_doc_comments(&files).is_empty());
    }

    #[test]
    fn detect_doc_comments_ignores_underscore_prefixed_defs() {
        // `_private`/`__private` не збігаються з `[A-Za-z]\w*` (не починаються
        // з букви) — не входять у `defs`, тож файл узагалі поза вимогою
        // (`defs.is_empty()` — рання порожня відповідь).
        let files = vec![sf("pkg/mod.py", "def _private():\n    return 1\n")];
        assert!(detect_doc_comments(&files).is_empty());
    }

    #[test]
    fn detect_doc_comments_skips_test_files_and_directories() {
        for path in [
            "tests/test_helpers.py",
            "pkg/test_foo.py",
            "pkg/foo_test.py",
            "pkg/conftest.py",
        ] {
            let files = vec![sf(path, "def run():\n    return 1\n")];
            assert!(
                detect_doc_comments(&files).is_empty(),
                "{path} мав бути поза вимогою"
            );
        }
    }

    #[test]
    fn detect_doc_comments_ignores_non_python_files() {
        let files = vec![sf("pkg/mod.js", "function run() { return 1 }\n")];
        assert!(detect_doc_comments(&files).is_empty());
    }

    #[test]
    fn detect_doc_comments_marks_promotable_comment_block_above_def() {
        let src =
            "\"\"\"Модуль.\"\"\"\n\n\n# Опис функції\n# другий рядок\ndef run():\n    return 1\n";
        let files = vec![sf("pkg/mod.py", src)];
        let diagnostics = detect_doc_comments(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, DOC_COMMENTS_MISSING_DEF_REASON);
        let data = diagnostics[0].data.as_deref().expect("data є");
        assert!(data.contains("\"promotable\":true"));
        assert!(data.contains("\"fromLine\":3"));
        assert!(data.contains("\"toLine\":4"));
        assert!(data.contains("\"headerEnd\":5"));
        assert!(data.contains("\"name\":\"run\""));
    }

    #[test]
    fn detect_doc_comments_decorator_between_comment_and_def_still_promotable() {
        let src = "\"\"\"Модуль.\"\"\"\n\n\n# Опис\n@decorator\ndef run():\n    return 1\n";
        let files = vec![sf("pkg/mod.py", src)];
        let diagnostics = detect_doc_comments(&files);
        assert_eq!(diagnostics.len(), 1);
        let data = diagnostics[0].data.as_deref().expect("data є");
        assert!(data.contains("\"promotable\":true"));
    }

    #[test]
    fn detect_doc_comments_no_comment_block_gives_name_only_data() {
        let src = "\"\"\"Модуль.\"\"\"\n\n\ndef run():\n    return 1\n";
        let files = vec![sf("pkg/mod.py", src)];
        let diagnostics = detect_doc_comments(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].data.as_deref(), Some("{\"name\":\"run\"}"));
    }

    #[test]
    fn detect_doc_comments_class_uses_class_keyword_in_message() {
        let src = "\"\"\"Модуль.\"\"\"\n\n\nclass Foo:\n    def bar(self):\n        pass\n";
        let files = vec![sf("pkg/mod.py", src)];
        let diagnostics = detect_doc_comments(&files);
        // top-level публічний символ — лише `Foo` (`bar` вкладений, колонка
        // 0 не збігається).
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0].message.contains("class Foo без docstring"));
    }

    #[test]
    fn detect_doc_comments_accepts_docstring_with_string_prefix() {
        let src =
            "r\"\"\"Модуль.\"\"\"\n\n\ndef run():\n    f\"\"\"Опис {1}.\"\"\"\n    return 1\n";
        let files = vec![sf("pkg/mod.py", src)];
        assert!(detect_doc_comments(&files).is_empty());
    }

    // --- build_manifest ---

    #[test]
    fn build_manifest_declares_all_three_concerns_with_expected_scopes() {
        let manifest = build_manifest();
        assert_eq!(manifest.id, "python/wasm-concerns");
        assert_eq!(manifest.world_version, "3.1.0");
        assert_eq!(manifest.domains, vec![Domain::Lint]);
        assert_eq!(manifest.concerns.len(), 3);
        assert!(manifest.tools.is_empty());
        assert!(manifest.ci_artifacts.is_empty());

        for key in [CONCERN_APPLIES, CONCERN_TOOLING] {
            let contribution = manifest
                .concerns
                .iter()
                .find(|c| c.key == key)
                .unwrap_or_else(|| panic!("{key} contribution має бути в маніфесті"));
            assert_eq!(contribution.scope, ConcernScope::Full);
            assert!(!contribution.glob.is_empty());
        }
        let doc_comments = manifest
            .concerns
            .iter()
            .find(|c| c.key == CONCERN_DOC_COMMENTS)
            .expect("python/doc_comments contribution має бути в маніфесті");
        assert_eq!(doc_comments.scope, ConcernScope::PerFile);
        assert_eq!(doc_comments.glob, vec!["**/*.py".to_string()]);

        assert!(manifest.capabilities.fs_read.is_empty());
        assert!(!manifest.capabilities.network);
    }

    /// `plugin.toml` — статичний дублікат `describe()` (доккомент самого
    /// файлу, той самий anti-drift мотив, що
    /// `crates/plugin-lang-js/src/lib.rs::plugin_toml_concern_keys_match_describe`).
    #[test]
    fn plugin_toml_concern_keys_match_describe() {
        let manifest: toml::Table = include_str!("../plugin.toml")
            .parse()
            .expect("plugin.toml має бути валідним TOML");
        let runtime = build_manifest();

        let mut declared: Vec<&str> = manifest
            .get("concerns")
            .and_then(|v| v.as_array())
            .expect("`concerns` — array of tables у корені маніфеста")
            .iter()
            .map(|c| c["key"].as_str().expect("`key` — рядок"))
            .collect();
        declared.sort_unstable();
        let mut runtime_keys: Vec<&str> = runtime.concerns.iter().map(|c| c.key.as_str()).collect();
        runtime_keys.sort_unstable();
        assert_eq!(
            declared, runtime_keys,
            "plugin.toml розійшовся з describe() по concerns — синхронізуй маніфест-довідник"
        );

        let declared_tools: Vec<&str> = manifest
            .get("tools")
            .and_then(|v| v.as_array())
            .expect("`tools` мусить бути top-level масивом маніфеста")
            .iter()
            .map(|t| t.as_str().expect("елемент `tools` — рядок"))
            .collect();
        assert_eq!(
            declared_tools,
            runtime.tools.iter().map(String::as_str).collect::<Vec<_>>(),
            "plugin.toml розійшовся з describe() по tools"
        );
    }
}
