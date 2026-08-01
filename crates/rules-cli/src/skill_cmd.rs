//! cspell:ignore ранери
//!
//! Native-команда `skill list` — перелік скілів пакета (зріз 2 фази 8,
//! `docs/specs/2026-08-01-rules-cli-phase8-skeleton.md`).
//!
//! Нативний ЛИШЕ `list`: решта `skill`-поверхні (`skill <runner> <id>`,
//! `skill <id>`, usage) — LLM/агентні ранери класу (в) інвентаризації, вони
//! лишаються делегованими. Роутер у [`crate::main`] звіряє саме перший
//! аргумент після `skill`, як і JS (`skill list зайве` теж друкує список —
//! `runSkillsCli` дивиться тільки на `argv[0]`).
//!
//! Джерело даних — `skills/` КОРЕНЯ ПАКЕТА, не поточного проєкту
//! ([`crate::js_fallback::package_root`]): дзеркало `resolveBundledPackageRoot`
//! у `npm/scripts/skills-cli.mjs`. Вивід — `Available skills:` і рядок
//! `- <id>` на кожен скіл; порожній перелік лишає тільки заголовок.
//!
//! **Свідома розбіжність із JS-CLI (спільна для всіх команд зрізу 2).**
//! JS-роутер (`npm/bin/n-rules-cli.mjs`) перед КОЖНОЮ командою, окрім `ci`,
//! кличе `ensureNRulesInRootDevDependencies(cwd)` — self-upgrade піна
//! `@7n/rules` у `package.json` з полем `workspaces`. Це поверхня sync/
//! дистрибуції, не семантика `skill list`, і вона зникає у зрізі 5 (npm-`bin`
//! стає launcher-ом бінаря), тож native-шлях її НЕ відтворює: read-only
//! команда лишається read-only. Розбіжність зафіксована окремим тестом
//! у `npm/scripts/lib/tests/rules-cli-parity.test.mjs`.

use std::process::ExitCode;

use crate::js_fallback;

/// Друкує перелік скілів пакета (порт гілки `first === 'list'` у
/// `runSkillsCli`).
pub fn run_list() -> ExitCode {
    let cwd = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    let package_root = match js_fallback::package_root(&cwd) {
        Ok(root) => root,
        Err(message) => {
            eprintln!("❌ {message}");
            return ExitCode::FAILURE;
        }
    };

    let mut out = String::from("Available skills:\n");
    for id in rules_core::skills::list_skill_ids(&package_root.join("skills")) {
        out.push_str("- ");
        out.push_str(&id);
        out.push('\n');
    }
    print!("{out}");
    ExitCode::SUCCESS
}
