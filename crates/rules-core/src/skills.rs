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

/// Файл метаданих скіла.
const SKILL_META_FILE: &str = "main.json";

/// Тир скіла за замовчуванням — порт `DEFAULT_SKILL_TIER`
/// (`npm/scripts/lib/skill-meta.mjs`). Скіли виконують цілі задачі, тож
/// дефолт свідомо найсильніший, а не найдешевший.
const DEFAULT_SKILL_TIER: &str = "max";

/// Валідні тири скіла — порт `SKILL_TIERS`.
const SKILL_TIERS: [&str; 3] = ["min", "avg", "max"];

/// Знімає префікс `n-` з імені скіла (`n-lint` → `lint`) — порт
/// `normalizeSkillId`. Порожнє чи не-рядкове ім'я в JS дає `''`; тут той
/// самий контракт через порожній рядок.
#[must_use]
pub fn normalize_skill_id(name: &str) -> String {
    name.strip_prefix("n-").unwrap_or(name).to_string()
}

/// Тир скіла з його `main.json` — порт `skillTier(readSkillMetaRaw(dir))`.
///
/// Будь-яка невдача (немає файлу, невалідний JSON, не-об'єкт, невідомий чи
/// не-рядковий `tier`) дає [`DEFAULT_SKILL_TIER`]: у JS ці гілки теж
/// зливаються в один дефолт, і скіл радше виконається сильнішою моделлю,
/// ніж не виконається зовсім.
#[must_use]
pub fn skill_tier(skill_dir: &Path) -> String {
    let Ok(text) = std::fs::read_to_string(skill_dir.join(SKILL_META_FILE)) else {
        return DEFAULT_SKILL_TIER.to_string();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return DEFAULT_SKILL_TIER.to_string();
    };
    value
        .get("tier")
        .and_then(serde_json::Value::as_str)
        .filter(|tier| SKILL_TIERS.contains(tier))
        .unwrap_or(DEFAULT_SKILL_TIER)
        .to_string()
}

/// Читає файл, якщо він є — порт `readIfExists` (відсутність не помилка).
fn read_if_exists(path: &Path) -> Option<String> {
    std::fs::read_to_string(path).ok()
}

/// Складає промпт одного скіл-рану — порт `buildSkillPrompt`.
///
/// `Err` — невідомий скіл; текст дзеркалить JS разом із переліком наявних,
/// бо це повідомлення бачить людина в терміналі.
///
/// # Errors
/// Скіла з таким id немає (або немає його `SKILL.md`).
pub fn build_skill_prompt(
    skills_root: &Path,
    raw_skill_name: &str,
    task: &str,
    project_dir: &Path,
) -> Result<String, String> {
    let skill_id = normalize_skill_id(raw_skill_name);
    let skill_path = skills_root.join(&skill_id).join(SKILL_FILE);
    let skill = if skill_id.is_empty() {
        None
    } else {
        read_if_exists(&skill_path)
    };
    let Some(skill) = skill else {
        let available = list_skill_ids(skills_root).join(", ");
        let available = if available.is_empty() {
            "(none)".to_string()
        } else {
            available
        };
        return Err(format!(
            "Unknown skill \"{raw_skill_name}\". Available skills: {available}"
        ));
    };

    let task = if task.is_empty() {
        "Execute the skill instructions for this project."
    } else {
        task
    };
    // `.n-rules.json` з fallback на застарілий `.n-cursor.json` — той самий
    // порядок, що в JS (нове ім'я має пріоритет).
    let n_rules = read_if_exists(&project_dir.join(".n-rules.json"))
        .or_else(|| read_if_exists(&project_dir.join(".n-cursor.json")));

    // Порожні секції відкидаються (`.filter(Boolean)` у JS), тож проєкт без
    // package.json не отримує порожнього заголовка.
    let mut blocks = vec![
        "# Task".to_string(),
        task.to_string(),
        String::new(),
        "# Skill".to_string(),
        skill,
        String::new(),
        "# Current project".to_string(),
        format!("Directory: {}", project_dir.display()),
        String::new(),
    ];
    for (name, content) in [
        (
            "package.json",
            read_if_exists(&project_dir.join("package.json")),
        ),
        (
            "tsconfig.json",
            read_if_exists(&project_dir.join("tsconfig.json")),
        ),
        (".n-rules.json", n_rules),
    ] {
        if let Some(content) = content {
            blocks.push(format!("## {name}\n\n```json\n{content}\n```"));
        }
    }
    blocks.retain(|block| !block.is_empty());
    Ok(blocks.join("\n\n"))
}

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
    fn strips_n_prefix_from_skill_id() {
        assert_eq!(normalize_skill_id("n-lint"), "lint");
        assert_eq!(normalize_skill_id("lint"), "lint");
        assert_eq!(normalize_skill_id(""), "");
        // `n` без дефіса — не префікс.
        assert_eq!(normalize_skill_id("npm-module"), "npm-module");
    }

    #[test]
    fn tier_comes_from_main_json_with_max_default() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();
        assert_eq!(skill_tier(dir), "max", "немає main.json → дефолт");

        std::fs::write(dir.join("main.json"), r#"{"tier":"min"}"#).unwrap();
        assert_eq!(skill_tier(dir), "min");

        std::fs::write(dir.join("main.json"), r#"{"tier":"turbo"}"#).unwrap();
        assert_eq!(skill_tier(dir), "max", "невідомий тир → дефолт");

        std::fs::write(dir.join("main.json"), "{ не json").unwrap();
        assert_eq!(skill_tier(dir), "max", "побитий JSON → дефолт, не паніка");
    }

    #[test]
    fn unknown_skill_names_the_available_ones() {
        let tmp = TempDir::new().unwrap();
        skill(tmp.path(), "lint");
        let error = build_skill_prompt(tmp.path(), "нема", "", tmp.path()).unwrap_err();
        assert_eq!(
            error, "Unknown skill \"нема\". Available skills: lint",
            "повідомлення бачить людина в терміналі — дзеркалимо JS дослівно"
        );
    }

    #[test]
    fn prompt_carries_task_skill_and_project_context() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("skills");
        skill(&root, "lint");
        let project = tmp.path().join("project");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::write(project.join("package.json"), "{\"name\":\"p\"}").unwrap();

        let prompt = build_skill_prompt(&root, "n-lint", "прибери борг", &project).unwrap();

        assert!(prompt.starts_with("# Task\n\nприбери борг\n\n# Skill\n"));
        assert!(prompt.contains("## package.json\n\n```json\n{\"name\":\"p\"}\n```"));
        assert!(
            !prompt.contains("## tsconfig.json"),
            "відсутній файл не лишає порожнього заголовка"
        );
    }

    #[test]
    fn empty_task_falls_back_to_the_default_instruction() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("skills");
        skill(&root, "lint");

        let prompt = build_skill_prompt(&root, "lint", "", tmp.path()).unwrap();

        assert!(prompt.starts_with("# Task\n\nExecute the skill instructions for this project."));
    }

    /// Застарілий `.n-cursor.json` читається лише за відсутності нового —
    /// той самий порядок, що в JS.
    #[test]
    fn legacy_cursor_config_is_a_fallback_not_an_addition() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("skills");
        skill(&root, "lint");
        let project = tmp.path().join("project");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::write(project.join(".n-cursor.json"), "{\"legacy\":true}").unwrap();

        let legacy_only = build_skill_prompt(&root, "lint", "", &project).unwrap();
        assert!(legacy_only.contains("{\"legacy\":true}"));

        std::fs::write(project.join(".n-rules.json"), "{\"new\":true}").unwrap();
        let both = build_skill_prompt(&root, "lint", "", &project).unwrap();
        assert!(both.contains("{\"new\":true}"));
        assert!(
            !both.contains("{\"legacy\":true}"),
            "новий файл витісняє старий"
        );
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
