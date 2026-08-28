//! T0-фікси для `abie/firebase_hosting` і `security/sample_secret`.
//!
//! Підключені до реєстру [`super::fix::NATIVE_FIXES`] і диспетчера
//! [`super::fix::run_concern_fix`].
//!
//! # `abie/firebase_hosting` — видалення заборонених артефактів
//!
//! Детектор ([`super::firebase_hosting::firebase_hosting`]) НЕ кладе шлях
//! ані в `Violation::file`, ані в `Violation::data` — обидва поля завжди
//! `None` (`crates/rules-core/src/concerns/firebase_hosting.rs:48-51,74-95`);
//! єдине місце зі шляхом — текст `message`. [`firebase_hosting_fix`] парсить
//! його СУВОРО за префіксом/суфіксом, які детектор генерує тими самими
//! literal-рядками (`FIREBASE_FILE_MSG_RE`/`FIREBASE_DIR_MSG_RE`) — це
//! точний зворотний парсинг детермінованого формату ОДНОГО й того самого
//! крейту, не вгадування. Повідомлення, що не збігається СУВОРО (напр.
//! помилка `read_dir` на неіснуючому корені), пропускається — для нього
//! немає шляху, який можна детерміновано видалити.
//!
//! Детектор знаходить і файли (`.firebaserc`, `firebase.json`), і
//! ДИРЕКТОРІЮ (`.firebase/`). Обидва типи тут дають однаковий
//! `FileEdit::Delete` — сам контракт `FixPlan` не розрізняє файл/директорію
//! на рівні типу; виконавець планів (`crates/rules-fix/src/t0.rs::to_edit_plan`)
//! це розрізняє сам: `Delete` на директорію розгортається в пофайлові
//! `Delete` усього піддерева, а ПІСЛЯ успішного commit спорожнілі теки
//! прибираються знизу вгору (`sweep_empty_dirs`, той самий доккомент модуля
//! `t0.rs`) — `Delete`-запис на `.firebase/` у плані звідси й ДЕКЛАРАТИВНО
//! коректний, і повністю виконується цим виконавцем.
//!
//! # `security/sample_secret` — заміна bare-`secret` на `sample-secret`
//!
//! Детектор ([`super::sample_secret::sample_secret`]) так само лишає
//! `file`/`data` порожніми — увесь контекст (`rel`, 1-based номер рядка,
//! trim-контент рядка) закодований у `message`
//! (`crates/rules-core/src/concerns/sample_secret.rs:105-116`).
//! [`sample_secret_fix`] парсить `rel`+номер рядка регуляркою
//! [`SAMPLE_SECRET_MSG_RE`] і ДОДАТКОВО звіряє, що поточний вміст цього
//! рядка файла (можливо, вже змінений відтоді, як пройшов detect) буквально
//! збігається із захопленим у violation `content` — якщо ні, рядок
//! пропускається: краще не зробити правку, ніж зачепити не той рядок.
//!
//! Якщо з message не вдається дістати номер рядка (захисний fallback на
//! гіпотетичний формат без номера — САМ детектор його завжди кладе, тож ця
//! гілка не покрита живим сценарієм детектора, лише власним тестом), але
//! `rel` усе ж розпізнається окремою регуляркою [`SAMPLE_SECRET_MSG_NO_LINE_RE`],
//! замінюємо лише ПЕРШИЙ збіг токена `secret` у файлі — той самий принцип
//! «консервативніше за замовчуванням», що вимагає постановка задачі. Якщо
//! навіть `rel` дістати не вдається — violation пропускається повністю, без
//! жодних припущень про ціль.
//!
//! Заміна самого токена — окрема регулярка [`SECRET_TOKEN_RE`], що
//! дзеркалить `VALUE_SECRET_RE` детектора (та приватна для сусіднього
//! модуля `sample_secret`, тож контракт дублюється, а не імпортується): та
//! сама 3-way alternation лапок (`'secret'`/`"secret"`/bare) і той самий
//! якір у кінці рядка (`sample_secret.rs:56-59`). Замінюємо ЛИШЕ сам токен
//! (зберігаючи тип лапок, якщо вони були) — решта рядка byte-for-byte
//! незмінна.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;

use crate::concerns::fix::{FileEdit, FixPlan, WriteFile};
use crate::diagnostics::Violation;

// ── abie/firebase_hosting ───────────────────────────────────────────────────

/// `reason`, яким детектор [`super::firebase_hosting::firebase_hosting`]
/// позначає ВСІ свої violation-и (файл/директорія/помилка читання) —
/// `firebase_hosting.rs:30`.
const FIREBASE_HOSTING_REASON: &str = "firebase_hosting";

/// T0-фікс `abie/firebase_hosting` — видаляє кожен знайдений заборонений
/// шлях (файл або директорію `.firebase/`) з підкаталогу 1-го рівня.
/// Дедуп за шляхом (той самий принцип, що [`super::fix::hasura_migrations_fix`]).
/// Violation, чий `message` не збігається СУВОРО з жодним із двох
/// детекторних форматів (напр. помилка `read_dir`) — пропускається: секція
/// доккоменту модуля вище.
pub fn firebase_hosting_fix(violations: &[Violation]) -> FixPlan {
    let mut seen = HashSet::new();
    let mut edits = Vec::new();
    for v in violations {
        if v.reason != FIREBASE_HOSTING_REASON {
            continue;
        }
        // Шлях беремо з `file` — детектор кладе його машинним полем.
        // Порушення без `file` (напр. збій читання каталогу) фікс не описує:
        // прибирати нема чого.
        let Some(rel) = v.file.clone() else { continue };
        if seen.insert(rel.clone()) {
            edits.push(FileEdit::Delete { path: rel });
        }
    }
    FixPlan { edits }
}

// ── security/sample_secret ──────────────────────────────────────────────────

/// `reason`, яким детектор [`super::sample_secret::sample_secret`] позначає
/// свої violation-и — `sample_secret.rs:65`.
const SAMPLE_SECRET_REASON: &str = "sample_secret";

/// Дзеркало `VALUE_SECRET_RE` (`sample_secret.rs:56-59`) з єдиною зміною —
/// alternation стає capturing-групою, щоб дістати span САМЕ токена (лапки +
/// `secret`), а не всього значення з хвостовою пунктуацією/коментарем.
static SECRET_TOKEN_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)[:=]>?\s*('secret'|"secret"|secret)[\s,;}\])]*(?:(?:#|//).*)?$"#)
        .expect("valid regex")
});

/// Замінює токен `secret`/`'secret'`/`"secret"` у кінці рядка на
/// `sample-secret` з тим самим типом лапок (bare лишається bare). `None` —
/// [`SECRET_TOKEN_RE`] не знайшла токена в цьому рядку (нема що міняти).
fn replace_secret_token(line: &str) -> Option<String> {
    let caps = SECRET_TOKEN_RE.captures(line)?;
    let tok = caps.get(1)?;
    let replacement = if tok.as_str().starts_with('\'') {
        "'sample-secret'"
    } else if tok.as_str().starts_with('"') {
        "\"sample-secret\""
    } else {
        "sample-secret"
    };
    Some(format!(
        "{}{replacement}{}",
        &line[..tok.start()],
        &line[tok.end()..]
    ))
}

/// T0-фікс `security/sample_secret` — читає кожен цільовий файл від `cwd` і
/// замінює bare-`secret` на `sample-secret` рядок-за-рядком, точково за
/// координатами з `message` (секція доккоменту модуля вище). Нечитабельний
/// файл — пропускається (fail-safe, той самий принцип, що й
/// [`super::fix::tauri_gitignore_target_fix`] для відсутнього `.gitignore`).
pub fn sample_secret_fix(cwd: &Path, violations: &[Violation]) -> FixPlan {
    let mut by_file: HashMap<String, Vec<usize>> = HashMap::new();

    for v in violations {
        if v.reason != SAMPLE_SECRET_REASON {
            continue;
        }
        // Шлях і номер рядка — машинні поля детектора (`file` і
        // `data.line`), не текст повідомлення. Порушення без них фікс не
        // описує: без точної адреси заміна була б вгадуванням.
        let Some(rel) = v.file.clone() else { continue };
        let Some(line_no) = v
            .data
            .as_ref()
            .and_then(|d| d.get("line"))
            .and_then(serde_json::Value::as_u64)
        else {
            continue;
        };
        by_file.entry(rel).or_default().push(line_no as usize);
    }

    let mut edits = Vec::new();
    for (rel, targets) in by_file {
        let Ok(content) = std::fs::read_to_string(cwd.join(&rel)) else {
            continue;
        };

        let numbered: HashSet<usize> = targets.iter().copied().collect();

        let mut out_lines: Vec<String> = Vec::new();
        let mut changed = false;

        for (i, raw_line) in content.split('\n').enumerate() {
            let line_no = i + 1;
            // Той самий CR-strip, що детектор (`sample_secret.rs:100-101`) —
            // токен шукаємо в CR-очищеному рядку, CR (якщо був) повертаємо
            // назад у результат незмінним.
            let (bare, had_cr) = match raw_line.strip_suffix('\r') {
                Some(b) => (b, true),
                None => (raw_line, false),
            };

            // Захист від дрейфу: правимо рядок лише якщо він ДОСІ містить
            // порушення. Раніше тут звірявся точний текст із повідомлення —
            // тепер джерелом істини є сам файл, а не те, що детектор колись
            // побачив.
            let should_try = numbered.contains(&line_no);

            if should_try {
                if let Some(new_bare) = replace_secret_token(bare) {
                    let mut new_line = new_bare;
                    if had_cr {
                        new_line.push('\r');
                    }
                    out_lines.push(new_line);
                    changed = true;
                    continue;
                }
            }
            out_lines.push(raw_line.to_string());
        }

        if changed {
            edits.push(FileEdit::Write(WriteFile {
                path: rel,
                content: out_lines.join("\n"),
            }));
        }
    }

    FixPlan { edits }
}

#[cfg(test)]
mod tests {
    use super::*;

    use tempfile::TempDir;

    use crate::concerns::firebase_hosting::firebase_hosting;
    use crate::concerns::sample_secret::sample_secret;
    use crate::concerns::test_support::write;
    use crate::diagnostics::Severity;

    /// Violation так, як його тепер будує детектор: шлях у `file`,
    /// номер рядка (для sample_secret) — у `data.line`.
    fn violation(reason: &str, message: &str) -> Violation {
        Violation {
            reason: reason.to_string(),
            message: message.to_string(),
            file: None,
            severity: Severity::Error,
            data: None,
        }
    }

    /// Violation зі шляхом — основна форма після переходу детекторів на
    /// машинні поля.
    fn violation_at(reason: &str, file: &str, line: Option<u64>) -> Violation {
        Violation {
            reason: reason.to_string(),
            message: "деталі — у машинних полях".to_string(),
            file: Some(file.to_string()),
            severity: Severity::Error,
            data: line.map(|n| serde_json::json!({ "line": n })),
        }
    }

    // ── firebase_hosting_fix ──

    #[test]
    fn firebase_fix_empty_plan_without_violations() {
        assert!(firebase_hosting_fix(&[]).edits.is_empty());
    }

    #[test]
    fn firebase_fix_deletes_forbidden_file_found_by_real_detector() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "pkg/.firebaserc", "{}");
        let violations = firebase_hosting(tmp.path());
        assert_eq!(violations.len(), 1);
        let plan = firebase_hosting_fix(&violations);
        assert_eq!(
            plan.edits,
            vec![FileEdit::Delete {
                path: "pkg/.firebaserc".to_string()
            }]
        );
    }

    #[test]
    fn firebase_fix_deletes_firebase_json_found_by_real_detector() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "pkg/firebase.json", "{}");
        let violations = firebase_hosting(tmp.path());
        let plan = firebase_hosting_fix(&violations);
        assert_eq!(
            plan.edits,
            vec![FileEdit::Delete {
                path: "pkg/firebase.json".to_string()
            }]
        );
    }

    /// Директорія `.firebase/` — теж `Delete`, без кінцевого `/` у шляху
    /// (секція доккоменту модуля про розгортання `Delete`-теки виконавцем
    /// `t0.rs::to_edit_plan`).
    #[test]
    fn firebase_fix_plans_delete_for_firebase_dir_found_by_real_detector() {
        let tmp = TempDir::new().unwrap();
        std::fs::create_dir_all(tmp.path().join("pkg/.firebase")).unwrap();
        let violations = firebase_hosting(tmp.path());
        assert_eq!(violations.len(), 1);
        let plan = firebase_hosting_fix(&violations);
        assert_eq!(
            plan.edits,
            vec![FileEdit::Delete {
                path: "pkg/.firebase".to_string()
            }]
        );
    }

    #[test]
    fn firebase_fix_dedups_same_path_across_multiple_violations() {
        let v = violation_at(FIREBASE_HOSTING_REASON, "pkg/.firebaserc", None);
        let plan = firebase_hosting_fix(&[v.clone(), v]);
        assert_eq!(plan.edits.len(), 1);
    }

    #[test]
    fn firebase_fix_ignores_violations_with_other_reason() {
        let v = violation(
            "other-reason",
            "Знайдено заборонений файл Firebase Hosting: pkg/.firebaserc — видали його (abie.mdc)",
        );
        assert!(firebase_hosting_fix(&[v]).edits.is_empty());
    }

    /// Помилка `read_dir` — той самий `reason`, але текст не збігається з
    /// жодним із двох детекторних форматів → без шляху для видалення.
    #[test]
    fn firebase_fix_skips_readdir_error_message() {
        let tmp = TempDir::new().unwrap();
        let ghost = tmp.path().join("no-such-path").join("nested");
        let violations = firebase_hosting(&ghost);
        assert_eq!(violations.len(), 1);
        assert!(firebase_hosting_fix(&violations).edits.is_empty());
    }

    /// Ідемпотентність: після фізичного видалення знайдених шляхів
    /// повторний прогін детектора не знаходить нічого — план порожній.
    #[test]
    fn firebase_fix_is_idempotent_after_deletion() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "pkg/.firebaserc", "{}");
        let first = firebase_hosting(tmp.path());
        assert_eq!(first.len(), 1);
        std::fs::remove_file(tmp.path().join("pkg/.firebaserc")).unwrap();
        let second = firebase_hosting(tmp.path());
        assert!(second.is_empty());
        assert!(firebase_hosting_fix(&second).edits.is_empty());
    }

    // ── sample_secret_fix ──

    #[test]
    fn sample_secret_fix_empty_plan_without_violations() {
        let tmp = TempDir::new().unwrap();
        assert!(sample_secret_fix(tmp.path(), &[]).edits.is_empty());
    }

    #[test]
    fn sample_secret_fix_replaces_bare_secret_found_by_real_detector() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, ".env.example", "DB_PASSWORD=secret\n");
        let violations = sample_secret(tmp.path());
        assert_eq!(violations.len(), 1);
        let plan = sample_secret_fix(tmp.path(), &violations);
        assert_eq!(plan.edits.len(), 1);
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("очікували write");
        };
        assert_eq!(w.path, ".env.example");
        assert_eq!(w.content, "DB_PASSWORD=sample-secret\n");
    }

    #[test]
    fn sample_secret_fix_preserves_double_quotes() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "config.sample", "password: \"secret\"\n");
        let violations = sample_secret(tmp.path());
        let plan = sample_secret_fix(tmp.path(), &violations);
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("очікували write");
        };
        assert_eq!(w.content, "password: \"sample-secret\"\n");
    }

    #[test]
    fn sample_secret_fix_preserves_single_quotes() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "config.sample", "password: 'secret'\n");
        let violations = sample_secret(tmp.path());
        let plan = sample_secret_fix(tmp.path(), &violations);
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("очікували write");
        };
        assert_eq!(w.content, "password: 'sample-secret'\n");
    }

    #[test]
    fn sample_secret_fix_preserves_surrounding_content_php_arrow_style() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "app.php.dist",
            "<?php return ['password' => 'secret'];\n",
        );
        let violations = sample_secret(tmp.path());
        let plan = sample_secret_fix(tmp.path(), &violations);
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("очікували write");
        };
        assert_eq!(w.content, "<?php return ['password' => 'sample-secret'];\n");
    }

    /// Лише цільовий рядок змінюється — решта файлу byte-for-byte та сама.
    #[test]
    fn sample_secret_fix_touches_only_the_targeted_line() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "fixtures/tokens.env",
            "HEADER=keep\nTOKEN=secret\nFOOTER=keep\n",
        );
        let violations = sample_secret(tmp.path());
        assert_eq!(violations.len(), 1);
        let plan = sample_secret_fix(tmp.path(), &violations);
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("очікували write");
        };
        assert_eq!(w.content, "HEADER=keep\nTOKEN=sample-secret\nFOOTER=keep\n");
    }

    #[test]
    fn sample_secret_fix_ignores_violations_with_other_reason() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, ".env.example", "DB_PASSWORD=secret\n");
        let v = violation("other-reason", ".env.example:1: `DB_PASSWORD=secret` — заміни placeholder `secret` на `sample-secret` (security.mdc)");
        assert!(sample_secret_fix(tmp.path(), &[v]).edits.is_empty());
    }

    #[test]
    fn sample_secret_fix_ignores_unparsable_message() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, ".env.example", "DB_PASSWORD=secret\n");
        let v = violation(SAMPLE_SECRET_REASON, "щось геть не за форматом");
        assert!(sample_secret_fix(tmp.path(), &[v]).edits.is_empty());
    }

    /// Файл, на який вказує violation, відсутній на диску — пропуск без паніки.
    #[test]
    fn sample_secret_fix_skips_missing_file() {
        let tmp = TempDir::new().unwrap();
        let v = violation(
            SAMPLE_SECRET_REASON,
            "ghost.env:1: `TOKEN=secret` — заміни placeholder `secret` на `sample-secret` (security.mdc)",
        );
        assert!(sample_secret_fix(tmp.path(), &[v]).edits.is_empty());
    }

    /// Дрейф: файл змінився з моменту detect (рядок уже не той, що описує
    /// violation) — targeted-рядок НЕ чіпається.
    #[test]
    fn sample_secret_fix_skips_line_when_content_drifted_since_detect() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, ".env.example", "DB_PASSWORD=secret\n");
        let violations = sample_secret(tmp.path());
        // Файл змінився ПІСЛЯ detect, ДО fix — інший рядок на тій самій позиції.
        write(&tmp, ".env.example", "DB_PASSWORD=sample-secret\n");
        assert!(sample_secret_fix(tmp.path(), &violations).edits.is_empty());
    }

    /// Ідемпотентність: застосований план (write повного вмісту) → повторний
    /// прогін детектора на новому вмісті не знаходить нічого.
    #[test]
    fn sample_secret_fix_is_idempotent_after_applying_plan() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, ".env.example", "DB_PASSWORD=secret\n");
        let violations = sample_secret(tmp.path());
        let plan = sample_secret_fix(tmp.path(), &violations);
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("очікували write");
        };
        std::fs::write(tmp.path().join(&w.path), &w.content).unwrap();

        let second_pass = sample_secret(tmp.path());
        assert!(second_pass.is_empty());
        assert!(sample_secret_fix(tmp.path(), &second_pass).edits.is_empty());
    }

    /// Без номера рядка фікс НЕ вгадує: раніше тут був fallback «заміни
    /// перший збіг», але після переходу детектора на машинні поля адреса
    /// правки або відома точно, або її немає. Мовчазна заміна не того рядка
    /// дорожча за невиправлене порушення, бо T0 працює без перевірки.
    #[test]
    fn sample_secret_fix_skips_violation_without_line_number() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "fixtures/multi.env", "A=secret\nB=secret\n");
        let v = violation_at(SAMPLE_SECRET_REASON, "fixtures/multi.env", None);
        let plan = sample_secret_fix(tmp.path(), &[v]);
        assert!(plan.edits.is_empty(), "без адреси правки — порожній план");
    }
}
