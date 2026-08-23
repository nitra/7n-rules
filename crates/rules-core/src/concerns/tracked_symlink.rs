//! Detector `security/tracked_symlink` — Rust-порт `main.mjs` того ж
//! концерну.
//!
//! Predmet: symlink, який git ВІДСТЕЖУЄ і який указує за межі репозиторію —
//! абсолютним шляхом (`/private/tmp/…`, `C:\…`) або відносним, що виходить
//! вгору за корінь. Такий symlink несе шлях, специфічний для машини автора,
//! у всі клони: у чужому checkout-і збірка пише артефакти кудись у чужу
//! теку, а тести, що шукають їх за `<repo>/<path>/…`, стають
//! недетермінованими. `.gitignore` не рятує — ignore не покриває вже
//! відстежені шляхи.
//!
//! Фіксу немає свідомо: авто-правка symlink-а була б здогадкою про намір
//! автора. Детектор лише сигналить і друкує готову команду прибирання.
//!
//! Ноти про пропуск (`git` поза PATH, каталог не є робочим деревом) ідуть
//! тим самим каналом, що й у JS — [`ConcernReport::diagnostics`]. Мовчазний
//! пропуск робив би невидимою НЕвиконану перевірку безпеки.

use std::path::Path;
use std::process::Command;

use crate::diagnostics::{ConcernDiagnostic, ConcernReport, Severity, Violation};
use crate::tool_resolve::resolve_cmd;

/// Режим symlink-запису в git-індексі (`git ls-files -s`).
const SYMLINK_MODE: &str = "120000";

/// Чи є ціль абсолютною в будь-якій із двох конвенцій.
///
/// Перевірка суто текстова, без доступу до ФС: вердикт не має залежати від
/// машини, на якій виконується lint. Windows-шлях із літерою диска
/// (`C:\…`, `C:/…`) — теж абсолютний, хоч POSIX так не вважає.
fn is_absolute_target(target: &str) -> bool {
    if target.starts_with('/') {
        return true;
    }
    let mut chars = target.chars();
    let (Some(letter), Some(colon), Some(separator)) = (chars.next(), chars.next(), chars.next())
    else {
        return false;
    };
    letter.is_ascii_alphabetic() && colon == ':' && (separator == '/' || separator == '\\')
}

/// Нормалізує posix-шлях (`.`/`..`) БЕЗ доступу до ФС.
///
/// Провідний `..` зберігається — саме він і означає вихід за корінь.
fn normalize(path: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                if out.last().is_some_and(|last| last != "..") {
                    out.pop();
                } else {
                    out.push("..".to_string());
                }
            }
            part => out.push(part.to_string()),
        }
    }
    out
}

/// Чи виходить відносна ціль за корінь репозиторію.
///
/// Рахується арифметикою шляхів від теки самого symlink-а — без `realpath`,
/// тож той самий symlink дає той самий вердикт у будь-якому checkout-і.
fn escapes_repo_root(link_path: &str, target: &str) -> bool {
    let mut base = normalize(link_path);
    base.pop(); // тека symlink-а
    let combined = format!("{}/{target}", base.join("/"));
    normalize(&combined)
        .first()
        .is_some_and(|part| part == "..")
}

/// Один symlink-запис індексу.
struct Entry {
    sha: String,
    path: String,
}

/// Розбирає `\0`-розділений вивід `git ls-files -s -z`, лишаючи symlink-и.
///
/// Формат запису — `<mode> <sha> <stage>\t<path>`.
fn parse_symlink_entries(stdout: &str) -> Vec<Entry> {
    let mut entries = Vec::new();
    for record in stdout.split('\0') {
        if record.is_empty() {
            continue;
        }
        let Some((meta, path)) = record.split_once('\t') else {
            continue;
        };
        let mut fields = meta.split(' ');
        let (Some(mode), Some(sha), Some(_stage), None) =
            (fields.next(), fields.next(), fields.next(), fields.next())
        else {
            continue;
        };
        if mode != SYMLINK_MODE || path.is_empty() {
            continue;
        }
        entries.push(Entry {
            sha: sha.to_string(),
            path: normalize(path).join("/"),
        });
    }
    entries
}

/// Запускає `git` у `cwd` і повертає stdout при нульовому коді.
fn git_stdout(git: &Path, cwd: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new(git)
        .args(args)
        .current_dir(cwd)
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Detector `security/tracked_symlink`.
///
/// Поза git-робочим деревом перевірка пропускається: її предмет — індекс
/// git — там просто відсутній.
#[must_use]
pub fn tracked_symlink(cwd: &Path) -> ConcernReport {
    let skipped = |message: &str| ConcernReport {
        violations: Vec::new(),
        diagnostics: vec![ConcernDiagnostic::info(message)],
    };
    let Some(git) = resolve_cmd("git") else {
        return skipped("security/tracked_symlink: `git` не знайдено в PATH — перевірку пропущено");
    };
    let Some(listed) = git_stdout(&git, cwd, &["ls-files", "-s", "-z"]) else {
        return skipped("security/tracked_symlink: не git-робоче дерево — перевірку пропущено");
    };

    let mut out = Vec::new();
    for entry in parse_symlink_entries(&listed) {
        // Ціль читається з ІНДЕКСУ, а не через readlink робочого дерева:
        // перевіряємо саме те, що поїде у чужий клон.
        let Some(blob) = git_stdout(&git, cwd, &["cat-file", "blob", &entry.sha]) else {
            continue;
        };
        // Хвостові переводи рядка зрізаємо саме їх: пробіли в цілі symlink-а
        // значущі, тож `trim_end()` тут був би помилкою.
        let target = blob.trim_end_matches('\n');
        if target.is_empty() {
            continue;
        }

        let absolute = is_absolute_target(target);
        if !absolute && !escapes_repo_root(&entry.path, target) {
            continue;
        }
        let kind = if absolute {
            "абсолютний шлях"
        } else {
            "шлях за межами репо"
        };
        out.push(Violation {
            reason: if absolute {
                "absolute-target".to_string()
            } else {
                "escapes-repo".to_string()
            },
            message: format!(
                "security/tracked_symlink: відстежений symlink `{}` → `{target}` ({kind}) — \
                 у чужому клоні він указує в неіснуючу або чужу теку, роблячи збірку й тести \
                 недетермінованими. Прибери його з індексу: `git rm --cached {}` і додай `{}` \
                 у .gitignore (патерн БЕЗ кінцевого слеша — git не ходить за symlink-ом і \
                 бачить його як file-entry)",
                entry.path, entry.path, entry.path
            ),
            file: Some(entry.path.clone()),
            severity: Severity::Error,
            data: Some(serde_json::json!({ "target": target })),
        });
    }
    ConcernReport::from(out)
}
