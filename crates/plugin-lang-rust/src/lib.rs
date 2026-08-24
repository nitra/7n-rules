//! wasm-компонент `n-rules:plugin@3.1.0` — `rust/wasm-concerns`, ТРЕТІЙ
//! first-party wasm-гість репозиторію (перший — `crates/plugin-lang-js`,
//! другий — `crates/plugin-lang-python`, доккомент того `src/lib.rs`
//! пояснює саму форму), створений за тим самим флоу скіла
//! `npm/skills/wasm-plugin/`. ПЕРША ХВИЛЯ порту: рівно три концерни
//! `rust/*` (`plugins/lang-rust/rules/rust/*`):
//!
//! - `rust/applies` (full-scope) — порт
//!   `plugins/lang-rust/rules/rust/applies/main.mjs`: чистий context-pass,
//!   реальний гейт застосовності декларативний (`rust/main.json:applies`),
//!   цей концерн НІКОЛИ не видає діагностику ([`detect_applies`]).
//! - `rust/doc_comments` (per-file) — порт
//!   `plugins/lang-rust/rules/rust/doc_comments/main.mjs`: рекомендовані
//!   вимоги до rustdoc-коментарів (провідний `//!`-header + `///` над кожним
//!   top-level `pub`-елементом). T0-фіксер (`fix-doc_comments.mjs`, JS)
//!   СВІДОМО поза обсягом цієї хвилі — `Guest::fix` повертає порожній план
//!   для цього концерну, як і для решти ([`Guest::fix`]).
//! - `rust/workspace_root` (full-scope) — порт
//!   `plugins/lang-rust/rules/rust/workspace_root/main.mjs`: репозиторій має
//!   мати рівно один кореневий Cargo workspace. Єдиний концерн цього крейта,
//!   що сам обходить УСЕ дерево репозиторію (JS-оригінал ігнорує `ctx.files`
//!   і ходить `readdirSync` напряму замість делти — той самий мотив, що
//!   `python/workspace_root`, доккомент `crates/plugin-lang-python/src/lib.rs`).
//!
//! # Обхід дерева — чому в гості немає обходу файлової системи
//!
//! Той самий принцип, що вже живе в `plugin-lang-js`/`plugin-lang-python`:
//! обхід файлової системи робить ВИКЛЮЧНО хост. `rust/doc_comments` —
//! `ConcernContribution { scope: PerFile, glob: ["**/*.rs"] }` у
//! [`build_manifest`]: коли виклик не передає явний список файлів, хост сам
//! будує `detect-batch.files` за цим glob-ом — [`detect_doc_comments`] лише
//! фільтрує вже надані host-ом файли через [`is_doc_comment_target`] (порт
//! `EXCLUDED_FILE_RE`), точнісінько як `.rs`-розширення й тестові каталоги
//! фільтрує JS-оригінал ПІСЛЯ `globby`.
//!
//! `rust/workspace_root` — `ConcernContribution { scope: Full, glob:
//! ["**/Cargo.toml"] }`: host-бік full-scope збору
//! (`crates/rules-napi::build_full_scope_files`) будує whole-repo batch
//! через `rules_core::scan::walk_dir` (`.gitignore` + дефолтний
//! `.git`/`node_modules`/worktrees-набір), відфільтрований цим glob-ом.
//! Решту `RUST_WORKSPACE_ROOT_IGNORED_DIR_NAMES` (доккомент константи)
//! JS-оригінал ігнорує ЗАВЖДИ, незалежно від `.gitignore`, тож гість
//! повторює той самий фільтр вручну ([`workspace_root_path_ignored`]) — той
//! самий «фільтр поверх host-глобу» дух, що [`is_doc_comment_target`].
//!
//! # Regex-lookahead: `PLAIN_COMMENT_RE` без regex-крейта
//!
//! JS-оригінал `rust/doc_comments` (`main.mjs`) має ОДИН патерн із
//! негативним lookahead — `PLAIN_COMMENT_RE = /^\s*\/\/(?![/!])/` («рядок —
//! `//`-коментар, але НЕ `///` і НЕ `//!»). Rust `regex`-крейт lookahead не
//! підтримує (`npm/skills/wasm-plugin/SKILL.md`, розділ «Parity-дисципліна»,
//! п.4) — порт БЕЗ регекса, ручна перевірка символу одразу після `//`
//! ([`is_plain_comment_line`]): семантично ідентично («//» матчить, «///» і
//! «//!» — ні), жодної апроксимації. Решта патернів канону (`EXCLUDED_FILE_RE`,
//! `EXTERN_PREFIX_RE`, `KIND_NAME_RE`) — БЕЗ lookaround/backreference, портовані
//! напряму в `regex`-крейт ([`DOC_COMMENTS_EXCLUDED_PATTERN`],
//! [`DOC_COMMENTS_EXTERN_PREFIX_PATTERN`], [`DOC_COMMENTS_KIND_NAME_PATTERN`]).
//! `DOC_LINE_RE`/`ATTR_LINE_RE`/`CFG_TEST_RE` теж без лукараунду, але настільки
//! тривіальні (просто префікс після `trim_start()`), що портовані як прості
//! рядкові перевірки ([`is_doc_line`]/[`is_attr_line`]/[`is_cfg_test_line`]) —
//! без зайвого regex-компайлу на кожен виклик, поведінково ідентично.
//!
//! # Unicode-фічі regex
//!
//! Той самий скорочений набір, що `crates/plugin-lang-python/Cargo.toml`:
//! `unicode-perl` ОБОВ'ЯЗКОВИЙ (не опційна size-оптимізація) — без неї
//! `\w`/`\s` у `KIND_NAME_RE`/`EXTERN_PREFIX_RE` не компілюються взагалі
//! (`regex::Regex::new` повертає `Syntax`-помилку `Unicode-aware Perl class
//! not found`). `unicode-case` не потрібен — жоден патерн цього крейта не
//! має `(?i)`.
//!
//! # `rust/workspace_root` vs `python/workspace_root` — дві реальні розбіжності
//!
//! 1. **Немає перевірки вкладеного lockfile**: JS-канон
//!    (`main.mjs`) взагалі не читає `Cargo.lock` — `findAllCargoManifests`
//!    шукає лише `Cargo.toml`. На відміну від `python/workspace_root`
//!    (`NESTED_LOCKFILE`-порушення на вкладений `uv.lock`), тут немає ні
//!    такого `reason`, ні такого гілки логіки — НЕ забутий крок, а точний
//!    порт (доккомент секції `main.mjs` підтверджує: `readdirSync`-обхід
//!    шукає лише `entry.name === 'Cargo.toml'`).
//! 2. **Є перевірка `[profile.*]`**: `NESTED_PROFILE` — Cargo мовчки
//!    ігнорує/варнить на `[profile.*]` у не-кореневих маніфестах, чого
//!    python-сусід (без аналогічної Cargo-специфічної секції) не має.
//!    [`WORKSPACE_ROOT_NESTED_WORKSPACE_REASON`] і
//!    [`WORKSPACE_ROOT_NESTED_PROFILE_REASON`] перевіряються НЕЗАЛЕЖНО —
//!    один не-кореневий маніфест може отримати ОБИДВА порушення одночасно
//!    (`main.mjs::reportNestedTables`, два окремі `if`, не `else if`).

wit_bindgen::generate!({
    path: "../rules-contract/wit",
    world: "plugin",
    generate_all,
});

/// Ключ контрибуції `rust/applies` — точний відповідник
/// `${ctx.ruleId}/${ctx.concernId}` (`runConcernDetector`,
/// `npm/scripts/lib/lint-surface/detect.mjs`).
const CONCERN_APPLIES: &str = "rust/applies";

/// Ключ контрибуції `rust/doc_comments`.
const CONCERN_DOC_COMMENTS: &str = "rust/doc_comments";

/// Ключ контрибуції `rust/workspace_root`.
const CONCERN_WORKSPACE_ROOT: &str = "rust/workspace_root";

/// Шукає файл у батчі за точним posix-relative шляхом — batch-відповідник
/// `existsSync` JS-оригіналу (той самий helper, що
/// `crates/plugin-lang-python/src/lib.rs::batch_file`, продубльований тут:
/// крейти не діляться кодом через wasm-межу). Наразі жоден концерн цієї
/// хвилі не потребує точкового пошуку за шляхом (обидва full-scope концерни
/// аналізують ВЕСЬ батч), лишений як спільний утиліт-примітив на майбутню
/// хвилю (`allow(dead_code)` замість видалення — той самий мотив, що
/// невикористані варіанти `JsonValue` у python-крейті).
#[allow(dead_code)]
fn batch_file<'a>(files: &'a [SourceFile], path: &str) -> Option<&'a SourceFile> {
    files.iter().find(|f| f.path == path)
}

/// Мінімальне (без сторонніх крейтів) JSON string-екранування — точний
/// набір спецсимволів `JSON.stringify` для рядків (`"`, `\`, control chars),
/// той самий helper, що `crates/plugin-lang-js`/`crates/plugin-lang-python`.
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

/// Діагностика без `file`/`data` — точний відповідник дефолтної гілки
/// `createViolationReporter.fail` (немає споживача в цій хвилі — `applies`
/// нічого не репортує, `workspace_root`'s bare-повідомлення теж не мають
/// `file`, але будуються прямим `Diagnostic`-літералом нижче для ясності
/// сигнатури; лишено як спільний примітив на майбутнє, той самий мотив, що
/// [`batch_file`]).
#[allow(dead_code)]
fn plain_violation(reason: &str, message: String) -> Diagnostic {
    Diagnostic {
        reason: reason.to_string(),
        message,
        file: None,
        severity: Severity::Error,
        data: None,
    }
}

/// Точний порт `lint()` `rust/applies`
/// (`plugins/lang-rust/rules/rust/applies/main.mjs`): чистий context-pass —
/// `reporter.pass(...)` `createViolationReporter` завжди no-op (доккомент
/// `npm/scripts/lib/lint-surface/violation-reporter.mjs`), тож цей концерн
/// НІКОЛИ не видає діагностику. Формально full-scope (`glob = ["**/Cargo.toml"]`),
/// але вміст батчу навіть не читається.
fn detect_applies(_files: &[SourceFile]) -> Vec<Diagnostic> {
    Vec::new()
}

// =====================================================================
// `rust/doc_comments`
// =====================================================================

/// `reason` «файл із pub-елементами без провідного `//!`-коментаря» —
/// точний відповідник літерала `'missing-file-header'` (`main.mjs`).
const DOC_COMMENTS_MISSING_FILE_HEADER_REASON: &str = "missing-file-header";

/// `reason` «pub-елемент без `///`-опису» — точний відповідник
/// `'missing-pub-doc'`.
const DOC_COMMENTS_MISSING_PUB_DOC_REASON: &str = "missing-pub-doc";

/// Пояснювальна підказка для `missing-file-header` — точний відповідник
/// `FILE_HEADER_HINT` (`main.mjs`): doc-files копіює цей коментар дослівно.
const DOC_COMMENTS_FILE_HEADER_HINT: &str = "Глобальний сенс: конвеєр doc-files копіює цей коментар ДОСЛІВНО в секцію «Огляд» автоматично згенерованої документації файлу (0 LLM-токенів) — без нього «Огляд» вигадує LLM із самого коду.";

/// Пояснювальна підказка для `missing-pub-doc` — точний відповідник
/// `PUB_DOC_HINT`.
const DOC_COMMENTS_PUB_DOC_HINT: &str = "Глобальний сенс: конвеєр doc-files бере цей опис ДОСЛІВНО в секцію «Публічний API» автоматично згенерованої документації файлу (0 LLM-токенів) — без нього опис вигадує LLM.";

/// Тестові файли/каталоги — поза вимогою doc-коментарів. Точний порт
/// `EXCLUDED_FILE_RE` (`main.mjs`) — БЕЗ lookaround, портується напряму
/// (доккомент модуля, розділ «Regex-lookahead»).
const DOC_COMMENTS_EXCLUDED_PATTERN: &str = r"(?:(?:^|/)tests?/)|(?:_tests?\.rs$)";

/// `extern "C" ` — модифікатор-префікс, який [`parse_pub_item`] зрізає перед
/// пошуком `kind`/`name`. Точний порт `EXTERN_PREFIX_RE` (`main.mjs`).
const DOC_COMMENTS_EXTERN_PREFIX_PATTERN: &str = r#"^extern\s+"[^"]*"\s+"#;

/// `kind name` top-level pub-елемента (`fn`/`struct`/`enum`/`trait`/`mod`/
/// `static`/`type`/`union`/`const`). Точний порт `KIND_NAME_RE` (`main.mjs`)
/// — З ОДНІЄЮ свідомою відмінністю запису: група імені написана як
/// `[0-9A-Za-z_]+`, НЕ `\w+`. Причина — реальна семантична розбіжність,
/// виявлена (не здогад) при написанні parity-тестів: JS `\w` у ECMA-262
/// ЗАВЖДИ ASCII-only (`[A-Za-z0-9_]`, незалежно від прапорця `u`), тоді як
/// Rust `regex`-крейт за замовчуванням (навіть із самою лише фічею
/// `unicode-perl`, яка вмикає ДАНІ для Perl-класів, а не звужує їх до ASCII)
/// компілює `\w` як Unicode-обізнаний клас — літера кирилиці чи інший
/// Unicode word char МАТЧИТЬ Rust `\w`, але НІКОЛИ не матчить JS `\w`. Для
/// `PUBLIC_DEF_RE` python-сусіда цей ризик обмежений (перший символ імені
/// зафіксований у `[A-Za-z]`, доккомент `crates/plugin-lang-python/src/lib.rs`
/// щодо навмисно ASCII `def`-імені), але тут `(\w+)` — ПЕРШИЙ символ імені
/// теж під `\w`, тож без цього фікса `pub fn облік() { … }` матчив би в Rust
/// (captures name="облік"), а в JS — НЕ матчив би взагалі (рядок узагалі не
/// розпізнається як pub-елемент, `parsePubItem` повертає `null`) — тиха
/// розбіжність violation-множини, не лише тексту. Явний ASCII-клас усуває
/// розбіжність повністю, без прапорця `(?-u:...)` (той самий результат,
/// прозоріший запис). Перевірено юніт-тестом
/// [`tests::detect_doc_comments_non_ascii_identifier_is_not_a_pub_item_matching_js_ascii_only_w`].
const DOC_COMMENTS_KIND_NAME_PATTERN: &str =
    r"^(fn|struct|enum|trait|mod|static|type|union|const)\s+([0-9A-Za-z_]+)";

/// Модифікатори, які [`parse_pub_item`] зрізає ІТЕРАТИВНО перед `extern`/
/// `kind name` — точний порт `PUB_MODIFIERS` (`main.mjs`).
const PUB_MODIFIERS: &[&str] = &["async ", "unsafe ", "const "];

/// Один top-level `pub`-елемент. Дзеркало JS-об'єкта `{ kind, name }`
/// (`parsePubItem`, `main.mjs`).
struct PubItem {
    /// `"fn"`/`"struct"`/… — точний захоплений текст групи 1.
    kind: String,
    /// Ім'я символу — точний захоплений текст групи 2.
    name: String,
}

/// Точний порт `parsePubItem` (`main.mjs`): розбирає top-level `pub`-елемент
/// із рядка (колонка 0). Модифікатори (`async `/`unsafe `/`const `) і
/// `extern "…" ` зрізаються ітеративно, ПОКИ рядок ще матчить один з них —
/// той самий цикл, що JS-оригінал (коментар джерела: «зрізаємо ітеративно
/// замість одного складного regex»).
fn parse_pub_item(
    line: &str,
    extern_re: &regex::Regex,
    kind_name_re: &regex::Regex,
) -> Option<PubItem> {
    if !line.starts_with("pub") {
        return None;
    }
    // `line.startsWith('pub ') ? line.slice(4) : ''` JS-оригіналу: рядок без
    // пробілу одразу після `pub` (напр. голий `"pub"` чи `"public"`) —
    // `rest` порожній ⇒ рання `None` нижче.
    let mut rest = line.strip_prefix("pub ")?;
    if rest.is_empty() {
        return None;
    }
    loop {
        if let Some(&modifier) = PUB_MODIFIERS.iter().find(|m| rest.starts_with(**m)) {
            // `pub const NAME` — це kind, а `pub const fn` — модифікатор:
            // зрізаємо `const ` лише якщо далі йде `fn `.
            if modifier == "const " && !rest[modifier.len()..].starts_with("fn ") {
                break;
            }
            rest = &rest[modifier.len()..];
            continue;
        }
        if let Some(m) = extern_re.find(rest) {
            rest = &rest[m.end()..];
            continue;
        }
        break;
    }
    kind_name_re.captures(rest).map(|c| PubItem {
        kind: c[1].to_string(),
        name: c[2].to_string(),
    })
}

/// Чи підпадає файл під вимогу doc-коментарів. Точний порт
/// `isDocCommentTarget` (`main.mjs`).
fn is_doc_comment_target(rel_posix: &str, excluded_re: &regex::Regex) -> bool {
    rel_posix.ends_with(".rs") && !excluded_re.is_match(rel_posix)
}

/// `///`-рядок (rustdoc). Точний порт `DOC_LINE_RE` (`main.mjs`) — без
/// regex, простий префікс після зняття провідних пробілів (доккомент
/// модуля, розділ «Regex-lookahead»). `"////"` теж матчить (JS-регекс не
/// вимагає, щоб ЧЕТВЕРТИЙ символ був не `/` — лише перевіряє префікс
/// `///`), той самий контракт тут.
fn is_doc_line(line: &str) -> bool {
    line.trim_start().starts_with("///")
}

/// `#[...]`-атрибут (колонка 0 після пробілів). Точний порт `ATTR_LINE_RE`.
fn is_attr_line(line: &str) -> bool {
    line.trim_start().starts_with("#[")
}

/// `#[cfg(test)]` РІВНО цей літерал (без варіацій на кшталт
/// `#[cfg(all(test, …))]`) — точний порт `CFG_TEST_RE`.
fn is_cfg_test_line(line: &str) -> bool {
    line.trim_start().starts_with("#[cfg(test)]")
}

/// Звичайний `//`-коментар, ЯКИЙ НЕ `///` і НЕ `//!` — точний семантичний
/// порт `PLAIN_COMMENT_RE = /^\s*\/\/(?![/!])/` (негативний lookahead) БЕЗ
/// regex-крейта: після зняття провідних пробілів і префікса `//` перевіряє,
/// що наступний символ — не `/` і не `!` (доккомент модуля, розділ
/// «Regex-lookahead»). Порожній залишок після `//` (рядок РІВНО `"//"`)
/// проходить — той самий контракт, що негативний lookahead на кінці рядка
/// (успішний, коли дивитись нема на що).
fn is_plain_comment_line(line: &str) -> bool {
    match line.trim_start().strip_prefix("//") {
        Some(rest) => !rest.starts_with('/') && !rest.starts_with('!'),
        None => false,
    }
}

/// Чи починається файл із `//!`-коментаря (перший непорожній рядок — `//!`
/// чи inner-атрибут `#![`). Точний порт `hasInnerDocHeader` (`main.mjs`).
fn has_inner_doc_header(lines: &[&str]) -> bool {
    for line in lines {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        return trimmed.starts_with("//!") || trimmed.starts_with("#![");
    }
    false
}

/// Провідний суцільний `//`-блок на початку файлу (кандидат на T0 `//` →
/// `//!`) — точний порт `leadingPlainCommentBlock` (`main.mjs`). Провідні
/// порожні рядки пропускаються ДО старту блоку; порожній рядок ПІСЛЯ старту
/// завершує блок (не матчить [`is_plain_comment_line`]).
fn leading_plain_comment_block(lines: &[&str]) -> Option<(usize, usize)> {
    let mut from: Option<usize> = None;
    for (i, line) in lines.iter().enumerate() {
        if line.trim().is_empty() && from.is_none() {
            continue;
        }
        if is_plain_comment_line(line) {
            if from.is_none() {
                from = Some(i);
            }
            continue;
        }
        return from.map(|f| (f, i - 1));
    }
    from.map(|f| (f, lines.len() - 1))
}

/// Коментар-блок безпосередньо над елементом — точний порт
/// `commentBlockAbove` (`main.mjs`): `#[...]`-атрибути між коментарем і
/// елементом пропускаються (rustdoc стоїть НАД атрибутами). `doc: true` —
/// над елементом уже стоїть `///` (одна лінія, без пошуку суцільного
/// блоку — той самий контракт, що JS-оригінал); `doc: false` — суцільний
/// звичайний `//`-блок, кандидат на T0-промоцію.
struct CommentBlock {
    doc: bool,
    from_line: usize,
    to_line: usize,
}

fn comment_block_above(lines: &[&str], item_line: usize) -> Option<CommentBlock> {
    let mut i = item_line as isize - 1;
    while i >= 0 && is_attr_line(lines[i as usize]) {
        i -= 1;
    }
    if i < 0 {
        return None;
    }
    if is_doc_line(lines[i as usize]) {
        let idx = i as usize;
        return Some(CommentBlock {
            doc: true,
            from_line: idx,
            to_line: idx,
        });
    }
    if !is_plain_comment_line(lines[i as usize]) {
        return None;
    }
    let to = i as usize;
    while i >= 1 && is_plain_comment_line(lines[(i - 1) as usize]) {
        i -= 1;
    }
    Some(CommentBlock {
        doc: false,
        from_line: i as usize,
        to_line: to,
    })
}

/// Точний порт `checkFileDocComments` (`main.mjs`): `//!`-header + `///` над
/// кожним top-level pub-елементом. Сканування збору `items` зупиняється на
/// `#[cfg(test)]` (тест-модуль конвенційно наприкінці файлу); файл без
/// pub-елементів — поза вимогою (рання порожня відповідь).
fn check_file_doc_comments(
    src: &str,
    rel_posix: &str,
    extern_re: &regex::Regex,
    kind_name_re: &regex::Regex,
) -> Vec<Diagnostic> {
    let lines: Vec<&str> = src.split('\n').collect();
    let mut items: Vec<(PubItem, usize)> = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        if is_cfg_test_line(line) {
            break;
        }
        if let Some(item) = parse_pub_item(line, extern_re, kind_name_re) {
            items.push((item, i));
        }
    }
    if items.is_empty() {
        return Vec::new();
    }

    let mut violations = Vec::new();
    if !has_inner_doc_header(&lines) {
        let data = match leading_plain_comment_block(&lines) {
            Some((from_line, to_line)) => format!(
                "{{\"promotable\":true,\"fromLine\":{from_line},\"toLine\":{to_line},\"header\":true}}"
            ),
            None => "{\"header\":true}".to_string(),
        };
        violations.push(Diagnostic {
            reason: DOC_COMMENTS_MISSING_FILE_HEADER_REASON.to_string(),
            message: format!(
                "{rel_posix}: файл із pub-елементами без провідного //!-коментаря. {DOC_COMMENTS_FILE_HEADER_HINT}"
            ),
            file: Some(rel_posix.to_string()),
            severity: Severity::Error,
            data: Some(data),
        });
    }

    for (item, line) in &items {
        let above = comment_block_above(&lines, *line);
        if let Some(CommentBlock { doc: true, .. }) = above {
            continue;
        }
        let data = match &above {
            Some(block) => format!(
                "{{\"promotable\":true,\"fromLine\":{},\"toLine\":{},\"name\":{}}}",
                block.from_line,
                block.to_line,
                json_escape_string(&item.name)
            ),
            None => format!("{{\"name\":{}}}", json_escape_string(&item.name)),
        };
        violations.push(Diagnostic {
            reason: DOC_COMMENTS_MISSING_PUB_DOC_REASON.to_string(),
            message: format!(
                "{rel_posix}: pub {} {} без ///-опису. {DOC_COMMENTS_PUB_DOC_HINT}",
                item.kind, item.name
            ),
            file: Some(rel_posix.to_string()),
            severity: Severity::Error,
            data: Some(data),
        });
    }
    violations
}

/// Точний порт гілки `lint()` `rust/doc_comments` із переданими `files`
/// (`main.mjs`) — PER-FILE (доккомент модуля, розділ «Обхід дерева»): host
/// уже надав batch за `**/*.rs`, [`is_doc_comment_target`] лише повторює
/// `.rs`-фільтр і виняток тестових файлів JS-оригіналу.
fn detect_doc_comments(files: &[SourceFile]) -> Vec<Diagnostic> {
    let excluded_re = regex::Regex::new(DOC_COMMENTS_EXCLUDED_PATTERN)
        .expect("DOC_COMMENTS_EXCLUDED_PATTERN валідний");
    let extern_re = regex::Regex::new(DOC_COMMENTS_EXTERN_PREFIX_PATTERN)
        .expect("DOC_COMMENTS_EXTERN_PREFIX_PATTERN валідний");
    let kind_name_re = regex::Regex::new(DOC_COMMENTS_KIND_NAME_PATTERN)
        .expect("DOC_COMMENTS_KIND_NAME_PATTERN валідний");

    let mut out = Vec::new();
    for file in files {
        if !is_doc_comment_target(&file.path, &excluded_re) {
            continue;
        }
        out.extend(check_file_doc_comments(
            &file.content,
            &file.path,
            &extern_re,
            &kind_name_re,
        ));
    }
    out
}

// =====================================================================
// `rust/workspace_root`
// =====================================================================

use std::collections::{HashMap, HashSet};

/// `reason` вкладеного `[workspace]` поза кореневим `Cargo.toml`. Точний
/// відповідник `NESTED_WORKSPACE` (`main.mjs`).
const WORKSPACE_ROOT_NESTED_WORKSPACE_REASON: &str = "nested-workspace";

/// `reason` `[profile.*]` у не-кореневому `Cargo.toml`. Точний відповідник
/// `NESTED_PROFILE`. Немає python-аналога (доккомент модуля, розділ
/// «`rust/workspace_root` vs `python/workspace_root`»).
const WORKSPACE_ROOT_NESTED_PROFILE_REASON: &str = "nested-profile";

/// `reason` відсутнього/невалідного кореневого workspace root. Точний
/// відповідник `MISSING_ROOT_WORKSPACE`.
const WORKSPACE_ROOT_MISSING_ROOT_REASON: &str = "missing-root-workspace";

/// `reason` package-маніфесту поза `members` кореневого workspace. Точний
/// відповідник `PACKAGE_NOT_WORKSPACE_MEMBER`.
const WORKSPACE_ROOT_PACKAGE_NOT_MEMBER_REASON: &str = "package-not-workspace-member";

/// Спільний хвіст повідомлення кожної діагностики концерну — точний порт
/// `REMEDIATION` (`main.mjs`, конкатенація літералів звужена до одного
/// рядка: сама конкатенація JS — форматування джерела, не семантика).
const WORKSPACE_ROOT_REMEDIATION: &str = "створи/підтверди кореневий [workspace] (resolver = \"2\", members) у кореневому Cargo.toml, перенеси [profile.*] у корінь, видали вкладені [workspace] і їхні Cargo.lock — у репозиторії має лишитись один кореневий workspace і один Cargo.lock (rust/workspace_root.mdc)";

/// Каталоги, які [`detect_workspace_root`] НЕ бачить — точний порт
/// `RUST_WALK_IGNORED_DIR_NAMES` (`plugins/lang-rust/rules/rust/lib/ignored-dirs.mjs`).
/// Host-batch (`ConcernContribution::glob`, [`build_manifest`]) фільтрує
/// лише `.git`/`node_modules`/`.worktrees` + `.gitignore`
/// (`crates/rules-core/src/scan.rs::ALWAYS_IGNORE`) — решту
/// (`target`/`.next`/`.turbo`/`.venv`/`venv`/`.claude`/`vendor`) JS-оригінал
/// ігнорує ЗАВЖДИ, незалежно від `.gitignore`, тож гість повторює той самий
/// фільтр вручну ([`workspace_root_path_ignored`]). На відміну від
/// `python/workspace_root` (`__pycache__` замість `.worktrees` у списку) —
/// тут явно є `.worktrees` (rust-специфічний PR #179: два stale
/// auto-created worktree сипали 12 хибних `NESTED_WORKSPACE`, доккомент
/// JS-джерела).
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
    ".worktrees",
];

/// Мінімальний зріз `Cargo.toml`, потрібний [`detect_workspace_root`]:
/// наявність `[package]` (значення не важливе — `Option<IgnoredAny>` приймає
/// БУДЬ-яку валідну TOML-форму), `[workspace]` з `members`/`exclude`, і
/// наявність `[profile]` (значення теж не важливе — сам факт присутності
/// ключа, той самий контракт, що `parsed.profile` truthy-перевірка
/// JS-оригіналу). `#[serde(default)]` на кожному полі — tolerant-парсинг,
/// той самий дух, що `smol-toml`-виклик JS-оригіналу (без схеми, невідомі
/// ключі мовчки ігноруються). Вибір `basic-toml` замість `toml`/`toml_edit`
/// — той самий обгрунтований вимір, що `crates/plugin-lang-python/Cargo.toml`
/// (доккомент залежності в `Cargo.toml` цього крейта): ідентичний typed-struct
/// probe, той самий крейт, вимірювати вдруге для того самого виклику нема
/// підстав.
#[derive(serde::Deserialize, Default)]
struct WorkspaceRootCargoToml {
    #[serde(default)]
    package: Option<serde::de::IgnoredAny>,
    #[serde(default)]
    workspace: Option<WorkspaceRootWorkspaceTable>,
    #[serde(default)]
    profile: Option<serde::de::IgnoredAny>,
}

/// `[workspace]` — точний зріз `main.mjs`: `members`/`exclude`, відсутність
/// поля = порожній масив (той самий дефолт, що `Array.isArray(workspace.members)
/// ? workspace.members : []`).
#[derive(serde::Deserialize, Default)]
struct WorkspaceRootWorkspaceTable {
    #[serde(default)]
    members: Vec<String>,
    #[serde(default)]
    exclude: Vec<String>,
}

/// Точний порт `readManifest` (`main.mjs`) для вже наданого host-ом вмісту
/// файлу (батч, не диск): `None` на невалідний TOML — той самий catch-null
/// JS-оригіналу.
fn workspace_root_parse_cargo_toml(content: &str) -> Option<WorkspaceRootCargoToml> {
    basic_toml::from_str(content).ok()
}

/// Чи лежить posix-relative шлях усередині одного з
/// [`WORKSPACE_ROOT_IGNORED_DIR_NAMES`].
fn workspace_root_path_ignored(path: &str) -> bool {
    path.split('/')
        .any(|segment| WORKSPACE_ROOT_IGNORED_DIR_NAMES.contains(&segment))
}

/// Posix "dirname": усе до останнього `/` (без нього), чи `""` для кореня.
/// Той самий мотив, що `dirname()`/`relative(cwd, ...)` JS-оригіналу, але
/// без реального FS-виклику — батч-шлях уже posix-relative до `cwd`.
fn workspace_root_dirname(path: &str) -> &str {
    match path.rfind('/') {
        Some(idx) => &path[..idx],
        None => "",
    }
}

/// Компілює `members`/`exclude`-патерн (літерал чи з одинарними `*`, БЕЗ
/// `**`) у прив'язаний regex — `*` не перетинає `/`, точний port
/// `resolveWorkspaceMemberDirs` (`npm/scripts/utils/cargo-workspace.mjs`),
/// той самий обмежений glob, що `scanGlob(pattern/Cargo.toml)` дає для
/// патернів на кшталт `"crates/*"` (доккомент `cargo-workspace.mjs`: «Без
/// повної Cargo glob-семантики — лише `*`-сегменти й літерали»). Символи
/// поза `*` екрануються по одному.
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

/// Точний порт `resolveWorkspaceMemberDirs` (`cargo-workspace.mjs`),
/// адаптований під wasm-гостя: замість `existsSync`/`scanGlob` по реальному
/// диску матчить `members`/`exclude`-патерни проти вже відомого набору
/// каталогів із знайденими `Cargo.toml` — того самого host-батчу, що
/// [`detect_workspace_root`] уже має (full-scope глоб покрив УСЕ дерево),
/// тож окремий FS-обхід тут не потрібен: дані для «чи існує `Cargo.toml` у
/// цьому каталозі» вже на руках. `pattern.trim_end_matches('/')` — той самий
/// `TRAILING_SLASH_RE`-нормалізатор, що JS-оригінал.
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

/// Діагностика з `file` (nested-workspace/nested-profile/
/// package-not-workspace-member) — точний відповідник `reporter.fail(msg, {
/// reason, file })`: `data` не встановлюється (`None`).
fn workspace_root_file_violation(reason: &str, message: String, file: &str) -> Diagnostic {
    Diagnostic {
        reason: reason.to_string(),
        message,
        file: Some(file.to_string()),
        severity: Severity::Error,
        data: None,
    }
}

/// Звітує про вкладені `[workspace]`/`[profile.*]` у не-кореневих
/// маніфестах — точний порт `reportNestedTables` (`main.mjs`): ОБИДВІ
/// перевірки незалежні (один манiфест може отримати обидва порушення, два
/// окремі `if`, не `else if` — доккомент модуля).
fn workspace_root_report_nested_tables<'a>(
    manifest_files: &[&'a SourceFile],
    parsed_by_path: &HashMap<&'a str, Option<WorkspaceRootCargoToml>>,
    diagnostics: &mut Vec<Diagnostic>,
) {
    for file in manifest_files {
        let path = file.path.as_str();
        if path == "Cargo.toml" {
            continue;
        }
        let Some(Some(parsed)) = parsed_by_path.get(path) else {
            continue;
        };
        if parsed.workspace.is_some() {
            diagnostics.push(workspace_root_file_violation(
                WORKSPACE_ROOT_NESTED_WORKSPACE_REASON,
                format!(
                    "{path}: вкладений [workspace] поза кореневим Cargo.toml — {WORKSPACE_ROOT_REMEDIATION}"
                ),
                path,
            ));
        }
        if parsed.profile.is_some() {
            diagnostics.push(workspace_root_file_violation(
                WORKSPACE_ROOT_NESTED_PROFILE_REASON,
                format!(
                    "{path}: [profile.*] поза кореневим Cargo.toml — Cargo мовчки ігнорує чи видає попередження на profile-секції у не-кореневих маніфестах. {WORKSPACE_ROOT_REMEDIATION}"
                ),
                path,
            ));
        }
    }
}

/// Точний порт `lint()` `rust/workspace_root` (`main.mjs`) — WHOLE-BATCH
/// (glob `["**/Cargo.toml"]`, [`build_manifest`]), єдиний концерн цього
/// крейта, що сам обходить УСЕ дерево репозиторію. Host уже надав batch за
/// глобом (`build_full_scope_files`, `crates/rules-napi/src/lib.rs`), але
/// той поважає лише `.gitignore` + `ALWAYS_IGNORE`
/// (`.git`/`node_modules`/`.worktrees`) — решту
/// [`WORKSPACE_ROOT_IGNORED_DIR_NAMES`] гість фільтрує сам
/// ([`workspace_root_path_ignored`]). На відміну від `python/workspace_root`
/// — НЕМАЄ перевірки вкладеного lockfile (доккомент модуля, розділ
/// «vs python/workspace_root»).
fn detect_workspace_root(files: &[SourceFile]) -> Vec<Diagnostic> {
    let manifest_files: Vec<&SourceFile> = files
        .iter()
        .filter(|f| {
            (f.path == "Cargo.toml" || f.path.ends_with("/Cargo.toml"))
                && !workspace_root_path_ignored(&f.path)
        })
        .collect();

    let parsed_by_path: HashMap<&str, Option<WorkspaceRootCargoToml>> = manifest_files
        .iter()
        .map(|f| (f.path.as_str(), workspace_root_parse_cargo_toml(&f.content)))
        .collect();

    let package_manifest_paths: Vec<&str> = manifest_files
        .iter()
        .map(|f| f.path.as_str())
        .filter(|p| {
            parsed_by_path
                .get(p)
                .and_then(|opt| opt.as_ref())
                .is_some_and(|parsed| parsed.package.is_some())
        })
        .collect();
    // жодного Rust-пакета (з [package]) у дереві — концерн не застосовний.
    if package_manifest_paths.is_empty() {
        return Vec::new();
    }

    let mut diagnostics = Vec::new();
    workspace_root_report_nested_tables(&manifest_files, &parsed_by_path, &mut diagnostics);

    let root_parsed = parsed_by_path
        .get("Cargo.toml")
        .and_then(|opt| opt.as_ref());
    let Some(root_parsed) = root_parsed else {
        diagnostics.push(plain_violation(
            WORKSPACE_ROOT_MISSING_ROOT_REASON,
            format!(
                "Cargo.toml відсутній у корені репозиторію, але знайдено {} package-маніфест(и). {WORKSPACE_ROOT_REMEDIATION}",
                package_manifest_paths.len()
            ),
        ));
        return diagnostics;
    };

    let other_package_manifest_paths: Vec<&str> = package_manifest_paths
        .iter()
        .copied()
        .filter(|&p| p != "Cargo.toml")
        .collect();

    let Some(root_workspace) = root_parsed.workspace.as_ref() else {
        if root_parsed.package.is_some() && other_package_manifest_paths.is_empty() {
            // Єдиний кореневий package — Cargo неявно робить його власним
            // workspace root. `pass(...)` — no-op; уже накопичені
            // nested-workspace/nested-profile діагностики вище лишаються в
            // результаті — точна калька раннього `return reporter.result()`
            // JS-оригіналу.
            return diagnostics;
        }
        diagnostics.push(plain_violation(
            WORKSPACE_ROOT_MISSING_ROOT_REASON,
            format!(
                "Кореневий Cargo.toml не є workspace root (немає [workspace]), а в репозиторії {} package-маніфест(и). {WORKSPACE_ROOT_REMEDIATION}",
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
                "{path}: package не покритий members кореневого workspace — додай шлях у [workspace].members кореневого Cargo.toml (або відобрази у workspace.exclude). {WORKSPACE_ROOT_REMEDIATION}"
            ),
            path,
        ));
    }

    diagnostics
}

/// Чиста (без host-імпортів `log`/`report-progress`) конструктор
/// маніфеста — винесений з [`Guest::describe`] окремо, щоб host-таргет
/// unit-тести могли звірити форму маніфеста без реального wasmtime-хоста
/// (той самий мотив, що `crates/plugin-lang-python/src/lib.rs::build_manifest`).
fn build_manifest() -> Manifest {
    Manifest {
        id: "rust/wasm-concerns".to_string(),
        version: "0.1.0".to_string(),
        world_version: "3.1.0".to_string(),
        domains: vec![Domain::Lint],
        concerns: vec![
            ConcernContribution {
                key: CONCERN_APPLIES.to_string(),
                scope: ConcernScope::Full,
                glob: vec!["**/Cargo.toml".to_string()],
            },
            ConcernContribution {
                key: CONCERN_DOC_COMMENTS.to_string(),
                scope: ConcernScope::PerFile,
                glob: vec!["**/*.rs".to_string()],
            },
            ConcernContribution {
                key: CONCERN_WORKSPACE_ROOT.to_string(),
                scope: ConcernScope::Full,
                glob: vec!["**/Cargo.toml".to_string()],
            },
        ],
        ci_artifacts: vec![],
        // Вміст файлів хост передає inline (per-file чи host-побудований
        // full-scope batch) — плагін не читає диск сам (той самий мотив, що
        // `crates/plugin-lang-js`/`crates/plugin-lang-python`).
        capabilities: Capabilities {
            fs_read: vec![],
            network: false,
        },
        // Перша хвиля не портує жодного `exec-tool`-концерну.
        tools: vec![],
    }
}

/// Guest-реалізація `n-rules:plugin@3.1.0` для `rust/wasm-concerns` — три
/// контрибуції першої хвилі (доккомент модуля).
struct LangRust;

impl Guest for LangRust {
    fn describe() -> Manifest {
        log(LogLevel::Info, "plugin-lang-rust: describe()");
        build_manifest()
    }

    fn detect(batch: DetectBatch) -> Vec<Diagnostic> {
        let total = batch.files.len() as u32;
        let diagnostics = match batch.concern_id.as_str() {
            CONCERN_APPLIES => {
                report_progress(total, total);
                detect_applies(&batch.files)
            }
            // PER-FILE: кожен файл — свій крок прогресу (той самий мотив,
            // що `python/doc_comments`/дефолтна гілка `plugin-lang-js`).
            CONCERN_DOC_COMMENTS => {
                let mut diagnostics = Vec::new();
                for (index, file) in batch.files.iter().enumerate() {
                    report_progress(index as u32 + 1, total);
                    diagnostics.extend(detect_doc_comments(std::slice::from_ref(file)));
                }
                diagnostics
            }
            CONCERN_WORKSPACE_ROOT => {
                report_progress(total, total);
                detect_workspace_root(&batch.files)
            }
            _ => Vec::new(),
        };
        log(
            LogLevel::Info,
            &format!(
                "plugin-lang-rust: detect({}) опрацював {total} файл(ів)",
                batch.concern_id
            ),
        );
        diagnostics
    }

    /// Перша хвиля не портує жодного fix-контуру (T0 `rust/doc_comments` —
    /// `fix-doc_comments.mjs` — лишається JS, доккомент модуля): порожній
    /// план для КОЖНОГО концерну, сумісна заглушка.
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

export!(LangRust);

#[cfg(test)]
mod tests {
    //! Юніт-тести на host-таргеті (`cargo test -p plugin-lang-rust`, без
    //! wasm-збірки) — лише чисті helper-и, НЕ `Guest::describe`/
    //! `Guest::detect` напряму (host-імпорти `log`/`report-progress`
    //! абортують поза реальним wasmtime-хостом — той самий мотив, що
    //! `crates/plugin-lang-js`/`crates/plugin-lang-python`). Живий
    //! end-to-end прогін через `PluginHost` — поза обсягом цієї хвилі;
    //! JS-vs-wasm parity —
    //! `npm/scripts/lib/lint-surface/tests/wasm-plugin-parity-rust.test.mjs`.
    use super::*;

    fn sf(path: &str, content: &str) -> SourceFile {
        SourceFile {
            path: path.to_string(),
            content: content.to_string(),
        }
    }

    // --- rust/applies ---

    #[test]
    fn detect_applies_never_reports_anything() {
        let files = vec![sf("Cargo.toml", "[package]\nname = \"demo\"\n")];
        assert!(detect_applies(&files).is_empty());
        assert!(detect_applies(&[]).is_empty());
    }

    // --- rust/doc_comments ---

    #[test]
    fn detect_doc_comments_file_without_pub_items_is_not_applicable() {
        let files = vec![sf("src/a.rs", "fn private_only() {}\n")];
        assert!(detect_doc_comments(&files).is_empty());
    }

    #[test]
    fn detect_doc_comments_header_and_pub_doc_present_is_clean() {
        let src = "//! Намір файлу.\n\n/// Робить X.\npub fn go() {}\n";
        let files = vec![sf("src/a.rs", src)];
        assert!(detect_doc_comments(&files).is_empty());
    }

    #[test]
    fn detect_doc_comments_missing_header_and_pub_doc_gives_two_violations() {
        let files = vec![sf("src/a.rs", "pub fn go() {}\n")];
        let mut reasons: Vec<String> = detect_doc_comments(&files)
            .into_iter()
            .map(|d| d.reason)
            .collect();
        reasons.sort_unstable();
        assert_eq!(reasons, vec!["missing-file-header", "missing-pub-doc"]);
    }

    #[test]
    fn detect_doc_comments_plain_comment_block_above_pub_item_is_promotable_attrs_skipped() {
        let src = "//! H.\n\n// робить X\n#[derive(Debug)]\npub struct S {}\n";
        let files = vec![sf("src/a.rs", src)];
        let violations = detect_doc_comments(&files);
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].reason, "missing-pub-doc");
        assert!(violations[0]
            .data
            .as_deref()
            .unwrap()
            .contains("\"promotable\":true"));
        assert!(violations[0]
            .data
            .as_deref()
            .unwrap()
            .contains("\"fromLine\":2"));
        assert!(violations[0]
            .data
            .as_deref()
            .unwrap()
            .contains("\"toLine\":2"));
    }

    #[test]
    fn detect_doc_comments_leading_plain_comment_block_is_promotable_header() {
        let src = "// намір\n/// X.\npub fn go() {}\n";
        let files = vec![sf("src/a.rs", src)];
        let violations = detect_doc_comments(&files);
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].reason, "missing-file-header");
        let data = violations[0].data.as_deref().unwrap();
        assert!(data.contains("\"promotable\":true"));
        assert!(data.contains("\"header\":true"));
        assert!(data.contains("\"fromLine\":0"));
        assert!(data.contains("\"toLine\":0"));
    }

    #[test]
    fn detect_doc_comments_items_after_cfg_test_are_not_scanned() {
        let src = "//! H.\n#[cfg(test)]\npub fn helper_in_tests() {}\n";
        let files = vec![sf("src/a.rs", src)];
        assert!(detect_doc_comments(&files).is_empty());
    }

    #[test]
    fn detect_doc_comments_const_name_is_const_kind_const_fn_is_fn_kind() {
        let src = "//! H.\npub const MAX: u32 = 1;\npub const fn calc() {}\n";
        let files = vec![sf("src/a.rs", src)];
        let mut names: Vec<(String, String)> = detect_doc_comments(&files)
            .iter()
            .map(|d| {
                let data = d.data.as_deref().unwrap();
                let kind = if data.contains("MAX") { "const" } else { "fn" };
                (kind.to_string(), data.to_string())
            })
            .collect();
        names.sort_unstable();
        assert_eq!(names.len(), 2);
        assert!(names[0].1.contains("\"name\":\"MAX\""));
        assert!(names[1].1.contains("\"name\":\"calc\""));
    }

    #[test]
    fn detect_doc_comments_excludes_tests_dir_and_test_suffix_files() {
        for path in ["tests/helpers.rs", "src/a_test.rs", "src/a_tests.rs"] {
            let files = vec![sf(path, "pub fn go() {}\n")];
            assert!(
                detect_doc_comments(&files).is_empty(),
                "{path} мав бути поза вимогою"
            );
        }
        let files = vec![sf("src/a.rs", "pub fn go() {}\n")];
        assert_eq!(detect_doc_comments(&files).len(), 2);
    }

    #[test]
    fn detect_doc_comments_ignores_non_rust_files() {
        let files = vec![sf("src/a.py", "pub fn go() {}\n")];
        assert!(detect_doc_comments(&files).is_empty());
    }

    #[test]
    fn detect_doc_comments_doc_line_directly_above_item_is_clean_not_promotable() {
        let src = "//! H.\n\n/// вже є опис\npub fn go() {}\n";
        let files = vec![sf("src/a.rs", src)];
        assert!(detect_doc_comments(&files).is_empty());
    }

    #[test]
    fn detect_doc_comments_quadruple_slash_counts_as_existing_doc_not_plain_comment() {
        // `"////"` матчить DOC_LINE_RE (`^\s*///`, будь-що після трьох
        // `/`), а НЕ PLAIN_COMMENT_RE (наступний символ після `//` — `/`,
        // виключено) — доккомент модуля, розділ «Regex-lookahead».
        let src = "//! H.\n\n////\npub fn go() {}\n";
        let files = vec![sf("src/a.rs", src)];
        assert!(detect_doc_comments(&files).is_empty());
    }

    #[test]
    fn detect_doc_comments_no_comment_block_gives_name_only_data() {
        let src = "//! H.\n\npub fn go() {}\n";
        let files = vec![sf("src/a.rs", src)];
        let violations = detect_doc_comments(&files);
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].data.as_deref().unwrap(), "{\"name\":\"go\"}");
    }

    #[test]
    fn detect_doc_comments_extern_and_modifier_prefixes_stripped_in_any_order() {
        let src = "//! H.\npub unsafe extern \"C\" fn foo() {}\npub async fn bar() {}\n";
        let files = vec![sf("src/a.rs", src)];
        let violations = detect_doc_comments(&files);
        assert_eq!(violations.len(), 2);
        assert!(violations
            .iter()
            .any(|v| v.message.contains("pub fn foo без")));
        assert!(violations
            .iter()
            .any(|v| v.message.contains("pub fn bar без")));
    }

    #[test]
    fn detect_doc_comments_class_like_struct_message_uses_struct_keyword() {
        let src = "//! H.\npub struct Foo {}\n";
        let files = vec![sf("src/a.rs", src)];
        let violations = detect_doc_comments(&files);
        assert_eq!(violations.len(), 1);
        assert!(violations[0]
            .message
            .contains("pub struct Foo без ///-опису"));
    }

    #[test]
    fn detect_doc_comments_non_ascii_identifier_is_not_a_pub_item_matching_js_ascii_only_w() {
        // Доккомент `DOC_COMMENTS_KIND_NAME_PATTERN`: JS `\w` — ЗАВЖДИ
        // ASCII-only, тож `pub fn облік()` у JS-каноні взагалі не
        // розпізнається як pub-елемент (файл без жодного виявленого
        // pub-елемента — поза вимогою, рання порожня відповідь). Без
        // явного ASCII-класу в `DOC_COMMENTS_KIND_NAME_PATTERN` Rust
        // `regex`-крейт (Unicode `\w` за замовчуванням) розпізнав би
        // кириличне ім'я — тиха розбіжність.
        let src = "//! H.\npub fn облік() {}\n";
        let files = vec![sf("src/a.rs", src)];
        assert!(detect_doc_comments(&files).is_empty());
    }

    // --- rust/workspace_root ---

    #[test]
    fn detect_workspace_root_a_root_workspace_covers_all_members_is_clean() {
        let files = vec![
            sf(
                "Cargo.toml",
                "[workspace]\nresolver = \"2\"\nmembers = [\"crates/a\", \"crates/b\"]\n",
            ),
            sf("crates/a/Cargo.toml", "[package]\nname = \"a\"\n"),
            sf("crates/b/Cargo.toml", "[package]\nname = \"b\"\n"),
        ];
        assert!(detect_workspace_root(&files).is_empty());
    }

    #[test]
    fn detect_workspace_root_a2_glob_members_pattern_is_clean() {
        let files = vec![
            sf(
                "Cargo.toml",
                "[workspace]\nresolver = \"2\"\nmembers = [\"crates/*\"]\n",
            ),
            sf("crates/a/Cargo.toml", "[package]\nname = \"a\"\n"),
            sf("crates/b/Cargo.toml", "[package]\nname = \"b\"\n"),
        ];
        assert!(detect_workspace_root(&files).is_empty());
    }

    #[test]
    fn detect_workspace_root_b_nested_workspace_below_root_is_flagged() {
        let files = vec![
            sf(
                "Cargo.toml",
                "[workspace]\nresolver = \"2\"\nmembers = [\"crates/a\"]\n",
            ),
            sf("crates/a/Cargo.toml", "[package]\nname = \"a\"\n"),
            sf("nested/Cargo.toml", "[workspace]\nmembers = [\"sub\"]\n"),
            sf("nested/sub/Cargo.toml", "[package]\nname = \"sub\"\n"),
        ];
        let violations = detect_workspace_root(&files);
        assert!(violations
            .iter()
            .any(|v| v.reason == "nested-workspace"
                && v.file.as_deref() == Some("nested/Cargo.toml")));
    }

    #[test]
    fn detect_workspace_root_c_solo_root_package_without_children_is_clean() {
        let files = vec![sf("Cargo.toml", "[package]\nname = \"solo\"\n")];
        assert!(detect_workspace_root(&files).is_empty());
    }

    #[test]
    fn detect_workspace_root_d_nested_profile_in_non_root_manifest_is_flagged() {
        let files = vec![
            sf(
                "Cargo.toml",
                "[workspace]\nresolver = \"2\"\nmembers = [\"crates/a\"]\n",
            ),
            sf(
                "crates/a/Cargo.toml",
                "[package]\nname = \"a\"\n\n[profile.release]\nopt-level = 3\n",
            ),
        ];
        let violations = detect_workspace_root(&files);
        assert!(violations
            .iter()
            .any(|v| v.reason == "nested-profile"
                && v.file.as_deref() == Some("crates/a/Cargo.toml")));
    }

    #[test]
    fn detect_workspace_root_nested_workspace_and_nested_profile_both_reported_independently() {
        // Один не-кореневий манiфест з ОБОМА порушеннями одночасно —
        // доккомент [`workspace_root_report_nested_tables`]: два незалежні
        // `if`, не `else if`.
        let files = vec![
            sf(
                "Cargo.toml",
                "[workspace]\nresolver = \"2\"\nmembers = [\"nested\"]\n",
            ),
            sf(
                "nested/Cargo.toml",
                "[package]\nname = \"nested\"\n\n[workspace]\nmembers = [\"x\"]\n\n[profile.release]\nopt-level = 3\n",
            ),
        ];
        let violations = detect_workspace_root(&files);
        assert!(violations.iter().any(|v| v.reason == "nested-workspace"));
        assert!(violations.iter().any(|v| v.reason == "nested-profile"));
    }

    #[test]
    fn detect_workspace_root_e_package_not_covered_by_members_is_flagged() {
        let files = vec![
            sf(
                "Cargo.toml",
                "[workspace]\nresolver = \"2\"\nmembers = [\"crates/a\"]\n",
            ),
            sf("crates/a/Cargo.toml", "[package]\nname = \"a\"\n"),
            sf("crates/orphan/Cargo.toml", "[package]\nname = \"orphan\"\n"),
        ];
        let violations = detect_workspace_root(&files);
        assert!(violations.iter().any(|v| {
            v.reason == "package-not-workspace-member"
                && v.file.as_deref() == Some("crates/orphan/Cargo.toml")
        }));
    }

    #[test]
    fn detect_workspace_root_exclude_removes_member_requirement() {
        let files = vec![
            sf(
                "Cargo.toml",
                "[workspace]\nresolver = \"2\"\nmembers = [\"crates/*\"]\nexclude = [\"crates/experimental\"]\n",
            ),
            sf("crates/a/Cargo.toml", "[package]\nname = \"a\"\n"),
            sf(
                "crates/experimental/Cargo.toml",
                "[package]\nname = \"experimental\"\n",
            ),
        ];
        assert!(detect_workspace_root(&files).is_empty());
    }

    #[test]
    fn detect_workspace_root_no_cargo_toml_with_package_is_not_applicable() {
        let files = vec![sf("package.json", "{}")];
        assert!(detect_workspace_root(&files).is_empty());
    }

    #[test]
    fn detect_workspace_root_missing_root_manifest_but_packages_exist_is_missing_root() {
        let files = vec![sf("crates/a/Cargo.toml", "[package]\nname = \"a\"\n")];
        let violations = detect_workspace_root(&files);
        assert!(violations
            .iter()
            .any(|v| v.reason == "missing-root-workspace" && v.file.is_none()));
    }

    #[test]
    fn detect_workspace_root_root_package_without_workspace_and_multiple_packages_is_missing_root()
    {
        let files = vec![
            sf("Cargo.toml", "[package]\nname = \"root\"\n"),
            sf("crates/a/Cargo.toml", "[package]\nname = \"a\"\n"),
        ];
        let violations = detect_workspace_root(&files);
        assert!(violations
            .iter()
            .any(|v| v.reason == "missing-root-workspace"));
    }

    #[test]
    fn detect_workspace_root_ignores_target_and_node_modules_directories() {
        let files = vec![
            sf(
                "Cargo.toml",
                "[workspace]\nresolver = \"2\"\nmembers = [\"crates/a\"]\n",
            ),
            sf("crates/a/Cargo.toml", "[package]\nname = \"a\"\n"),
            sf(
                "target/debug/build/whatever/Cargo.toml",
                "[package]\nname = \"ignored\"\n",
            ),
            sf(
                "node_modules/pkg/Cargo.toml",
                "[package]\nname = \"ignored2\"\n",
            ),
        ];
        assert!(detect_workspace_root(&files).is_empty());
    }

    #[test]
    fn detect_workspace_root_ignores_worktrees_directory() {
        let files = vec![
            sf(
                "Cargo.toml",
                "[workspace]\nresolver = \"2\"\nmembers = [\"crates/a\"]\n",
            ),
            sf("crates/a/Cargo.toml", "[package]\nname = \"a\"\n"),
            sf(
                ".worktrees/main-lint/Cargo.toml",
                "[workspace]\nresolver = \"2\"\nmembers = [\"crates/a\"]\n",
            ),
            sf(
                ".worktrees/main-lint/crates/a/Cargo.toml",
                "[package]\nname = \"a\"\n",
            ),
        ];
        assert!(detect_workspace_root(&files).is_empty());
    }

    #[test]
    fn detect_workspace_root_unparseable_root_toml_is_treated_as_missing_root() {
        let files = vec![
            sf("Cargo.toml", "this is not = [valid toml"),
            sf("crates/a/Cargo.toml", "[package]\nname = \"a\"\n"),
        ];
        let violations = detect_workspace_root(&files);
        assert!(violations
            .iter()
            .any(|v| v.reason == "missing-root-workspace"));
    }

    // --- маніфест ---

    #[test]
    fn build_manifest_declares_all_concerns_with_expected_scopes() {
        let manifest = build_manifest();
        assert_eq!(manifest.id, "rust/wasm-concerns");
        assert_eq!(manifest.world_version, "3.1.0");
        assert_eq!(manifest.domains, vec![Domain::Lint]);
        assert_eq!(manifest.concerns.len(), 3);
        assert!(manifest.tools.is_empty());
        assert!(manifest.ci_artifacts.is_empty());

        let applies = manifest
            .concerns
            .iter()
            .find(|c| c.key == CONCERN_APPLIES)
            .expect("rust/applies contribution має бути в маніфесті");
        assert_eq!(applies.scope, ConcernScope::Full);
        assert_eq!(applies.glob, vec!["**/Cargo.toml".to_string()]);

        let doc_comments = manifest
            .concerns
            .iter()
            .find(|c| c.key == CONCERN_DOC_COMMENTS)
            .expect("rust/doc_comments contribution має бути в маніфесті");
        assert_eq!(doc_comments.scope, ConcernScope::PerFile);
        assert_eq!(doc_comments.glob, vec!["**/*.rs".to_string()]);

        let workspace_root = manifest
            .concerns
            .iter()
            .find(|c| c.key == CONCERN_WORKSPACE_ROOT)
            .expect("rust/workspace_root contribution має бути в маніфесті");
        assert_eq!(workspace_root.scope, ConcernScope::Full);
        assert_eq!(workspace_root.glob, vec!["**/Cargo.toml".to_string()]);

        assert!(manifest.capabilities.fs_read.is_empty());
        assert!(!manifest.capabilities.network);
    }

    /// `plugin.toml` — статичний дублікат `describe()` (той самий anti-drift
    /// мотив, що `crates/plugin-lang-js`/`crates/plugin-lang-python`).
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
