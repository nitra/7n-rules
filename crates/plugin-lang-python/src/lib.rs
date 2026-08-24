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
//! # Друга хвиля
//!
//! `python/mypy`+`python/ruff` — ПІЛОТИ `exec-tool` цього крейта (доккомент
//! секції «`python/mypy` + `python/ruff`» перед `build_manifest`), портовані
//! окремим кроком; `python/project`/`python/workspace_root` (`uv-workspace.mjs`,
//! `blue-oak.mjs`) — поза обсягом цього конкретного кроку.

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

/// Ключ контрибуції `python/workspace_root` — друга хвиля порту (доккомент
/// модуля, розділ «Наступна хвиля»).
const CONCERN_WORKSPACE_ROOT: &str = "python/workspace_root";

/// Ключ контрибуції `python/mypy` (друга хвиля порту, доккомент секції
/// «`python/mypy` + `python/ruff`» перед [`build_manifest`]).
const CONCERN_MYPY: &str = "python/mypy";

/// Ключ контрибуції `python/ruff`.
const CONCERN_RUFF: &str = "python/ruff";

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
///
/// Хвіст імені — ЯВНИЙ ASCII-клас, не `\w`. JS-`\w` (ECMA-262) завжди
/// `[A-Za-z0-9_]`, тоді як `\w` крейта `regex` — Unicode-aware навіть із
/// самим лише `unicode-perl`. Перший символ прикритий ASCII-класом
/// `[A-Za-z]`, тож множина порушень збігається, АЛЕ на імені зі змішаним
/// хвостом (`def aоблік`) JS захоплював би `a`, а Unicode-`\w` — `aоблік`:
/// тиха розбіжність `data.name` і тексту повідомлення. Знайдено при порті
/// `rust/doc_comments` (у якого `KIND_NAME_RE` не мав ASCII-якоря взагалі,
/// тож там розходилась уже сама множина) і виміряно на живому гості —
/// [`tests::detect_doc_comments_name_tail_is_ascii_only_like_js`].
const DOC_COMMENTS_PUBLIC_DEF_PATTERN: &str =
    r"^(?:async\s+)?(def|class)\s+([A-Za-z][0-9A-Za-z_]*)";

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

/// `reason` вкладеного `[tool.uv.workspace]` поза кореневим `pyproject.toml`.
/// Точний відповідник `NESTED_WORKSPACE`
/// (`plugins/lang-python/rules/python/workspace_root/main.mjs`).
const WORKSPACE_ROOT_NESTED_WORKSPACE_REASON: &str = "nested-workspace";

/// `reason` вкладеного `uv.lock` поза кореневим workspace. Точний
/// відповідник `NESTED_LOCKFILE` (`main.mjs`).
const WORKSPACE_ROOT_NESTED_LOCKFILE_REASON: &str = "nested-lockfile";

/// `reason` відсутнього/невалідного кореневого workspace root. Точний
/// відповідник `MISSING_ROOT_WORKSPACE` (`main.mjs`).
const WORKSPACE_ROOT_MISSING_ROOT_REASON: &str = "missing-root-workspace";

/// `reason` package-маніфесту поза `members` кореневого workspace. Точний
/// відповідник `PACKAGE_NOT_WORKSPACE_MEMBER` (`main.mjs`).
const WORKSPACE_ROOT_PACKAGE_NOT_MEMBER_REASON: &str = "package-not-workspace-member";

/// Спільний хвіст повідомлення кожної діагностики концерну — точний порт
/// `REMEDIATION` (`main.mjs`, конкатенація літералів звужена до одного
/// рядка: сама конкатенація JS — форматування джерела, не семантика).
const WORKSPACE_ROOT_REMEDIATION: &str = "створи/підтверди кореневий [tool.uv.workspace] (members) у кореневому pyproject.toml, запусти `uv lock` з кореня для єдиного кореневого uv.lock, видали вкладені uv.lock у не-виключених members — у репозиторії має лишитись один кореневий workspace і один uv.lock (python/workspace_root.mdc)";

/// Каталоги, які [`detect_workspace_root`] НЕ бачить — точний порт
/// `IGNORED_DIR_NAMES` (`main.mjs`). Host-batch (`ConcernContribution::glob`,
/// [`build_manifest`]) фільтрує лише `.git`/`node_modules`/`.worktrees` +
/// `.gitignore` (`crates/rules-core/src/scan.rs::ALWAYS_IGNORE`) — решту
/// (`.venv`/`venv`/`target`/`.next`/`.turbo`/`.claude` ЦІЛКОМ (не лише
/// `.claude/worktrees`)/`vendor`/`__pycache__`) JS-оригінал ігнорує ЗАВЖДИ,
/// незалежно від `.gitignore`, тож гість повторює той самий фільтр вручну
/// ([`workspace_root_path_ignored`]) — той самий «фільтр поверх host-глобу»
/// дух, що [`is_doc_comment_target`] для `python/doc_comments`.
const WORKSPACE_ROOT_IGNORED_DIR_NAMES: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    ".next",
    ".turbo",
    ".venv",
    "venv",
    ".claude",
    "vendor",
    "__pycache__",
];

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

// =====================================================================
// `python/mypy` + `python/ruff` (друга хвиля порту) — обидва ПІЛОТИ
// `exec-tool` цього крейта: спавнять зовнішній тул (`mypy`/`ruff`) через
// `uv run --frozen`, той самий host-mediated контур, що вже несе
// `crates/plugin-lang-js` (`bun/licensee`, `style/lint` — доккомент
// [`exec_tool`], `crates/rules-contract/src/tool.rs`). Обидва тягнуть
// спільний preflight, точний функціональний порт `preparePythonRun`
// (`plugins/lang-python/rules/python/lib/uv-run.mjs`, 52 рядки) — [`PythonRunPrep`]/
// [`prepare_python_run`].
//
// # Per-file + якорі (`lint.anchors`) — не Full-scope
//
// JS-канон обох `main.mjs` — per-file (`concern.json: {"scope":"per-file"}`),
// і [`build_manifest`] дзеркалить це буквально: `ConcernScope::PerFile`,
// glob `["**/*.py"]`. Проблема, яку це спершу створювало: `preparePythonRun`
// ПЕРШИМ ділом гейтить на `existsSync(pyproject.toml)` — сигнал, якого
// чистий per-file host-батч (лише `**/*.py`) гостю не приносить, бо
// звужений до дельти, тож "pyproject.toml не в дельті" (типовий прогін, де
// мінявся лише код) мовчки видавався б за "pyproject.toml не існує".
//
// Розв'язок — НЕ Full-scope (перша спроба цієї хвилі; замінена після
// рев'ю): контракт `concern.json#lint` отримав нове поле `anchors`
// (`npm/scripts/lib/concern-meta.mjs`, схема `npm/schemas/concern.json`,
// доккомент `rules_core::lint_plan::plan_concern_for_delta` —
// `crates/rules-core/src/lint_plan.rs`). Planner (JS `plan_concern_for_delta`
// через native `buildLintPlan`) додає репо-relative шляхи з `lint.anchors`
// ДО НЕПОРОЖНЬОГО per-file delta-batch-у, навіть якщо самі якорі не
// змінювались; `read_source_files` (`crates/rules-napi/src/lib.rs`) тихо
// пропускає ті з них, яких немає на диску. Наслідок: гість бачить
// `pyproject.toml` у batch-і РІВНО тоді, коли він реально існує — без
// жодного `existsSync`-ходу диском і без ходу по всьому дереву на кожен
// тригер. `plugins/lang-python/rules/python/{mypy,ruff}/concern.json`
// декларують `"anchors": ["pyproject.toml"]` поряд зі своїм `"glob":
// ["**/*.py"]`.
//
// Ціна попередньої Full-scope спроби (ширший за дельту список цілей на
// кожен прогін — і, окремо, спавн тула навіть коли `.py`-файлів немає)
// зникає разом із нею: per-file delta дає `mypy`/`ruff` РІВНО змінені
// `.py`-файли (плюс якір), той самий контракт, що JS-канон.
//
// # Канал «тула немає» — ДВІ різні гілки, не одна (визначено функціонально)
//
// `preparePythonRun` має ДВІ окремі точки відмови з ПРОТИЛЕЖНОЮ
// реакцією:
// 1. `resolveCmd('uv')` повертає `null` → `fail('… \`uv\` не знайдено …',
//    'uv-missing')` — ЄДИНА гілка preflight, що видає violation.
// 2. `uvToolAvailable(uv, tool)` повертає `false` (тул не встановлений як
//    dev-залежність у uv-середовищі) → `return null` БЕЗ виклику `fail` —
//    тиша, fail-open, коментар JS-оригіналу: `// tool недоступний у
//    uv-середовищі → пропущено`.
// [`PythonRunPrep::UvMissing`]/[`PythonRunPrep::ToolUnavailable`] — точна
// структурна калька цих двох гілок; `exec_tool`'s `status: none` (тул не
// резолвлений host-`ToolResolver`-ом — `path:uv` відсутній у PATH) мапиться
// на гілку 1, ненульовий exit-код probe-виклику (`uv run --frozen <tool>
// --version`) — на гілку 2. Той самий розподіл `status: none`, що вже
// прийнятий для `bun/licensee` (`crates/plugin-lang-js/src/lib.rs`,
// «Розбіжність 1» тієї секції): охоплює і «тула немає», і «процес не
// стартував», і таймаут — усі три без реального exit-коду.

/// Декларація тула `python/mypy`+`python/ruff` — схема `path:` (рішення В
/// спеки `docs/specs/2026-08-01-plugin-contract-v31-surfaces.md`):
/// резолв по `PATH`, точний відповідник `resolveCmd('uv')` JS-оригіналу
/// (`uv-run.mjs`).
const UV_TOOL: &str = "path:uv";

/// `reason` violation-у «uv не знайдено» — точний відповідник літерала
/// `fail(msg, 'uv-missing')` (`uv-run.mjs::preparePythonRun`), СПІЛЬНИЙ для
/// обох концернів (той самий preflight).
const UV_MISSING_REASON: &str = "uv-missing";

/// Повідомлення «uv не знайдено» — точний відповідник рядкового літерала
/// `uv-run.mjs::preparePythonRun`.
const UV_MISSING_MESSAGE: &str =
    "lint-python: `uv` не знайдено в PATH (потрібен при наявному pyproject.toml, python.mdc)";

/// `reason` violation-у `python/mypy` — точний відповідник `fail(msg,
/// 'mypy-violation')` (`mypy/main.mjs`).
const MYPY_VIOLATION_REASON: &str = "mypy-violation";

/// `reason` violation-у кроку `ruff check` — точний відповідник `fail(msg,
/// 'ruff-check-violation')` (`ruff/main.mjs::runRuffStep`, виклик з
/// `args: ['check', ...targets]`).
const RUFF_CHECK_VIOLATION_REASON: &str = "ruff-check-violation";

/// `reason` violation-у кроку `ruff format --check` — точний відповідник
/// `fail(msg, 'ruff-format-violation')` (`ruff/main.mjs::runRuffStep`,
/// виклик з `args: ['format', '--check', ...targets]`).
const RUFF_FORMAT_VIOLATION_REASON: &str = "ruff-format-violation";

/// Ліміт довжини вставки чужого stdout/stderr у повідомлення — точний
/// відповідник `.slice(0, 2000)` обох `main.mjs` (`mypy`, `ruff`).
const PY_TOOL_DETAIL_LIMIT: usize = 2000;

/// Обрізає рядок до `limit` СИМВОЛІВ (не байтів) — той самий helper, що
/// `crates/plugin-lang-js/src/lib.rs::truncate_chars` (продубльований тут:
/// крейти не діляться кодом через wasm-межу, доккомент [`batch_file`]).
/// Наближення `String.prototype.slice` JS-оригіналу (той рахує UTF-16
/// code units); вивід `mypy`/`ruff` — здебільшого ASCII шляхи й
/// діагностики, де обидві міри збігаються.
fn truncate_chars(text: &str, limit: usize) -> String {
    match text.char_indices().nth(limit) {
        Some((index, _)) => text[..index].to_string(),
        None => text.to_string(),
    }
}

/// Результат спільного preflight [`prepare_python_run`] — структурна калька
/// гілок `preparePythonRun` (`uv-run.mjs`), доккомент секції «Канал "тула
/// немає"» вище.
enum PythonRunPrep {
    /// `pyproject.toml` відсутній у батчі, АБО в батчі немає жодного
    /// `.py`-файлу (`targets.length === 0` JS-оригіналу) — рання тиша, без
    /// `fail()`.
    Skip,
    /// `uv` не резолвиться — ЄДИНА гілка, що дає violation.
    UvMissing,
    /// `tool` (`mypy`/`ruff`) недоступний у uv-середовищі — тиша
    /// (fail-open), НЕ violation.
    ToolUnavailable,
    /// Preflight пройдено — конкретні `.py`-цілі для `uv run --frozen
    /// <tool>`.
    Ready { targets: Vec<String> },
}

/// Точний функціональний порт `preparePythonRun` (`uv-run.mjs`) — спільний
/// preflight `python/mypy`+`python/ruff`. `tool` — ім'я тула у
/// uv-середовищі (`"mypy"`/`"ruff"`), третій аргумент JS-оригіналу.
fn prepare_python_run(files: &[SourceFile], tool: &str) -> PythonRunPrep {
    // `existsSync(join(ctx.cwd, 'pyproject.toml'))` JS-оригіналу — тут
    // presence у батчі, куди planner додав якір `pyproject.toml`
    // (`lint.anchors`, доккомент секції «Per-file + якорі» вище).
    if batch_file(files, "pyproject.toml").is_none() {
        return PythonRunPrep::Skip;
    }

    // `ctx.files === undefined ? ['.'] : ctx.files.filter(PY_EXT_RE)`
    // JS-оригіналу — тут `.py`-файли переданого батчу (per-file delta-список
    // + якір, доккомент секції «Per-file + якорі»), не буквальний `'.'`.
    let targets: Vec<String> = files
        .iter()
        .filter(|file| file.path.ends_with(".py"))
        .map(|file| file.path.clone())
        .collect();
    if targets.is_empty() {
        return PythonRunPrep::Skip;
    }

    // `resolveCmd('uv')` + `uvToolAvailable(uv, tool)` JS-оригіналу — обидва
    // об'єднані в ОДИН `exec_tool`-probe (`uv run --frozen <tool>
    // --version`): `status: none` ⇒ гілка 1 (`uv` не резолвиться),
    // ненульовий код ⇒ гілка 2 (`tool` недоступний у uv-середовищі).
    let probe = exec_tool(&ToolRequest {
        tool: UV_TOOL.to_string(),
        args: vec![
            "run".to_string(),
            "--frozen".to_string(),
            tool.to_string(),
            "--version".to_string(),
        ],
        stdin: None,
        // `None` — корінь репо, рівно `cwd: undefined` (успадкований
        // `ctx.cwd`) JS-оригіналу.
        cwd: None,
        env: vec![],
        scratch_in: vec![],
        scratch_out: vec![],
    });
    let Some(status) = probe.status else {
        return PythonRunPrep::UvMissing;
    };
    if status != 0 {
        return PythonRunPrep::ToolUnavailable;
    }

    PythonRunPrep::Ready { targets }
}

/// Точний порт `lint()` `python/mypy`
/// (`plugins/lang-python/rules/python/mypy/main.mjs`).
fn detect_mypy(files: &[SourceFile]) -> Vec<Diagnostic> {
    let targets = match prepare_python_run(files, "mypy") {
        PythonRunPrep::Skip | PythonRunPrep::ToolUnavailable => return Vec::new(),
        PythonRunPrep::UvMissing => {
            return vec![plain_violation(
                UV_MISSING_REASON,
                UV_MISSING_MESSAGE.to_string(),
            )];
        }
        PythonRunPrep::Ready { targets } => targets,
    };

    let mut args = vec![
        "run".to_string(),
        "--frozen".to_string(),
        "mypy".to_string(),
    ];
    args.extend(targets);
    let result = exec_tool(&ToolRequest {
        tool: UV_TOOL.to_string(),
        args,
        stdin: None,
        cwd: None,
        env: vec![],
        scratch_in: vec![],
        scratch_out: vec![],
    });
    // `typeof r.exitCode === 'number' ? r.exitCode : 1` JS-оригіналу: після
    // успішного preflight будь-яка аномалія другого спавну (нема реального
    // exit-коду) все одно трактується як ПОРУШЕННЯ з кодом 1, НЕ як
    // «uv-missing» вдруге.
    let code = result.status.unwrap_or(1);
    if code == 0 {
        return Vec::new();
    }

    let combined = format!("{}{}", result.stdout, result.stderr);
    let out = truncate_chars(combined.trim(), PY_TOOL_DETAIL_LIMIT);
    let suffix = if out.is_empty() {
        String::new()
    } else {
        format!("\n{out}")
    };
    vec![plain_violation(
        MYPY_VIOLATION_REASON,
        format!("lint-python: mypy — помилка (код {code}, python.mdc){suffix}"),
    )]
}

/// Точний порт `runRuffStep` (`ruff/main.mjs`) — один крок `uv run --frozen
/// ruff <args_suffix>`. `Ok(())` — крок пройшов (`exitCode === 0`), `Err`
/// несе готову violation-діагностику того ж кроку.
fn run_ruff_step(label: &str, args_suffix: Vec<String>, reason: &str) -> Result<(), Diagnostic> {
    let mut args = vec![
        "run".to_string(),
        "--frozen".to_string(),
        "ruff".to_string(),
    ];
    args.extend(args_suffix);
    let result = exec_tool(&ToolRequest {
        tool: UV_TOOL.to_string(),
        args,
        stdin: None,
        cwd: None,
        env: vec![],
        scratch_in: vec![],
        scratch_out: vec![],
    });
    let code = result.status.unwrap_or(1);
    if code == 0 {
        return Ok(());
    }

    let combined = format!("{}{}", result.stdout, result.stderr);
    let out = truncate_chars(combined.trim(), PY_TOOL_DETAIL_LIMIT);
    let suffix = if out.is_empty() {
        String::new()
    } else {
        format!("\n{out}")
    };
    Err(plain_violation(
        reason,
        format!("lint-python: {label} — помилка (код {code}, python.mdc){suffix}"),
    ))
}

/// Точний порт `lint()` `python/ruff`
/// (`plugins/lang-python/rules/python/ruff/main.mjs`): `ruff check`, потім
/// (лише якщо перший крок пройшов) `ruff format --check` — рання відповідь
/// на першому провальному кроці.
fn detect_ruff(files: &[SourceFile]) -> Vec<Diagnostic> {
    let targets = match prepare_python_run(files, "ruff") {
        PythonRunPrep::Skip | PythonRunPrep::ToolUnavailable => return Vec::new(),
        PythonRunPrep::UvMissing => {
            return vec![plain_violation(
                UV_MISSING_REASON,
                UV_MISSING_MESSAGE.to_string(),
            )];
        }
        PythonRunPrep::Ready { targets } => targets,
    };

    let mut check_args = vec!["check".to_string()];
    check_args.extend(targets.iter().cloned());
    if let Err(diagnostic) = run_ruff_step("ruff check", check_args, RUFF_CHECK_VIOLATION_REASON) {
        return vec![diagnostic];
    }

    let mut format_args = vec!["format".to_string(), "--check".to_string()];
    format_args.extend(targets);
    match run_ruff_step(
        "ruff format --check",
        format_args,
        RUFF_FORMAT_VIOLATION_REASON,
    ) {
        Ok(()) => Vec::new(),
        Err(diagnostic) => vec![diagnostic],
    }
}

use std::collections::{HashMap, HashSet};

/// Мінімальний зріз `pyproject.toml`, потрібний [`detect_workspace_root`]:
/// наявність `[project]` (значення не важливе — `Option<IgnoredAny>` приймає
/// БУДЬ-яку валідну TOML-форму без падіння) і `[tool.uv.workspace]` з
/// `members`/`exclude`. `#[serde(default)]` на кожному полі — tolerant-парсинг,
/// той самий дух, що `smol-toml`-виклик JS-оригіналу (без схеми, невідомі
/// ключі мовчки ігноруються серд-дефолтом за відсутності
/// `#[serde(deny_unknown_fields)]`). Обґрунтування вибору `basic-toml`
/// замість `toml`/`toml_edit` — доккомент `Cargo.toml` біля залежності
/// (розмір: `basic-toml` ~183 KiB у release-wasm проти ~286 KiB у `toml`,
/// емпіричний вимір тим самим probe-методом, що й Unicode-фічі regex вище).
#[derive(serde::Deserialize, Default)]
struct WorkspaceRootPyproject {
    #[serde(default)]
    project: Option<serde::de::IgnoredAny>,
    #[serde(default)]
    tool: Option<WorkspaceRootTool>,
}

/// `[tool]`-таблиця — лише `uv`-підтаблиця цікавить цей концерн.
#[derive(serde::Deserialize, Default)]
struct WorkspaceRootTool {
    #[serde(default)]
    uv: Option<WorkspaceRootToolUv>,
}

/// `[tool.uv]`-таблиця — лише `workspace`-підтаблиця цікавить цей концерн.
#[derive(serde::Deserialize, Default)]
struct WorkspaceRootToolUv {
    #[serde(default)]
    workspace: Option<WorkspaceRootWorkspace>,
}

/// `[tool.uv.workspace]` — точний зріз `main.mjs`: `members`/`exclude`,
/// відсутність поля = порожній масив (той самий дефолт, що
/// `Array.isArray(workspace.members) ? workspace.members : []`).
#[derive(serde::Deserialize, Default)]
struct WorkspaceRootWorkspace {
    #[serde(default)]
    members: Vec<String>,
    #[serde(default)]
    exclude: Vec<String>,
}

/// Точний порт `readPyprojectManifest` (`npm/scripts/utils/uv-workspace.mjs`)
/// для вже наданого host-ом вмісту файлу (батч, не диск): `None` на
/// невалідний TOML — той самий catch-null JS-оригіналу. Файл, що ЗА ФАКТОМ
/// існує в батчі, але не парситься, поводиться нижче ідентично «файл
/// відсутній» — точна калька того, що `parsedByPath.get(rootManifestPath)`
/// дає `undefined`, коли `readPyprojectManifest` повернув `null`.
fn workspace_root_parse_pyproject(content: &str) -> Option<WorkspaceRootPyproject> {
    basic_toml::from_str(content).ok()
}

/// Чи лежить posix-relative шлях усередині одного з [`WORKSPACE_ROOT_IGNORED_DIR_NAMES`].
fn workspace_root_path_ignored(path: &str) -> bool {
    path.split('/')
        .any(|segment| WORKSPACE_ROOT_IGNORED_DIR_NAMES.contains(&segment))
}

/// Posix "dirname": усе до останнього `/` (без нього), чи `""` для
/// кореня. Той самий мотив, що `dirname()`/`relative(cwd, ...)`
/// JS-оригіналу, але без реального FS-виклику — батч-шлях уже
/// posix-relative до `cwd` (спека `wit/world.wit`), тож `relative()` тут
/// зайвий: шлях і так у потрібній формі.
fn workspace_root_dirname(path: &str) -> &str {
    match path.rfind('/') {
        Some(idx) => &path[..idx],
        None => "",
    }
}

/// Компілює `members`/`exclude`-патерн (літерал чи з одинарними `*`, БЕЗ
/// `**`) у прив'язаний regex — `*` не перетинає `/`, той самий обмежений
/// glob, що `Bun.Glob`/`node:fs/promises#glob` дають `scanGlob`
/// (`uv-workspace.mjs`) для патернів на кшталт `"packages/*"` (доккомент
/// `workspace_root.mdc`: «glob `*` підтримується мінімально»). Символи поза
/// `*` екрануються по одному — безпечно для будь-якого валідного вхідного
/// патерну, `None` лише як defensive fallback (skip-not-crash).
fn workspace_root_pattern_regex(pattern: &str) -> Option<regex::Regex> {
    let mut source = String::from("^");
    for ch in pattern.chars() {
        match ch {
            '*' => source.push_str("[^/]*"),
            c if "\\.+()|[]{}^$?".contains(c) => {
                source.push('\\');
                source.push(c);
            }
            c => source.push(c),
        }
    }
    source.push('$');
    regex::Regex::new(&source).ok()
}

/// Точний порт `resolveUvWorkspaceMemberDirs` (`uv-workspace.mjs`),
/// адаптований під wasm-гостя: замість `existsSync`/`scanGlob` по реальному
/// диску матчить `members`/`exclude`-патерни проти вже відомого набору
/// каталогів із знайденими `pyproject.toml` — того самого host-батчу, що
/// [`detect_workspace_root`] уже має (full-scope глоб покрив УСЕ дерево,
/// доккомент [`build_manifest`]), тож окремий FS-обхід тут не потрібен:
/// дані для «чи існує pyproject.toml у цьому каталозі» вже на руках.
fn workspace_root_resolve_member_dirs<'a>(
    known_dirs: &[&'a str],
    patterns: &[String],
) -> HashSet<&'a str> {
    let mut found = HashSet::new();
    for pattern in patterns {
        let norm = pattern.trim_end_matches('/');
        if norm.contains('*') {
            let Some(re) = workspace_root_pattern_regex(norm) else {
                continue;
            };
            for &dir in known_dirs {
                if re.is_match(dir) {
                    found.insert(dir);
                }
            }
        } else if let Some(&dir) = known_dirs.iter().find(|&&d| d == norm) {
            found.insert(dir);
        }
    }
    found
}

/// Діагностика з `file` (nested-workspace/package-not-workspace-member/
/// nested-lockfile) — точний відповідник `reporter.fail(msg, { reason, file })`
/// (`createViolationReporter`, `npm/scripts/lib/lint-surface/violation-reporter.mjs`):
/// `data` не встановлюється (`None`), той самий контракт, що [`plain_violation`].
fn workspace_root_file_violation(reason: &str, message: String, file: &str) -> Diagnostic {
    Diagnostic {
        reason: reason.to_string(),
        message,
        file: Some(file.to_string()),
        severity: Severity::Error,
        data: None,
    }
}

/// Точний порт `lint()` `python/workspace_root`
/// (`plugins/lang-python/rules/python/workspace_root/main.mjs`) — WHOLE-BATCH
/// (glob `["**/pyproject.toml", "**/uv.lock"]`, [`build_manifest`]), єдиний
/// концерн цього крейта, що сам обходить УСЕ дерево репозиторію (JS-оригінал
/// ігнорує `ctx.files` і ходить `readdirSync` напряму замість делти —
/// доккомент модуля, розділ «Наступна хвиля»). Host уже надав batch за
/// глобом (`build_full_scope_files`, `crates/rules-napi/src/lib.rs`), але
/// той поважає лише `.gitignore` + `ALWAYS_IGNORE`
/// (`.git`/`node_modules`/`.worktrees`) — решту `IGNORED_DIR_NAMES`
/// JS-оригіналу гість фільтрує сам ([`workspace_root_path_ignored`]).
/// `resolveUvWorkspaceMemberDirs` (реальний FS-обхід JS-оригіналу) замінено
/// матчем проти вже відомого host-набору каталогів
/// ([`workspace_root_resolve_member_dirs`]) — доккомент тієї функції.
fn detect_workspace_root(files: &[SourceFile]) -> Vec<Diagnostic> {
    let manifest_files: Vec<&SourceFile> = files
        .iter()
        .filter(|f| {
            (f.path == "pyproject.toml" || f.path.ends_with("/pyproject.toml"))
                && !workspace_root_path_ignored(&f.path)
        })
        .collect();
    let lock_files: Vec<&SourceFile> = files
        .iter()
        .filter(|f| {
            (f.path == "uv.lock" || f.path.ends_with("/uv.lock"))
                && !workspace_root_path_ignored(&f.path)
        })
        .collect();

    let parsed_by_path: HashMap<&str, Option<WorkspaceRootPyproject>> = manifest_files
        .iter()
        .map(|f| (f.path.as_str(), workspace_root_parse_pyproject(&f.content)))
        .collect();

    let package_manifest_paths: Vec<&str> = manifest_files
        .iter()
        .map(|f| f.path.as_str())
        .filter(|p| {
            parsed_by_path
                .get(p)
                .and_then(|opt| opt.as_ref())
                .is_some_and(|parsed| parsed.project.is_some())
        })
        .collect();
    // жодного Python-пакета (з [project]) у дереві — концерн не застосовний.
    if package_manifest_paths.is_empty() {
        return Vec::new();
    }

    let mut diagnostics = Vec::new();

    // reportNestedWorkspaces: будь-який НЕ кореневий манiфест із
    // `[tool.uv.workspace]` — завжди порушення.
    for file in &manifest_files {
        let path = file.path.as_str();
        if path == "pyproject.toml" {
            continue;
        }
        let has_workspace = parsed_by_path
            .get(path)
            .and_then(|opt| opt.as_ref())
            .and_then(|p| p.tool.as_ref())
            .and_then(|t| t.uv.as_ref())
            .and_then(|u| u.workspace.as_ref())
            .is_some();
        if has_workspace {
            diagnostics.push(workspace_root_file_violation(
                WORKSPACE_ROOT_NESTED_WORKSPACE_REASON,
                format!(
                    "{path}: вкладений [tool.uv.workspace] поза кореневим pyproject.toml — {WORKSPACE_ROOT_REMEDIATION}"
                ),
                path,
            ));
        }
    }

    let root_parsed = parsed_by_path
        .get("pyproject.toml")
        .and_then(|opt| opt.as_ref());
    let Some(root_parsed) = root_parsed else {
        diagnostics.push(plain_violation(
            WORKSPACE_ROOT_MISSING_ROOT_REASON,
            format!(
                "pyproject.toml відсутній у корені репозиторію, але знайдено {} package-маніфест(и). {WORKSPACE_ROOT_REMEDIATION}",
                package_manifest_paths.len()
            ),
        ));
        return diagnostics;
    };

    let other_package_manifest_paths: Vec<&str> = package_manifest_paths
        .iter()
        .copied()
        .filter(|&p| p != "pyproject.toml")
        .collect();

    let root_workspace = root_parsed
        .tool
        .as_ref()
        .and_then(|t| t.uv.as_ref())
        .and_then(|u| u.workspace.as_ref());

    let Some(root_workspace) = root_workspace else {
        if root_parsed.project.is_some() && other_package_manifest_paths.is_empty() {
            // Єдиний кореневий package — uv неявно робить його власним
            // workspace root. `pass(...)` — no-op, той самий мотив, що
            // `python/tooling` (уже накопичені nested-workspace діагностики
            // вище лишаються в результаті — точна калька раннього
            // `return reporter.result()` JS-оригіналу).
            return diagnostics;
        }
        diagnostics.push(plain_violation(
            WORKSPACE_ROOT_MISSING_ROOT_REASON,
            format!(
                "Кореневий pyproject.toml не є workspace root (немає [tool.uv.workspace]), а в репозиторії {} package-маніфест(и). {WORKSPACE_ROOT_REMEDIATION}",
                package_manifest_paths.len()
            ),
        ));
        return diagnostics;
    };

    let manifest_dirs: Vec<&str> = manifest_files
        .iter()
        .map(|f| workspace_root_dirname(&f.path))
        .collect();
    let member_dirs = workspace_root_resolve_member_dirs(&manifest_dirs, &root_workspace.members);
    let exclude_dirs = workspace_root_resolve_member_dirs(&manifest_dirs, &root_workspace.exclude);

    for &path in &other_package_manifest_paths {
        let dir = workspace_root_dirname(path);
        if exclude_dirs.contains(dir) || member_dirs.contains(dir) {
            continue;
        }
        diagnostics.push(workspace_root_file_violation(
            WORKSPACE_ROOT_PACKAGE_NOT_MEMBER_REASON,
            format!(
                "{path}: package не покритий members кореневого workspace — додай шлях у [tool.uv.workspace].members кореневого pyproject.toml (або відобрази у workspace.exclude — навмисний опт-аут з конфліктними залежностями). {WORKSPACE_ROOT_REMEDIATION}"
            ),
            path,
        ));
    }

    for lock in &lock_files {
        let path = lock.path.as_str();
        if path == "uv.lock" {
            continue;
        }
        let dir = workspace_root_dirname(path);
        if exclude_dirs.contains(dir) {
            continue;
        }
        diagnostics.push(workspace_root_file_violation(
            WORKSPACE_ROOT_NESTED_LOCKFILE_REASON,
            format!(
                "{path}: вкладений uv.lock поза кореневим workspace — lock лише кореневий (або каталог має бути у workspace.exclude, якщо це навмисний опт-аут). {WORKSPACE_ROOT_REMEDIATION}"
            ),
            path,
        ));
    }

    diagnostics
}

// =====================================================================
// `python/project` — друга хвиля порту: read-only lockfile-аудит `uv` +
// ліцензійна перевірка Blue Oak Council. Порт
// `plugins/lang-python/rules/python/project/main.mjs` (125 рядків,
// `concern.json.lint.scope: "full"`, БЕЗ `lint.glob` — lockfile-аудит і
// ліцензійна перевірка project-wide за природою, поза delta-планом,
// доккомент `main.mjs`).
//
// # `exec-tool` — той самий контур, що `bun/licensee`/`style/lint`
//
// Один тул (`path:uv`, схема `path:` — резолв по PATH, той самий мотив, що
// `path:bun`, `crates/plugin-lang-js::LICENSEE_TOOL`), ЧОТИРИ послідовні
// спавни через `exec-tool`: `uv lock --check` → `uv sync --frozen` → `uv run
// --frozen pip-licenses --version` (availability-перевірка) → `uv run
// --frozen pip-licenses --from=mixed --format=spdx-json` (сам скан).
// Короткий цикл зупинки дзеркалить JS-канон: перші два кроки на неуспіху
// повертають РАННЄ порушення й нічого далі не спавнять (точний порт `return
// reporter.result()` після кожного `runTool`), третій — тихо (без
// діагностики) пропускає решту при неуспіху (доккомент [`detect_project`],
// розділ «Fail-open гілка»).
//
// # Канал «інструмента немає» — РЕАЛЬНЕ порушення, не fail-open
//
// `resolveCmd('uv') === null` каноничного `main.mjs` веде до `fail(msg,
// 'uv-missing')` БЕЗ `opts.severity` — дефолтна severity
// (`createViolationReporter`, доккомент `violation-reporter.mjs`) є
// error-порушенням, що блокує гейт. Це НАВМИСНО інша поведінка, ніж
// `bun-missing`/`stylelint-unresolved` (`crates/plugin-lang-js`, обидва
// `Severity::Warn`, fail-open): `python/project` вимагає `uv` жорстко, коли
// `pyproject.toml` уже є. У гостя немає окремого «резолв без спавну» — сам
// перший `exec-tool` (`uv lock --check`) і є перевіркою наявності:
// `result.status: None` покриває і «uv поза PATH», і «процес не стартував»
// (та сама ширша семантика, що `bun-missing`), але РЕПОРТУЄТЬСЯ як звичайне
// `Error`-порушення ([`plain_violation`]) — точний відповідник семантики
// канону.
//
// # Blue Oak Council — вшитий snapshot, не читання диска
//
// [`BLUE_OAK_SNAPSHOT_JSON`] — `include_str!` ТОГО САМОГО файлу
// (`npm/data/blue-oak.json`), що читає `npm/scripts/lib/blue-oak.mjs`
// (`getBronzeAndAbove`) — той самий мотив, що `OXLINT_CANONICAL_JSON`
// (`crates/plugin-lang-js/src/lib.rs`): одне джерело правди — після
// `npm/scripts/update-blue-oak.mjs` компонент перезбирається з оновленим
// списком, а застарілий вшитий snapshot ловить анти-дрейф-тест
// [`blue_oak_snapshot_parses_and_matches_js_source`]. `blue-oak.mjs` САМ
// лишається JS — вшито лише ДАНІ, не логіку. Після зняття JS-детектора
// `python/project` (єдиного його імпортера) споживачів усередині монорепо в
// нього не лишилось, але це ОПУБЛІКОВАНА поверхня
// `@7n/rules/scripts/lib/blue-oak.mjs`: зовнішній плагін може імпортувати її,
// тож видалення — окреме breaking-рішення, не побічний ефект цієї хвилі
// (§2.15 реєстру). Попередня редакція цього доккоментаря називала іншу
// причину — «його ще споживає `update-blue-oak.mjs`»; це неправда, той скрипт
// лише ПИШЕ `npm/data/blue-oak.json` і нічого з `blue-oak.mjs` не імпортує.
//
// # Мінімальний JSON-парсер — чому не `serde_json`
//
// `pip-licenses --format=spdx-json` повертає повноцінний JSON-документ
// (масив пакетів), а snapshot Blue Oak — теж JSON. `serde_json` у
// `Cargo.toml` цього крейта немає (ні тут, ні в `plugin-lang-js` —
// доккомент `OXLINT_CANONICAL_JSON`/`JsonOrdered` там): вага крейта в
// size-бюджет гостя не виправдана заради двох точкових read-шляхів.
// [`JsonValue`]/[`JsonParser`] — свій мінімальний рекурсивний парсер, той
// самий мотив, простіший за `JsonOrdered`: порядок ключів об'єкта тут НЕ
// важливий (обидва споживачі читають за іменем поля, не серіалізують
// назад).
// =====================================================================

/// Ключ контрибуції `python/project` (друга хвиля порту).
const CONCERN_PROJECT: &str = "python/project";

/// Декларація тула в `manifest.tools` — схема `path:` (доккомент секції).
const PROJECT_TOOL: &str = "path:uv";

/// `reason` «`uv` не резолвиться» — точний відповідник `fail(msg,
/// 'uv-missing')` каноничного `main.mjs` (доккомент секції, розділ «Канал
/// „інструмента немає“»).
const PROJECT_UV_MISSING_REASON: &str = "uv-missing";

/// `reason` провалу `uv lock --check` — точний відповідник
/// `runTool(..., 'uv-lock-violation')`.
const PROJECT_UV_LOCK_VIOLATION_REASON: &str = "uv-lock-violation";

/// `reason` провалу `uv sync --frozen` — точний відповідник
/// `runTool(..., 'uv-sync-violation')`.
const PROJECT_UV_SYNC_VIOLATION_REASON: &str = "uv-sync-violation";

/// `reason` провалу самого спавну `pip-licenses` (НЕ ліцензійне порушення) —
/// точний відповідник `fail(..., 'pip-licenses-error')`.
const PROJECT_PIP_LICENSES_ERROR_REASON: &str = "pip-licenses-error";

/// `reason` ліцензійного порушення — точний відповідник `fail(...,
/// 'license-violation')`.
const PROJECT_LICENSE_VIOLATION_REASON: &str = "license-violation";

/// Ліміт вставки чужого stdout/stderr у повідомлення — порт `.slice(0,
/// 2000)` каноничного `runTool`.
const PROJECT_DETAIL_LIMIT: usize = 2000;

/// Вшитий Blue Oak Council snapshot (доккомент секції, розділ «Blue Oak
/// Council»).
const BLUE_OAK_SNAPSHOT_JSON: &str = include_str!("../../../npm/data/blue-oak.json");

/// Мінімальне (без сторонніх крейтів) представлення JSON-значення — лише те,
/// що потрібно для двох вузьких форм: снапшота Blue Oak
/// ([`BLUE_OAK_SNAPSHOT_JSON`]) і відповіді `pip-licenses
/// --format=spdx-json` (`{"packages":[{"name":...,"versionInfo":...,
/// "licenseDeclared":...,"licenseConcluded":...}, ...]}`) — доккомент
/// секції, розділ «Мінімальний JSON-парсер».
// `Bool`/`Number` — payload читає лише unit-тест
// ([`parse_json_reads_nested_object_array_and_escapes`]): продакшн-споживачі
// ([`get_bronze_and_above`]/[`extract_packages`]) читають лише
// `Str`/`Array`/`Object`, але варіанти МУСЯТЬ нести дані — інакше парсер не
// зможе коректно ПРОПУСТИТИ легітимні bool/number-поля деінде в документі
// (`pip-licenses` виводить й інші поля, не лише ті чотири, що нас
// цікавлять) без падіння в `Err`.
#[allow(dead_code)]
#[derive(Debug, Clone)]
enum JsonValue {
    Null,
    Bool(bool),
    Number(f64),
    Str(String),
    Array(Vec<JsonValue>),
    Object(Vec<(String, JsonValue)>),
}

impl JsonValue {
    /// `Some` лише для `JsonValue::Str` — той самий контракт, що
    /// `Option<&str>`-гілки JS-доступу (`pkg.name` тощо, де тип не рядок
    /// трактується як «поля немає»).
    fn as_str(&self) -> Option<&str> {
        match self {
            JsonValue::Str(s) => Some(s.as_str()),
            _ => None,
        }
    }

    /// `Some` лише для `JsonValue::Array`.
    fn as_array(&self) -> Option<&[JsonValue]> {
        match self {
            JsonValue::Array(items) => Some(items),
            _ => None,
        }
    }

    /// Пошук поля об'єкта за іменем — `None` і для «немає такого ключа», і
    /// для «це не об'єкт» (той самий контракт, що optional chaining `?.`
    /// JS-канону).
    fn get(&self, key: &str) -> Option<&JsonValue> {
        match self {
            JsonValue::Object(entries) => entries.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }
}

/// Рекурсивно-спусковий парсер [`JsonValue`] по байтах UTF-8 рядка.
/// Повертає `Err` на будь-яку синтаксичну помилку — той самий канал, що
/// `try { JSON.parse(...) } catch { ... }` JS-канону (обидва споживачі
/// [`parse_json`] трактують помилку як «даних немає», не як паніку).
struct JsonParser<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> JsonParser<'a> {
    fn new(input: &'a str) -> Self {
        Self {
            bytes: input.as_bytes(),
            pos: 0,
        }
    }

    fn parse(mut self) -> Result<JsonValue, String> {
        self.skip_ws();
        let value = self.parse_value()?;
        self.skip_ws();
        Ok(value)
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.pos += 1;
        }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    fn parse_value(&mut self) -> Result<JsonValue, String> {
        self.skip_ws();
        match self.peek() {
            Some(b'"') => self.parse_string().map(JsonValue::Str),
            Some(b'{') => self.parse_object(),
            Some(b'[') => self.parse_array(),
            Some(b't') => self.parse_literal("true", JsonValue::Bool(true)),
            Some(b'f') => self.parse_literal("false", JsonValue::Bool(false)),
            Some(b'n') => self.parse_literal("null", JsonValue::Null),
            Some(c) if c == b'-' || c.is_ascii_digit() => self.parse_number(),
            _ => Err("неочікуваний символ у JSON".to_string()),
        }
    }

    fn parse_literal(&mut self, lit: &str, value: JsonValue) -> Result<JsonValue, String> {
        let end = self.pos + lit.len();
        if self.bytes.get(self.pos..end) == Some(lit.as_bytes()) {
            self.pos = end;
            Ok(value)
        } else {
            Err(format!("очікував `{lit}`"))
        }
    }

    fn parse_number(&mut self) -> Result<JsonValue, String> {
        let start = self.pos;
        if self.peek() == Some(b'-') {
            self.pos += 1;
        }
        while matches!(self.peek(), Some(c) if c.is_ascii_digit() || matches!(c, b'.' | b'e' | b'E' | b'+' | b'-'))
        {
            self.pos += 1;
        }
        let slice = std::str::from_utf8(&self.bytes[start..self.pos])
            .map_err(|_| "невалідний UTF-8 у числі".to_string())?;
        slice
            .parse::<f64>()
            .map(JsonValue::Number)
            .map_err(|_| "невалідне число".to_string())
    }

    fn parse_string(&mut self) -> Result<String, String> {
        // Викликається лише коли `self.peek() == Some(b'"')`.
        self.pos += 1;
        let mut out = String::new();
        loop {
            match self.peek() {
                None => return Err("незакритий рядок".to_string()),
                Some(b'"') => {
                    self.pos += 1;
                    break;
                }
                Some(b'\\') => {
                    self.pos += 1;
                    match self.peek() {
                        Some(b'"') => {
                            out.push('"');
                            self.pos += 1;
                        }
                        Some(b'\\') => {
                            out.push('\\');
                            self.pos += 1;
                        }
                        Some(b'/') => {
                            out.push('/');
                            self.pos += 1;
                        }
                        Some(b'b') => {
                            out.push('\u{8}');
                            self.pos += 1;
                        }
                        Some(b'f') => {
                            out.push('\u{c}');
                            self.pos += 1;
                        }
                        Some(b'n') => {
                            out.push('\n');
                            self.pos += 1;
                        }
                        Some(b'r') => {
                            out.push('\r');
                            self.pos += 1;
                        }
                        Some(b't') => {
                            out.push('\t');
                            self.pos += 1;
                        }
                        Some(b'u') => {
                            self.pos += 1;
                            let code = self.parse_hex4()?;
                            if (0xD800..=0xDBFF).contains(&code) {
                                if self.bytes.get(self.pos..self.pos + 2) == Some(b"\\u") {
                                    self.pos += 2;
                                    let low = self.parse_hex4()?;
                                    let combined = 0x10000u32
                                        + ((u32::from(code) - 0xD800) << 10)
                                        + (u32::from(low) - 0xDC00);
                                    out.push(
                                        char::from_u32(combined).ok_or_else(|| {
                                            "невалідна сурогатна пара".to_string()
                                        })?,
                                    );
                                } else {
                                    return Err("незавершена сурогатна пара".to_string());
                                }
                            } else {
                                out.push(
                                    char::from_u32(u32::from(code))
                                        .ok_or_else(|| "невалідний \\u-escape".to_string())?,
                                );
                            }
                        }
                        _ => return Err("невідомий escape-символ".to_string()),
                    }
                }
                Some(_) => {
                    let rest = std::str::from_utf8(&self.bytes[self.pos..])
                        .map_err(|_| "невалідний UTF-8".to_string())?;
                    let ch = rest
                        .chars()
                        .next()
                        .ok_or_else(|| "порожній залишок рядка".to_string())?;
                    out.push(ch);
                    self.pos += ch.len_utf8();
                }
            }
        }
        Ok(out)
    }

    fn parse_hex4(&mut self) -> Result<u16, String> {
        let slice = self
            .bytes
            .get(self.pos..self.pos + 4)
            .ok_or_else(|| "незавершений \\u-escape".to_string())?;
        let text =
            std::str::from_utf8(slice).map_err(|_| "невалідний UTF-8 у \\u-escape".to_string())?;
        let code =
            u16::from_str_radix(text, 16).map_err(|_| "невалідний hex у \\u-escape".to_string())?;
        self.pos += 4;
        Ok(code)
    }

    fn parse_array(&mut self) -> Result<JsonValue, String> {
        self.pos += 1; // `[`
        let mut items = Vec::new();
        self.skip_ws();
        if self.peek() == Some(b']') {
            self.pos += 1;
            return Ok(JsonValue::Array(items));
        }
        loop {
            items.push(self.parse_value()?);
            self.skip_ws();
            match self.peek() {
                Some(b',') => self.pos += 1,
                Some(b']') => {
                    self.pos += 1;
                    break;
                }
                _ => return Err("очікував `,` або `]`".to_string()),
            }
        }
        Ok(JsonValue::Array(items))
    }

    fn parse_object(&mut self) -> Result<JsonValue, String> {
        self.pos += 1; // `{`
        let mut entries = Vec::new();
        self.skip_ws();
        if self.peek() == Some(b'}') {
            self.pos += 1;
            return Ok(JsonValue::Object(entries));
        }
        loop {
            self.skip_ws();
            if self.peek() != Some(b'"') {
                return Err("очікував ключ-рядок".to_string());
            }
            let key = self.parse_string()?;
            self.skip_ws();
            if self.peek() != Some(b':') {
                return Err("очікував `:`".to_string());
            }
            self.pos += 1;
            let value = self.parse_value()?;
            entries.push((key, value));
            self.skip_ws();
            match self.peek() {
                Some(b',') => self.pos += 1,
                Some(b'}') => {
                    self.pos += 1;
                    break;
                }
                _ => return Err("очікував `,` або `}`".to_string()),
            }
        }
        Ok(JsonValue::Object(entries))
    }
}

/// Розбирає `input` у [`JsonValue`] — точка входу для [`get_bronze_and_above`]
/// і [`extract_packages`].
fn parse_json(input: &str) -> Result<JsonValue, String> {
    JsonParser::new(input).parse()
}

/// Точний порт `getBronzeAndAbove` (`npm/scripts/lib/blue-oak.mjs`):
/// множина SPDX-ідентифікаторів Blue Oak Bronze і вище з вшитого снапшота
/// ([`BLUE_OAK_SNAPSHOT_JSON`]).
fn get_bronze_and_above() -> HashSet<String> {
    let value = parse_json(BLUE_OAK_SNAPSHOT_JSON).expect("BLUE_OAK_SNAPSHOT_JSON — валідний JSON");
    let items = value
        .get("bronzeAndAbove")
        .and_then(JsonValue::as_array)
        .expect("BLUE_OAK_SNAPSHOT_JSON.bronzeAndAbove — масив");
    items
        .iter()
        .filter_map(JsonValue::as_str)
        .map(str::to_string)
        .collect()
}

/// Точний порт `clean` (`blue-oak.mjs`): `s.trim().replaceAll(/^\(|\)$/g,
/// '')` — знімає обрамлювальні пробіли, тоді ОДИН провідний `(` і ОДИН
/// завершальний `)`, якщо вони є (регекс з альтернацією `^\(|\)$` на
/// практиці зачіпає не більш ніж по одному збігу з кожного боку).
fn clean_spdx(fragment: &str) -> String {
    let trimmed = fragment.trim();
    let without_leading = trimmed.strip_prefix('(').unwrap_or(trimmed);
    without_leading
        .strip_suffix(')')
        .unwrap_or(without_leading)
        .to_string()
}

/// Точний порт `isSpdxAllowed` (`blue-oak.mjs`): одиночний ID, `A AND B`
/// (усі мають бути дозволені) чи `A OR B` (будь-який дозволений).
/// `NOASSERTION`/`NONE`/порожній рядок — завжди `false`.
fn is_spdx_allowed(expression: &str, allowed: &HashSet<String>) -> bool {
    if expression.is_empty() || expression == "NOASSERTION" || expression == "NONE" {
        return false;
    }
    if expression.contains(" AND ") {
        return expression
            .split(" AND ")
            .all(|part| allowed.contains(&clean_spdx(part)));
    }
    if expression.contains(" OR ") {
        return expression
            .split(" OR ")
            .any(|part| allowed.contains(&clean_spdx(part)));
    }
    allowed.contains(&clean_spdx(expression))
}

/// Один запис `pip-licenses --format=spdx-json` — дзеркало JS-доступу
/// `pkg.name`/`pkg.versionInfo`/`pkg.licenseDeclared ?? pkg.licenseConcluded`
/// (`checkPipLicenses`, `main.mjs`).
struct LicenseInfo {
    name: String,
    version: String,
    license: String,
}

/// Точний порт зчитування `doc?.packages ?? []` (`checkPipLicenses`):
/// невалідний JSON чи відсутнє/нетипове поле `packages` — ПОРОЖНІЙ список
/// (не помилка) — той самий optional-chaining fail-open, що JS-канон, БЕЗ
/// жодної діагностики (відрізняється від [`PROJECT_PIP_LICENSES_ERROR_REASON`],
/// який ловить провал самого СПАВНУ, не парсингу його виводу).
fn extract_packages(stdout: &str) -> Vec<LicenseInfo> {
    let Ok(doc) = parse_json(stdout) else {
        return Vec::new();
    };
    let Some(packages) = doc.get("packages").and_then(JsonValue::as_array) else {
        return Vec::new();
    };
    packages
        .iter()
        .map(|pkg| LicenseInfo {
            name: pkg
                .get("name")
                .and_then(JsonValue::as_str)
                .unwrap_or_default()
                .to_string(),
            version: pkg
                .get("versionInfo")
                .and_then(JsonValue::as_str)
                .unwrap_or("?")
                .to_string(),
            license: pkg
                .get("licenseDeclared")
                .and_then(JsonValue::as_str)
                .or_else(|| pkg.get("licenseConcluded").and_then(JsonValue::as_str))
                .unwrap_or("NOASSERTION")
                .to_string(),
        })
        .collect()
}

/// Точний порт повідомлення `runTool` (`main.mjs`): `lint-python: ${label} —
/// помилка (код ${code}, python.mdc)${outSuffix}`, де `outSuffix` —
/// `stdout+stderr`, trim, зріз до [`PROJECT_DETAIL_LIMIT`], з провідним `\n`
/// лише якщо непорожній.
fn project_tool_error_message(label: &str, exit_code: i32, stdout: &str, stderr: &str) -> String {
    let combined = format!("{stdout}{stderr}");
    let out = truncate_chars(combined.trim(), PROJECT_DETAIL_LIMIT);
    let suffix = if out.is_empty() {
        String::new()
    } else {
        format!("\n{out}")
    };
    format!("lint-python: {label} — помилка (код {exit_code}, python.mdc){suffix}")
}

/// Діагностика «`uv` не резолвиться» — доккомент секції, розділ «Канал
/// „інструмента немає“».
fn project_uv_missing_diagnostic() -> Diagnostic {
    plain_violation(
        PROJECT_UV_MISSING_REASON,
        "lint-python: `uv` не знайдено в PATH (потрібен при наявному pyproject.toml, python.mdc)"
            .to_string(),
    )
}

/// Точний порт `lint()` `python/project` (`main.mjs`) — WHOLE-BATCH,
/// послідовний ланцюжок `exec-tool` (доккомент секції).
///
/// `files` несе рівно те, що канон читає з диска ПЕРЕД спавном:
/// `existsSync(join(cwd, 'pyproject.toml'))` — рання порожня відповідь, коли
/// репо не python-проєкт (глоб контрибуції звужений до цього ОДНОГО файлу,
/// той самий мотив, що `bun/licensee`).
fn detect_project(files: &[SourceFile]) -> Vec<Diagnostic> {
    if batch_file(files, "pyproject.toml").is_none() {
        return Vec::new();
    }

    let lock_result = exec_tool(&ToolRequest {
        tool: PROJECT_TOOL.to_string(),
        args: vec!["lock".to_string(), "--check".to_string()],
        stdin: None,
        // `None` — корінь репо (слот `repo-root@1`), рівно `cwd: ctx.cwd`
        // канону.
        cwd: None,
        env: vec![],
        scratch_in: vec![],
        scratch_out: vec![],
    });
    let Some(lock_exit) = lock_result.status else {
        return vec![project_uv_missing_diagnostic()];
    };
    if lock_exit != 0 {
        return vec![plain_violation(
            PROJECT_UV_LOCK_VIOLATION_REASON,
            project_tool_error_message(
                "uv lock --check",
                lock_exit,
                &lock_result.stdout,
                &lock_result.stderr,
            ),
        )];
    }

    let sync_result = exec_tool(&ToolRequest {
        tool: PROJECT_TOOL.to_string(),
        args: vec!["sync".to_string(), "--frozen".to_string()],
        stdin: None,
        cwd: None,
        env: vec![],
        scratch_in: vec![],
        scratch_out: vec![],
    });
    let Some(sync_exit) = sync_result.status else {
        return vec![project_uv_missing_diagnostic()];
    };
    if sync_exit != 0 {
        return vec![plain_violation(
            PROJECT_UV_SYNC_VIOLATION_REASON,
            project_tool_error_message(
                "uv sync --frozen",
                sync_exit,
                &sync_result.stdout,
                &sync_result.stderr,
            ),
        )];
    }

    // `pip-licenses` доступність — FAIL-OPEN (доккомент секції, розділ
    // «`exec-tool`…»): будь-який неуспіх тут ЗАВЕРШУЄ детектор МОВЧКИ, точний
    // порт `uvToolAvailable(...) → return true` (`checkPipLicenses`,
    // `main.mjs`) — немає ні `resolveCmd`-подібного жорсткого каналу (як
    // перші два кроки), ні окремого warn-каналу (як `bun/licensee`): це
    // ЄДИНИЙ по-справжньому беззвучний fail-open цього концерну.
    let availability = exec_tool(&ToolRequest {
        tool: PROJECT_TOOL.to_string(),
        args: vec![
            "run".to_string(),
            "--frozen".to_string(),
            "pip-licenses".to_string(),
            "--version".to_string(),
        ],
        stdin: None,
        // `None` тут ТЕЖ — розбіжність із канону (доккомент JS: `uvToolAvailable`
        // спавнить БЕЗ `cwd`, тобто успадковує cwd host-процесу оркестрації,
        // не обов'язково корінь репо). Той самий клас документованої
        // розбіжності, що `cwd: ctx.cwd` `bun/licensee`
        // (`crates/plugin-lang-js`): у типовому виклику (оркестрація стартує
        // з кореня репо) поведінка збігається, різниться лише в нетиповому
        // cwd виклику хоста.
        cwd: None,
        env: vec![],
        scratch_in: vec![],
        scratch_out: vec![],
    });
    if availability.status != Some(0) {
        return Vec::new();
    }

    let scan_result = exec_tool(&ToolRequest {
        tool: PROJECT_TOOL.to_string(),
        args: vec![
            "run".to_string(),
            "--frozen".to_string(),
            "pip-licenses".to_string(),
            "--from=mixed".to_string(),
            "--format=spdx-json".to_string(),
        ],
        stdin: None,
        cwd: None,
        env: vec![],
        scratch_in: vec![],
        scratch_out: vec![],
    });
    if scan_result.status != Some(0) {
        return vec![plain_violation(
            PROJECT_PIP_LICENSES_ERROR_REASON,
            "lint-python: pip-licenses — помилка виконання".to_string(),
        )];
    }

    let allowed = get_bronze_and_above();
    let packages = extract_packages(&scan_result.stdout);
    let violating: Vec<&LicenseInfo> = packages
        .iter()
        .filter(|pkg| !is_spdx_allowed(&pkg.license, &allowed))
        .collect();
    if violating.is_empty() {
        return Vec::new();
    }

    let list = violating
        .iter()
        .map(|pkg| format!("  ✗ {}@{}: {}", pkg.name, pkg.version, pkg.license))
        .collect::<Vec<_>>()
        .join("\n");
    vec![plain_violation(
        PROJECT_LICENSE_VIOLATION_REASON,
        format!(
            "lint-python: pip-licenses — {} пакет(ів) поза Blue Oak Bronze+ (python.mdc)\n{list}",
            violating.len()
        ),
    )]
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
            // PerFile, як `CONCERN_DOC_COMMENTS` — `pyproject.toml` до batch-у
            // приносить НЕ цей glob, а `lint.anchors` відповідного
            // `concern.json` (доккомент секції «`python/mypy` +
            // `python/ruff`» перед цією функцією, розділ «Per-file + якорі»).
            ConcernContribution {
                key: CONCERN_MYPY.to_string(),
                scope: ConcernScope::PerFile,
                glob: vec!["**/*.py".to_string()],
            },
            ConcernContribution {
                key: CONCERN_RUFF.to_string(),
                scope: ConcernScope::PerFile,
                glob: vec!["**/*.py".to_string()],
            },
            ConcernContribution {
                key: CONCERN_WORKSPACE_ROOT.to_string(),
                scope: ConcernScope::Full,
                glob: vec!["**/pyproject.toml".to_string(), "**/uv.lock".to_string()],
            },
            // наявність `pyproject.toml`, решту вердикту дає ланцюжок
            // `exec-tool` (той самий мотив, що `bun/licensee`,
            // `crates/plugin-lang-js`).
            ConcernContribution {
                key: CONCERN_PROJECT.to_string(),
                scope: ConcernScope::Full,
                glob: vec!["pyproject.toml".to_string()],
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
        // `python/mypy`+`python/ruff` — перші споживачі `run-tool`/`exec-tool`
        // цього крейта (доккомент секції перед цією функцією), обидва йдуть
        // через `uv run --frozen`, тож ОДНА декларація [`UV_TOOL`] на двох.
        tools: vec![UV_TOOL.to_string()],
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
            // PerFile, АЛЕ один `exec-tool`-виклик на ВЕСЬ переданий batch,
            // не на файл (мотив [`prepare_python_run`]: `mypy`/`ruff` самі
            // приймають список цілей одним запуском) — прогрес звітується
            // одним кроком, як `CONCERN_TOOLING`.
            CONCERN_MYPY => {
                report_progress(total, total);
                detect_mypy(&batch.files)
            }
            CONCERN_RUFF => {
                report_progress(total, total);
                detect_ruff(&batch.files)
            }
            CONCERN_WORKSPACE_ROOT => {
                report_progress(total, total);
                detect_workspace_root(&batch.files)
            }
            CONCERN_PROJECT => {
                report_progress(total, total);
                detect_project(&batch.files)
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

    /// Хвіст імені — ASCII-only, як JS-`\w` (ECMA-262), а не Unicode-`\w`
    /// крейта `regex`: на `def aоблік` JS-канон захоплював саме `a`
    /// (доккомент [`DOC_COMMENTS_PUBLIC_DEF_PATTERN`]). Перевіряє `data.name`,
    /// бо множина порушень тут збігається в обох семантиках — розходився лише
    /// текст. Другий випадок (`def облік`) фіксує, що ім'я, яке ПОЧИНАЄТЬСЯ
    /// не з ASCII, не розпізнається як pub-елемент узагалі — і ніколи не
    /// розпізнавалось.
    #[test]
    fn detect_doc_comments_name_tail_is_ascii_only_like_js() {
        let files = vec![sf(
            "pkg/mod.py",
            "\"\"\"М.\"\"\"\n\n\ndef aоблік():\n    return 1\n",
        )];
        let diagnostics = detect_doc_comments(&files);
        assert_eq!(diagnostics.len(), 1);
        let data = diagnostics[0].data.as_deref().expect("data є");
        assert!(
            data.contains("\"name\":\"a\""),
            "очікували ім'я \"a\", отримали {data}"
        );

        let cyrillic_head = vec![sf(
            "pkg/b.py",
            "\"\"\"М.\"\"\"\n\n\ndef облік():\n    return 1\n",
        )];
        assert!(detect_doc_comments(&cyrillic_head).is_empty());
    }

    /// Порт `doc_comments.test.mjs::'_приватні def і class поза вимогою;
    /// async def ловиться'` — `_internal` (приватний, з-під
    /// `[A-Za-z]\w*`-предиката) НЕ входить у `defs` і не впливає на
    /// перелік порушень, а `async def` розпізнається [`DOC_COMMENTS_PUBLIC_DEF_PATTERN`]
    /// нарівні зі звичайним `def` (група `(?:async\s+)?` перед `(def|class)`)
    /// — жодного #[test] цю гілку ще не займав.
    #[test]
    fn detect_doc_comments_flags_async_def_and_skips_private_def() {
        let src = "\"\"\"М.\"\"\"\n\ndef _internal():\n    return 1\n\nasync def fetch_data():\n    return 2\n";
        let files = vec![sf("pkg/mod.py", src)];
        let diagnostics = detect_doc_comments(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, DOC_COMMENTS_MISSING_DEF_REASON);
        assert!(diagnostics[0].message.contains("fetch_data"));
        let data = diagnostics[0].data.as_deref().expect("data є");
        assert!(data.contains("\"name\":\"fetch_data\""));
    }

    /// Порт `doc_comments.test.mjs::'shebang/коментарі/from __future__ перед
    /// module-docstring — ок'` — [`has_module_docstring`] пропускає
    /// shebang/коментарі/порожні рядки (`header_skip_re`) і
    /// `from __future__ import ...` (`future_import_re`) ДО пошуку
    /// module-docstring; жоден наявний тест цей preflight не зачіпає (усі
    /// інші фікстури починаються з docstring на рядку 0).
    #[test]
    fn detect_doc_comments_module_docstring_after_shebang_and_future_import() {
        let src = "#!/usr/bin/env python\nfrom __future__ import annotations\n\"\"\"Намір.\"\"\"\n\ndef go():\n    \"\"\"X.\"\"\"\n    return 1\n";
        let files = vec![sf("pkg/mod.py", src)];
        assert!(detect_doc_comments(&files).is_empty());
    }

    // --- build_manifest ---

    #[test]
    fn build_manifest_declares_all_concerns_with_expected_scopes() {
        let manifest = build_manifest();
        assert_eq!(manifest.id, "python/wasm-concerns");
        assert_eq!(manifest.world_version, "3.1.0");
        assert_eq!(manifest.domains, vec![Domain::Lint]);
        // Сім — увесь `lang-python`: `applies`/`tooling`/`doc_comments`
        // (перша хвиля), `mypy`/`ruff` (друга), `workspace_root`/`project`
        // (третя). Число росте лише разом із `describe()`, і розбіжність
        // ловить анти-дрейф `plugin_toml_concern_keys_match_describe`.
        assert_eq!(manifest.concerns.len(), 7);
        assert_eq!(manifest.tools, vec![UV_TOOL.to_string()]);
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

    // --- python/mypy + python/ruff (друга хвиля) ---
    //
    // Тут — лише ЧИСТІ гілки: `detect_mypy`/`detect_ruff`/`run_ruff_step` і
    // `prepare_python_run` за межею `Skip` кличуть host-імпорт `exec-tool`,
    // який поза реальним wasmtime-хостом абортує (той самий мотив, що
    // `crates/plugin-lang-js/src/lib.rs`, коментар над тестами
    // `bun/licensee`). Живий контур (реальний спавн через фейковий `uv`) —
    // `npm/scripts/lib/lint-surface/tests/wasm-plugin-parity-python.test.mjs`.

    #[test]
    fn truncate_chars_cuts_on_char_boundary_not_bytes() {
        // Кирилиця — 2 байти на символ: байтовий зріз на 3 розрубав би
        // послідовність і запанікував би.
        // cspell:disable-next-line
        assert_eq!(truncate_chars("абвгд", 3), "абв");
        assert_eq!(truncate_chars("abc", 10), "abc");
        assert_eq!(truncate_chars("", 5), "");
    }

    #[test]
    fn prepare_python_run_skips_without_pyproject_toml_in_batch() {
        // `existsSync(join(ctx.cwd, 'pyproject.toml'))` JS-оригіналу — рання
        // тиша, ДО будь-якого `exec_tool`, тож безпечно на host-таргеті.
        let files = vec![sf("pkg/mod.py", "def run():\n    return 1\n")];
        assert!(matches!(
            prepare_python_run(&files, "mypy"),
            PythonRunPrep::Skip
        ));
    }

    #[test]
    fn prepare_python_run_skips_when_batch_has_no_python_files() {
        // `targets.length === 0` JS-оригіналу — теж рання тиша, ДО
        // `exec_tool` (`uv`-probe для доступності tool-а в середовищі).
        let files = vec![sf("pyproject.toml", "[project]\nname = \"demo\"\n")];
        assert!(matches!(
            prepare_python_run(&files, "ruff"),
            PythonRunPrep::Skip
        ));
    }

    #[test]
    fn build_manifest_declares_mypy_and_ruff_as_per_file_with_uv_tool() {
        let manifest = build_manifest();
        for key in [CONCERN_MYPY, CONCERN_RUFF] {
            let contribution = manifest
                .concerns
                .iter()
                .find(|c| c.key == key)
                .unwrap_or_else(|| panic!("{key} contribution має бути в маніфесті"));
            // PerFile, як `CONCERN_DOC_COMMENTS` — `pyproject.toml` до
            // batch-у приносить `lint.anchors` відповідного `concern.json`
            // (JS-планувальник), НЕ ця glob-декларація (доккомент секції
            // «`python/mypy` + `python/ruff`», розділ «Per-file + якорі»).
            assert_eq!(contribution.scope, ConcernScope::PerFile);
            assert_eq!(contribution.glob, vec!["**/*.py".to_string()]);
        }
        assert_eq!(manifest.tools, vec![UV_TOOL.to_string()]);
    }
    // --- python/workspace_root ---
    //
    // Сценарії дзеркалять `plugins/lang-python/rules/python/workspace_root/
    // tests/workspace_root.test.mjs` (букви a–g — той самий порядок і той
    // самий підпис сценарію в коментарі тесту).

    #[test]
    fn detect_workspace_root_a_root_workspace_covers_all_members_is_clean() {
        let files = vec![
            sf(
                "pyproject.toml",
                "[tool.uv.workspace]\nmembers = [\"packages/a\", \"packages/b\"]\n",
            ),
            sf("packages/a/pyproject.toml", "[project]\nname = \"a\"\n"),
            sf("packages/b/pyproject.toml", "[project]\nname = \"b\"\n"),
            sf("uv.lock", "version = 1\n"),
        ];
        assert!(detect_workspace_root(&files).is_empty());
    }

    #[test]
    fn detect_workspace_root_b_package_without_any_root_workspace_is_missing_root() {
        let files = vec![sf("packages/a/pyproject.toml", "[project]\nname = \"a\"\n")];
        let diagnostics = detect_workspace_root(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, WORKSPACE_ROOT_MISSING_ROOT_REASON);
        assert!(diagnostics[0].file.is_none());
        assert!(diagnostics[0]
            .message
            .contains("pyproject.toml відсутній у корені"));
    }

    #[test]
    fn detect_workspace_root_c_solo_root_project_without_children_is_clean() {
        let files = vec![
            sf("pyproject.toml", "[project]\nname = \"solo\"\n"),
            sf("uv.lock", "version = 1\n"),
        ];
        assert!(detect_workspace_root(&files).is_empty());
    }

    #[test]
    fn detect_workspace_root_d_nested_workspace_below_root_is_flagged() {
        let files = vec![
            sf(
                "pyproject.toml",
                "[tool.uv.workspace]\nmembers = [\"packages/a\"]\n",
            ),
            sf("packages/a/pyproject.toml", "[project]\nname = \"a\"\n"),
            sf(
                "nested/pyproject.toml",
                "[tool.uv.workspace]\nmembers = [\"sub\"]\n",
            ),
            sf("nested/sub/pyproject.toml", "[project]\nname = \"sub\"\n"),
        ];
        let diagnostics = detect_workspace_root(&files);
        assert!(diagnostics
            .iter()
            .any(|d| d.reason == WORKSPACE_ROOT_NESTED_WORKSPACE_REASON
                && d.file.as_deref() == Some("nested/pyproject.toml")));
    }

    #[test]
    fn detect_workspace_root_e_package_not_covered_by_members_is_flagged() {
        let files = vec![
            sf(
                "pyproject.toml",
                "[tool.uv.workspace]\nmembers = [\"packages/a\"]\n",
            ),
            sf("packages/a/pyproject.toml", "[project]\nname = \"a\"\n"),
            sf(
                "packages/orphan/pyproject.toml",
                "[project]\nname = \"orphan\"\n",
            ),
        ];
        let diagnostics = detect_workspace_root(&files);
        assert!(diagnostics
            .iter()
            .any(|d| d.reason == WORKSPACE_ROOT_PACKAGE_NOT_MEMBER_REASON
                && d.file.as_deref() == Some("packages/orphan/pyproject.toml")));
    }

    #[test]
    fn detect_workspace_root_f_nested_lockfile_in_non_excluded_member_is_flagged() {
        let files = vec![
            sf(
                "pyproject.toml",
                "[tool.uv.workspace]\nmembers = [\"packages/a\"]\n",
            ),
            sf("packages/a/pyproject.toml", "[project]\nname = \"a\"\n"),
            sf("uv.lock", "version = 1\n"),
            sf("packages/a/uv.lock", "version = 1\n"),
        ];
        let diagnostics = detect_workspace_root(&files);
        assert!(diagnostics
            .iter()
            .any(|d| d.reason == WORKSPACE_ROOT_NESTED_LOCKFILE_REASON
                && d.file.as_deref() == Some("packages/a/uv.lock")));
    }

    #[test]
    fn detect_workspace_root_g_nested_lockfile_in_excluded_member_is_clean() {
        let files = vec![
            sf(
                "pyproject.toml",
                "[tool.uv.workspace]\nmembers = [\"packages/*\"]\nexclude = [\"packages/conflicting\"]\n",
            ),
            sf("packages/a/pyproject.toml", "[project]\nname = \"a\"\n"),
            sf(
                "packages/conflicting/pyproject.toml",
                "[project]\nname = \"conflicting\"\n",
            ),
            sf("uv.lock", "version = 1\n"),
            sf("packages/conflicting/uv.lock", "version = 1\n"),
        ];
        assert!(detect_workspace_root(&files).is_empty());
    }

    #[test]
    fn detect_workspace_root_no_pyproject_with_project_is_not_applicable() {
        let files = vec![sf("app.py", "print('hi')\n")];
        assert!(detect_workspace_root(&files).is_empty());
    }

    #[test]
    fn detect_workspace_root_virtual_root_without_project_covers_members() {
        let files = vec![
            sf(
                "pyproject.toml",
                "[tool.uv.workspace]\nmembers = [\"packages/a\"]\n",
            ),
            sf("packages/a/pyproject.toml", "[project]\nname = \"a\"\n"),
            sf("uv.lock", "version = 1\n"),
        ];
        assert!(detect_workspace_root(&files).is_empty());
    }

    #[test]
    fn detect_workspace_root_ignores_venv_and_node_modules_directories() {
        // Host-глоб (`**/pyproject.toml`) НЕ фільтрує `.venv`/`node_modules`
        // сам (доккомент [`WORKSPACE_ROOT_IGNORED_DIR_NAMES`]) — тут
        // імітується batch, у якому host уже їх поклав (гірший випадок), і
        // перевіряється, що [`workspace_root_path_ignored`] їх все одно
        // відфільтровує.
        let files = vec![
            sf(
                "pyproject.toml",
                "[tool.uv.workspace]\nmembers = [\"packages/a\"]\n",
            ),
            sf("packages/a/pyproject.toml", "[project]\nname = \"a\"\n"),
            sf(
                ".venv/lib/site-packages/foo/pyproject.toml",
                "[project]\nname = \"ignored\"\n",
            ),
            sf(
                "node_modules/pkg/pyproject.toml",
                "[project]\nname = \"ignored2\"\n",
            ),
        ];
        assert!(detect_workspace_root(&files).is_empty());
    }

    #[test]
    fn detect_workspace_root_unparseable_root_toml_is_treated_as_missing_root() {
        // Точна калька `readPyprojectManifest`'s catch-null: файл ІСНУЄ в
        // батчі, але невалідний TOML — root-манiфест трактується як
        // відсутній (`parsedByPath.get(rootManifestPath) ?? null`).
        let files = vec![
            sf("pyproject.toml", "not valid toml [[[\n"),
            sf("packages/a/pyproject.toml", "[project]\nname = \"a\"\n"),
        ];
        let diagnostics = detect_workspace_root(&files);
        assert!(diagnostics
            .iter()
            .any(|d| d.reason == WORKSPACE_ROOT_MISSING_ROOT_REASON && d.file.is_none()));
    }

    #[test]
    fn detect_workspace_root_root_without_workspace_and_multiple_packages_is_missing_root() {
        let files = vec![
            sf("pyproject.toml", "[project]\nname = \"root\"\n"),
            sf("packages/a/pyproject.toml", "[project]\nname = \"a\"\n"),
        ];
        let diagnostics = detect_workspace_root(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, WORKSPACE_ROOT_MISSING_ROOT_REASON);
        assert!(diagnostics[0]
            .message
            .contains("не є workspace root (немає [tool.uv.workspace])"));
    }

    #[test]
    fn parse_json_reads_nested_object_array_and_escapes() {
        let value =
            parse_json(r#"{"a":[1,"x\"y",null,true],"b":{"c":-1.5}}"#).expect("валідний JSON");
        let array = value
            .get("a")
            .and_then(JsonValue::as_array)
            .expect("a — масив");
        assert_eq!(array.len(), 4);
        assert_eq!(array[1].as_str(), Some("x\"y"));
        let nested = value.get("b").and_then(|b| b.get("c")).expect("b.c є");
        assert!(matches!(nested, JsonValue::Number(n) if (*n - (-1.5)).abs() < f64::EPSILON));
    }

    #[test]
    fn parse_json_rejects_malformed_input() {
        assert!(parse_json("{not json}").is_err());
        assert!(parse_json("").is_err());
    }

    #[test]
    fn parse_json_decodes_unicode_escape_and_surrogate_pair() {
        // `A` — проста escape-послідовність; `🎉` — сурогатна
        // пара (🎉, за межами BMP) — обидва канали [`JsonParser::parse_string`].
        let value = parse_json(r#""A🎉""#).expect("валідний рядок");
        assert_eq!(value.as_str(), Some("A🎉"));
    }

    /// Анти-дрейф вшитого асета: `include_str!` вказує на ТОЙ САМИЙ файл, що
    /// читає JS-канон (`npm/scripts/lib/blue-oak.mjs::DATA_PATH`) — він
    /// лишається валідним JSON з очікуваними Bronze+ ідентифікаторами
    /// (доккомент секції `python/project`, розділ «Blue Oak Council»).
    #[test]
    fn blue_oak_snapshot_parses_and_matches_js_source() {
        let allowed = get_bronze_and_above();
        assert!(allowed.contains("MIT"));
        assert!(allowed.contains("Apache-2.0"));
        assert!(allowed.contains("BlueOak-1.0.0"));
        // GPL-родина НЕ Bronze+ (copyleft, поза Blue Oak permissive-списком) —
        // негативний контроль, щоб тест не пройшов на порожній множині.
        assert!(!allowed.contains("GPL-3.0-only"));
        assert!(
            allowed.len() > 100,
            "snapshot має містити ~153 ідентифікатори, отримано {}",
            allowed.len()
        );
    }

    #[test]
    fn clean_spdx_strips_surrounding_parens_and_whitespace() {
        assert_eq!(clean_spdx("  MIT  "), "MIT");
        assert_eq!(clean_spdx("(MIT)"), "MIT");
        assert_eq!(clean_spdx(" (Apache-2.0) "), "Apache-2.0");
    }

    #[test]
    fn is_spdx_allowed_rejects_noassertion_and_none_and_empty() {
        let allowed = get_bronze_and_above();
        assert!(!is_spdx_allowed("NOASSERTION", &allowed));
        assert!(!is_spdx_allowed("NONE", &allowed));
        assert!(!is_spdx_allowed("", &allowed));
    }

    #[test]
    fn is_spdx_allowed_single_identifier() {
        let allowed = get_bronze_and_above();
        assert!(is_spdx_allowed("MIT", &allowed));
        assert!(!is_spdx_allowed("GPL-3.0-only", &allowed));
    }

    #[test]
    fn is_spdx_allowed_or_expression_needs_any_allowed() {
        let allowed = get_bronze_and_above();
        assert!(is_spdx_allowed("MIT OR Apache-2.0", &allowed));
        assert!(is_spdx_allowed("GPL-3.0-only OR MIT", &allowed));
        assert!(!is_spdx_allowed("GPL-3.0-only OR AGPL-3.0-only", &allowed));
    }

    #[test]
    fn is_spdx_allowed_and_expression_needs_all_allowed() {
        let allowed = get_bronze_and_above();
        assert!(is_spdx_allowed("MIT AND Apache-2.0", &allowed));
        assert!(!is_spdx_allowed("MIT AND GPL-3.0-only", &allowed));
    }

    #[test]
    fn extract_packages_reads_name_version_and_license_fallback() {
        let stdout = r#"{"packages":[
            {"name":"pkg-a","versionInfo":"1.0.0","licenseDeclared":"MIT"},
            {"name":"pkg-b","licenseConcluded":"Apache-2.0"},
            {"name":"pkg-c"}
        ]}"#;
        let packages = extract_packages(stdout);
        assert_eq!(packages.len(), 3);
        assert_eq!(packages[0].name, "pkg-a");
        assert_eq!(packages[0].version, "1.0.0");
        assert_eq!(packages[0].license, "MIT");
        // `versionInfo` відсутній → `'?'` (точний порт `pkg.versionInfo ?? '?'`).
        assert_eq!(packages[1].version, "?");
        // `licenseDeclared` відсутній → фолбек на `licenseConcluded`.
        assert_eq!(packages[1].license, "Apache-2.0");
        // Ні `licenseDeclared`, ні `licenseConcluded` → `'NOASSERTION'`.
        assert_eq!(packages[2].license, "NOASSERTION");
    }

    #[test]
    fn extract_packages_on_malformed_json_returns_empty_not_error() {
        // Точний порт `doc?.packages ?? []` (`checkPipLicenses`, `main.mjs`)
        // після невдалого `JSON.parse` — fail-open без діагностики.
        assert!(extract_packages("не json").is_empty());
        assert!(extract_packages(r#"{"no_packages_key":true}"#).is_empty());
    }

    #[test]
    fn project_tool_error_message_matches_run_tool_format() {
        let message = project_tool_error_message("uv lock --check", 1, "out\n", "err\n");
        assert_eq!(
            message,
            "lint-python: uv lock --check — помилка (код 1, python.mdc)\nout\nerr"
        );
    }

    #[test]
    fn project_tool_error_message_omits_suffix_when_output_empty() {
        let message = project_tool_error_message("uv sync --frozen", 2, "", "");
        assert_eq!(
            message,
            "lint-python: uv sync --frozen — помилка (код 2, python.mdc)"
        );
    }
}
