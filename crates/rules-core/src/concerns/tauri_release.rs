//! Native-порт `tauri/release` (`npm/rules/tauri/release/main.mjs`, 317
//! рядків) — tauri.mdc `release`: updater-готовність `tauri.conf.json`
//! кожного Tauri-застосунку в монорепо, канонічний layout
//! `changelog-release.yml` (тригер на change-файли, guard від
//! release-циклу, права, push-auth), канонічний `release.yml` (тег-тригер,
//! dispatch, порядок sync версії перед `tauri-action`, zizmor-приглушення
//! `Swatinem/rust-cache`), і присутність `<ws>/.changes/.gitkeep`.
//!
//! На відміну від `tauri/gitignore_target`/`tauri/linux_deps` (G1 TOML-кластер),
//! цей concern шукає Tauri-застосунки за `tauri.conf.json`
//! (nested `src-tauri/tauri.conf.json` або legacy flat `tauri.conf.json`), не
//! за `src-tauri/Cargo.toml` — тому [`find_tauri_app_dirs`] тут окрема
//! функція, не `crate::concerns::find_src_tauri::find_src_tauri_dirs`.

use std::path::{Path, PathBuf};

use crate::concerns::find_src_tauri::relative_posix;
use crate::concerns::gha_workflow::{
    flatten_workflow_steps, get_step_run, get_step_uses, parse_workflow_yaml, FlatStep,
};
use crate::concerns::workspaces::get_monorepo_package_root_dirs;
use crate::diagnostics::{Severity, Violation};

/// Шлях workflow, що на push у main бампає версію з change-файлів і створює
/// тег — порт `CHANGELOG_RELEASE_WORKFLOW` (`main.mjs:11`).
pub(super) const CHANGELOG_RELEASE_WORKFLOW: &str = ".github/workflows/changelog-release.yml";
/// Шлях workflow, що на тег збирає й публікує реліз Tauri-застосунку — порт
/// `RELEASE_WORKFLOW` (`main.mjs:13`).
pub(super) const RELEASE_WORKFLOW: &str = ".github/workflows/release.yml";

/// Канонічний фрагмент push-auth кроку (текстовий, не через YAML-дерево —
/// точний вигляд рядка з `main.mjs:186`, вживається лише всередині
/// `format!`-інтерполяції через звичайний `&str`, тож фігурні дужки
/// `${{ ... }}` тут — буквальний текст, без спецсимволів `format!`).
pub(super) const PUSH_AUTH_SNIPPET: &str =
    "git remote set-url origin \"https://x-access-token:${{ secrets.GITHUB_TOKEN }}@github.com/${{ github.repository }}.git\"";

/// Один знайдений Tauri-застосунок — точний порт `{ ws, tauriConfPath }`
/// (`main.mjs:21-32`).
pub(super) struct TauriApp {
    pub(super) ws: String,
    pub(super) tauri_conf_path: PathBuf,
}

/// Знаходить workspace-каталоги з Tauri-застосунком (`<ws>/src-tauri/
/// tauri.conf.json` чи legacy `<ws>/tauri.conf.json`) — точний порт
/// `findTauriAppDirs` (`main.mjs:21-32`).
pub(super) fn find_tauri_app_dirs(cwd: &Path) -> Vec<TauriApp> {
    let roots = get_monorepo_package_root_dirs(cwd);
    let mut found = Vec::new();
    for ws in roots {
        let base = if ws == "." {
            cwd.to_path_buf()
        } else {
            cwd.join(&ws)
        };
        let nested = base.join("src-tauri").join("tauri.conf.json");
        let flat = base.join("tauri.conf.json");
        if nested.exists() {
            found.push(TauriApp {
                ws,
                tauri_conf_path: nested,
            });
        } else if flat.exists() {
            found.push(TauriApp {
                ws,
                tauri_conf_path: flat,
            });
        }
    }
    found
}

/// Чи `on.workflow_dispatch` присутній у корені workflow — точний порт
/// `hasWorkflowDispatch` (`main.mjs:39-42`).
pub(super) fn has_workflow_dispatch(root: &serde_json::Value) -> bool {
    root.get("on")
        .and_then(|on| on.as_object())
        .map(|on| on.contains_key("workflow_dispatch"))
        .unwrap_or(false)
}

/// Перевіряє `tauri.conf.json` одного застосунку на updater-готовність
/// bundle-секції — точний порт `checkTauriConf` (`main.mjs:51-96`). Помилка
/// читання файлу трактується як помилка парсингу JSON (той самий видимий
/// ефект, що й JS: `await readFile(...)` усередині одного `try` з
/// `JSON.parse`, тож обидва класи помилок ловить один і той самий `catch`).
fn check_tauri_conf(app: &TauriApp, cwd: &Path, violations: &mut Vec<Violation>) {
    let rel = relative_posix(cwd, &app.tauri_conf_path);

    let conf: serde_json::Value = match std::fs::read_to_string(&app.tauri_conf_path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
    {
        Some(v) => v,
        None => {
            violations.push(Violation {
                reason: "tauri-conf-invalid-json".to_string(),
                message: format!("{rel}: не вдалося розпарсити JSON (tauri.mdc release)"),
                file: Some(rel),
                severity: Severity::Error,
                data: None,
            });
            return;
        }
    };

    let create_updater_artifacts = conf
        .get("bundle")
        .and_then(|b| b.get("createUpdaterArtifacts"))
        .and_then(|v| v.as_bool())
        == Some(true);
    if !create_updater_artifacts {
        violations.push(Violation {
            reason: "updater-artifacts-disabled".to_string(),
            message: format!(
                "{rel}: bundle.createUpdaterArtifacts має бути true — інакше release-білд не публікує updater-артефакти (tauri.mdc release)"
            ),
            file: Some(rel.clone()),
            severity: Severity::Error,
            data: None,
        });
    }

    let pubkey = conf
        .get("plugins")
        .and_then(|p| p.get("updater"))
        .and_then(|u| u.get("pubkey"))
        .and_then(|v| v.as_str());
    let has_pubkey = pubkey.map(|s| !s.trim().is_empty()).unwrap_or(false);
    if !has_pubkey {
        violations.push(Violation {
            reason: "updater-pubkey-missing".to_string(),
            message: format!(
                "{rel}: plugins.updater.pubkey відсутній — автооновлення не запуститься без публічного ключа (tauri.mdc release)"
            ),
            file: Some(rel.clone()),
            severity: Severity::Error,
            data: None,
        });
    }

    let endpoints = conf
        .get("plugins")
        .and_then(|p| p.get("updater"))
        .and_then(|u| u.get("endpoints"))
        .and_then(|e| e.as_array());
    let has_latest_json_endpoint = endpoints
        .map(|arr| {
            arr.iter().any(|e| {
                e.as_str()
                    .map(|s| s.ends_with("/releases/latest/download/latest.json"))
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false);
    if !has_latest_json_endpoint {
        violations.push(Violation {
            reason: "updater-endpoint-missing".to_string(),
            message: format!(
                "{rel}: plugins.updater.endpoints має містити \".../releases/latest/download/latest.json\" (tauri.mdc release)"
            ),
            file: Some(rel),
            severity: Severity::Error,
            data: None,
        });
    }
}

/// Перевіряє `changelog-release.yml`: тригер на change-файли, guard від
/// release-циклу, права, push-auth — точний порт
/// `checkChangelogReleaseWorkflow` (`main.mjs:105-190`).
fn check_changelog_release_workflow(
    cwd: &Path,
    apps: &[TauriApp],
    violations: &mut Vec<Violation>,
) {
    let path = cwd.join(CHANGELOG_RELEASE_WORKFLOW);
    if !path.exists() {
        violations.push(Violation {
            reason: "changelog-release-workflow-missing".to_string(),
            message: format!(
                "{CHANGELOG_RELEASE_WORKFLOW} відсутній — канонічний release-flow вимагає push-тригер на <app>/.changes/** (tauri.mdc release)"
            ),
            file: Some(CHANGELOG_RELEASE_WORKFLOW.to_string()),
            severity: Severity::Error,
            data: None,
        });
        return;
    }
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return;
    };
    let Some(root) = parse_workflow_yaml(&raw) else {
        violations.push(Violation {
            reason: "changelog-release-workflow-invalid-yaml".to_string(),
            message: format!(
                "{CHANGELOG_RELEASE_WORKFLOW}: YAML не вдалося розібрати (tauri.mdc release)"
            ),
            file: Some(CHANGELOG_RELEASE_WORKFLOW.to_string()),
            severity: Severity::Error,
            data: None,
        });
        return;
    };

    let paths = root
        .get("on")
        .and_then(|on| on.get("push"))
        .and_then(|p| p.get("paths"))
        .and_then(|p| p.as_array());
    let expected_suffixes: Vec<String> = apps
        .iter()
        .map(|a| {
            let prefix = if a.ws == "." {
                String::new()
            } else {
                format!("{}/", a.ws)
            };
            format!("{prefix}.changes/**")
        })
        .collect();
    let has_changes_path = paths
        .map(|arr| {
            expected_suffixes
                .iter()
                .any(|suffix| arr.iter().any(|p| p.as_str() == Some(suffix.as_str())))
        })
        .unwrap_or(false);
    if !has_changes_path {
        violations.push(Violation {
            reason: "changelog-release-paths-missing".to_string(),
            message: format!(
                "{CHANGELOG_RELEASE_WORKFLOW}: on.push.paths має містити \"<app>/.changes/**\" (tauri.mdc release, n-changelog.mdc)"
            ),
            file: Some(CHANGELOG_RELEASE_WORKFLOW.to_string()),
            severity: Severity::Error,
            data: None,
        });
    }

    if !has_workflow_dispatch(&root) {
        violations.push(Violation {
            reason: "changelog-release-no-dispatch".to_string(),
            message: format!(
                "{CHANGELOG_RELEASE_WORKFLOW}: бракує workflow_dispatch: {{}} (tauri.mdc release)"
            ),
            file: Some(CHANGELOG_RELEASE_WORKFLOW.to_string()),
            severity: Severity::Error,
            data: None,
        });
    }

    let jobs: Vec<&serde_json::Value> = root
        .get("jobs")
        .and_then(|j| j.as_object())
        .map(|o| o.values().collect())
        .unwrap_or_default();

    let has_release_guard = jobs.iter().any(|job| {
        job.get("if")
            .and_then(|g| g.as_str())
            .map(|g| g.contains("head_commit.message") && g.contains("release:"))
            .unwrap_or(false)
    });
    if !has_release_guard {
        violations.push(Violation {
            reason: "changelog-release-no-guard".to_string(),
            message: format!(
                "{CHANGELOG_RELEASE_WORKFLOW}: job без guard \"!startsWith(github.event.head_commit.message, 'release:')\" — ризик циклу (tauri.mdc release)"
            ),
            file: Some(CHANGELOG_RELEASE_WORKFLOW.to_string()),
            severity: Severity::Error,
            data: None,
        });
    }

    let has_write_permissions = jobs.iter().any(|job| {
        let permissions = job.get("permissions");
        permissions
            .and_then(|p| p.get("contents"))
            .and_then(|v| v.as_str())
            == Some("write")
            && permissions
                .and_then(|p| p.get("actions"))
                .and_then(|v| v.as_str())
                == Some("write")
    });
    if !has_write_permissions {
        violations.push(Violation {
            reason: "changelog-release-permissions-missing".to_string(),
            message: format!(
                "{CHANGELOG_RELEASE_WORKFLOW}: job має мати permissions.contents: write і permissions.actions: write (для dispatch release.yml) (tauri.mdc release)"
            ),
            file: Some(CHANGELOG_RELEASE_WORKFLOW.to_string()),
            severity: Severity::Error,
            data: None,
        });
    }

    // ga-канон тримає persist-credentials: false на checkout, тож
    // `n-rules release`/`git push` у джобі мовчки відхиляється без явного
    // push-auth через job-scoped GITHUB_TOKEN у remote-url.
    let has_push_auth = flatten_workflow_steps(&root).iter().any(|s| {
        let run = get_step_run(&s.step);
        run.contains("remote set-url") && run.contains("x-access-token")
    });
    if !has_push_auth {
        violations.push(Violation {
            reason: "changelog-release-push-auth-missing".to_string(),
            message: format!(
                "{CHANGELOG_RELEASE_WORKFLOW}: бракує кроку push-auth `{PUSH_AUTH_SNIPPET}` — checkout з persist-credentials: false не лишає токена, і release-push мовчки падає (tauri.mdc release)"
            ),
            file: Some(CHANGELOG_RELEASE_WORKFLOW.to_string()),
            severity: Severity::Error,
            data: None,
        });
    }
}

/// Перевіряє `<ws>/.changes/.gitkeep` — точний порт `checkChangesGitkeep`
/// (`main.mjs:201-213`): тригер `on.push.paths: <ws>/.changes/**` живе лише
/// доки glob матчить бодай один tracked-файл, а після релізу каталог
/// порожніє — без `.gitkeep` два канони конфліктують.
fn check_changes_gitkeep(cwd: &Path, apps: &[TauriApp], violations: &mut Vec<Violation>) {
    for app in apps {
        let rel = if app.ws == "." {
            ".changes/.gitkeep".to_string()
        } else {
            format!("{}/.changes/.gitkeep", app.ws)
        };
        if !cwd.join(&rel).exists() {
            violations.push(Violation {
                reason: "changes-gitkeep-missing".to_string(),
                message: format!(
                    "{rel} відсутній — після релізу .changes/ порожніє і on.push.paths glob перестає матчити tracked-файли (ga/workflows unmatched-paths-glob) (tauri.mdc release)"
                ),
                file: Some(rel.clone()),
                severity: Severity::Error,
                data: None,
            });
        }
    }
}

/// Перевіряє `release.yml`: тригер на теги, dispatch, sync версії перед
/// `tauri-action`, zizmor-приглушення rust-cache — точний порт
/// `checkReleaseWorkflow` (`main.mjs:221-295`).
fn check_release_workflow(cwd: &Path, violations: &mut Vec<Violation>) {
    let path = cwd.join(RELEASE_WORKFLOW);
    if !path.exists() {
        violations.push(Violation {
            reason: "release-workflow-missing".to_string(),
            message: format!(
                "{RELEASE_WORKFLOW} відсутній — build/publish DMG й updater-артефактів вимагає канонічний release.yml (tauri.mdc release)"
            ),
            file: Some(RELEASE_WORKFLOW.to_string()),
            severity: Severity::Error,
            data: None,
        });
        return;
    }
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return;
    };
    let Some(root) = parse_workflow_yaml(&raw) else {
        violations.push(Violation {
            reason: "release-workflow-invalid-yaml".to_string(),
            message: format!("{RELEASE_WORKFLOW}: YAML не вдалося розібрати (tauri.mdc release)"),
            file: Some(RELEASE_WORKFLOW.to_string()),
            severity: Severity::Error,
            data: None,
        });
        return;
    };

    let tags = root
        .get("on")
        .and_then(|on| on.get("push"))
        .and_then(|p| p.get("tags"))
        .and_then(|t| t.as_array());
    let has_tag_trigger = tags
        .map(|arr| arr.iter().any(|t| t.as_str() == Some("v*")))
        .unwrap_or(false);
    if !has_tag_trigger {
        violations.push(Violation {
            reason: "release-workflow-no-tag-trigger".to_string(),
            message: format!(
                "{RELEASE_WORKFLOW}: on.push.tags має містити \"v*\" (tauri.mdc release)"
            ),
            file: Some(RELEASE_WORKFLOW.to_string()),
            severity: Severity::Error,
            data: None,
        });
    }

    if !has_workflow_dispatch(&root) {
        violations.push(Violation {
            reason: "release-workflow-no-dispatch".to_string(),
            message: format!(
                "{RELEASE_WORKFLOW}: бракує workflow_dispatch: {{}} — без нього changelog-release.yml не може викликати dispatch білда (tauri.mdc release)"
            ),
            file: Some(RELEASE_WORKFLOW.to_string()),
            severity: Severity::Error,
            data: None,
        });
    }

    let all_steps = flatten_workflow_steps(&root);
    // `[...new Set(allSteps.map(s => s.jobId))]` (`main.mjs:261`) — Set
    // JS зберігає порядок першого входження, тож тут — ручний
    // first-seen-order dedup, не сортування.
    let mut job_ids: Vec<String> = Vec::new();
    for s in &all_steps {
        if !job_ids.contains(&s.job_id) {
            job_ids.push(s.job_id.clone());
        }
    }
    for job_id in &job_ids {
        let steps: Vec<&FlatStep> = all_steps.iter().filter(|s| &s.job_id == job_id).collect();
        let Some(action_idx) = steps
            .iter()
            .position(|s| get_step_uses(&s.step).starts_with("tauri-apps/tauri-action"))
        else {
            continue;
        };
        let sync_idx = steps.iter().position(|s| {
            let run = get_step_run(&s.step);
            run.contains("tauri.conf.json") && run.to_lowercase().contains("version")
        });
        let sync_before_action = sync_idx.map(|si| si < action_idx).unwrap_or(false);
        if !sync_before_action {
            violations.push(Violation {
                reason: "release-workflow-version-sync-order".to_string(),
                message: format!(
                    "{RELEASE_WORKFLOW}: job \"{job_id}\" — крок sync версії в tauri.conf.json з тегу має йти перед tauri-apps/tauri-action (tauri.mdc release)"
                ),
                file: Some(RELEASE_WORKFLOW.to_string()),
                severity: Severity::Error,
                data: None,
            });
        }
    }

    // rust/toolchain_cache вимагає Swatinem/rust-cache після rust-toolchain, а
    // zizmor (ga/workflows) фейлить cache-poisoning high для кешу в
    // тег-тригереному release — канон розв'язки: inline-приглушення.
    // Коментарі не живуть у розпарсеному YAML, тож перевірка по сирих рядках.
    let unsuppressed_cache = raw.lines().any(|line| {
        line.contains("Swatinem/rust-cache") && !line.contains("zizmor: ignore[cache-poisoning]")
    });
    if unsuppressed_cache {
        violations.push(Violation {
            reason: "release-workflow-rust-cache-zizmor".to_string(),
            message: format!(
                "{RELEASE_WORKFLOW}: рядок із Swatinem/rust-cache без \"# zizmor: ignore[cache-poisoning]\" — zizmor (ga/workflows) фейлить cache-poisoning у тег-тригереному release, а rust-канон вимагає кеш (tauri.mdc release)"
            ),
            file: Some(RELEASE_WORKFLOW.to_string()),
            severity: Severity::Error,
            data: None,
        });
    }
}

/// Detector `tauri/release` — точний порт `lint(ctx)` (`main.mjs:301-317`).
/// Без жодного `tauri.conf.json` у монорепо — silent skip (правило не про
/// Tauri-проєкт).
pub fn tauri_release(cwd: &Path) -> Vec<Violation> {
    let apps = find_tauri_app_dirs(cwd);
    if apps.is_empty() {
        return Vec::new();
    }

    let mut violations = Vec::new();
    for app in &apps {
        check_tauri_conf(app, cwd, &mut violations);
    }
    check_changes_gitkeep(cwd, &apps, &mut violations);
    check_changelog_release_workflow(cwd, &apps, &mut violations);
    check_release_workflow(cwd, &mut violations);

    violations
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    use crate::concerns::test_support::write;

    const CHANGELOG_RELEASE_YML: &str = "on:
  push:
    branches: [main]
    paths:
      - 'app/.changes/**'
  workflow_dispatch: {}
jobs:
  release:
    if: \"!startsWith(github.event.head_commit.message, 'release:')\"
    permissions:
      contents: write
      actions: write
    steps:
      - uses: actions/checkout@v6
      - name: Configure git identity + push auth
        run: |
          git config user.name \"github-actions[bot]\"
          git remote set-url origin \"https://x-access-token:${{ secrets.GITHUB_TOKEN }}@github.com/${{ github.repository }}.git\"
      - run: npx @7n/rules release
";

    const RELEASE_YML: &str = "on:
  push:
    tags: ['v*']
  workflow_dispatch: {}
jobs:
  build-desktop:
    steps:
      - name: Sync app version from tag
        run: |
          VER=\"${GITHUB_REF_NAME#v}\"
          node -e \"sync tauri.conf.json version\"
      - uses: tauri-apps/tauri-action@v0
";

    fn tauri_conf_json() -> String {
        serde_json::json!({
            "bundle": { "createUpdaterArtifacts": true },
            "plugins": {
                "updater": {
                    "pubkey": "abc123",
                    "endpoints": ["https://github.com/owner/repo/releases/latest/download/latest.json"]
                }
            }
        })
        .to_string()
    }

    struct Proj {
        dir: TempDir,
    }

    impl Proj {
        fn path(&self) -> &Path {
            self.dir.path()
        }
    }

    /// Опції для [`make_proj`] — дзеркало параметрів `makeProj` (`release.test.mjs:71-76`).
    struct MakeProjOpts<'a> {
        no_tauri: bool,
        tauri_conf: &'a str,
        changelog_release_yml: Option<&'a str>,
        release_yml: Option<&'a str>,
    }

    impl<'a> Default for MakeProjOpts<'a> {
        fn default() -> Self {
            MakeProjOpts {
                no_tauri: false,
                tauri_conf: "__DEFAULT__",
                changelog_release_yml: Some("__DEFAULT__"),
                release_yml: Some("__DEFAULT__"),
            }
        }
    }

    fn make_proj(opts: MakeProjOpts) -> Proj {
        let tmp = TempDir::new().unwrap();
        if opts.no_tauri {
            return Proj { dir: tmp };
        }
        let default_conf = tauri_conf_json();
        let tauri_conf = if opts.tauri_conf == "__DEFAULT__" {
            default_conf.as_str()
        } else {
            opts.tauri_conf
        };
        write(&tmp, "package.json", r#"{"workspaces":["app"]}"#);
        write(
            &tmp,
            "app/package.json",
            r#"{"name":"app","version":"0.0.0"}"#,
        );
        write(&tmp, "app/src-tauri/tauri.conf.json", tauri_conf);
        write(&tmp, "app/.changes/.gitkeep", "");
        match opts.changelog_release_yml {
            Some("__DEFAULT__") => write(&tmp, CHANGELOG_RELEASE_WORKFLOW, CHANGELOG_RELEASE_YML),
            Some(content) => write(&tmp, CHANGELOG_RELEASE_WORKFLOW, content),
            None => {}
        }
        match opts.release_yml {
            Some("__DEFAULT__") => write(&tmp, RELEASE_WORKFLOW, RELEASE_YML),
            Some(content) => write(&tmp, RELEASE_WORKFLOW, content),
            None => {}
        }
        Proj { dir: tmp }
    }

    // --- дзеркало `describe('tauri release concern', ...)` ---

    #[test]
    fn no_tauri_conf_json_is_silent_skip() {
        let proj = make_proj(MakeProjOpts {
            no_tauri: true,
            ..Default::default()
        });
        assert!(tauri_release(proj.path()).is_empty());
    }

    #[test]
    fn canonical_layout_is_clean() {
        let proj = make_proj(MakeProjOpts::default());
        assert!(tauri_release(proj.path()).is_empty());
    }

    #[test]
    fn missing_create_updater_artifacts_is_violation() {
        let conf = serde_json::json!({ "bundle": {}, "plugins": tauri_conf_json() }).to_string();
        let proj = make_proj(MakeProjOpts {
            tauri_conf: &conf,
            ..Default::default()
        });
        let violations = tauri_release(proj.path());
        assert!(violations
            .iter()
            .any(|v| v.reason == "updater-artifacts-disabled"));
    }

    #[test]
    fn missing_pubkey_is_violation() {
        let conf = serde_json::json!({
            "bundle": { "createUpdaterArtifacts": true },
            "plugins": { "updater": { "endpoints": ["https://github.com/o/r/releases/latest/download/latest.json"] } }
        })
        .to_string();
        let proj = make_proj(MakeProjOpts {
            tauri_conf: &conf,
            ..Default::default()
        });
        let violations = tauri_release(proj.path());
        assert!(violations
            .iter()
            .any(|v| v.reason == "updater-pubkey-missing"));
    }

    #[test]
    fn endpoints_without_latest_json_is_violation() {
        let conf = serde_json::json!({
            "bundle": { "createUpdaterArtifacts": true },
            "plugins": { "updater": { "pubkey": "abc", "endpoints": ["https://example.com/other.json"] } }
        })
        .to_string();
        let proj = make_proj(MakeProjOpts {
            tauri_conf: &conf,
            ..Default::default()
        });
        let violations = tauri_release(proj.path());
        assert!(violations
            .iter()
            .any(|v| v.reason == "updater-endpoint-missing"));
    }

    #[test]
    fn missing_changelog_release_yml_is_violation() {
        let proj = make_proj(MakeProjOpts {
            changelog_release_yml: None,
            ..Default::default()
        });
        let violations = tauri_release(proj.path());
        assert!(violations
            .iter()
            .any(|v| v.reason == "changelog-release-workflow-missing"));
    }

    #[test]
    fn changelog_release_yml_without_changes_path_is_violation() {
        let broken = CHANGELOG_RELEASE_YML.replace("- 'app/.changes/**'", "- 'app/other/**'");
        let proj = make_proj(MakeProjOpts {
            changelog_release_yml: Some(&broken),
            ..Default::default()
        });
        let violations = tauri_release(proj.path());
        assert!(violations
            .iter()
            .any(|v| v.reason == "changelog-release-paths-missing"));
    }

    #[test]
    fn changelog_release_yml_without_guard_is_violation() {
        let broken = CHANGELOG_RELEASE_YML.replace(
            "    if: \"!startsWith(github.event.head_commit.message, 'release:')\"\n",
            "",
        );
        let proj = make_proj(MakeProjOpts {
            changelog_release_yml: Some(&broken),
            ..Default::default()
        });
        let violations = tauri_release(proj.path());
        assert!(violations
            .iter()
            .any(|v| v.reason == "changelog-release-no-guard"));
    }

    #[test]
    fn changelog_release_yml_without_actions_write_is_violation() {
        let broken = CHANGELOG_RELEASE_YML.replace("      actions: write\n", "");
        let proj = make_proj(MakeProjOpts {
            changelog_release_yml: Some(&broken),
            ..Default::default()
        });
        let violations = tauri_release(proj.path());
        assert!(violations
            .iter()
            .any(|v| v.reason == "changelog-release-permissions-missing"));
    }

    #[test]
    fn missing_release_yml_is_violation() {
        let proj = make_proj(MakeProjOpts {
            release_yml: None,
            ..Default::default()
        });
        let violations = tauri_release(proj.path());
        assert!(violations
            .iter()
            .any(|v| v.reason == "release-workflow-missing"));
    }

    #[test]
    fn release_yml_without_tag_trigger_is_violation() {
        let broken = RELEASE_YML.replace("tags: ['v*']", "tags: []");
        let proj = make_proj(MakeProjOpts {
            release_yml: Some(&broken),
            ..Default::default()
        });
        let violations = tauri_release(proj.path());
        assert!(violations
            .iter()
            .any(|v| v.reason == "release-workflow-no-tag-trigger"));
    }

    #[test]
    fn release_yml_sync_after_tauri_action_is_violation() {
        let broken = "on:
  push:
    tags: ['v*']
  workflow_dispatch: {}
jobs:
  build-desktop:
    steps:
      - uses: tauri-apps/tauri-action@v0
      - name: Sync app version from tag
        run: node -e \"sync tauri.conf.json version\"
";
        let proj = make_proj(MakeProjOpts {
            release_yml: Some(broken),
            ..Default::default()
        });
        let violations = tauri_release(proj.path());
        assert!(violations
            .iter()
            .any(|v| v.reason == "release-workflow-version-sync-order"));
    }

    #[test]
    fn release_yml_without_sync_step_at_all_is_violation() {
        let broken = "on:
  push:
    tags: ['v*']
  workflow_dispatch: {}
jobs:
  build-desktop:
    steps:
      - uses: tauri-apps/tauri-action@v0
";
        let proj = make_proj(MakeProjOpts {
            release_yml: Some(broken),
            ..Default::default()
        });
        let violations = tauri_release(proj.path());
        assert!(violations
            .iter()
            .any(|v| v.reason == "release-workflow-version-sync-order"));
    }

    // --- push-auth / .gitkeep / zizmor-приглушення rust-cache ---

    #[test]
    fn no_remote_set_url_is_push_auth_missing_violation() {
        let no_auth = "on:
  push:
    branches: [main]
    paths:
      - 'app/.changes/**'
  workflow_dispatch: {}
jobs:
  release:
    if: \"!startsWith(github.event.head_commit.message, 'release:')\"
    permissions:
      contents: write
      actions: write
    steps:
      - uses: actions/checkout@v6
      - run: npx @7n/rules release
";
        let proj = make_proj(MakeProjOpts {
            changelog_release_yml: Some(no_auth),
            ..Default::default()
        });
        let violations = tauri_release(proj.path());
        assert!(violations
            .iter()
            .any(|v| v.reason == "changelog-release-push-auth-missing"));
    }

    #[test]
    fn missing_changes_gitkeep_is_violation() {
        let proj = make_proj(MakeProjOpts::default());
        fs::remove_file(proj.path().join("app/.changes/.gitkeep")).unwrap();
        let violations = tauri_release(proj.path());
        assert!(violations
            .iter()
            .any(|v| v.reason == "changes-gitkeep-missing"));
    }

    #[test]
    fn rust_cache_without_zizmor_ignore_is_violation() {
        let with_cache = "on:
  push:
    tags: ['v*']
  workflow_dispatch: {}
jobs:
  build-desktop:
    steps:
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: app/src-tauri
      - name: Sync app version from tag
        run: |
          VER=\"${GITHUB_REF_NAME#v}\"
          node -e \"sync tauri.conf.json version\"
      - uses: tauri-apps/tauri-action@v0
";
        let proj = make_proj(MakeProjOpts {
            release_yml: Some(with_cache),
            ..Default::default()
        });
        let violations = tauri_release(proj.path());
        assert!(violations
            .iter()
            .any(|v| v.reason == "release-workflow-rust-cache-zizmor"));
    }

    #[test]
    fn rust_cache_with_zizmor_ignore_is_clean() {
        let with_cache = "on:
  push:
    tags: ['v*']
  workflow_dispatch: {}
jobs:
  build-desktop:
    steps:
      - uses: Swatinem/rust-cache@v2 # zizmor: ignore[cache-poisoning]
        with:
          workspaces: app/src-tauri
      - name: Sync app version from tag
        run: |
          VER=\"${GITHUB_REF_NAME#v}\"
          node -e \"sync tauri.conf.json version\"
      - uses: tauri-apps/tauri-action@v0
";
        let proj = make_proj(MakeProjOpts {
            release_yml: Some(with_cache),
            ..Default::default()
        });
        assert!(tauri_release(proj.path()).is_empty());
    }
}
