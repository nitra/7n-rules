//! cspell:ignore errno
//!
//! Перелік скілів пакета `@7n/rules` — порт `listSkillIds`
//! (`npm/scripts/skills-cli.mjs`), рушій команди `skill list`
//! (зріз 2 фази 8, `docs/specs/2026-08-01-rules-cli-phase8-skeleton.md`).
//!
//! Порт 1:1: скіл — це ПІДКАТАЛОГ `skills/` з файлом `SKILL.md` усередині;
//! результат відсортований `localeCompare` ([`crate::locale`], а не байтово
//! — id можуть містити `_`/великі літери, для яких порядки розходяться).
//!
//! Дзеркала семантики JS, звірені пункт за пунктом:
//! - `existsSync(skillsRoot)` хибний → порожній список (не помилка);
//! - `entry.isDirectory()` у Node — це `d_type`/`lstat`, тож симлінк на
//!   каталог НЕ вважається каталогом; [`std::fs::DirEntry::file_type`] має
//!   ту саму (не-follow) семантику;
//! - `existsSync(join(root, name, 'SKILL.md'))` — навпаки, слідує симлінкам
//!   і істинний для каталогу з такою назвою; [`Path::exists`] теж.
//!
//! **Межа порту.** Якщо `skills/` існує, але не є каталогом, `readdirSync`
//! у JS кидає `ENOTDIR` ще ДО `try` в `runSkillsCli` — CLI друкує текст
//! errno-помилки Node і виходить кодом 1. Відтворити той рядок дослівно
//! неможливо (формат повідомлення — деталь рантайму), тож тут такий випадок
//! дає порожній список, як і відсутній каталог. Випадок недосяжний для
//! коректно зібраного npm-пакета.

use std::path::Path;

/// Файл-маркер скіла всередині його каталогу.
const SKILL_FILE: &str = "SKILL.md";

/// Відсортовані id скілів у `skills_root` (порт `listSkillIds`).
pub fn list_skill_ids(skills_root: &Path) -> Vec<String> {
    if !skills_root.exists() {
        return Vec::new();
    }
    let Ok(entries) = std::fs::read_dir(skills_root) else {
        return Vec::new();
    };

    let mut ids: Vec<String> = entries
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| skills_root.join(name).join(SKILL_FILE).exists())
        .collect();
    ids.sort_by(|a, b| crate::locale::locale_compare(a, b));
    ids
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn skill(root: &Path, id: &str) {
        std::fs::create_dir_all(root.join(id)).unwrap();
        std::fs::write(root.join(id).join(SKILL_FILE), "# skill\n").unwrap();
    }

    #[test]
    fn missing_root_gives_empty_list() {
        let tmp = TempDir::new().unwrap();
        assert!(list_skill_ids(&tmp.path().join("skills")).is_empty());
    }

    #[test]
    fn only_directories_with_skill_md_are_listed_and_sorted() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        skill(root, "taze");
        skill(root, "lint");
        skill(root, "doc_files");
        skill(root, "doc-files");
        // Каталог без SKILL.md і звичайний файл — обидва не скіли.
        std::fs::create_dir_all(root.join("empty-dir")).unwrap();
        std::fs::write(root.join("README.md"), "x\n").unwrap();

        // `_` перед `-` — саме `localeCompare`, не байтовий порядок.
        assert_eq!(
            list_skill_ids(root),
            vec!["doc_files", "doc-files", "lint", "taze"]
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_directory_is_not_a_skill() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        skill(root, "lint");
        std::os::unix::fs::symlink(root.join("lint"), root.join("alias")).unwrap();
        assert_eq!(list_skill_ids(root), vec!["lint"]);
    }
}
