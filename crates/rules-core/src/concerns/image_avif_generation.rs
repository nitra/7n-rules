//! Native-порт `image-avif/avif_generation`
//! (`npm/rules/image-avif/avif_generation/main.mjs`, 413 рядків) —
//! image-avif.mdc: read-only скан `.vue`/`.html`, звітує raster-посилання
//! (`import`/`src=`), яким бракує `.avif`-двійника (`avif-needs-rewrite` —
//! двійник є, треба переписати ref; `avif-missing` — двійника немає взагалі)
//! і `.avif`-«сироти» без живих посилань (`avif-orphan`). Мутації
//! (rewrite/unlink/`npx @nitra/minify-image`) лишаються на боці T0-fix
//! (`npm/rules/image-avif/avif_generation/fix-avif_generation.mjs`,
//! JS-only — детектор тут read-only).
//!
//! # Self-containment T0-fix (Р9 фіналу фази 5)
//!
//! JS `main.mjs` видаляється разом із native-портом. T0-fix потребує НЕ
//! лише `violations` (reason+file+message), а фактичний **новий вміст**
//! rewrite-ів і повний список orphan-шляхів для запису/unlink — цього
//! `Violation`-DTO навмисно не містить (діагностика, не мутаційний план,
//! доккомент `diagnostics.rs`). Тому `fix-avif_generation.mjs` дублює
//! власну (JS) копію read-only скан-логіки (`scanAvif`) — той самий підхід,
//! що вже усталений у цьому репо для non-trivial T0-фіксерів (на відміну
//! від тривіальних, як `hasura/migrations`, де досить `violation.file`).
//!
//! # `walkDir` → [`crate::concerns::cursor_ignore::walk_with_ignore_paths`]
//!
//! JS-версія використовувала `scripts/utils/walkDir.mjs` (callback-стиль,
//! той самий алгоритм, що вже портований у фазі 4а як [`crate::scan::walk_dir_raw`]
//! — Vec-стиль). Тут — [`crate::concerns::cursor_ignore::walk_with_ignore_paths`]
//! (той самий `ignore_paths`, завантажений один раз, обходить кілька
//! package-коренів), без окремого callback-шару.
//!
//! # Лукбехайнд у `VUE_RASTER_STATIC_SRC_RE` — регекс без lookbehind + ручний фільтр
//!
//! JS `VUE_RASTER_STATIC_SRC_RE` = `/(?<![:\-_.])\bsrc\s*=\s*['"](...)['"]/giu`.
//! Crate `regex` (DFA-двигун) **не підтримує lookaround**. `\b` перед `src`
//! уже відкидає прямий сусідній word-char (літера/цифра/`_`) — лишається
//! лише явно виключити три не-word символи (`:`, `-`, `.`), які
//! `\b` пропустив би: [`find_static_src_matches`] бере "голий" (без
//! лукбехайнду) regex і після кожного матчу перевіряє попередній символ
//! рядка вручну — той самий видимий ефект.
//!
//! # `process.cwd()` → явний `cwd`-параметр
//!
//! JS-хелпер `resolveImageCandidates` для `/`-префіксних посилань додає
//! `join(process.cwd(), importPath)` як legacy-фолбек. У CLI-контексті,
//! звідки викликається `lint()`, `process.cwd()` завжди дорівнює кореню
//! репозиторію (той самий `cwd`, що й `ctx.cwd` — CLI не робить `chdir`
//! по ходу лінту). [`resolve_image_candidates`] бере той самий `repo_cwd`,
//! що переданий у [`image_avif_generation`], як явний еквівалент.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use regex::Regex;

use crate::concerns::cursor_ignore::{load_cursor_ignore_paths, walk_with_ignore_paths};
use crate::concerns::workspaces::get_monorepo_package_root_dirs;
use crate::diagnostics::{Severity, Violation};

/// Стабільний reason: raster-посилання має `.avif`-двійник на диску, але
/// сам `.vue`/`.html` ще посилається на raster — точний порт
/// `AVIF_NEEDS_REWRITE` (`main.mjs:21`).
pub const AVIF_NEEDS_REWRITE: &str = "avif-needs-rewrite";
/// Стабільний reason: для растрового зображення відсутній `.avif`-двійник —
/// точний порт `AVIF_MISSING` (`main.mjs:23`).
pub const AVIF_MISSING: &str = "avif-missing";
/// Стабільний reason: AVIF-файл лишився без растрового джерела — точний
/// порт `AVIF_ORPHAN` (`main.mjs:25`).
pub const AVIF_ORPHAN: &str = "avif-orphan";

/// Поле в `package.json` для конфігу `@nitra/minify-image` — точний порт
/// `PKG_CONFIG_FIELD` (`main.mjs:31`).
const PKG_CONFIG_FIELD: &str = "@nitra/minify-image";

/// Каталоги, які cleanup не зачіпає (build-артефакти/нативні платформи) —
/// точний порт `CLEANUP_EXTRA_IGNORE_DIR_NAMES` (`main.mjs:40`).
const CLEANUP_EXTRA_IGNORE_DIR_NAMES: &[&str] =
    &["build", "android", "ios", ".output", ".nuxt", ".cache"];

/// `import name from '...ext'` для raster-розширень — точний порт
/// `VUE_RASTER_IMPORT_RE` (`main.mjs:48`, флаги `giu` → `(?i)` тут,
/// case-insensitive; unicode-`\w` у crate `regex` дещо ширший за JS
/// ASCII-`\w`, не спостережна різниця для реальних identifier-ів проєкту).
static VUE_RASTER_IMPORT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)import\s+\w[\w$]*\s+from\s+['"]([^'"\n]+\.(?:png|jpe?g|gif))['"]"#)
        .expect("valid regex")
});

/// "Голий" (без лукбехайнду) базовий regex для `src="..."` — доккомент
/// модуля щодо ручного фільтра. Точний порт решти `VUE_RASTER_STATIC_SRC_RE`
/// (`main.mjs:59`) без `(?<![:\-_.])`.
static VUE_RASTER_STATIC_SRC_BASE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)\bsrc\s*=\s*['"]([^'"\s]+\.(?:png|jpe?g|gif))['"]"#).expect("valid regex")
});

/// Готові AVIF-посилання (`import`/`src=`, вже з `.avif`-суфіксом) — точний
/// порт `VUE_AVIF_REF_RE` (`main.mjs:68`).
static VUE_AVIF_REF_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)['"]([^'"\s]+\.(?:png|jpe?g|gif)\.avif)['"]"#).expect("valid regex")
});

/// Чи у `package.json` пакета вимкнено avif-перевірку — точний порт
/// `packageHasAvifDisabled` (`main.mjs:76-81`).
fn package_has_avif_disabled(pkg: &serde_json::Value) -> bool {
    pkg.get(PKG_CONFIG_FIELD)
        .and_then(|v| v.as_object())
        .and_then(|o| o.get("disable-avif"))
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
}

/// `path.join`-семантика Node (на відміну від Rust `Path::join`, де
/// приєднання абсолютного компонента ПОВНІСТЮ замінює базу) — абсолютний
/// префікс `/` у `extra` тут трактується як звичайний сегмент, не re-root.
fn node_join(base: &Path, extra: &str) -> PathBuf {
    base.join(extra.trim_start_matches('/'))
}

/// Впорядкований список абсолютних кандидатів для одного raster/avif
/// посилання — точний порт `resolveImageCandidates` (`main.mjs:106-128`,
/// секція «`process.cwd()`» у доккоменті модуля щодо `repo_cwd`).
fn resolve_image_candidates(
    import_path: &str,
    source_abs_path: &Path,
    package_root_abs: Option<&Path>,
    repo_cwd: &Path,
) -> Vec<PathBuf> {
    if import_path.starts_with('.') {
        let parent = source_abs_path.parent().unwrap_or(source_abs_path);
        return vec![node_join(parent, import_path)];
    }
    if import_path.starts_with('/') {
        let mut candidates = Vec::new();
        if let Some(root) = package_root_abs {
            candidates.push(node_join(&node_join(root, "public"), import_path));
            candidates.push(node_join(root, import_path));
        }
        candidates.push(node_join(repo_cwd, import_path));
        return candidates;
    }
    if import_path.contains('/') {
        let parent = source_abs_path.parent().unwrap_or(source_abs_path);
        let mut candidates = vec![node_join(parent, import_path)];
        if let Some(root) = package_root_abs {
            candidates.push(node_join(&node_join(root, "public"), import_path));
        }
        return candidates;
    }
    Vec::new()
}

/// `<candidate>.avif` — суфіксований шлях для перевірки наявності двійника.
fn with_avif_suffix(p: &Path) -> PathBuf {
    let mut s = p.as_os_str().to_os_string();
    s.push(".avif");
    PathBuf::from(s)
}

/// Posix-relative шлях від `root`, лексично.
fn to_relative_posix(root: &Path, abs: &Path) -> String {
    let rel = abs.strip_prefix(root).unwrap_or(abs);
    rel.components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

/// Абсолютний шлях як posix-рядок (для сегментного аналізу орфан-cleanup).
fn to_posix_string(p: &Path) -> String {
    p.components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

/// Один знайдений матч regex-проходу: байтові діапазони повного матчу й
/// capture-групи 1 (шлях зображення) відносно рядка, у якому шукали.
type MatchSpan = (usize, usize, usize, usize);

/// Матчі `VUE_RASTER_IMPORT_RE` над `content` — без лукбехайнду, звичайний
/// `captures_iter`.
fn find_import_matches(content: &str) -> Vec<MatchSpan> {
    VUE_RASTER_IMPORT_RE
        .captures_iter(content)
        .filter_map(|caps| {
            let m = caps.get(0)?;
            let g = caps.get(1)?;
            Some((m.start(), m.end(), g.start(), g.end()))
        })
        .collect()
}

/// Матчі `VUE_RASTER_STATIC_SRC_RE` над `content` — доккомент модуля щодо
/// ручного лукбехайнд-фільтра (`:`/`-`/`.` перед `\bsrc`).
fn find_static_src_matches(content: &str) -> Vec<MatchSpan> {
    let mut out = Vec::new();
    for caps in VUE_RASTER_STATIC_SRC_BASE_RE.captures_iter(content) {
        let Some(m) = caps.get(0) else { continue };
        let Some(g) = caps.get(1) else { continue };
        let start = m.start();
        if start > 0 {
            let prev = content[..start].chars().next_back();
            if matches!(prev, Some(':') | Some('-') | Some('.')) {
                continue;
            }
        }
        out.push((m.start(), m.end(), g.start(), g.end()));
    }
    out
}

/// Один rewrite-прохід над `content` — для кожного матчу вирішує:
/// bare-alias (0 кандидатів) → лишити без змін; є `.avif`-двійник → замінити
/// шлях на `<path>.avif`, зафіксувати `used_avif_abs`; немає жодного
/// кандидата з `.avif` → зафіксувати `missing`, лишити без змін. Точний
/// порт `processMatches` (`main.mjs:187-205`, викликається двічі —
/// `main.mjs:207-218`).
#[allow(clippy::too_many_arguments)]
fn apply_rewrite_pass(
    content: &str,
    matches: &[MatchSpan],
    abs_path: &Path,
    abs_root: &Path,
    repo_cwd: &Path,
    used_avif_abs: &mut HashSet<PathBuf>,
    missing: &mut Vec<(PathBuf, String)>,
    render_failure: impl Fn(&str) -> String,
) -> String {
    if matches.is_empty() {
        return content.to_string();
    }
    let mut result = String::with_capacity(content.len());
    let mut cursor = 0usize;
    for &(m_start, m_end, p_start, p_end) in matches {
        result.push_str(&content[cursor..m_start]);
        let import_path = &content[p_start..p_end];
        let candidates = resolve_image_candidates(import_path, abs_path, Some(abs_root), repo_cwd);
        if candidates.is_empty() {
            result.push_str(&content[m_start..m_end]);
        } else {
            let found = candidates.iter().find(|c| with_avif_suffix(c).exists());
            if let Some(found) = found {
                used_avif_abs.insert(with_avif_suffix(found));
                result.push_str(&content[m_start..p_start]);
                result.push_str(import_path);
                result.push_str(".avif");
                result.push_str(&content[p_end..m_end]);
            } else {
                missing.push((abs_path.to_path_buf(), render_failure(import_path)));
                result.push_str(&content[m_start..m_end]);
            }
        }
        cursor = m_end;
    }
    result.push_str(&content[cursor..]);
    result
}

/// Збирає вже-вживані `.avif`-посилання у фінальному (post-rewrite) вмісті —
/// точний порт циклу `matchAll(VUE_AVIF_REF_RE)` (`main.mjs:220-226`).
fn collect_avif_refs(
    content: &str,
    abs_path: &Path,
    abs_root: &Path,
    repo_cwd: &Path,
    used_avif_abs: &mut HashSet<PathBuf>,
) {
    for caps in VUE_AVIF_REF_RE.captures_iter(content) {
        let Some(g) = caps.get(1) else { continue };
        let avif_path = g.as_str();
        for cand in resolve_image_candidates(avif_path, abs_path, Some(abs_root), repo_cwd) {
            if cand.exists() {
                used_avif_abs.insert(cand);
            }
        }
    }
}

/// Файли `.vue`/`.html` під `abs_root`, за межами `other_roots_abs` — точний
/// порт callback-фільтра всередині `walkDir(absRoot, ..., ignorePaths)`
/// (`main.mjs:167-176`, `main.mjs:300-308`), спільний для pre-scan і
/// основного проходу.
fn collect_target_vue_html_files(
    abs_root: &Path,
    other_roots_abs: &[PathBuf],
    ignore_paths: &[String],
) -> Vec<PathBuf> {
    walk_with_ignore_paths(abs_root, ignore_paths)
        .into_iter()
        .filter_map(|rel| {
            if !(rel.ends_with(".vue") || rel.ends_with(".html")) {
                return None;
            }
            let abs = abs_root.join(&rel);
            if other_roots_abs.iter().any(|other| abs.starts_with(other)) {
                return None;
            }
            Some(abs)
        })
        .collect()
}

/// Read-only скан `.vue`/`.html` одного workspace-пакета — точний порт
/// `scanVueAvifInPackage` (`main.mjs:162-232`). Читання файлу, що
/// зникло/недоступне між обходом і читанням, — тихо пропускається
/// (fail-safe; JS-версія впала б у rejected promise, нетестований
/// edge-case — той самий підхід, що й в інших native-концернах цього
/// крейту, напр. `hasura_internal_urls::check_env_file`).
#[allow(clippy::too_many_arguments)]
fn scan_vue_avif_in_package(
    package_root: &str,
    other_roots_abs: &[PathBuf],
    ignore_paths: &[String],
    used_avif_abs: &mut HashSet<PathBuf>,
    rewrites: &mut Vec<(PathBuf, String)>,
    missing: &mut Vec<(PathBuf, String)>,
    cwd: &Path,
) {
    let abs_root = cwd.join(package_root);
    let label = if package_root == "." {
        "корінь".to_string()
    } else {
        package_root.to_string()
    };
    let target_files = collect_target_vue_html_files(&abs_root, other_roots_abs, ignore_paths);
    if target_files.is_empty() {
        return;
    }

    for abs_path in &target_files {
        let rel = to_relative_posix(cwd, abs_path);
        let Ok(original) = std::fs::read_to_string(abs_path) else {
            continue;
        };
        let mut updated = original.clone();

        let import_matches = find_import_matches(&updated);
        updated = apply_rewrite_pass(
            &updated,
            &import_matches,
            abs_path,
            &abs_root,
            cwd,
            used_avif_abs,
            missing,
            |import_path| {
                format!(
                    "[{label}] {rel}: import з '{import_path}' має посилатись на AVIF-двійник '{import_path}.avif' (`npx @7n/rules fix image-avif` створює його поряд, якщо оригінал є на диску). Вимкнути локально: \"@nitra/minify-image\": {{ \"disable-avif\": true }} у package.json пакета"
                )
            },
        );

        let static_src_matches = find_static_src_matches(&updated);
        updated = apply_rewrite_pass(
            &updated,
            &static_src_matches,
            abs_path,
            &abs_root,
            cwd,
            used_avif_abs,
            missing,
            |src_path| {
                format!(
                    "[{label}] {rel}: пряме `src=\"{src_path}\"` у шаблоні має використовувати AVIF-двійник `src=\"{src_path}.avif\"` (або винеси у import + `:src=\"...\"`). Вимкнути локально: \"@nitra/minify-image\": {{ \"disable-avif\": true }} у package.json пакета"
                )
            },
        );

        collect_avif_refs(&updated, abs_path, &abs_root, cwd, used_avif_abs);

        if updated != original {
            rewrites.push((abs_path.clone(), updated));
        }
    }
}

/// Сканує всі workspace-пакети (opt-out через `disable-avif`), повертає
/// абсолютні корені пакетів з активним opt-out — точний порт
/// `scanVueAvifImports` (`main.mjs:252-269`). Невалідний/нечитабельний
/// `package.json` пакета трактується як «без opt-out» (fail-safe; JS без
/// `try/catch` тут кинула б — нетестований edge-case, той самий підхід
/// fail-safe-over-crash, що й в інших native-концернах).
fn scan_vue_avif_imports(
    ignore_paths: &[String],
    used_avif_abs: &mut HashSet<PathBuf>,
    rewrites: &mut Vec<(PathBuf, String)>,
    missing: &mut Vec<(PathBuf, String)>,
    cwd: &Path,
) -> Vec<PathBuf> {
    let roots = get_monorepo_package_root_dirs(cwd);
    let mut opted_out_abs = Vec::new();
    for root in &roots {
        let pkg_path = cwd.join(root).join("package.json");
        if pkg_path.exists() {
            let disabled = std::fs::read_to_string(&pkg_path)
                .ok()
                .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
                .map(|pkg| package_has_avif_disabled(&pkg))
                .unwrap_or(false);
            if disabled {
                opted_out_abs.push(cwd.join(root));
                continue;
            }
        }
        let other_roots_abs: Vec<PathBuf> = roots
            .iter()
            .filter(|r| r.as_str() != root.as_str() && r.as_str() != ".")
            .map(|r| cwd.join(r))
            .collect();
        scan_vue_avif_in_package(
            root,
            &other_roots_abs,
            ignore_paths,
            used_avif_abs,
            rewrites,
            missing,
            cwd,
        );
    }
    opted_out_abs
}

/// Pre-scan: чи є хоч одне raster-посилання, яке потенційно варто
/// переписати — точний порт `hasAnyVueRasterReference` (`main.mjs:287-318`).
/// Невалідний `package.json` — той самий fail-safe, що й
/// [`scan_vue_avif_imports`].
fn has_any_vue_raster_reference(ignore_paths: &[String], cwd: &Path) -> bool {
    let roots = get_monorepo_package_root_dirs(cwd);
    for root in &roots {
        let pkg_path = cwd.join(root).join("package.json");
        if pkg_path.exists() {
            let disabled = std::fs::read_to_string(&pkg_path)
                .ok()
                .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
                .map(|pkg| package_has_avif_disabled(&pkg))
                .unwrap_or(false);
            if disabled {
                continue;
            }
        }
        let abs_root = cwd.join(root);
        let other_roots_abs: Vec<PathBuf> = roots
            .iter()
            .filter(|r| r.as_str() != root.as_str() && r.as_str() != ".")
            .map(|r| cwd.join(r))
            .collect();
        let target_files = collect_target_vue_html_files(&abs_root, &other_roots_abs, ignore_paths);
        for abs_path in &target_files {
            let Ok(content) = std::fs::read_to_string(abs_path) else {
                continue;
            };
            if !find_import_matches(&content).is_empty() {
                return true;
            }
            if !find_static_src_matches(&content).is_empty() {
                return true;
            }
        }
    }
    false
}

/// Read-only: збирає AVIF-сироти без живих посилань — точний порт
/// `collectOrphanAvifs` (`main.mjs:330-346`).
fn collect_orphan_avifs(
    used_avif_abs: &HashSet<PathBuf>,
    opted_out_abs: &[PathBuf],
    ignore_paths: &[String],
    cwd: &Path,
) -> Vec<PathBuf> {
    walk_with_ignore_paths(cwd, ignore_paths)
        .into_iter()
        .filter_map(|rel| {
            if !rel.ends_with(".avif") {
                return None;
            }
            let abs = cwd.join(&rel);
            if used_avif_abs.contains(&abs) {
                return None;
            }
            if opted_out_abs
                .iter()
                .any(|root| &abs == root || abs.starts_with(root))
            {
                return None;
            }
            let posix = to_posix_string(&abs);
            let segments: Vec<&str> = posix.split('/').collect();
            if segments
                .iter()
                .any(|seg| CLEANUP_EXTRA_IGNORE_DIR_NAMES.contains(seg))
            {
                return None;
            }
            Some(abs)
        })
        .collect()
}

/// Результат read-only скану AVIF-етапу — точний порт `AvifScan`
/// (`main.mjs:348-355`). `rewrites`/`missing` тримають `(абсолютний_шлях,
/// новий_вміст_або_повідомлення)` замість окремих `{file, content}`/`{file,
/// message}` обʼєктів — той самий вміст, компактніша Rust-форма.
pub struct AvifScan {
    pub skipped: bool,
    pub rewrites: Vec<(PathBuf, String)>,
    pub missing: Vec<(PathBuf, String)>,
    pub orphans: Vec<PathBuf>,
}

/// Чистий read-only скан усього AVIF-етапу — точний порт `scanAvif`
/// (`main.mjs:363-377`).
pub fn scan_avif(cwd: &Path) -> AvifScan {
    let ignore_paths = load_cursor_ignore_paths(cwd);
    if !has_any_vue_raster_reference(&ignore_paths, cwd) {
        return AvifScan {
            skipped: true,
            rewrites: Vec::new(),
            missing: Vec::new(),
            orphans: Vec::new(),
        };
    }
    let mut used_avif_abs = HashSet::new();
    let mut rewrites = Vec::new();
    let mut missing = Vec::new();
    let opted_out_abs = scan_vue_avif_imports(
        &ignore_paths,
        &mut used_avif_abs,
        &mut rewrites,
        &mut missing,
        cwd,
    );
    let orphans = collect_orphan_avifs(&used_avif_abs, &opted_out_abs, &ignore_paths, cwd);
    AvifScan {
        skipped: false,
        rewrites,
        missing,
        orphans,
    }
}

/// Detector `image-avif/avif_generation` — точний порт `lint(ctx)`
/// (`main.mjs:386-413`). Read-only: НЕ переписує/видаляє файли (T0-фіксер
/// у `fix-avif_generation.mjs` робить мутації — доккомент модуля).
pub fn image_avif_generation(cwd: &Path) -> Vec<Violation> {
    let scan = scan_avif(cwd);
    if scan.skipped {
        return Vec::new();
    }

    let mut violations = Vec::new();
    for (abs_path, _content) in &scan.rewrites {
        let rel = to_relative_posix(cwd, abs_path);
        violations.push(Violation {
            reason: AVIF_NEEDS_REWRITE.to_string(),
            message: format!(
                "{rel}: raster-посилання має вживати AVIF-двійник — запусти `npx @7n/rules fix image-avif` (image-avif.mdc)"
            ),
            file: Some(rel),
            severity: Severity::Error,
            data: None,
        });
    }
    for (abs_path, message) in &scan.missing {
        let rel = to_relative_posix(cwd, abs_path);
        violations.push(Violation {
            reason: AVIF_MISSING.to_string(),
            message: message.clone(),
            file: Some(rel),
            severity: Severity::Error,
            data: None,
        });
    }
    for orphan in &scan.orphans {
        let rel = to_relative_posix(cwd, orphan);
        violations.push(Violation {
            reason: AVIF_ORPHAN.to_string(),
            message: format!(
                "{rel}: AVIF-сирота без живих посилань — запусти `npx @7n/rules fix image-avif` (image-avif.mdc)"
            ),
            file: Some(rel),
            severity: Severity::Error,
            data: None,
        });
    }
    violations
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    use crate::concerns::test_support::write;

    fn write_json(tmp: &TempDir, rel: &str, value: serde_json::Value) {
        write(tmp, rel, &value.to_string());
    }

    fn setup_mono_app(tmp: &TempDir) {
        write_json(
            tmp,
            "package.json",
            serde_json::json!({ "name": "mono", "private": true, "workspaces": ["app"] }),
        );
        write(tmp, ".gitignore", "node_modules/\n");
        write_json(
            tmp,
            "app/package.json",
            serde_json::json!({ "name": "app" }),
        );
    }

    #[test]
    fn static_src_with_avif_twin_reports_rewrite_and_is_read_only() {
        let tmp = TempDir::new().unwrap();
        setup_mono_app(&tmp);
        write(&tmp, "app/src/a.png", "fake-png");
        write(&tmp, "app/src/a.png.avif", "fake-avif");
        let vue = "<template>\n  <img src=\"./a.png\" alt=\"a\" />\n</template>\n";
        write(&tmp, "app/src/App.vue", vue);

        let violations = image_avif_generation(tmp.path());
        assert!(violations.iter().any(|v| v.reason == AVIF_NEEDS_REWRITE));
        assert_eq!(
            fs::read_to_string(tmp.path().join("app/src/App.vue")).unwrap(),
            vue
        );
    }

    #[test]
    fn orphan_avif_reports_orphan_and_is_not_deleted() {
        let tmp = TempDir::new().unwrap();
        setup_mono_app(&tmp);
        write(&tmp, "app/src/usage.png", "fake-png");
        write(&tmp, "app/src/usage.png.avif", "fake-avif");
        write(&tmp, "app/src/orphan.png.avif", "fake-avif");
        write(
            &tmp,
            "app/src/App.vue",
            "<template>\n  <img src=\"./usage.png\" />\n</template>\n",
        );

        let violations = image_avif_generation(tmp.path());
        assert!(violations.iter().any(|v| v.reason == AVIF_ORPHAN));
        assert!(tmp.path().join("app/src/orphan.png.avif").exists());
    }

    #[test]
    fn missing_avif_twin_for_import_is_violation() {
        let tmp = TempDir::new().unwrap();
        setup_mono_app(&tmp);
        write(
            &tmp,
            "app/src/App.vue",
            "<script setup>\nimport hero from './hero.png'\n</script>\n<template><img :src=\"hero\"/></template>\n",
        );
        let violations = image_avif_generation(tmp.path());
        assert!(!violations.is_empty());
        assert!(violations.iter().any(|v| v.reason == AVIF_MISSING));
    }

    #[test]
    fn already_avif_import_is_clean() {
        let tmp = TempDir::new().unwrap();
        setup_mono_app(&tmp);
        write(
            &tmp,
            "app/src/App.vue",
            "<script setup>\nimport hero from './hero.png.avif'\n</script>\n<template><img :src=\"hero\"/></template>\n",
        );
        assert!(image_avif_generation(tmp.path()).is_empty());
    }

    #[test]
    fn opted_out_package_is_clean() {
        let tmp = TempDir::new().unwrap();
        write_json(
            &tmp,
            "package.json",
            serde_json::json!({ "name": "mono", "private": true, "workspaces": ["app"] }),
        );
        write(&tmp, ".gitignore", "node_modules/\n");
        write_json(
            &tmp,
            "app/package.json",
            serde_json::json!({ "name": "app", "@nitra/minify-image": { "disable-avif": true } }),
        );
        write(
            &tmp,
            "app/src/App.vue",
            "<script setup>\nimport hero from './hero.png'\n</script>\n<template><img :src=\"hero\"/></template>\n",
        );
        assert!(image_avif_generation(tmp.path()).is_empty());
    }

    #[test]
    fn svg_imports_do_not_require_avif() {
        let tmp = TempDir::new().unwrap();
        setup_mono_app(&tmp);
        write(
            &tmp,
            "app/src/App.vue",
            "<script setup>\nimport icon from './icon.svg'\n</script>\n<template><img :src=\"icon\"/></template>\n",
        );
        assert!(image_avif_generation(tmp.path()).is_empty());
    }

    #[test]
    fn direct_static_src_without_import_is_violation() {
        let tmp = TempDir::new().unwrap();
        setup_mono_app(&tmp);
        write(
            &tmp,
            "app/src/App.vue",
            "<template>\n  <img src=\"./hero.png\" alt=\"hero\" />\n</template>\n",
        );
        assert!(!image_avif_generation(tmp.path()).is_empty());
    }

    #[test]
    fn direct_static_src_avif_is_clean() {
        let tmp = TempDir::new().unwrap();
        setup_mono_app(&tmp);
        write(
            &tmp,
            "app/src/App.vue",
            "<template>\n  <img src=\"./hero.png.avif\" alt=\"hero\" />\n</template>\n",
        );
        assert!(image_avif_generation(tmp.path()).is_empty());
    }

    #[test]
    fn reactive_bind_src_is_not_confused_with_static_src() {
        let tmp = TempDir::new().unwrap();
        setup_mono_app(&tmp);
        write(
            &tmp,
            "app/src/App.vue",
            "<script setup>\nimport hero from './hero.png.avif'\n</script>\n<template>\n  <img :src=\"hero\" />\n</template>\n",
        );
        assert!(image_avif_generation(tmp.path()).is_empty());
    }

    #[test]
    fn data_src_attribute_is_not_matched_as_static_src() {
        let tmp = TempDir::new().unwrap();
        setup_mono_app(&tmp);
        write(&tmp, "app/src/reactive.png", "fake");
        write(&tmp, "app/src/reactive.png.avif", "fake");
        write(
            &tmp,
            "app/src/App.vue",
            "<template>\n  <img data-src=\"./reactive.png\" />\n</template>\n",
        );
        // data-src не має відповідати VUE_RASTER_STATIC_SRC_RE (лукбехайнд
        // виключає `-` перед `src`) → жодного raster-посилання не знайдено →
        // весь AVIF-етап пропускається (немає інших raster-ref у файлі).
        assert!(image_avif_generation(tmp.path()).is_empty());
    }

    #[test]
    fn quasar_style_root_src_resolves_via_package_public() {
        let tmp = TempDir::new().unwrap();
        write_json(
            &tmp,
            "package.json",
            serde_json::json!({ "name": "mono", "private": true, "workspaces": ["site"] }),
        );
        write(&tmp, ".gitignore", "node_modules/\n");
        write_json(
            &tmp,
            "site/package.json",
            serde_json::json!({ "name": "site" }),
        );
        write(&tmp, "site/public/api-page/1.png", "fake");
        write(&tmp, "site/public/api-page/1.png.avif", "fake");
        write(
            &tmp,
            "site/src/pages/x.vue",
            "<template>\n  <q-img src=\"/api-page/1.png\" />\n</template>\n",
        );
        let violations = image_avif_generation(tmp.path());
        assert!(violations.iter().any(|v| v.reason == AVIF_NEEDS_REWRITE));
    }

    #[test]
    fn cleanup_ignores_build_android_ios_output_nuxt_cache() {
        let tmp = TempDir::new().unwrap();
        setup_mono_app(&tmp);
        write(&tmp, "app/src/App.vue", "<template><div/></template>\n");
        for sub in ["build", "android", "ios", ".output", ".nuxt", ".cache"] {
            write(&tmp, &format!("app/{sub}/artifact.png.avif"), "fake");
        }
        // Немає raster-посилань у .vue → pre-scan skip → жодних orphan-звітів.
        assert!(image_avif_generation(tmp.path()).is_empty());
        for sub in ["build", "android", "ios", ".output", ".nuxt", ".cache"] {
            assert!(tmp
                .path()
                .join(format!("app/{sub}/artifact.png.avif"))
                .exists());
        }
    }

    #[test]
    fn bare_dedup_of_two_matching_regexes_reported_once_per_file() {
        let tmp = TempDir::new().unwrap();
        setup_mono_app(&tmp);
        write(
            &tmp,
            "app/src/App.vue",
            "<script setup>\nimport hero from './hero.png'\n</script>\n",
        );
        let violations = image_avif_generation(tmp.path());
        let hero_violations: Vec<_> = violations
            .iter()
            .filter(|v| v.message.contains("hero.png"))
            .collect();
        assert_eq!(hero_violations.len(), 1);
    }

    #[test]
    fn all_violations_carry_file_field() {
        let tmp = TempDir::new().unwrap();
        setup_mono_app(&tmp);
        write(
            &tmp,
            "app/src/App.vue",
            "<template>\n  <img src=\"./hero.png\" alt=\"hero\" />\n</template>\n",
        );
        let violations = image_avif_generation(tmp.path());
        assert!(!violations.is_empty());
        assert!(violations.iter().all(|v| v.file.is_some()));
    }
}
