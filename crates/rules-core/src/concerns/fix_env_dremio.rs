//! T0-фікси `abie/env_dns` і `k8s/dremio_logging` — точкові детерміновані
//! правки для двох native-детекторів
//! ([`super::env_dns::env_dns`]/[`super::dremio_logging::dremio_logging`]).
//! Проводка в [`super::fix::NATIVE_FIXES`]/[`super::fix::run_concern_fix`] —
//! робота оркестратора, не цього модуля (задача навмисно обмежує зміни
//! одним новим файлом).
//!
//! # Спільний принцип: ре-детект з диска, а не парсинг значень із тексту
//!
//! Обидва детектори лишають `Violation.file: None` і кодують шлях файла
//! ПРЕФІКСОМ у `message` (`"{rel}: ..."`). Обидва фікси нижче дістають із
//! `message` ЛИШЕ цей `rel` (щоб знайти файл), а самі значення для
//! точкової заміни — обчислюють заново напряму з поточного вмісту файла тим самим
//! `pub fn`, що й детектор (`validate_abie_env_internal_urls` /
//! `DREMIO_ROOT_LEVEL_RE`, дзеркало `ROOT_LEVEL_RE`). Це дає дві переваги:
//! фікс лишається коректним, навіть якщо файл змінився між detect і fix
//! (без stale-diff), і дає точні byte-offset-и в АКТУАЛЬНОМУ вмісті для
//! мінімальної точкової заміни (той самий стиль, що `rewrite_hasura_endpoint`
//! у `fix.rs`) — а не сліпий пошук/заміну підрядка з чужого тексту
//! повідомлення.
//!
//! # Обидва фікси свідомо пропускають неоднозначні гілки
//!
//! Деталі — у доккоментах [`env_dns_fix`] і [`dremio_logging_fix`] окремо.
//! Спільний принцип один: якщо з поточного стану файла не можна ОДНОЗНАЧНО
//! вивести і поточне, і точне очікуване значення — violation пропускається
//! без edit-у. Це узгоджується з T0-контрактом: фікс без ревʼю моделі,
//! помилка тут дорожча за пропуск.

use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;

use crate::diagnostics::Violation;

use super::env_dns::{abie_env_name_from_basename, validate_abie_env_internal_urls};
use super::fix::{FileEdit, FixPlan, WriteFile};

// ── abie/env_dns ────────────────────────────────────────────────────────────

/// Дістає `rel`-шлях файла з тексту violation `env_dns` — усе до першого
/// `": http"` (кожен internal-URL у повідомленні детектора завжди починається
/// з `http(s)://`, `env_dns.rs:82-89`, тож цей маркер однозначно відмежовує
/// `rel` від решти тексту). Повідомлення про I/O-помилку (`"{rel}: не
/// вдалося прочитати (...)"`, `env_dns.rs:125-131`) цим маркером не
/// матчиться — таке `rel` дістати нема сенсу (нема URL, нема що фіксити
/// як текст), тож функція повертає `None`.
fn env_dns_violation_rel(message: &str) -> Option<&str> {
    let idx = message.find(": http")?;
    Some(&message[..idx])
}

/// Порт формату помилки кластерної DNS-розбіжності з
/// `validate_abie_env_internal_urls` (`env_dns.rs:82-84`, точна копія
/// `format!`-рядка) — джерело `full_url`/`found`/`expected` для точкової
/// заміни. Формат помилки namespace-розбіжності (`env_dns.rs:87-89`) навмисно
/// НЕ матчиться цим регексом — див. доккомент [`env_dns_fix`].
static ENV_DNS_CLUSTER_MISMATCH_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"^(?P<url>\S+): кластерний DNS "(?P<found>[^"]+)" не відповідає env "[^"]+" \(очікується "(?P<expected>[^"]+)"\)$"#,
    )
    .expect("valid regex")
});

/// Розбирає один рядок помилки з `validate_abie_env_internal_urls` на
/// `(full_url, found, expected)`, якщо це саме кластерна DNS-розбіжність.
/// `None` — інший формат (namespace-розбіжність чи щось нерозпізнане) —
/// виклик має пропустити такий рядок, не вгадуючи заміну.
fn parse_cluster_dns_mismatch(err: &str) -> Option<(&str, &str, &str)> {
    let caps = ENV_DNS_CLUSTER_MISMATCH_RE.captures(err)?;
    let url = caps.name("url")?.as_str();
    let found = caps.name("found")?.as_str();
    let expected = caps.name("expected")?.as_str();
    Some((url, found, expected))
}

/// Точкова заміна лише кластерного DNS-сегмента всередині `full_url`
/// (`.svc.{found}` → `.svc.{expected}`) — `service`/`namespace`/`port`
/// лишаються байтово незмінні. `None`, якщо очікуваної підпослідовності
/// немає (структура URL не та, яку сподівались побачити) — тоді нема що
/// заміняти, а не вгадувати інше місце.
fn rewrite_cluster_dns(full_url: &str, found: &str, expected: &str) -> Option<String> {
    let from = format!(".svc.{found}");
    let to = format!(".svc.{expected}");
    if !full_url.contains(&from) {
        return None;
    }
    Some(full_url.replace(&from, &to))
}

/// T0-фікс `abie/env_dns` — для кожного унікального файла зі свідомо
/// релевантних violations обчислює заново актуальні помилки з диска
/// ([`validate_abie_env_internal_urls`], та сама функція, що в детектора) і
/// точково заміняє кластерний DNS-сегмент КОЖНОГО internal-URL, для якого
/// поточне ("found") і очікуване ("expected") значення однозначно відомі
/// (обидва явно присутні в тексті помилки — `env_dns.rs:82-84`).
///
/// # Свідомо НЕ покрита гілка: namespace-префікс
///
/// `validate_abie_env_internal_urls` також емітить помилку, коли namespace
/// не починається з очікуваного префікса (`env_dns.rs:86-89`). Ця помилка
/// дає ПОТОЧНЕ значення (повний namespace, напр. `"dev-apruv"`), але
/// ОЧІКУВАНЕ — лише ВИМОГА-префікс (`"dev-"`/`"ua-"`), не конкретне повне
/// значення namespace. Підставити правильний суфікс без вгадування
/// неможливо: namespace може відображати свідомий крос-кластерний доступ —
/// саме ризик маскування реальної проблеми топології, який попередив
/// аудит. Тому такі помилки НЕ матчаться [`ENV_DNS_CLUSTER_MISMATCH_RE`] і
/// мовчки пропускаються без edit-у (див. тест
/// `env_dns_fix_skips_namespace_prefix_mismatch`).
pub fn env_dns_fix(cwd: &Path, violations: &[Violation]) -> FixPlan {
    let mut seen = std::collections::HashSet::new();
    let mut rels = Vec::new();
    for v in violations {
        if v.reason != "env_dns" {
            continue;
        }
        let Some(rel) = env_dns_violation_rel(&v.message) else {
            continue;
        };
        if seen.insert(rel.to_string()) {
            rels.push(rel.to_string());
        }
    }

    let mut edits = Vec::new();
    for rel in rels {
        let Ok(content) = std::fs::read_to_string(cwd.join(&rel)) else {
            continue; // файл відсутній/нечитабельний — пропустити
        };
        let basename = rel.rsplit('/').next().unwrap_or(rel.as_str());
        let Some(env_name) = abie_env_name_from_basename(basename) else {
            continue;
        };

        let mut next = content.clone();
        for err in validate_abie_env_internal_urls(&content, env_name) {
            let Some((full_url, found, expected)) = parse_cluster_dns_mismatch(&err) else {
                continue; // namespace-розбіжність чи нерозпізнаний формат — пропустити
            };
            if let Some(fixed_url) = rewrite_cluster_dns(full_url, found, expected) {
                next = next.replace(full_url, &fixed_url);
            }
        }
        if next != content {
            edits.push(FileEdit::Write(WriteFile {
                path: rel,
                content: next,
            }));
        }
    }
    FixPlan { edits }
}

// ── k8s/dremio_logging ──────────────────────────────────────────────────────

/// Дублікат `ROOT_LEVEL_RE` детектора (`dremio_logging.rs:23-25`, приватний
/// для того модуля) — навмисне локальне копіювання, не рефакторинг чужого
/// файла (задача обмежує зміни одним новим файлом); той самий патерн
/// локальної копії регексу, що `TOOLCHAIN_RE`/`APT_INSTALL_RE`-використання
/// в `fix.rs`.
static DREMIO_ROOT_LEVEL_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)<root\s+level\s*=\s*["']([^"']+)["']"#).expect("valid regex")
});

/// Дублікат `ALLOWED_ROOT_LEVELS` детектора (`dremio_logging.rs:32`).
const DREMIO_ALLOWED_ROOT_LEVELS: &[&str] = &["warn", "error", "off"];

/// Дублікат приватної `REASON`-константи детектора (`dremio_logging.rs:38`,
/// `"zk-logback-root-level"`) — той самий рядок, яким детектор позначає ВСІ
/// свої violations (обидві гілки: root відсутній / root має невалідний
/// рівень).
const DREMIO_REASON: &str = "zk-logback-root-level";

/// Дістає `rel`-шлях файла з тексту violation `dremio_logging` — обидва
/// формати повідомлення детектора («root відсутній цілком» і «root має
/// невалідний рівень») починаються з літерального `"zookeeper.yaml: "`
/// одразу після `rel` (`dremio_logging.rs:52,62`, обгортка `"{rel}:
/// {violation_text}"` у `dremio_logging.rs:90`), тож маркер `":
/// zookeeper.yaml: "` однозначно відмежовує `rel` незалежно від того, як
/// насправді називається файл, переданий викликачем у `files`.
fn dremio_violation_rel(message: &str) -> Option<&str> {
    let idx = message.find(": zookeeper.yaml: ")?;
    Some(&message[..idx])
}

/// T0-фікс `k8s/dremio_logging` — для кожного унікального файла зі
/// свідомо релевантних violations перечитує файл з диска і точково заміняє
/// ЛИШЕ значення атрибута `<root level="...">` на `"warn"`, коли тег
/// присутній, але його рівень не входить у `warn`/`error`/`off`
/// (case-insensitive, як у детектора). Заміна — byte-range усередині
/// самого атрибута (той самий стиль точкового `replace_range`, що
/// `rewrite_hasura_endpoint` у `fix.rs`): решта файла (Go-template-синтаксис
/// `zookeeper.yaml`, `appender-ref` тощо) лишається байтово незмінною.
///
/// # Свідомо НЕ покрита гілка: `<root>` відсутній цілком
///
/// Коли `logback.xml: |`-блок є, а тега `<root level="...">` немає взагалі,
/// детектор також емітить violation (`dremio_logging.rs:50-54`,
/// `zk_logback_root_level_violation`). Вставка тега вимагає знати
/// `appender-ref` (і взагалі безпечне місце в XML-дереві Go-template-файла)
/// — `.mdc` цього concern-а прямо попереджає: «ризиковано трансформувати
/// блайндово» (`npm/rules/k8s/dremio_logging/dremio_logging.mdc`, розділ
/// ZooKeeper). Ця гілка НЕ реалізована: [`DREMIO_ROOT_LEVEL_RE`] просто не
/// матчить такий файл, і функція мовчки переходить до наступного `rel` без
/// edit-у (тест `dremio_logging_fix_skips_missing_root_tag_branch`).
///
/// # Свідомо НЕ реалізовано: rego-гілка `<logger name="...">` з
/// фіксованого списку
///
/// `.mdc` цього concern-а документує ДРУГУ, окрему перевірку — обов'язкові
/// `<logger name="<FQCN>" level="warn"/>`-записи у ЗОВСІМ ІНШОМУ файлі
/// (`dremio_v2/config/logback.xml`,
/// `npm/rules/k8s/dremio_logging/dremio_logging.rego`). Ця частина
/// НЕ портована в native Rust (доккомент модуля `dremio_logging.rs:1-4`:
/// «рего-шлях лишається в JS/conftest, спека вимагає порт лише
/// `main.mjs`») — native-детектор
/// [`super::dremio_logging::dremio_logging`], чиї violations надходять у
/// цю функцію, структурно НЕ може породити такий violation (перевіряє лише
/// `zookeeper.yaml`/`<root level>`, інший файл і інший формат
/// повідомлення). Сам `.mdc` прямо документує для цієї rego-частини
/// «Autofix: відсутній... T0-fix, за потреби, окремою ітерацією». Парсити
/// гіпотетичний формат violation з чужого (JS/conftest) пайплайна, не
/// бачачи реального коду, який його породжує й передає сюди, — це
/// вгадування, якого задача прямо просить уникати.
pub fn dremio_logging_fix(cwd: &Path, violations: &[Violation]) -> FixPlan {
    let mut seen = std::collections::HashSet::new();
    let mut rels = Vec::new();
    for v in violations {
        if v.reason != DREMIO_REASON {
            continue;
        }
        let Some(rel) = dremio_violation_rel(&v.message) else {
            continue;
        };
        if seen.insert(rel.to_string()) {
            rels.push(rel.to_string());
        }
    }

    let mut edits = Vec::new();
    for rel in rels {
        let Ok(content) = std::fs::read_to_string(cwd.join(&rel)) else {
            continue; // файл відсутній/нечитабельний — пропустити
        };
        let Some(caps) = DREMIO_ROOT_LEVEL_RE.captures(&content) else {
            continue; // <root> відсутній цілком — свідомо не покрита гілка
        };
        // Капітальна група 1 гарантовано матчиться разом з групою 0 —
        // сама структура регексу вимагає значення атрибута в лапках.
        let Some(level) = caps.get(1) else {
            continue;
        };
        if DREMIO_ALLOWED_ROOT_LEVELS.contains(&level.as_str().to_lowercase().as_str()) {
            continue; // вже валідний рівень — ідемпотентний no-op
        }
        let mut next = content.clone();
        next.replace_range(level.start()..level.end(), "warn");
        edits.push(FileEdit::Write(WriteFile {
            path: rel,
            content: next,
        }));
    }
    FixPlan { edits }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::concerns::test_support::write;
    use crate::diagnostics::Severity;
    use tempfile::TempDir;

    fn violation(reason: &str, message: &str) -> Violation {
        Violation {
            reason: reason.to_string(),
            message: message.to_string(),
            file: None,
            severity: Severity::Error,
            data: None,
        }
    }

    // ── abie/env_dns ──

    #[test]
    fn env_dns_fix_empty_plan_without_matching_reason() {
        let tmp = TempDir::new().unwrap();
        assert!(env_dns_fix(tmp.path(), &[]).edits.is_empty());
        assert!(env_dns_fix(tmp.path(), &[violation("other", "x")])
            .edits
            .is_empty());
    }

    /// Успішний шлях: кластерна DNS-розбіжність → точкова заміна лише
    /// `.svc.<found>` → `.svc.<expected>`, решта файла байтово незмінна.
    #[test]
    fn env_dns_fix_rewrites_wrong_cluster_dns_point_in_place() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "pkg/dev.env",
            "OTHER=https://api.example.com/x\nAPI_URL=https://x-hl.dev-y.svc.abie-ua.internal:8080\n",
        );
        let violations = crate::concerns::env_dns(tmp.path());
        assert!(!violations.is_empty());

        let plan = env_dns_fix(tmp.path(), &violations);
        assert_eq!(plan.edits.len(), 1);
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("очікували write");
        };
        assert_eq!(w.path, "pkg/dev.env");
        assert!(w.content.contains("abie-dev.internal"));
        assert!(!w.content.contains("abie-ua.internal"));
        assert!(w.content.contains("OTHER=https://api.example.com/x"));
        assert!(w.content.contains("x-hl.dev-y.svc"));
    }

    /// Ідемпотентність: застосований fix прибирає всі violations, повторний
    /// прогін над уже виправленим файлом дає порожній план.
    #[test]
    fn env_dns_fix_is_idempotent() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "pkg/dev.env",
            "API_URL=https://x-hl.dev-y.svc.abie-ua.internal:8080\n",
        );
        let violations = crate::concerns::env_dns(tmp.path());
        let plan = env_dns_fix(tmp.path(), &violations);
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("очікували write");
        };
        std::fs::write(tmp.path().join("pkg/dev.env"), &w.content).unwrap();

        let violations2 = crate::concerns::env_dns(tmp.path());
        assert!(violations2.is_empty());
        assert!(env_dns_fix(tmp.path(), &violations2).edits.is_empty());
    }

    /// Пропуск неоднозначної гілки: namespace не починається з очікуваного
    /// префікса — очікуване значення НЕ конкретне (лише вимога-префікс),
    /// тож violation не породжує edit.
    #[test]
    fn env_dns_fix_skips_namespace_prefix_mismatch() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "pkg/ua.env",
            "API_URL=https://x-hl.dev-y.svc.abie-ua.internal\n",
        );
        let violations = crate::concerns::env_dns(tmp.path());
        assert!(!violations.is_empty());
        assert!(env_dns_fix(tmp.path(), &violations).edits.is_empty());
    }

    /// Відсутній файл — пропустити (навіть з коректно сформованою
    /// violation).
    #[test]
    fn env_dns_fix_skips_missing_file() {
        let tmp = TempDir::new().unwrap();
        let v = violation(
            "env_dns",
            "pkg/dev.env: https://x.dev-y.svc.abie-ua.internal: кластерний DNS \"abie-ua.internal\" не відповідає env \"dev\" (очікується \"abie-dev.internal\") (abie.mdc)",
        );
        assert!(env_dns_fix(tmp.path(), &[v]).edits.is_empty());
    }

    /// I/O-помилку детектора (`"{rel}: не вдалося прочитати (...)"`) не
    /// можна розпарсити як URL-компоненти — пропустити.
    #[test]
    fn env_dns_fix_ignores_io_error_shaped_violation() {
        let tmp = TempDir::new().unwrap();
        let v = violation(
            "env_dns",
            "pkg/dev.env: не вдалося прочитати (permission denied)",
        );
        assert!(env_dns_fix(tmp.path(), &[v]).edits.is_empty());
    }

    // ── k8s/dremio_logging ──

    #[test]
    fn dremio_logging_fix_empty_plan_without_matching_reason() {
        let tmp = TempDir::new().unwrap();
        assert!(dremio_logging_fix(tmp.path(), &[]).edits.is_empty());
        assert!(dremio_logging_fix(tmp.path(), &[violation("other", "x")])
            .edits
            .is_empty());
    }

    /// Успішний шлях: `<root level="info">` → `<root level="warn">`,
    /// решта файла (включно з `<appender-ref>`) байтово незмінна.
    #[test]
    fn dremio_logging_fix_replaces_invalid_root_level_with_warn() {
        let tmp = TempDir::new().unwrap();
        let rel = "dremio_v2/templates/zookeeper.yaml";
        write(
            &tmp,
            rel,
            "data:\n  logback.xml: |\n    <configuration>\n      <root level=\"info\">\n        <appender-ref ref=\"CONSOLE\" />\n      </root>\n    </configuration>\n",
        );
        let violations = crate::concerns::dremio_logging(tmp.path(), Some(&[rel.to_string()]));
        assert_eq!(violations.len(), 1);

        let plan = dremio_logging_fix(tmp.path(), &violations);
        assert_eq!(plan.edits.len(), 1);
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("очікували write");
        };
        assert_eq!(w.path, rel);
        assert!(w.content.contains("<root level=\"warn\">"));
        assert!(w.content.contains("<appender-ref ref=\"CONSOLE\" />"));
    }

    /// Ідемпотентність: застосований fix прибирає violation, повторний
    /// прогін над уже виправленим файлом дає порожній план.
    #[test]
    fn dremio_logging_fix_is_idempotent() {
        let tmp = TempDir::new().unwrap();
        let rel = "dremio_v2/templates/zookeeper.yaml";
        write(
            &tmp,
            rel,
            "data:\n  logback.xml: |\n    <root level=\"info\">\n",
        );
        let violations = crate::concerns::dremio_logging(tmp.path(), Some(&[rel.to_string()]));
        let plan = dremio_logging_fix(tmp.path(), &violations);
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("очікували write");
        };
        std::fs::write(tmp.path().join(rel), &w.content).unwrap();

        let violations2 = crate::concerns::dremio_logging(tmp.path(), Some(&[rel.to_string()]));
        assert!(violations2.is_empty());
        assert!(dremio_logging_fix(tmp.path(), &violations2)
            .edits
            .is_empty());
    }

    /// Пропуск неоднозначної/ризикованої гілки: `<root>` відсутній цілком —
    /// вставка вимагає знати `appender-ref`, `.mdc` попереджає: трансформувати
    /// блайндово ризиковано, тож violation не породжує edit.
    #[test]
    fn dremio_logging_fix_skips_missing_root_tag_branch() {
        let tmp = TempDir::new().unwrap();
        let rel = "dremio_v2/templates/zookeeper.yaml";
        write(
            &tmp,
            rel,
            "data:\n  logback.xml: |\n    <configuration>\n      <appender name=\"CONSOLE\" />\n    </configuration>\n",
        );
        let violations = crate::concerns::dremio_logging(tmp.path(), Some(&[rel.to_string()]));
        assert_eq!(violations.len(), 1);
        assert!(violations[0].message.contains("без <root level"));
        assert!(dremio_logging_fix(tmp.path(), &violations).edits.is_empty());
    }

    /// Відсутній файл — пропустити (навіть з коректно сформованою
    /// violation).
    #[test]
    fn dremio_logging_fix_skips_missing_file() {
        let tmp = TempDir::new().unwrap();
        let v = violation(
            "zk-logback-root-level",
            "dremio_v2/templates/zookeeper.yaml: zookeeper.yaml: вбудований logback.xml має <root level=\"info\"> — постав \"warn\" або строгіше (error/off), бо ruok-проби кожні ~10s заливають Cloud Logging на INFO (k8s.mdc)",
        );
        assert!(dremio_logging_fix(tmp.path(), &[v]).edits.is_empty());
    }
}
