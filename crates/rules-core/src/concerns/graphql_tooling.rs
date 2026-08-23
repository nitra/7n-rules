//! Native-порт `graphql/tooling` (`npm/rules/graphql/tooling/main.mjs`, 129
//! рядків) — graphql.mdc: якщо у `.vue`/JS/TS джерелах є хоча б один
//! `gql\`…\`` tagged template literal, проєкт повинен мати `.graphqlrc.yml`
//! у корені й рекомендацію `graphql.vscode-graphql` у
//! `.vscode/extensions.json` (rego-полісі `graphql/vscode_extensions`).
//!
//! # Reuse-межа
//!
//! - `loadCursorIgnorePaths` + `walkDir` (`main.mjs:12,14,28-43`) →
//!   [`crate::concerns::cursor_ignore`] + [`crate::scan::walk_dir`] — той
//!   самий двоетапний виклик (читання `.n-rules.json` → нормалізація у
//!   relative-posix-`/**`-глоби → обхід), що вже прийнятий у
//!   [`super::env_dns`] (доккомент там пояснює відхилення від Р5: full-scope
//!   native concern сам читає repo-локальний конфіг, бо `run_concern`
//!   (`mod.rs`) не має per-concern знань).
//! - `runConftestBatch` (`main.mjs:82-86`, без `templateData`) →
//!   [`crate::conftest::run_conftest_batch`] — той самий rego-пакет
//!   (`rules/graphql/vscode_extensions`), той самий namespace
//!   (`graphql.vscode_extensions`), той самий єдиний файл-ціль.
//! - `createViolationReporter` (`main.mjs:101-102`) — тут немає окремого
//!   reporter-типу: `pass(...)` у JS-каноні — **навмисний no-op**
//!   (`violation-reporter.mjs:29-32`, коментар «detector не друкує — pass
//!   стає no-op»), тож жоден із трьох викликів `pass(...)` у `main.mjs`
//!   (рядки 111, 116, 119, 88) не дає жодного спостережуваного ефекту — ні
//!   violation, ні diagnostic. Через це порт не заводить жодного
//!   [`crate::diagnostics::ConcernDiagnostic`]: концерн повністю описується
//!   парою (`violations`, `Result::Err`), без третього каналу.
//!
//! # `sourceFileHasGqlTaggedTemplate` — свідома заміна AST на regex
//!
//! Канон визначає tagged template через **справжній AST**
//! (`npm/rules/graphql/lib/graphql-gql-scan.mjs`, `oxc-parser`
//! `parseSync` + рекурсивний обхід `TaggedTemplateExpression` з
//! `tag.type === 'Identifier' && tag.name === 'gql'`). Цей файл лишається на
//! JS-боці незмінним (він НЕ частина `main.mjs`, і в нього є другий живий
//! споживач — `npm/scripts/auto-rules.mjs`, предикат `gqlTaggedTemplate` для
//! авто-увімкнення правила; видаляти чи мігрувати його немає підстав).
//!
//! `rules-core` не має залежності на `oxc_parser` (це залежність лише
//! `crates/plugin-lang-js`, wasm-плагіна для іншого кластеру концернів
//! `js/*` — притягувати її сюди заради одного regex-замінного патерну не
//! виправдано розміром). Тому [`source_file_has_gql_tagged_template`] тут —
//! **текстова апроксимація**: непорожній збіг `` gql` `` (ідентифікатор
//! `gql`, не частина довшого імені й не властивість після `.`, одразу перед
//! backtick-ом, з опційними пробілами між ними — той самий клас
//! toleration, що вже прийнятий для `INVOKE_PLUGIN_RE`/`JS_PLUGIN_IMPORT_RE`
//! у [`super::tauri_tool_surface`]). Наслідки апроксимації:
//! - синтаксично зламаний файл (канон: `parseSync` кидає помилку → `false`)
//!   тут дає `false` **лише якщо** в тексті немає підрядка `` gql` `` —
//!   збігається з усіма сценаріями чинного тест-набору (жоден з них не має
//!   зламаного синтаксису одночасно з валідним `gql`-тегом), але теоретично
//!   розійдеться на файлі, що одночасно синтаксично зламаний І містить
//!   текстовий підрядок `` gql` `` (наприклад, усередині рядкового літералу
//!   чи коментаря) — токен, що канон побачив би лише у справжньому AST;
//! - `obj.gql\`…\`` (властивість, MemberExpression-тег) канон відкидає
//!   (`tag.type !== 'Identifier'`); тут теж відкидається (перед `gql`
//!   вимагається НЕ `.`-символ), парність збережена явно, не випадково.
//!
//! # Канал помилок — по кожній гілці окремо
//!
//! `main.mjs` НЕ кличе `ensureTool` напряму жодного разу — обидва місця, де
//! JS-канон може впасти, роблять це через спільний хелпер, якого сам
//! `lint()` не ловить (`try/catch` немає ні в `collectGqlHits`, ні в
//! `checkExtensionsRecommendation`):
//! - `readFile` у `collectGqlHits` (`main.mjs:56`) без `try/catch` →
//!   виняток летить із `lint()` → [`RulesError::Concern`];
//! - `runConftestBatch` у `checkExtensionsRecommendation` (`main.mjs:82-86`)
//!   без `try/catch` → виняток (`conftest` не резолвиться, rego-каталог
//!   відсутній, `conftest` впав з несподіваним кодом) летить із `lint()` →
//!   [`RulesError::Concern`]. [`crate::conftest::run_conftest_batch`] вже
//!   інкапсулює рівно ці fail-closed гілки як `Result`, тож `?` тут і є
//!   портом «неспійманого винятку».
//!
//! Усі інші гілки (`.vscode/extensions.json` не існує; `.graphqlrc.yml` не
//! існує; rego-полісі повернула failures) — контрольовані `fail(...)`-виклики
//! з JS-боку, тобто звичайні [`Violation`], не помилки.

use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;

use crate::concerns::cursor_ignore::{load_cursor_ignore_paths, to_relative_ignore_globs};
use crate::conftest::run_conftest_batch;
use crate::diagnostics::{Severity, Violation};
use crate::rules_package::{missing_package_root_hint, rules_root};
use crate::scan::walk_dir;
use crate::RulesError;

/// Очікуваний файл GraphQL Config у корені (graphql.mdc) — `GRAPHQL_RC_FILENAME`
/// (`main.mjs:17`).
pub const GRAPHQL_RC_FILENAME: &str = ".graphqlrc.yml";

/// Розширення VS Code з graphql.mdc — `REQUIRED_GRAPHQL_VSCODE_EXTENSION`
/// (`main.mjs:20`).
pub const REQUIRED_GRAPHQL_VSCODE_EXTENSION: &str = "graphql.vscode-graphql";

/// Каталог rego-полісі відносно `<корінь пакета>/rules` — `policyDirRel`
/// (`main.mjs:83`).
const POLICY_DIR_REL: &str = "graphql/vscode_extensions";

/// Namespace rego-пакета — `namespace` (`main.mjs:84`).
const POLICY_NAMESPACE: &str = "graphql.vscode_extensions";

/// Відносний шлях цілі rego-перевірки — `pathRel` (`main.mjs:74`).
const EXTENSIONS_JSON_REL: &str = ".vscode/extensions.json";

/// `reason` усіх violations цього концерну — `createViolationReporter`
/// дає `defaultReason = ctx?.concernId ?? 'violation'`
/// (`violation-reporter.mjs:27`), а виклик у тестах фіксує
/// `concernId: 'tooling'` (`tooling.test.mjs:14`; шлях концерну —
/// `graphql/tooling`). Жоден `fail(...)` у `main.mjs` не передає власний
/// `opts.reason`, тож усі violations несуть рівно цей код.
const REASON: &str = "tooling";

/// Розширення джерел для gql-сканування — `SOURCE_FILE_RE`
/// (`graphql-gql-scan.mjs:12`, `/\.(vue|[cm]?[jt]sx?)$/u`).
static SOURCE_FILE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\.(vue|[cm]?[jt]sx?)$").expect("valid regex"));

/// `<script>` блоки `.vue` SFC — `VUE_SCRIPT_BLOCK_RE`
/// (`graphql-gql-scan.mjs:13`, `/<script\b[^>]*>([\s\S]*?)<\/script>/gi`).
static VUE_SCRIPT_BLOCK_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<script\b[^>]*>(.*?)</script>").expect("valid regex"));

/// Текстова апроксимація `gql\`…\`` tagged template — доккомент модуля,
/// секція «свідома заміна AST на regex». Перед `gql` не повинно бути
/// `\w`/`$`/`.` (виключає довші ідентифікатори й властивості на кшталт
/// `obj.gql`), одразу (з опційними пробілами) — backtick.
static GQL_TAG_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?:^|[^\w$.])gql[ \t]*`").expect("valid regex"));

/// Чи підлягає файл скануванню за розширенням — порт `isGqlScanSourceFile`
/// (`graphql-gql-scan.mjs:130-132`).
fn is_gql_scan_source_file(rel: &str) -> bool {
    SOURCE_FILE_RE.is_match(rel)
}

/// Чи пропустити файл (декларації, auto-imports/components.d.ts) — порт
/// `shouldSkipFileForGqlScan` (`graphql-gql-scan.mjs:140-146`).
fn should_skip_file_for_gql_scan(rel_posix: &str) -> bool {
    let base = rel_posix.rsplit('/').next().unwrap_or(rel_posix);
    if base == "auto-imports.d.ts" || base == "components.d.ts" {
        return true;
    }
    rel_posix.ends_with(".d.ts")
}

/// Витягує лише вміст `<script>` блоків з `.vue` SFC — порт
/// `extractVueScriptBlocks` (`graphql-gql-scan.mjs:20-29`).
fn extract_vue_script_blocks(sfc: &str) -> String {
    VUE_SCRIPT_BLOCK_RE
        .captures_iter(sfc)
        .map(|caps| caps[1].to_string())
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// Чи містить файл `gql\`…\`` tagged template — regex-апроксимація
/// `sourceFileHasGqlTaggedTemplate` (`graphql-gql-scan.mjs:110-123`),
/// доккомент модуля пояснює межу розходження з AST-каноном. Для `.vue`
/// сканується лише вміст `<script>`-блоків — порт `contentForGqlScan`
/// (`graphql-gql-scan.mjs:37-42`).
fn source_file_has_gql_tagged_template(content: &str, rel: &str) -> bool {
    if rel.ends_with(".vue") {
        GQL_TAG_RE.is_match(&extract_vue_script_blocks(content))
    } else {
        GQL_TAG_RE.is_match(content)
    }
}

/// Збирає відносні posix-шляхи файлів-кандидатів для gql-сканування — порт
/// `collectScanCandidates` (`main.mjs:28-43`). Обхід дерева й
/// repo-локальний `.n-rules.json`/`.n-cursor.json` читаються тут же (та сама
/// відповідність, що [`super::env_dns::env_dns`] — доккомент модуля,
/// секція «Reuse-межа»).
fn collect_scan_candidates(root: &Path) -> Vec<String> {
    let ignore_paths = load_cursor_ignore_paths(root);
    let extra_globs = to_relative_ignore_globs(root, &ignore_paths);
    walk_dir(root, &extra_globs)
        .into_iter()
        .filter(|rel| !should_skip_file_for_gql_scan(rel) && is_gql_scan_source_file(rel))
        .collect()
}

/// Повертає відносні шляхи файлів, де знайдено gql tagged template — порт
/// `collectGqlHits` (`main.mjs:51-62`). `readFile`, як і в JS, не загорнутий
/// у власний обробник помилок — I/O-помилка тут стає
/// [`RulesError::Concern`] (доккомент модуля, секція «Канал помилок»).
fn collect_gql_hits(root: &Path, candidates: &[String]) -> Result<Vec<String>, RulesError> {
    let mut hits = Vec::new();
    for rel in candidates {
        let content = std::fs::read_to_string(root.join(rel)).map_err(|error| {
            RulesError::Concern(format!("{rel}: не вдалося прочитати: {error}"))
        })?;
        if source_file_has_gql_tagged_template(&content, rel) {
            hits.push(rel.clone());
        }
    }
    Ok(hits)
}

/// Делегує валідацію `.vscode/extensions.json` rego-пакету
/// `graphql.vscode_extensions` — порт `checkExtensionsRecommendation`
/// (`main.mjs:73-92`). Викликається лише після того, як [`collect_gql_hits`]
/// знайшов хоча б один gql-tag (умовне правило — доккомент [`graphql_tooling`]).
fn check_extensions_recommendation(
    cwd: &Path,
    violations: &mut Vec<Violation>,
) -> Result<(), RulesError> {
    let path_abs = cwd.join(EXTENSIONS_JSON_REL);
    if !path_abs.exists() {
        violations.push(Violation {
            reason: REASON.to_string(),
            message: format!(
                "{EXTENSIONS_JSON_REL} не існує — створи файл і додай у recommendations {REQUIRED_GRAPHQL_VSCODE_EXTENSION} (graphql.mdc)"
            ),
            file: None,
            severity: Severity::Error,
            data: None,
        });
        return Ok(());
    }

    let root = rules_root(cwd).ok_or_else(|| RulesError::Concern(missing_package_root_hint()))?;
    let policy_abs = root.join(POLICY_DIR_REL);
    let failures = run_conftest_batch(&policy_abs, POLICY_NAMESPACE, &[path_abs])?;
    for failure in failures {
        violations.push(Violation {
            reason: REASON.to_string(),
            message: failure.message,
            file: None,
            severity: Severity::Error,
            data: None,
        });
    }
    Ok(())
}

/// Detector `graphql/tooling` — точний порт `lint(ctx)` (`main.mjs:100-129`).
/// `ctx.files` у каноні ніде не читається (умовне правило — full-scope
/// сканування завжди, `concern.json:{"lint":{"scope":"full"}}`), тож на
/// відміну від буквальної специфікації (`files: Option<&[String]>`) параметр
/// тут відсутній — та сама форма, що найближчий прототип
/// [`super::tauri_tool_surface::tauri_tool_surface`] (доккомент модуля
/// пояснює й це відхилення в кінці — секція «Що виявилось невірним»
/// репорту порту, не тут).
pub fn graphql_tooling(cwd: &Path) -> Result<Vec<Violation>, RulesError> {
    let candidates = collect_scan_candidates(cwd);
    let hits = collect_gql_hits(cwd, &candidates)?;

    let mut violations = Vec::new();
    if hits.is_empty() {
        return Ok(violations);
    }

    if !cwd.join(GRAPHQL_RC_FILENAME).exists() {
        violations.push(Violation {
            reason: REASON.to_string(),
            message: format!(
                "Відсутній {GRAPHQL_RC_FILENAME} у корені — додай GraphQL Config (graphql.mdc), бо в проєкті є gql template literals"
            ),
            file: None,
            severity: Severity::Error,
            data: None,
        });
    }

    check_extensions_recommendation(cwd, &mut violations)?;

    Ok(violations)
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;
    use crate::concerns::test_support::write;

    // --- is_gql_scan_source_file / should_skip_file_for_gql_scan ---

    #[test]
    fn source_file_extensions_match_canon_set() {
        for rel in [
            "a.vue", "a.js", "a.jsx", "a.mjs", "a.cjs", "a.ts", "a.tsx", "a.mts", "a.cts",
        ] {
            assert!(is_gql_scan_source_file(rel), "{rel}");
        }
        for rel in ["a.txt", "a.json", "a.rs", "a.md"] {
            assert!(!is_gql_scan_source_file(rel), "{rel}");
        }
    }

    #[test]
    fn generated_declaration_files_are_skipped() {
        assert!(should_skip_file_for_gql_scan("src/auto-imports.d.ts"));
        assert!(should_skip_file_for_gql_scan("components.d.ts"));
        assert!(should_skip_file_for_gql_scan("src/env.d.ts"));
        assert!(!should_skip_file_for_gql_scan("src/main.ts"));
    }

    // --- source_file_has_gql_tagged_template: дзеркало tooling.test.mjs:18-56 ---

    #[test]
    fn true_for_gql_in_ts() {
        let src = "import gql from 'graphql-tag'\nconst q = gql`query { me { id } }`\n";
        assert!(source_file_has_gql_tagged_template(src, "api/foo.ts"));
    }

    #[test]
    fn true_for_gql_in_tsx() {
        let src = "const q = gql`query { x }`\n";
        assert!(source_file_has_gql_tagged_template(src, "api/foo.tsx"));
    }

    #[test]
    fn true_for_gql_in_jsx() {
        let src = "const q = gql`query { x }`\n";
        assert!(source_file_has_gql_tagged_template(src, "api/foo.jsx"));
    }

    #[test]
    fn syntactically_broken_text_without_gql_tag_is_false() {
        assert!(!source_file_has_gql_tagged_template(
            "import { from broken\n",
            "x.ts"
        ));
    }

    #[test]
    fn true_for_gql_only_in_vue_script() {
        let sfc = "<template><div /></template>\n<script setup>\nimport gql from 'graphql-tag'\nconst q = gql`{ __typename }`\n</script>\n";
        assert!(source_file_has_gql_tagged_template(sfc, "views/App.vue"));
    }

    #[test]
    fn false_when_gql_only_in_vue_template_not_script() {
        let sfc = "<template>{{ `not gql` }}</template>\n<script setup>\nconst x = 1\n</script>\n";
        assert!(!source_file_has_gql_tagged_template(sfc, "views/NoGql.vue"));
    }

    #[test]
    fn false_for_different_tag() {
        let src = "const q = foo`query { x }`\n";
        assert!(!source_file_has_gql_tagged_template(src, "x.ts"));
    }

    #[test]
    fn false_without_templates() {
        assert!(!source_file_has_gql_tagged_template(
            "const x = 1\n",
            "a.js"
        ));
    }

    #[test]
    fn member_expression_tag_is_not_a_match() {
        // `obj.gql\`…\`` — MemberExpression-тег, канон (AST) не рахує таке gql-тегом.
        assert!(!source_file_has_gql_tagged_template(
            "const q = obj.gql`query { x }`\n",
            "x.ts"
        ));
    }

    // --- graphql_tooling(cwd): дзеркало tooling.test.mjs:58-98 ---

    /// «exit 0 — немає gql шаблонів у джерелах» (`:59-64`).
    #[test]
    fn no_gql_templates_yields_no_violations() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "index.js", "const x = 1\n");
        assert!(graphql_tooling(tmp.path()).unwrap().is_empty());
    }

    /// «exit 1 — gql знайдено, .graphqlrc.yml відсутній» (`:66-72`) — і
    /// `.vscode/extensions.json` теж відсутній (не створений у фікстурі),
    /// тож `checkExtensionsRecommendation` (яка виконується завжди, не лише
    /// коли `.graphqlrc.yml` відсутній) додає СВОЮ violation теж — 2 разом.
    #[test]
    fn gql_found_without_graphqlrc_yields_violations() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "api.js", "const q = gql`query { me { id } }`\n");
        let violations = graphql_tooling(tmp.path()).unwrap();
        assert_eq!(violations.len(), 2);
        assert!(violations
            .iter()
            .all(|v| v.reason == REASON && v.file.is_none()));
        assert!(violations
            .iter()
            .any(|v| v.message.contains(GRAPHQL_RC_FILENAME)));
        assert!(violations
            .iter()
            .any(|v| v.message.contains(EXTENSIONS_JSON_REL)));
    }

    /// `.graphqlrc.yml` присутній, `.vscode/extensions.json` відсутній —
    /// лише друга violation (перша гілка мовчить, `pass()`-еквівалент).
    #[test]
    fn gql_found_with_graphqlrc_but_missing_extensions_json() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "api.js", "const q = gql`query { me { id } }`\n");
        write(&tmp, GRAPHQL_RC_FILENAME, "schema: schema.graphql\n");
        let violations = graphql_tooling(tmp.path()).unwrap();
        assert_eq!(violations.len(), 1);
        assert!(violations[0].message.contains(EXTENSIONS_JSON_REL));
    }

    /// Vue-джерело з gql лише в `<script>` теж активує правило (не лише
    /// `.js`/`.ts`).
    #[test]
    fn gql_found_in_vue_script_also_triggers_rule() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "views/App.vue",
            "<template><div/></template>\n<script setup>\nconst q = gql`{ __typename }`\n</script>\n",
        );
        let violations = graphql_tooling(tmp.path()).unwrap();
        assert!(!violations.is_empty());
    }

    /// `.n-rules.json`-`ignore` виключає піддерево з обходу — той самий
    /// repo-локальний конфіг, що читає [`super::env_dns::env_dns`].
    #[test]
    fn cursor_ignore_config_excludes_subtree() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "vendor/api.js", "const q = gql`query { x }`\n");
        write(&tmp, ".n-rules.json", r#"{"rules":[],"ignore":["vendor"]}"#);
        assert!(graphql_tooling(tmp.path()).unwrap().is_empty());
    }

    /// `.d.ts`-декларації не скануються, навіть якщо містять `gql\`…\``.
    #[test]
    fn declaration_files_are_not_scanned_for_gql() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "types.d.ts", "const q = gql`query { x }`\n");
        assert!(graphql_tooling(tmp.path()).unwrap().is_empty());
    }

    /// Гейт відкритий (gql знайдено, `.graphqlrc.yml` є,
    /// `.vscode/extensions.json` існує) — доходимо до `run_conftest_batch`,
    /// але корінь пакета `@7n/rules` не резолвиться (tmp-дерево поза репо,
    /// без override) → fail-closed із підказкою, не мовчазний skip. Той
    /// самий прийом, що `k8s_hasura_configmap::open_gate_without_package_root_fails_closed`
    /// / `text_markdownlint::config_present_without_package_root_fails_closed`.
    ///
    /// Тест свідомо НЕ мутує `N_RULES_PACKAGE_ROOT` — паралельно біжать інші
    /// тести того ж процесу.
    #[test]
    fn open_extensions_gate_without_package_root_fails_closed() {
        if std::env::var("N_RULES_PACKAGE_ROOT").is_ok() {
            return; // оточення з явним override — сценарій недосяжний
        }
        let tmp = TempDir::new().unwrap();
        write(&tmp, "api.js", "const q = gql`query { me { id } }`\n");
        write(&tmp, GRAPHQL_RC_FILENAME, "schema: schema.graphql\n");
        write(&tmp, EXTENSIONS_JSON_REL, r#"{"recommendations":[]}"#);
        let err = graphql_tooling(tmp.path()).unwrap_err();
        assert!(matches!(err, RulesError::Concern(_)));
        assert!(err.to_string().contains("N_RULES_PACKAGE_ROOT"), "{err}");
    }

    /// `readFile`-помилка всередині `collect_gql_hits` (тут: кандидат без
    /// права читання, `chmod 000`) не ловиться жодним `try/catch` у каноні —
    /// летить із `lint()` як помилка.
    #[cfg(unix)]
    #[test]
    fn unreadable_candidate_fails_closed() {
        use std::os::unix::fs::PermissionsExt;

        let tmp = TempDir::new().unwrap();
        write(&tmp, "weird.ts", "const q = 1\n");
        let path = tmp.path().join("weird.ts");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o000)).unwrap();

        let result = graphql_tooling(tmp.path());

        // root (типово в контейнерних CI-раннерах) ігнорує права доступу —
        // тоді сценарій недосяжний; повертаємо права перед early-return,
        // щоб TempDir міг прибрати за собою.
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        if std::fs::read_to_string(&path).is_ok() {
            return;
        }

        let err = result.unwrap_err();
        assert!(matches!(err, RulesError::Concern(_)));
    }
}
