//! Спільний шар відкриття файлів k8s-кластера — native-порт хелперів
//! `npm/rules/k8s/manifests/main.mjs`, на які спирається кожен концерн
//! кластера.
//!
//! Обсяг навмисно рівно той, що потрібен уже портованим концернам кластера:
//! решта хелперів (`isForbiddenK8sDevPath`, `isK8sYamlUnderBaseDirectory`)
//! приїде разом із концерном, який їх реально викликає (`k8s/manifests`), а не
//! наперед — інакше це поверхня без споживача.
//!
//! Портовані функції (з посиланням на рядки JS-канону):
//!
//! | Rust | JS |
//! |---|---|
//! | [`path_has_k8s_segment`] | `pathHasK8sSegment` (`main.mjs:229-235`) |
//! | [`k8s_root_from_file`] | `k8sRootFromFile` (`main.mjs:6766-6775`) |
//! | [`find_k8s_roots`] | `findK8sRoots` (`main.mjs:6786-6801`) |
//! | [`find_k8s_yaml_files`] | `findK8sYamlFiles` (`main.mjs:1592-1612`) |
//!
//! # Обхід дерева
//!
//! JS-версії ходять через `walkDir` (`npm/scripts/utils/walkDir.mjs`), який
//! сам уже делегує в native [`crate::scan::walk_dir_raw`] — тобто набір
//! кандидатів той самий, різниця лише в тому, що JS отримує абсолютні
//! шляхи, а [`crate::scan::walk_dir_raw`] — posix-relative. Тут кандидати
//! фільтруються в relative-формі, а назовні (у спавн зовнішніх тулів)
//! віддаються абсолютні — як у JS.
//!
//! # Сортування
//!
//! JS сортує результат через `localeCompare` (ICU-порядок), а не байтово,
//! тож порт використовує [`crate::locale::locale_compare`] — той самий
//! мотив, що в [`crate::lint_render`].
//!
//! # Де паритет свідомо не побайтовий: два додаткових фільтри (реєстр §2.34)
//!
//! Обидва — власний фікс `k8s_common`, не порт JS-канону; кожен закриває
//! СВІЙ клас хибних спрацювань, і жоден не підмінює інший (перевірено дією:
//! спроба закрити обидва класи одним «немає ні `apiVersion`, ні `kind`» —
//! ширшим фільтром на рівні [`find_k8s_yaml_files`] — ламала заморожену
//! parity-фікстуру `no-kind.yaml`, `k8s_manifests_slice2_parity.rs`: файл із
//! modeline `$schema=` але без `apiVersion`/`kind` — це СПРАВЖНЄ порушення
//! («не знайдено apiVersion/kind у першому документі»), яке канон навмисно
//! репортить, а не мовчки пропускає. Звідси два вузькі, незалежні критерії
//! замість одного широкого):
//!
//! - [`find_k8s_roots`] фільтрує через [`file_looks_like_k8s_resource`]
//!   (клас 1 — голі `spec:`-фрагменти без `apiVersion`/`kind` в жодному
//!   документі, напр. `network_policy/template/*.snippet.yaml`): без
//!   фільтра каталог із самими такими фрагментами ставав kubescape-
//!   таргетом (raw dir scan), а `kubescape scan` на ньому падає з «no
//!   scannable resources» — generic-гілка `kubescape_violations` мапить
//!   БУДЬ-ЯКИЙ ненульовий код на «kubescape знайшов ризики», хоча це вхідна
//!   помилка тула, не вердикт. [`find_k8s_yaml_files`] цей фільтр НЕ
//!   успадковує — жоден інший крок `k8s/manifests` (per-file цикл,
//!   cross-file, rego) на цьому класі файлів не спрацьовує: без
//!   modeline `check_k8s_yaml_file` (`k8s_manifests_per_file.rs`) на них
//!   уже мовчить, а щойно фільтр торкнувся б цієї функції — заморожена
//!   `no-kind.yaml`-фікстура вище показала б, чому це небезпечно.
//! - [`walk_k8s_candidates`] (спільний для обох функцій) фільтрує через
//!   [`looks_like_gha_workflow`] (клас 2 — GitHub Actions workflow під
//!   шляхом із сегментом `k8s`, напр.
//!   `plugins/ci-github/rules/*/template/*.yml.snippet.yml`): без нього
//!   такий файл потрапляв у [`find_k8s_yaml_files`] лише за збігом шляху й
//!   розширення, а перше ж, що перевіряє `checkK8sYamlFile`
//!   (`k8s_manifests_per_file.rs`), — розширення `.yml` → хибне
//!   «перейменуй на .yaml», хоча `.yml` тут канонічне розширення GHA.
//!   Критерій — надійна структурна ознака workflow (`on:`+`jobs:` на
//!   верхньому рівні), а не «немає k8s-полів»: для [`find_k8s_roots`] цей
//!   фільтр — no-op (`.yml` там і так не проходить строге розширення
//!   `.yaml`).

use std::path::{Path, PathBuf};

use crate::concerns::cursor_ignore::walk_with_ignore_paths;
use crate::locale::locale_compare;

/// Максимальна глибина підйому до `k8s`-предка — той самий бюджет ітерацій
/// (`for (let i = 0; i < 64; i++)`), що в `k8sRootFromFile` (`main.mjs:6768`).
const K8S_ROOT_LOOKUP_MAX_DEPTH: usize = 64;

/// Чи має шлях компонент-каталог рівно з іменем `k8s` — порт
/// `pathHasK8sSegment` (`main.mjs:229-235`) для **уже relative** шляху.
///
/// JS-версія приймає `root` і сама relativize-ує: без цього випадав
/// false-positive, коли корінь репо сам містить компонент `k8s`
/// (`/Users/…/abie/k8s/`). Тут вхід — результат [`crate::scan::walk_dir_raw`],
/// тобто вже posix-relative від кореня, тож relativize зайвий; порожній шлях
/// (сам корінь) — `false`, як і в JS.
fn path_has_k8s_segment(rel_posix: &str) -> bool {
    if rel_posix.is_empty() {
        return false;
    }
    rel_posix
        .split(['/', '\\'])
        .any(|component| component == "k8s")
}

/// Чи є шлях YAML-файлом саме з розширенням `.yaml` — порт
/// `FIND_K8S_ROOTS_YAML_EXT_RE` (`main.mjs:6778`). `.yml` тут НЕ підходить
/// (для нього в `k8s/manifests` окремий fail «перейменуй на .yaml»).
fn has_strict_yaml_extension(rel_posix: &str) -> bool {
    rel_posix.to_ascii_lowercase().ends_with(".yaml")
}

/// Роздільник YAML-документів — рядок `---`, можливо з хвостовими
/// пробілами, сам по собі. Той самий критерій, що JS
/// `YAML_DOC_SEPARATOR_LINE_RE`, застосований [`crate::concerns::
/// k8s_manifests_per_file::first_yaml_document`] до **першого** документа —
/// тут потрібні всі документи файла, а не лише перший.
fn is_yaml_doc_separator(line: &str) -> bool {
    line.strip_prefix("---")
        .is_some_and(|rest| rest.chars().all(char::is_whitespace))
}

/// Чи рядок — скалярне поле `key_with_colon` (будь-який відступ, як
/// `API_VERSION_FIELD_RE`/`KIND_FIELD_RE`, `main.mjs:189-190`) із непорожнім
/// значенням. Значення тут не звіряється на «один токен» (на відміну від
/// `scalar_field` у `k8s_manifests_per_file` — там воно йде далі в
/// порівняння), бо тут лише сам факт присутності поля має значення.
fn line_has_scalar_field(line: &str, key_with_colon: &str) -> bool {
    let rest = line.trim_start_matches(char::is_whitespace);
    let Some(rest) = rest.strip_prefix(key_with_colon) else {
        return false;
    };
    !rest.trim_matches(char::is_whitespace).is_empty()
}

/// Чи файл містить хоча б один документ (розділений `---`), що має
/// `apiVersion` **або** `kind` — мінімальний, максимально лояльний критерій
/// «це схоже на k8s-ресурс, і його варто вважати kubescape-таргетом».
///
/// **Навіщо і чому саме тут (клас 1, реєстр §2.34).** Не порт JS-канону —
/// власний фікс `k8s/manifests`: голі YAML-фрагменти без `apiVersion`/`kind`
/// (наприклад, `spec:`-сніпети для fix-шаблонування,
/// `network_policy/template/*.snippet.yaml`) раніше давали
/// [`find_k8s_roots`] корінь лише за збігом шляху й розширення — і каталог
/// із самих таких фрагментів ставав kubescape-таргетом, а `kubescape scan`
/// падав з «no scannable resources» (generic-гілка `kubescape_violations`
/// мапить БУДЬ-ЯКИЙ ненульовий код на «kubescape знайшов ризики»). Критерій
/// навмисно **лояльний** (досить ОДНОГО з двох полів, у БУДЬ-ЯКОМУ
/// документі): суворіший критерій «обидва поля в кожному документі» зняв би
/// зі скану й легітимні `kustomization.yaml`/патчі, які в реальних репо
/// часто мають лише `kind:` (a то й жодного) — це вже послаблення справжньої
/// перевірки, а не фікс хибного спрацювання. Свідомо НЕ використовується в
/// [`find_k8s_yaml_files`] — доккомент модуля вище пояснює, чому.
///
/// Без повного YAML-парсера — той самий мотив, що в `checkK8sYamlFile`
/// (`k8s_manifests_per_file.rs`): напівзламаний файл не повинен через
/// помилку парсингу випадати зі скану (`serde_yaml` впав би саме там, де
/// правило й мало спрацювати).
fn file_looks_like_k8s_resource(abs: &Path) -> bool {
    let Ok(raw) = std::fs::read_to_string(abs) else {
        return false;
    };
    let body = raw.strip_prefix('\u{feff}').unwrap_or(&raw);
    let mut has_api_version = false;
    let mut has_kind = false;
    for line in body.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if is_yaml_doc_separator(line) {
            // Новий документ — лічильники по полях старого не переносяться:
            // критерій per-document (реєстр §2.34), не per-file.
            has_api_version = false;
            has_kind = false;
            continue;
        }
        has_api_version = has_api_version || line_has_scalar_field(line, "apiVersion:");
        has_kind = has_kind || line_has_scalar_field(line, "kind:");
        if has_api_version || has_kind {
            return true;
        }
    }
    false
}

/// Чи рядок — ключ ВЕРХНЬОГО рівня `key_with_colon` (без жодного відступу;
/// значення може бути як в одному рядку, так і блоковим на наступних —
/// GHA `on:`/`jobs:` майже завжди блокові). На відміну від
/// [`line_has_scalar_field`] тут відступ має значення (структурний ключ
/// workflow-у, не довільне поле деінде в дереві) і непорожнє інлайн-значення
/// не потрібне.
fn line_is_top_level_key(line: &str, key_with_colon: &str) -> bool {
    line.strip_prefix(key_with_colon)
        .is_some_and(|rest| rest.is_empty() || rest.starts_with(char::is_whitespace))
}

/// Чи файл виглядає як GitHub Actions workflow — надійна структурна ознака
/// `on:` разом із `jobs:` на верхньому рівні (та сама ознака, що пропонує
/// реєстр §2.34; `.github/workflows/` тут зайвий — `walk_k8s_candidates`
/// вже виключає весь `.github/` окремим рядком нижче).
///
/// **Навіщо і чому саме тут (клас 2, реєстр §2.34).** Не порт JS-канону —
/// власний фікс `k8s/manifests`: GHA workflow під шляхом із сегментом `k8s`
/// (групування за консюмер-фічею, напр.
/// `plugins/ci-github/rules/k8s/lint_k8s_yml/template/lint-k8s.yml.snippet.yml`)
/// формально збігається з `pathHasK8sSegment`, і без цього фільтра
/// потрапляв у [`find_k8s_yaml_files`] → `checkK8sYamlFile`
/// (`k8s_manifests_per_file.rs`), де ПЕРШЕ, що перевіряється, — розширення
/// `.yml` → хибне «перейменуй на .yaml», хоча `.yml` тут канонічне
/// розширення GHA-workflow-у, не помилка.
fn looks_like_gha_workflow(abs: &Path) -> bool {
    let Ok(raw) = std::fs::read_to_string(abs) else {
        return false;
    };
    let body = raw.strip_prefix('\u{feff}').unwrap_or(&raw);
    let mut has_on = false;
    let mut has_jobs = false;
    for line in body.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        has_on = has_on || line_is_top_level_key(line, "on:");
        has_jobs = has_jobs || line_is_top_level_key(line, "jobs:");
        if has_on && has_jobs {
            return true;
        }
    }
    false
}

/// Найближчий предок-каталог з іменем `k8s` — порт `k8sRootFromFile`
/// (`main.mjs:6766-6775`). `None`, якщо такого предка немає.
fn k8s_root_from_file(abs_file: &Path) -> Option<PathBuf> {
    let mut dir = abs_file.parent()?.to_path_buf();
    for _ in 0..K8S_ROOT_LOOKUP_MAX_DEPTH {
        if dir.file_name().is_some_and(|name| name == "k8s") {
            return Some(dir);
        }
        let parent = dir.parent()?.to_path_buf();
        if parent == dir {
            break;
        }
        dir = parent;
    }
    None
}

/// Спільний прохід дерева: relative-кандидати під `k8s`, окрім `.github/` і
/// GHA workflow-подібних файлів.
///
/// `.github/` виключається явно (JS-версії роблять це першим рядком
/// колбека) — там канон `.yml` і належить він правилу `ga.mdc`. Фільтр
/// [`looks_like_gha_workflow`] — клас 2 реєстру §2.34 (доккомент модуля),
/// власний, не з JS-канону.
fn walk_k8s_candidates(root: &Path, ignore_paths: &[String]) -> Vec<String> {
    walk_with_ignore_paths(root, ignore_paths)
        .into_iter()
        .filter(|rel| !rel.starts_with(".github/"))
        .filter(|rel| path_has_k8s_segment(rel))
        .filter(|rel| !looks_like_gha_workflow(&root.join(rel)))
        .collect()
}

/// Унікальні `k8s`-корені з-під валідних `*.yaml` — порт `findK8sRoots`
/// (`main.mjs:6786-6801`). Повертає **абсолютні** шляхи, відсортовані
/// `localeCompare`.
///
/// Кандидат на корінь мусить ще й [`file_looks_like_k8s_resource`] — інакше
/// каталог, де всі `*.yaml` виявляються не-ресурсами (реєстр §2.34), стає
/// kubescape-таргетом, а `kubescape scan` на ньому падає з «no scannable
/// resources» — генерична гілка `kubescape_violations` мапить це на
/// «kubescape знайшов ризики», хоча це вхідна помилка, не вердикт.
pub fn find_k8s_roots(root: &Path, ignore_paths: &[String]) -> Vec<PathBuf> {
    let mut roots: Vec<String> = Vec::new();
    for rel in walk_k8s_candidates(root, ignore_paths) {
        if !has_strict_yaml_extension(&rel) {
            continue;
        }
        let abs = root.join(&rel);
        if !file_looks_like_k8s_resource(&abs) {
            continue;
        }
        let Some(k8s_root) = k8s_root_from_file(&abs) else {
            continue;
        };
        let as_string = k8s_root.to_string_lossy().into_owned();
        // `Set` у JS — дедуп зі збереженням першої появи; тут порядок і так
        // перезаписується сортуванням нижче, тож достатньо лінійної перевірки
        // (кількість k8s-коренів у репо — одиниці).
        if !roots.contains(&as_string) {
            roots.push(as_string);
        }
    }
    roots.sort_by(|a, b| locale_compare(a, b));
    roots.into_iter().map(PathBuf::from).collect()
}

/// Чи є шлях YAML-файлом за `YAML_EXTENSION_RE` (`main.mjs:187`,
/// `/\.ya?ml$/iu`). На відміну від [`has_strict_yaml_extension`] тут `.yml`
/// теж проходить: `k8s/manifests` сам репортує «перейменуй на .yaml», тож
/// файл спершу треба знайти.
fn has_yaml_extension(rel_posix: &str) -> bool {
    let lower = rel_posix.to_ascii_lowercase();
    lower.ends_with(".yaml") || lower.ends_with(".yml")
}

/// Усі `*.yaml`/`*.yml` під каталогами `k8s` — порт `findK8sYamlFiles`
/// (`main.mjs:1592-1612`). Повертає **абсолютні** шляхи, відсортовані
/// `localeCompare` (як і `findK8sRoots`).
///
/// На відміну від [`find_k8s_roots`] тут НЕМАЄ фільтра
/// [`file_looks_like_k8s_resource`] — доккомент модуля вище пояснює, чому
/// (заморожена parity-фікстура `no-kind.yaml`). GHA-фільтр
/// ([`looks_like_gha_workflow`]) успадковується через [`walk_k8s_candidates`]
/// — саме він і закриває клас 2.
pub fn find_k8s_yaml_files(root: &Path, ignore_paths: &[String]) -> Vec<PathBuf> {
    let mut files: Vec<String> = walk_k8s_candidates(root, ignore_paths)
        .into_iter()
        .filter(|rel| has_yaml_extension(rel))
        .map(|rel| root.join(rel).to_string_lossy().into_owned())
        .collect();
    files.sort_by(|a, b| locale_compare(a, b));
    files.into_iter().map(PathBuf::from).collect()
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;
    use crate::concerns::test_support::write;

    #[test]
    fn path_has_k8s_segment_matches_only_exact_component() {
        assert!(path_has_k8s_segment("svc/k8s/base/deploy.yaml"));
        assert!(path_has_k8s_segment("k8s/base/deploy.yaml"));
        assert!(!path_has_k8s_segment("svc/k8s-extra/base/deploy.yaml"));
        assert!(!path_has_k8s_segment("svc/myk8s/deploy.yaml"));
        assert!(!path_has_k8s_segment(""));
    }

    #[test]
    fn k8s_root_from_file_returns_nearest_k8s_ancestor() {
        let abs = PathBuf::from("/repo/svc/k8s/overlays/prod/deploy.yaml");
        assert_eq!(
            k8s_root_from_file(&abs),
            Some(PathBuf::from("/repo/svc/k8s"))
        );
        assert_eq!(
            k8s_root_from_file(&PathBuf::from("/repo/svc/deploy.yaml")),
            None
        );
    }

    /// Найближчий (не найдальший) предок — при вкладених `k8s` береться той,
    /// що ближче до файла.
    #[test]
    fn k8s_root_from_file_prefers_nearest_ancestor() {
        let abs = PathBuf::from("/repo/k8s/apps/k8s/base/deploy.yaml");
        assert_eq!(
            k8s_root_from_file(&abs),
            Some(PathBuf::from("/repo/k8s/apps/k8s"))
        );
    }

    #[test]
    fn find_k8s_roots_dedupes_and_ignores_yml() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(&tmp, "a/k8s/base/deploy.yaml", "kind: Deployment\n");
        write(
            &tmp,
            "a/k8s/overlays/prod/kustomization.yaml",
            "bases: []\n",
        );
        write(&tmp, "b/k8s/base/svc.yml", "kind: Service\n");
        write(&tmp, "c/plain/config.yaml", "a: 1\n");

        // `b` містить лише `.yml` → не дає кореня (strict `.yaml` фільтр).
        assert_eq!(find_k8s_roots(root, &[]), vec![root.join("a/k8s")]);
    }

    /// `.github/` не дає кореня навіть із сегментом `k8s` у шляху — там
    /// канон `.yml` і власне правило `ga`.
    #[test]
    fn find_k8s_roots_skips_github_dir() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, ".github/k8s/workflow.yaml", "on: push\n");
        assert!(find_k8s_roots(tmp.path(), &[]).is_empty());
    }

    /// Порожнє дерево / неіснуючий корінь — порожній результат, без паніки
    /// (той самий fail-safe, що `walkDir` у JS).
    #[test]
    fn find_k8s_roots_on_missing_root_is_empty() {
        let tmp = TempDir::new().unwrap();
        assert!(find_k8s_roots(&tmp.path().join("nope"), &[]).is_empty());
    }

    /// `findK8sYamlFiles` бере і `.yaml`, і `.yml` (на відміну від
    /// `findK8sRoots`), лише під `k8s`, і сортує результат.
    #[test]
    fn find_k8s_yaml_files_takes_yaml_and_yml_under_k8s() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(&tmp, "svc/k8s/base/deploy.yaml", "kind: Deployment\n");
        write(&tmp, "svc/k8s/base/svc.yml", "kind: Service\n");
        write(&tmp, "svc/k8s/base/readme.md", "# no\n");
        write(&tmp, "svc/other/config.yaml", "a: 1\n");

        assert_eq!(
            find_k8s_yaml_files(root, &[]),
            vec![
                root.join("svc/k8s/base/deploy.yaml"),
                root.join("svc/k8s/base/svc.yml"),
            ]
        );
    }

    /// `.github/` не потрапляє у вибірку навіть із сегментом `k8s` — та сама
    /// гілка, що й у `findK8sRoots`, і `ignorePaths` так само діють.
    #[test]
    fn find_k8s_yaml_files_skips_github_and_ignored() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(&tmp, ".github/k8s/deploy.yaml", "kind: Deployment\n");
        write(&tmp, "vendor/k8s/base/deploy.yaml", "kind: Deployment\n");
        write(&tmp, "svc/k8s/base/deploy.yaml", "kind: Deployment\n");

        let ignored = vec![root.join("vendor").to_string_lossy().into_owned()];
        assert_eq!(
            find_k8s_yaml_files(root, &ignored),
            vec![root.join("svc/k8s/base/deploy.yaml")]
        );
    }

    /// `ignorePaths` (з `.cursorignore`) виключають піддерево цілком.
    #[test]
    fn find_k8s_roots_honours_ignore_paths() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(&tmp, "svc/k8s/base/deploy.yaml", "kind: Deployment\n");
        write(&tmp, "vendor/k8s/base/deploy.yaml", "kind: Deployment\n");

        let ignored = vec![root.join("vendor").to_string_lossy().into_owned()];
        assert_eq!(find_k8s_roots(root, &ignored), vec![root.join("svc/k8s")]);
    }

    // ─── Реєстр §2.34: два класи хибних спрацювань ─────────────────────────

    /// Клас 1 (реєстр §2.34): `spec:`-фрагмент без `apiVersion`/`kind` — той
    /// самий вміст, що реальний
    /// `npm/rules/k8s/network_policy/template/deployment.snippet.yaml` —
    /// **не** дає кореня. До фіксу такий каталог ставав kubescape-таргетом
    /// (raw dir scan), а `kubescape scan` на ньому падав з «no scannable
    /// resources», що generic-гілка `kubescape_violations` мапить на
    /// «kubescape знайшов ризики» — хибне спрацювання, перевірене дією
    /// (§2.32 register).
    #[test]
    fn network_policy_snippet_fragment_does_not_establish_a_root() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(
            &tmp,
            "npm/rules/k8s/network_policy/template/deployment.snippet.yaml",
            "spec:\n  podSelector:\n    matchLabels: {}\n  policyTypes:\n    - Ingress\n",
        );
        assert!(find_k8s_roots(root, &[]).is_empty());
    }

    /// Той самий фрагмент лишається у `find_k8s_yaml_files` (на відміну від
    /// `find_k8s_roots` — фільтр `file_looks_like_k8s_resource` навмисно НЕ
    /// успадкований, доккомент модуля пояснює чому), і це БЕЗПЕЧНО: без
    /// modeline `checkK8sYamlFile` (`k8s_manifests_per_file.rs`) на файлах
    /// без `# yaml-language-server: $schema=` мовчить незалежно від
    /// `apiVersion`/`kind` — саме тому клас 1 повністю закривається на рівні
    /// `find_k8s_roots` (kubescape), без додаткового фільтра тут.
    #[test]
    fn network_policy_snippet_fragment_stays_in_yaml_files_but_is_harmless() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(
            &tmp,
            "npm/rules/k8s/network_policy/template/deployment.snippet.yaml",
            "spec:\n  podSelector:\n    matchLabels: {}\n",
        );
        assert_eq!(
            find_k8s_yaml_files(root, &[]),
            vec![root.join("npm/rules/k8s/network_policy/template/deployment.snippet.yaml")]
        );
    }

    /// Клас 2 (реєстр §2.34): канон GitHub Actions workflow (`name:`+`on:`+
    /// `jobs:`, той самий каркас, що реальний
    /// `plugins/ci-github/rules/k8s/lint_k8s_yml/template/lint-k8s.yml.snippet.yml`)
    /// під шляхом із сегментом `k8s` — `.yml` тут коректне розширення GHA,
    /// але без `looks_like_gha_workflow`-фільтра файл потрапляв у
    /// `find_k8s_yaml_files` (сегмент шляху збігається) і далі в
    /// `checkK8sYamlFile`, де перше ж, що перевіряється, — розширення `.yml`
    /// → хибне «перейменуй на .yaml», перевірене дією (§2.32 register). Це
    /// ОКРЕМА евристика від класу 1 (структурна ознака `on:`+`jobs:`, а не
    /// відсутність `apiVersion`/`kind`) — доккомент модуля пояснює, чому
    /// одним фільтром на рівні `find_k8s_yaml_files` не обійшлось
    /// (заморожена parity-фікстура `no-kind.yaml`).
    #[test]
    fn gha_workflow_yml_under_k8s_path_segment_is_excluded_from_yaml_files() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(
            &tmp,
            "plugins/ci-github/rules/k8s/lint_k8s_yml/template/lint-k8s.yml.snippet.yml",
            "name: Lint K8s\n\non:\n  push:\n    branches:\n      - main\n\njobs:\n  lint-k8s:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo x\n",
        );
        assert!(find_k8s_yaml_files(root, &[]).is_empty());
    }

    /// Позитивний контроль: справжній маніфест (`apiVersion`+`kind`) із
    /// реальною проблемою (розширення `.yml`) лишається у вибірці — фільтр
    /// не ховає файли, які варто перевіряти, лише ті, що не є ресурсом.
    #[test]
    fn real_manifest_with_yml_extension_still_enters_yaml_files() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(
            &tmp,
            "svc/k8s/base/deploy.yml",
            "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: api\n",
        );
        assert_eq!(
            find_k8s_yaml_files(root, &[]),
            vec![root.join("svc/k8s/base/deploy.yml")]
        );
    }

    /// Той самий контроль для `find_k8s_roots`: справжній `.yaml`-маніфест
    /// із `apiVersion`+`kind` встановлює корінь так само, як і до фіксу.
    #[test]
    fn real_manifest_still_establishes_a_root() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(
            &tmp,
            "svc/k8s/base/deploy.yaml",
            "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: api\n",
        );
        assert_eq!(find_k8s_roots(root, &[]), vec![root.join("svc/k8s")]);
    }

    /// Багатодокументний YAML (клас 1, `find_k8s_roots`) — критерій
    /// per-document: перший документ є фрагментом без `apiVersion`/`kind`,
    /// другий — справжній Deployment. Корінь встановлюється, бо хоч ОДИН
    /// документ валідний («якщо хоч один документ — файл сканується»).
    #[test]
    fn multi_document_file_establishes_a_root_when_any_document_is_a_resource() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(
            &tmp,
            "svc/k8s/base/mixed.yaml",
            "spec:\n  podSelector: {}\n---\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: api\n",
        );
        assert_eq!(find_k8s_roots(root, &[]), vec![root.join("svc/k8s")]);
    }

    /// Той самий багатодокументний файл, але ОБИДВА документи — фрагменти
    /// без `apiVersion`/`kind`: критерій застосовується per-document, а не
    /// «бодай десь у файлі», тож корінь не встановлюється.
    #[test]
    fn multi_document_file_does_not_establish_a_root_when_no_document_is_a_resource() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(
            &tmp,
            "svc/k8s/base/mixed.yaml",
            "spec:\n  podSelector: {}\n---\nmetadata:\n  name: x\n",
        );
        assert!(find_k8s_roots(root, &[]).is_empty());
    }
}
