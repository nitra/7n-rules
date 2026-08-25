//! Native-порт `hasura/migrations` (`npm/rules/hasura/migrations/main.mjs`,
//! 53 рядки) — у `hasura/migrations/` директорія міграції має містити лише
//! `up.sql`, `down.sql` заборонений (`hasura.mdc`).
//!
//! # Обхід дерева — `walk_under_repo`, З consumer-ignore (реєстр §2.27/§2.30)
//!
//! Використовує [`crate::concerns::cursor_ignore::walk_under_repo`]: конфіг
//! (`.n-rules.json`) лежить у корені проєкту (`cwd`), а обхід іде по
//! ОКРЕМОМУ піддереву (`hasura/migrations/`) — точний випадок, для якого
//! існує `walk_under_repo`, а не `walk_repo`.
//!
//! **Поведінкова зміна щодо JS-оригіналу**: `main.mjs` кликав
//! `walkDir(migrationsDir)` без `ignorePaths`, тобто НЕ консультувався з
//! `.n-rules.json:ignore` (перевірено `git show <sha>~1` до вилучення JS).
//! Це був один із чотирьох «1:1-портів» задачі §2.27 (реєстр:
//! `docs/plans/2026-08-05-open-questions-register.md`). §2.30 його закриває
//! на «почати фільтрувати» — не з практичної потреби (поверхня вузька за
//! конструкцією: одна конкретна тека, малоймовірно, що хтось додає
//! `hasura/migrations/**` в ignore окремо від repo-wide правил), а з
//! КОНСИСТЕНТНОСТІ: після §2.27 усі 13 інших full-scope concern-ів у цьому
//! крейті вже консультуються з `.n-rules.json:ignore` через одну з трьох
//! обгорток `cursor_ignore`; лишати саме цей call-сайт винятком без жодної
//! практичної причини (лише «JS теж так робив» — аргумент, що сам реєстр
//! §2.27 визнає таким, що слабшає з часом, бо канон тепер Rust) —гірше, ніж
//! просто уніфікувати. Наслідок: `down.sql` у ВИКЛЮЧЕНІЙ директорії міграції
//! більше НЕ дає violation — див. `ignored_migration_subdir_is_excluded`
//! нижче й запис у change-файлі.

use std::path::Path;

use crate::concerns::cursor_ignore::walk_under_repo;
use crate::diagnostics::{Severity, Violation};

/// Відносний шлях до директорії міграцій від кореня проєкту — порт
/// `MIGRATIONS_REL` (`main.mjs:9`).
const MIGRATIONS_REL: &str = "hasura/migrations";

/// Явний `reason`, який JS-версія передає в `fail(msg, { file, reason })`
/// (`main.mjs:47`) — не дефолт `ctx.concernId`. `fix-migrations.mjs` матчить
/// T0-патерн саме по цьому reason-у (`v.reason === 'down-sql-forbidden'`), а
/// `file` — по якому видаляє конкретний `down.sql` — обидва поля тут
/// збережені біт-у-біт.
const REASON: &str = "down-sql-forbidden";

/// Перевіряє, що у `hasura/migrations/` немає файлів `down.sql` — точний
/// порт `lint(ctx)` (`main.mjs:17-53`).
pub fn hasura_migrations(cwd: &Path) -> Vec<Violation> {
    let migrations_dir = cwd.join(MIGRATIONS_REL);
    if !migrations_dir.exists() {
        return Vec::new();
    }

    let files = walk_under_repo(cwd, &migrations_dir);
    let mut violations = Vec::new();
    for rel_to_migrations in &files {
        let basename = rel_to_migrations
            .split('/')
            .next_back()
            .unwrap_or(rel_to_migrations.as_str());
        if basename != "down.sql" {
            continue;
        }
        let rel_to_cwd = format!("{MIGRATIONS_REL}/{rel_to_migrations}");
        violations.push(Violation {
            reason: REASON.to_string(),
            message: format!(
                "{rel_to_cwd}: down.sql заборонений у {MIGRATIONS_REL}/ — у директорії міграції має бути лише up.sql (hasura.mdc)"
            ),
            file: Some(rel_to_cwd),
            severity: Severity::Error,
            data: None,
        });
    }
    violations
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;

    use crate::concerns::test_support::write;

    /// «успіх: hasura/migrations/ відсутній → exit 0» (`tests/migrations.test.mjs:18-22`).
    #[test]
    fn missing_migrations_dir_is_clean() {
        let tmp = TempDir::new().unwrap();
        assert!(hasura_migrations(tmp.path()).is_empty());
    }

    /// «успіх: є лише up.sql → exit 0» (`:24-31`).
    #[test]
    fn only_up_sql_is_clean() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "hasura/migrations/default/1000_add_foo/up.sql",
            "CREATE TABLE foo (id INT);\n",
        );
        assert!(hasura_migrations(tmp.path()).is_empty());
    }

    /// «порушення: down.sql у директорії міграції → exit 1» (`:33-42`).
    #[test]
    fn down_sql_present_is_violation() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "hasura/migrations/default/1000_add_foo/up.sql",
            "CREATE TABLE foo (id INT);\n",
        );
        write(
            &tmp,
            "hasura/migrations/default/1000_add_foo/down.sql",
            "DROP TABLE foo;\n",
        );
        let violations = hasura_migrations(tmp.path());
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].reason, "down-sql-forbidden");
        assert_eq!(
            violations[0].file.as_deref(),
            Some("hasura/migrations/default/1000_add_foo/down.sql")
        );
        assert_eq!(violations[0].severity, Severity::Error);
        assert!(violations[0].data.is_none());
    }

    /// «порушення: кілька down.sql у різних міграціях — усі репортуються» (`:44-55`).
    #[test]
    fn multiple_down_sql_are_all_reported() {
        let tmp = TempDir::new().unwrap();
        for name in ["1000_add_foo", "2000_add_bar"] {
            write(
                &tmp,
                &format!("hasura/migrations/default/{name}/up.sql"),
                "-- up\n",
            );
            write(
                &tmp,
                &format!("hasura/migrations/default/{name}/down.sql"),
                "-- down\n",
            );
        }
        assert_eq!(hasura_migrations(tmp.path()).len(), 2);
    }

    /// «порушення: down.sql у вкладеній директорії → exit 1» (`:57-65`).
    #[test]
    fn nested_down_sql_is_violation() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "hasura/migrations/other_db/1234_nested/sub/down.sql",
            "-- down\n",
        );
        assert_eq!(hasura_migrations(tmp.path()).len(), 1);
    }

    /// «успіх: файл з іменем down.sql.bak поза межами правила → exit 0» (`:67-75`).
    #[test]
    fn down_sql_bak_suffix_is_clean() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "hasura/migrations/default/1000_add_foo/up.sql",
            "-- up\n",
        );
        write(
            &tmp,
            "hasura/migrations/default/1000_add_foo/down.sql.bak",
            "-- bak\n",
        );
        assert!(hasura_migrations(tmp.path()).is_empty());
    }

    /// «успіх: down.sql поза hasura/migrations/ не сканується → exit 0» (`:77-86`).
    #[test]
    fn down_sql_outside_migrations_dir_is_not_scanned() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "hasura/migrations/default/1_foo/up.sql", "-- up\n");
        write(&tmp, "some/other/dir/down.sql", "-- irrelevant\n");
        assert!(hasura_migrations(tmp.path()).is_empty());
    }

    /// Поведінкова зміна (реєстр §2.27/§2.30): `.n-rules.json:ignore` у
    /// КОРЕНІ проєкту виключає піддерево під `hasura/migrations/` — `down.sql`
    /// у виключеній директорії міграції більше НЕ дає violation.
    #[test]
    fn ignored_migration_subdir_is_excluded() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            ".n-rules.json",
            r#"{"ignore":["hasura/migrations/legacy"]}"#,
        );
        write(
            &tmp,
            "hasura/migrations/legacy/1000_old/down.sql",
            "-- down\n",
        );
        write(
            &tmp,
            "hasura/migrations/default/1000_add_foo/down.sql",
            "-- down\n",
        );
        let violations = hasura_migrations(tmp.path());
        assert_eq!(violations.len(), 1);
        assert_eq!(
            violations[0].file.as_deref(),
            Some("hasura/migrations/default/1000_add_foo/down.sql")
        );
    }
}
