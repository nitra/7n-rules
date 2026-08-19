//! cspell:ignore ранери
//!
//! Native-команда `skill` — перелік скілів, друк промпта і агентний прогін
//! (зріз 2 фази 8 дав `list`, міграція `agent-skill` — решту:
//! `docs/specs/2026-08-08-llm-lib-acp-only-rust-goose.md`, §3.3, клас 2).
//!
//! Нативні три гілки: `list` (перелік), `skill <id>` ([`run_prompt`] — друк
//! зібраного промпта, без LLM) і `skill <runner> <id>` ([`run_runner`] —
//! один хід ACP-агента). Роутер у [`crate::main`] звіряє перший аргумент
//! після `skill`, як і JS (`skill list зайве` теж друкує список —
//! `runSkillsCli` дивиться тільки на `argv[0]`).
//!
//! Делегованими лишаються рівно дві речі, обидві за класом, а не за обсягом:
//! [`ORCHESTRATED_SKILLS`] (конвеєр кроків, не один хід) і раннер `claude`
//! (deprecated JS-шим без Rust-моделі).
//!
//! Головне, що змінилось для `pi`: раніше він ішов ОКРЕМОЮ JS-гілкою
//! (`@7n/llm-lib/agent-skill`), тоді як `cursor`/`codex` — через napi-міст.
//! Тепер усі kind-и йдуть одним шляхом класу 2, і JS-раннер більше не
//! потрібен.
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

use std::path::Path;
use std::process::ExitCode;

use llm_lib::acp::{AcpAgentKind, Strength};

use crate::js_fallback;

/// Скіли з власним JS-оркестратором: їхній прогін — не один агентний хід, а
/// конвеєр детермінованих кроків із точковими LLM-викликами
/// (`skills/taze/js/orchestrate.mjs` і `git-reconcile`). Порт конвеєрів —
/// окремий зріз спеки, тож тут вони лишаються делегованими: краще чесно
/// віддати їх JS, ніж підмінити конвеєр одним ходом і мовчки втратити кроки.
const ORCHESTRATED_SKILLS: [&str; 2] = ["taze", "git-reconcile"];

/// Раннер CLI → ACP-kind. `claude` свідомо відсутній (legacy-ім'я, usage
/// друкує JS — доккомент роутера в `main.rs`); `goose` прибрано слідом за
/// `llm-lib` 0.3 (рішення Ч спеки `2026-08-17-n7n-harness-local-models.md`):
/// він був єдиним kind-ом, чий пресет резолвив модель із env, і ця
/// асиметрія зламала розчеплення `Strength`/`Tier`.
fn runner_kind(runner: &str) -> Option<AcpAgentKind> {
    match runner {
        "pi" => Some(AcpAgentKind::Pi),
        "cursor" => Some(AcpAgentKind::Cursor),
        "codex" => Some(AcpAgentKind::Codex),
        _ => None,
    }
}

/// Тир скіла (рядок із `main.json`) → [`Strength`] — сила моделі всередині
/// обраного агента. Саме `Strength`, не `Tier`: «наскільки сильна модель»
/// і «де рахується/за чий рахунок» — два різні питання (рішення Б тієї ж
/// спеки), і `main.json.tier` скіла завжди означав перше.
fn strength_from_name(tier: &str) -> Strength {
    match tier {
        "min" => Strength::Min,
        "avg" => Strength::Avg,
        _ => Strength::Max,
    }
}

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

/// Резолвить `skills/` пакета і робочий каталог проєкту — спільний перший
/// крок обох гілок нижче.
fn roots() -> Result<(std::path::PathBuf, std::path::PathBuf), String> {
    let cwd =
        std::env::current_dir().map_err(|error| format!("немає робочої директорії: {error}"))?;
    let package_root = js_fallback::package_root(&cwd)?;
    Ok((package_root.join("skills"), cwd))
}

/// `skill <id> ["task"]` — друкує зібраний промпт і виходить.
///
/// LLM тут не бере участі взагалі: гілка існує, щоб людина (чи інший агент)
/// могла взяти готовий промпт і виконати його де завгодно.
pub fn run_prompt(raw_skill_name: &str, task: &str) -> ExitCode {
    let (skills_root, project_dir) = match roots() {
        Ok(roots) => roots,
        Err(message) => return fail(&message),
    };
    match rules_core::skills::build_skill_prompt(&skills_root, raw_skill_name, task, &project_dir) {
        Ok(prompt) => {
            println!("{prompt}");
            ExitCode::SUCCESS
        }
        Err(message) => fail(&message),
    }
}

/// `skill <runner> <id> ["task"]` — виконує скіл зовнішнім ACP-агентом.
///
/// Силу моделі бере з `main.json` скіла (дефолт `max`) і передає в
/// [`llm_lib::acp::one_shot_acp_with_strength`] — той самий шлях класу 2 для всіх
/// kind-ів. До цього зрізу `pi` йшов окремою JS-гілкою
/// (`@7n/llm-lib/agent-skill`), а `cursor`/`codex` — через napi-міст із JS;
/// тепер це один контур без стрибка через JS.
pub fn run_runner(runner: &str, raw_skill_name: &str, task: &str) -> ExitCode {
    let Some(kind) = runner_kind(runner) else {
        return fail(&format!("невідомий раннер скіла: {runner}"));
    };
    let (skills_root, project_dir) = match roots() {
        Ok(roots) => roots,
        Err(message) => return fail(&message),
    };

    let skill_id = rules_core::skills::normalize_skill_id(raw_skill_name);
    let prompt = match rules_core::skills::build_skill_prompt(
        &skills_root,
        raw_skill_name,
        task,
        &project_dir,
    ) {
        Ok(prompt) => prompt,
        Err(message) => return fail(&message),
    };
    let strength = strength_from_name(&rules_core::skills::skill_tier(
        &skills_root.join(&skill_id),
    ));

    match run_blocking(kind, strength, &prompt, &project_dir) {
        Ok(output) => {
            print!("{output}");
            if !output.ends_with('\n') {
                println!();
            }
            ExitCode::SUCCESS
        }
        Err(message) => fail(&message),
    }
}

/// Чи має цей скіл власний JS-оркестратор ([`ORCHESTRATED_SKILLS`]).
#[must_use]
pub fn is_orchestrated(raw_skill_name: &str) -> bool {
    ORCHESTRATED_SKILLS.contains(&rules_core::skills::normalize_skill_id(raw_skill_name).as_str())
}

/// Заводить async-рантайм під один ACP-виклик (та сама причина, що й у
/// `fix_cmd::run_blocking`: решта native-команд синхронна).
fn run_blocking(
    kind: AcpAgentKind,
    strength: Strength,
    prompt: &str,
    cwd: &Path,
) -> Result<String, String> {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("не вдалося створити async-рантайм: {error}"))?;
    runtime
        .block_on(llm_lib::acp::one_shot_acp_with_strength(
            kind, strength, prompt, cwd,
        ))
        .map_err(|error| error.to_string())
}

/// Друкує помилку в stderr і повертає код невдачі — єдине місце формату.
fn fail(message: &str) -> ExitCode {
    eprintln!("❌ {message}");
    ExitCode::FAILURE
}
