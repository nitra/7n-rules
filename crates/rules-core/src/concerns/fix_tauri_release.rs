//! T0-фікси концерну `tauri/release` — порт пʼятьох патернів
//! `npm/rules/tauri/release/fix-release.mjs`.
//!
//! # Чому цей файл зʼявився лише тепер
//!
//! Концерн роками стояв у секції «Свідомо НЕ портовані» доккоментаря
//! [`super::fix`] із трьома причинами. Дві з них до цієї хвилі застаріли, а
//! третя виявилась вужчою, ніж записано:
//!
//! 1. **«Rust-екосистема не має format-preserving YAML-редактора»** —
//!    хибно від §2.71: `rules_template_merge::try_surgical_merge` саме це й
//!    робить (коментарі, порядок ключів і стиль лишаються на місці), і його
//!    вже беруть обидві колії міграції.
//! 2. **«`resolveGithubOwnerRepo` спавнить `git remote get-url origin` —
//!    процесна дія поза мандатом чистого плану»** — знімається на КРАЩЕ:
//!    [`github_owner_repo`] читає `.git/config`, тобто файл, а не процес.
//!    Побічно зникає й залежність від того, чи є `git` у `PATH`.
//! 3. **Позиційна вставка кроку** — оце було справжнім блокером, але лише
//!    для ДВОХ патернів із пʼятьох. Закрито
//!    `rules_template_merge::try_surgical_seq_insert`.
//!
//! Загальна фраза «патерни редагують YAML через Document API» була правдою
//! про два патерни, а блокувала всі пʼять: `release-tauri-conf-canon`
//! (чистий JSON), `release-changes-gitkeep` (створення порожніх файлів) і
//! `release-rust-cache-zizmor-ignore` (порядкова текстова заміна) у YAML не
//! впираються взагалі.
//!
//! # Чому порт — усе або нічого
//!
//! Спокуса портувати три легкі патерни й лишити два хибна: `loadT0Patterns`
//! повертає РІВНО native-патерн, щойно ключ зʼявляється в
//! [`super::fix::NATIVE_FIXES`], і JS-канон затінюється цілком. Часткова
//! реєстрація тихо втратила б два патерни — рівно той мовчазний пропуск,
//! проти якого й будується цей контур.
//!
//! # Свідомі відхилення від канону
//!
//! 1. **Ключі, які фікс ДОПИСУЄ в чужий workflow, виходять у лапках**
//!    (`- "name": …`) — наявна поведінка `yaml_key` спільного крейта,
//!    однакова з рештою фіксерів, що пишуть у консюмерські workflow. YAML
//!    валідний; наявні рядки не переписуються.
//! 2. **Побитий `tauri.conf.json` — гучна помилка, а не тихий пропуск.**
//!    Канон робив `catch { continue }`, тобто «файл не змінено», що не
//!    відрізнити від «усе вже гаразд».
//! 3. **Недосяжний хірургічний шлях — теж гучна помилка**, а не мовчазна
//!    повна регенерація YAML: втрата коментарів у ЧУЖОМУ workflow-файлі має
//!    бути видимою, а не побічним ефектом.

use std::path::Path;

use rules_contract::fix::{FileEdit, FixPlan, WriteFile};
use rules_template_merge::{Format, Json, try_surgical_merge, try_surgical_seq_insert};

use crate::RulesError;
use crate::diagnostics::Violation;

use super::gha_workflow::{flatten_workflow_steps, get_step_run, get_step_uses, parse_workflow_yaml};
use super::tauri_release::{
    CHANGELOG_RELEASE_WORKFLOW, PUSH_AUTH_SNIPPET, RELEASE_WORKFLOW, TauriApp,
    find_tauri_app_dirs, has_workflow_dispatch,
};

/// Канонічний крок синхронізації git-ідентичності й push-токена.
const PUSH_AUTH_STEP_NAME: &str = "Configure git identity + push auth";
/// Канонічний крок синхронізації версії застосунку з тега.
const VERSION_SYNC_STEP_NAME: &str = "Sync app version from tag";

fn has_reason(violations: &[Violation], reasons: &[&str]) -> bool {
    violations
        .iter()
        .any(|v| reasons.contains(&v.reason.as_str()))
}

fn rel(cwd: &Path, path: &Path) -> String {
    path.strip_prefix(cwd)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

/// `owner/repo` з `.git/config` — заміна канонічного
/// `git remote get-url origin`.
///
/// Читання файлу, а не спавн процесу: план лишається чистим, і фікс
/// перестає залежати від наявності `git` у `PATH`. Розбирається та сама
/// пара форм (https і ssh), що канонічний `GITHUB_REMOTE_RE`.
fn github_owner_repo(cwd: &Path) -> Option<(String, String)> {
    let config = std::fs::read_to_string(cwd.join(".git").join("config")).ok()?;
    let mut in_origin = false;
    for line in config.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            in_origin = trimmed.replace(' ', "") == "[remote\"origin\"]";
            continue;
        }
        if !in_origin {
            continue;
        }
        let Some(url) = trimmed.strip_prefix("url") else {
            continue;
        };
        let url = url.trim_start().strip_prefix('=')?.trim();
        return parse_github_remote(url);
    }
    None
}

/// Порт `GITHUB_REMOTE_RE` — `github.com[:/]<owner>/<repo>[.git]`.
fn parse_github_remote(url: &str) -> Option<(String, String)> {
    let idx = url.find("github.com")?;
    let rest = &url[idx + "github.com".len()..];
    let rest = rest.strip_prefix(':').or_else(|| rest.strip_prefix('/'))?;
    let (owner, repo) = rest.split_once('/')?;
    let repo = repo.strip_suffix(".git").unwrap_or(repo);
    if owner.is_empty() || repo.is_empty() {
        return None;
    }
    Some((owner.to_string(), repo.to_string()))
}

/// Доповнює `tauri.conf.json` канонічними updater-полями.
///
/// `pubkey` не чіпається — реальний ключ підпису не генерується.
fn tauri_conf_edits(cwd: &Path, apps: &[TauriApp]) -> Result<Vec<FileEdit>, RulesError> {
    let owner_repo = github_owner_repo(cwd);
    let mut edits = Vec::new();
    for app in apps {
        let raw = std::fs::read_to_string(&app.tauri_conf_path).map_err(|e| {
            RulesError::Concern(format!(
                "tauri/release: {} не читається: {e}",
                rel(cwd, &app.tauri_conf_path)
            ))
        })?;
        let mut conf: serde_json::Value = serde_json::from_str(&raw).map_err(|e| {
            RulesError::Concern(format!(
                "tauri/release: {} — невалідний JSON: {e}",
                rel(cwd, &app.tauri_conf_path)
            ))
        })?;
        let mut changed = false;

        if conf.pointer("/bundle/createUpdaterArtifacts") != Some(&serde_json::Value::Bool(true)) {
            ensure_object(&mut conf, &["bundle"])?.insert(
                "createUpdaterArtifacts".to_string(),
                serde_json::Value::Bool(true),
            );
            changed = true;
        }

        let endpoints = conf.pointer("/plugins/updater/endpoints");
        let has_latest = endpoints.and_then(|e| e.as_array()).is_some_and(|arr| {
            arr.iter().any(|e| {
                e.as_str()
                    .is_some_and(|s| s.ends_with("/releases/latest/download/latest.json"))
            })
        });
        if !has_latest {
            if let Some((owner, repo)) = owner_repo.as_ref() {
            let endpoint = format!(
                "https://github.com/{owner}/{repo}/releases/latest/download/latest.json"
            );
            let mut list = endpoints
                .and_then(|e| e.as_array())
                .cloned()
                .unwrap_or_default();
            list.push(serde_json::Value::String(endpoint));
            ensure_object(&mut conf, &["plugins", "updater"])?
                .insert("endpoints".to_string(), serde_json::Value::Array(list));
            changed = true;
            }
        }

        if !changed {
            continue;
        }
        let content = format!(
            "{}\n",
            serde_json::to_string_pretty(&conf).map_err(|e| RulesError::Concern(format!(
                "tauri/release: серіалізація {} не вдалась: {e}",
                rel(cwd, &app.tauri_conf_path)
            )))?
        );
        edits.push(FileEdit::Write(WriteFile {
            path: rel(cwd, &app.tauri_conf_path),
            content,
        }));
    }
    Ok(edits)
}

/// Дістає (створюючи за потреби) вкладену мапу за шляхом ключів.
fn ensure_object<'a>(
    root: &'a mut serde_json::Value,
    path: &[&str],
) -> Result<&'a mut serde_json::Map<String, serde_json::Value>, RulesError> {
    let mut node = root;
    for key in path {
        if !node.is_object() {
            *node = serde_json::Value::Object(serde_json::Map::new());
        }
        node = node
            .as_object_mut()
            .expect("щойно нормалізовано в обʼєкт")
            .entry((*key).to_string())
            .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
    }
    if !node.is_object() {
        *node = serde_json::Value::Object(serde_json::Map::new());
    }
    node.as_object_mut()
        .ok_or_else(|| RulesError::Concern("tauri/release: очікувався обʼєкт".to_string()))
}

/// `.changes/.gitkeep` для кожного Tauri-застосунку.
fn changes_gitkeep_edits(cwd: &Path, apps: &[TauriApp]) -> Vec<FileEdit> {
    apps.iter()
        .filter_map(|app| {
            let rel_path = if app.ws == "." {
                ".changes/.gitkeep".to_string()
            } else {
                format!("{}/.changes/.gitkeep", app.ws)
            };
            if cwd.join(&rel_path).exists() {
                return None;
            }
            Some(FileEdit::Write(WriteFile {
                path: rel_path,
                content: String::new(),
            }))
        })
        .collect()
}

/// `# zizmor: ignore[cache-poisoning]` на рядках `Swatinem/rust-cache`.
///
/// Порядкова текстова трансформація — коментарі не живуть у розпарсеному
/// YAML, тож і в каноні це не Document API.
fn rust_cache_zizmor_edit(cwd: &Path) -> Option<FileEdit> {
    let path = cwd.join(RELEASE_WORKFLOW);
    let raw = std::fs::read_to_string(&path).ok()?;
    let mut changed = false;
    let next: Vec<String> = raw
        .split('\n')
        .map(|line| {
            if !line.contains("Swatinem/rust-cache")
                || line.contains("zizmor: ignore[cache-poisoning]")
            {
                return line.to_string();
            }
            changed = true;
            format!("{} # zizmor: ignore[cache-poisoning]", line.trim_end())
        })
        .collect();
    if !changed {
        return None;
    }
    Some(FileEdit::Write(WriteFile {
        path: RELEASE_WORKFLOW.to_string(),
        content: next.join("\n"),
    }))
}

/// Хірургічний мерж або гучна помилка — мовчазної повної регенерації
/// (втрата коментарів у чужому workflow) тут свідомо немає.
fn merge_or_fail(content: &str, snippet: &Json, file: &str) -> Result<String, RulesError> {
    try_surgical_merge(content, snippet, Format::Yaml).ok_or_else(|| {
        RulesError::Concern(format!(
            "tauri/release: {file} — хірургічний мерж недосяжний; \
             повна регенерація знищила б коментарі чужого workflow, тож фікс зупиняється"
        ))
    })
}

fn insert_or_fail(
    content: &str,
    path: &[&str],
    index: usize,
    value: &Json,
    file: &str,
) -> Result<String, RulesError> {
    try_surgical_seq_insert(content, path, index, value, Format::Yaml).ok_or_else(|| {
        RulesError::Concern(format!(
            "tauri/release: {file} — не вдалося вставити крок на позицію {index} \
             зі збереженням форматування; фікс зупиняється замість перезапису файла"
        ))
    })
}

fn obj(entries: Vec<(&str, Json)>) -> Json {
    Json::Object(
        entries
            .into_iter()
            .map(|(k, v)| (k.to_string(), v))
            .collect(),
    )
}

/// Доповнює `changelog-release.yml` канонічними ключами.
fn changelog_release_edit(cwd: &Path, apps: &[TauriApp]) -> Result<Option<FileEdit>, RulesError> {
    let path = cwd.join(CHANGELOG_RELEASE_WORKFLOW);
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return Ok(None);
    };
    let Some(root) = parse_workflow_yaml(&raw) else {
        return Ok(None);
    };
    let mut content = raw.clone();

    let expected: Vec<String> = apps
        .iter()
        .map(|a| {
            if a.ws == "." {
                ".changes/**".to_string()
            } else {
                format!("{}/.changes/**", a.ws)
            }
        })
        .collect();
    let existing_paths: Vec<String> = root
        .pointer("/on/push/paths")
        .and_then(|p| p.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    if let Some(first) = expected.first().filter(|_| !expected.iter().any(|e| existing_paths.contains(e)))
    {
        content = merge_or_fail(
            &content,
            &obj(vec![(
                "on",
                obj(vec![(
                    "push",
                    obj(vec![("paths", Json::Array(vec![Json::Str(first.clone())]))]),
                )]),
            )]),
            CHANGELOG_RELEASE_WORKFLOW,
        )?;
    }

    if !has_workflow_dispatch(&root) {
        content = merge_or_fail(
            &content,
            &obj(vec![("on", obj(vec![("workflow_dispatch", obj(vec![]))]))]),
            CHANGELOG_RELEASE_WORKFLOW,
        )?;
    }

    let job_ids: Vec<String> = root
        .get("jobs")
        .and_then(|j| j.as_object())
        .map(|j| j.keys().cloned().collect())
        .unwrap_or_default();
    let Some(target) = job_ids.first().cloned() else {
        return finish(raw, content, CHANGELOG_RELEASE_WORKFLOW);
    };

    let guarded = job_ids.iter().any(|id| {
        root.pointer(&format!("/jobs/{id}/if"))
            .and_then(|g| g.as_str())
            .is_some_and(|g| g.contains("head_commit.message") && g.contains("release:"))
    });
    if !guarded {
        content = merge_or_fail(
            &content,
            &obj(vec![(
                "jobs",
                Json::Object(vec![(
                    target.clone(),
                    obj(vec![(
                        "if",
                        Json::Str(
                            "!startsWith(github.event.head_commit.message, 'release:')".to_string(),
                        ),
                    )]),
                )]),
            )]),
            CHANGELOG_RELEASE_WORKFLOW,
        )?;
    }

    let has_permissions = job_ids.iter().any(|id| {
        root.pointer(&format!("/jobs/{id}/permissions/contents"))
            .and_then(|c| c.as_str())
            == Some("write")
            && root
                .pointer(&format!("/jobs/{id}/permissions/actions"))
                .and_then(|c| c.as_str())
                == Some("write")
    });
    if !has_permissions {
        content = merge_or_fail(
            &content,
            &obj(vec![(
                "jobs",
                Json::Object(vec![(
                    target.clone(),
                    obj(vec![(
                        "permissions",
                        obj(vec![
                            ("contents", Json::Str("write".to_string())),
                            ("actions", Json::Str("write".to_string())),
                        ]),
                    )]),
                )]),
            )]),
            CHANGELOG_RELEASE_WORKFLOW,
        )?;
    }

    let all_steps = flatten_workflow_steps(&root);
    let has_push_auth = all_steps.iter().any(|s| {
        let run = get_step_run(&s.step);
        run.contains("remote set-url") && run.contains("x-access-token")
    });
    if !has_push_auth {
        let job_steps: Vec<_> = all_steps.iter().filter(|s| s.job_id == target).collect();
        if !job_steps.is_empty() {
            let idx = job_steps
                .iter()
                .position(|s| !get_step_run(&s.step).is_empty())
                .unwrap_or(job_steps.len());
            let run = format!(
                "git config user.name \"github-actions[bot]\"\n\
                 git config user.email \"github-actions[bot]@users.noreply.github.com\"\n\
                 {PUSH_AUTH_SNIPPET}"
            );
            content = insert_or_fail(
                &content,
                &["jobs", &target, "steps"],
                idx,
                &obj(vec![
                    ("name", Json::Str(PUSH_AUTH_STEP_NAME.to_string())),
                    ("run", Json::Str(run)),
                ]),
                CHANGELOG_RELEASE_WORKFLOW,
            )?;
        }
    }

    finish(raw, content, CHANGELOG_RELEASE_WORKFLOW)
}

fn finish(raw: String, content: String, path: &str) -> Result<Option<FileEdit>, RulesError> {
    if content == raw {
        return Ok(None);
    }
    Ok(Some(FileEdit::Write(WriteFile {
        path: path.to_string(),
        content,
    })))
}

/// Доповнює `release.yml` канонічними ключами й кроком синхронізації версії.
fn release_workflow_edit(cwd: &Path, apps: &[TauriApp]) -> Result<Option<FileEdit>, RulesError> {
    let path = cwd.join(RELEASE_WORKFLOW);
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return Ok(None);
    };
    let Some(root) = parse_workflow_yaml(&raw) else {
        return Ok(None);
    };
    let mut content = raw.clone();

    let has_tag = root
        .pointer("/on/push/tags")
        .and_then(|t| t.as_array())
        .is_some_and(|arr| arr.iter().any(|v| v.as_str() == Some("v*")));
    if !has_tag {
        content = merge_or_fail(
            &content,
            &obj(vec![(
                "on",
                obj(vec![(
                    "push",
                    obj(vec![("tags", Json::Array(vec![Json::Str("v*".to_string())]))]),
                )]),
            )]),
            RELEASE_WORKFLOW,
        )?;
    }

    if !has_workflow_dispatch(&root) {
        content = merge_or_fail(
            &content,
            &obj(vec![("on", obj(vec![("workflow_dispatch", obj(vec![]))]))]),
            RELEASE_WORKFLOW,
        )?;
    }

    let all_steps = flatten_workflow_steps(&root);
    let mut job_ids: Vec<String> = Vec::new();
    for s in &all_steps {
        if !job_ids.contains(&s.job_id) {
            job_ids.push(s.job_id.clone());
        }
    }
    let conf_rel = apps
        .first()
        .map(|a| rel(cwd, &a.tauri_conf_path))
        .unwrap_or_else(|| "src-tauri/tauri.conf.json".to_string());

    for job_id in job_ids {
        let steps: Vec<_> = all_steps.iter().filter(|s| s.job_id == job_id).collect();
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
        if sync_idx.is_some_and(|i| i < action_idx) {
            continue;
        }
        let run = format!(
            "VER=\"${{GITHUB_REF_NAME#v}}\"\n\
             node -e \"const fs=require('fs');const f='{conf_rel}';\
             const c=JSON.parse(fs.readFileSync(f));c.version=process.argv[1];\
             fs.writeFileSync(f,JSON.stringify(c,null,2)+'\\n')\" \"$VER\""
        );
        content = insert_or_fail(
            &content,
            &["jobs", &job_id, "steps"],
            action_idx,
            &obj(vec![
                ("name", Json::Str(VERSION_SYNC_STEP_NAME.to_string())),
                ("run", Json::Str(run)),
            ]),
            RELEASE_WORKFLOW,
        )?;
    }

    finish(raw, content, RELEASE_WORKFLOW)
}

/// Native-обгортка концерну: пʼять канонічних `test()`-предикатів стають
/// пʼятьма гілками одного плану.
///
/// # Errors
///
/// Повертає помилку, коли `tauri.conf.json` нечитабельний чи невалідний, або
/// коли format-preserving правка YAML недосяжна — обидва випадки в каноні
/// були тихим пропуском.
pub fn tauri_release_fix(cwd: &Path, violations: &[Violation]) -> Result<FixPlan, RulesError> {
    let mut edits: Vec<FileEdit> = Vec::new();
    let apps: Vec<TauriApp> = find_tauri_app_dirs(cwd);

    if has_reason(
        violations,
        &["updater-artifacts-disabled", "updater-endpoint-missing"],
    ) {
        edits.extend(tauri_conf_edits(cwd, &apps)?);
    }

    if has_reason(
        violations,
        &[
            "changelog-release-paths-missing",
            "changelog-release-no-dispatch",
            "changelog-release-no-guard",
            "changelog-release-permissions-missing",
            "changelog-release-push-auth-missing",
        ],
    ) {
        if let Some(edit) = changelog_release_edit(cwd, &apps)? {
            edits.push(edit);
        }
    }

    if has_reason(
        violations,
        &[
            "release-workflow-no-tag-trigger",
            "release-workflow-no-dispatch",
            "release-workflow-version-sync-order",
        ],
    ) {
        if let Some(edit) = release_workflow_edit(cwd, &apps)? {
            edits.push(edit);
        }
    }

    if has_reason(violations, &["changes-gitkeep-missing"]) {
        edits.extend(changes_gitkeep_edits(cwd, &apps));
    }

    if has_reason(violations, &["release-workflow-rust-cache-zizmor"]) {
        if let Some(edit) = rust_cache_zizmor_edit(cwd) {
            edits.push(edit);
        }
    }

    Ok(FixPlan { edits })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(reason: &str) -> Violation {
        Violation {
            reason: reason.to_string(),
            message: String::new(),
            file: None,
            severity: crate::diagnostics::Severity::Error,
            data: None,
        }
    }

    /// Мінімальний Tauri-проєкт: `package.json` (щоб workspace-обхід дав
    /// корінь), `app/src-tauri/tauri.conf.json` і потрібні workflow-файли.
    fn fixture(conf: &str, changelog: Option<&str>, release: Option<&str>) -> tempfile::TempDir {
        let tmp = tempfile::TempDir::new().unwrap();
        let root = tmp.path();
        std::fs::write(
            root.join("package.json"),
            r#"{"workspaces":["app"],"name":"root"}"#,
        )
        .unwrap();
        std::fs::create_dir_all(root.join("app").join("src-tauri")).unwrap();
        std::fs::write(root.join("app").join("package.json"), r#"{"name":"app"}"#).unwrap();
        std::fs::write(
            root.join("app").join("src-tauri").join("tauri.conf.json"),
            conf,
        )
        .unwrap();
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::write(
            root.join(".git").join("config"),
            "[remote \"origin\"]\n\turl = https://github.com/owner/repo.git\n",
        )
        .unwrap();
        let wf = root.join(".github").join("workflows");
        std::fs::create_dir_all(&wf).unwrap();
        if let Some(c) = changelog {
            std::fs::write(wf.join("changelog-release.yml"), c).unwrap();
        }
        if let Some(r) = release {
            std::fs::write(wf.join("release.yml"), r).unwrap();
        }
        tmp
    }

    fn written(plan: &FixPlan, path: &str) -> Option<String> {
        plan.edits.iter().find_map(|e| match e {
            FileEdit::Write(w) if w.path == path => Some(w.content.clone()),
            _ => None,
        })
    }

    #[test]
    fn derives_the_updater_endpoint_from_the_git_remote() {
        let tmp = fixture(
            r#"{"bundle":{"createUpdaterArtifacts":true},"plugins":{"updater":{"pubkey":"abc"}}}"#,
            None,
            None,
        );
        let plan = tauri_release_fix(tmp.path(), &[v("updater-endpoint-missing")]).unwrap();
        let conf = written(&plan, "app/src-tauri/tauri.conf.json").expect("конфіг переписано");
        assert!(
            conf.contains("https://github.com/owner/repo/releases/latest/download/latest.json"),
            "{conf}"
        );
    }

    #[test]
    fn never_fabricates_a_signing_pubkey() {
        // Канонічна межа: `pubkey` — реальний ключ підпису, і фікс, який його
        // вигадає, гірший за фікс, який нічого не робить.
        let tmp = fixture(
            r#"{"bundle":{"createUpdaterArtifacts":true},"plugins":{"updater":{"endpoints":["https://x/releases/latest/download/latest.json"]}}}"#,
            None,
            None,
        );
        let plan = tauri_release_fix(tmp.path(), &[v("updater-pubkey-missing")]).unwrap();
        assert!(
            plan.edits.is_empty(),
            "жодної правки: pubkey не фабрикується, а решта вже канонічна"
        );
    }

    #[test]
    fn augments_changelog_release_and_is_idempotent() {
        let src = "\
on:
  push: {}
jobs:
  release:
    steps:
      # коментар має вижити
      - uses: actions/checkout@v4
      - run: bun run release
";
        let tmp = fixture(
            r#"{"bundle":{"createUpdaterArtifacts":true}}"#,
            Some(src),
            None,
        );
        let plan =
            tauri_release_fix(tmp.path(), &[v("changelog-release-no-dispatch")]).unwrap();
        let out = written(&plan, CHANGELOG_RELEASE_WORKFLOW).expect("workflow переписано");
        assert!(out.contains("workflow_dispatch"), "{out}");
        assert!(out.contains("head_commit.message"), "{out}");
        assert!(out.contains("x-access-token"), "{out}");
        assert!(
            out.contains("# коментар має вижити"),
            "коментар чужого workflow знищено:\n{out}"
        );

        std::fs::write(tmp.path().join(CHANGELOG_RELEASE_WORKFLOW), &out).unwrap();
        let again =
            tauri_release_fix(tmp.path(), &[v("changelog-release-no-dispatch")]).unwrap();
        assert!(
            again.edits.is_empty(),
            "повторний прогін мусить бути порожнім, інакше фікс/детект зациклюються"
        );
    }

    #[test]
    fn puts_the_version_sync_step_before_the_tauri_action() {
        // Порядок і Є змістом цієї правки: синхронізація версії ПІСЛЯ збірки
        // не робить нічого, хоч фікс і звітував би успіх.
        let src = "\
on:
  push: {}
jobs:
  build-desktop:
    steps:
      - uses: tauri-apps/tauri-action@v0
";
        let tmp = fixture(
            r#"{"bundle":{"createUpdaterArtifacts":true}}"#,
            None,
            Some(src),
        );
        let plan =
            tauri_release_fix(tmp.path(), &[v("release-workflow-version-sync-order")]).unwrap();
        let out = written(&plan, RELEASE_WORKFLOW).expect("release.yml переписано");
        let sync = out.find("Sync app version").expect("крок вставлено");
        let action = out.find("tauri-apps/tauri-action").expect("цільовий крок");
        assert!(sync < action, "крок мусить стояти ПЕРЕД дією:\n{out}");
        assert!(out.contains("tags"), "{out}");

        std::fs::write(tmp.path().join(RELEASE_WORKFLOW), &out).unwrap();
        let again =
            tauri_release_fix(tmp.path(), &[v("release-workflow-version-sync-order")]).unwrap();
        assert!(again.edits.is_empty(), "повторний прогін нічого не змінює");
    }

    #[test]
    fn never_scaffolds_a_missing_workflow() {
        // Канон свідомо не створює workflow з нуля: правдоподібний, але
        // вигаданий шаблон гірший за явну вимогу зробити це вручну.
        let tmp = fixture(r#"{"bundle":{"createUpdaterArtifacts":true}}"#, None, None);
        let plan = tauri_release_fix(
            tmp.path(),
            &[
                v("changelog-release-no-dispatch"),
                v("release-workflow-no-tag-trigger"),
            ],
        )
        .unwrap();
        assert!(plan.edits.is_empty(), "{:?}", plan.edits);
    }

    #[test]
    fn leaves_an_unparsable_workflow_alone() {
        let tmp = fixture(
            r#"{"bundle":{"createUpdaterArtifacts":true}}"#,
            None,
            Some("on: [\nbroken"),
        );
        let plan =
            tauri_release_fix(tmp.path(), &[v("release-workflow-no-tag-trigger")]).unwrap();
        assert!(plan.edits.is_empty(), "невалідний YAML не переписується");
    }

    #[test]
    fn creates_changes_gitkeep_per_app() {
        let tmp = fixture(r#"{"bundle":{"createUpdaterArtifacts":true}}"#, None, None);
        let plan = tauri_release_fix(tmp.path(), &[v("changes-gitkeep-missing")]).unwrap();
        assert_eq!(plan.edits.len(), 1);
        assert_eq!(plan.edits[0].path(), "app/.changes/.gitkeep");
    }

    #[test]
    fn parses_both_github_remote_forms_and_rejects_others() {
        assert_eq!(
            parse_github_remote("https://github.com/nitra/7n-rules.git"),
            Some(("nitra".to_string(), "7n-rules".to_string()))
        );
        assert_eq!(
            parse_github_remote("git@github.com:nitra/7n-rules"),
            Some(("nitra".to_string(), "7n-rules".to_string()))
        );
        assert_eq!(parse_github_remote("https://gitlab.com/a/b.git"), None);
    }

    #[test]
    fn reads_owner_repo_from_git_config_without_spawning_git() {
        let tmp = tempfile::TempDir::new().unwrap();
        std::fs::create_dir_all(tmp.path().join(".git")).unwrap();
        std::fs::write(
            tmp.path().join(".git").join("config"),
            "[core]\n\turl = nope\n[remote \"origin\"]\n\turl = git@github.com:nitra/app.git\n",
        )
        .unwrap();
        assert_eq!(
            github_owner_repo(tmp.path()),
            Some(("nitra".to_string(), "app".to_string()))
        );
    }

    #[test]
    fn empty_violations_give_an_empty_plan() {
        let tmp = tempfile::TempDir::new().unwrap();
        let plan = tauri_release_fix(tmp.path(), &[]).unwrap();
        assert!(plan.edits.is_empty());
    }

    #[test]
    fn broken_tauri_conf_is_loud_not_a_silent_skip() {
        let tmp = tempfile::TempDir::new().unwrap();
        std::fs::write(tmp.path().join("package.json"), "{}").unwrap();
        std::fs::write(tmp.path().join("tauri.conf.json"), "{ broken").unwrap();
        let err = tauri_release_fix(tmp.path(), &[v("updater-artifacts-disabled")])
            .expect_err("побитий конфіг — помилка, не «нічого не змінено»");
        assert!(
            format!("{err}").contains("невалідний JSON"),
            "повідомлення має називати причину: {err}"
        );
    }

    #[test]
    fn zizmor_ignore_is_appended_once_and_is_idempotent() {
        let tmp = tempfile::TempDir::new().unwrap();
        let wf = tmp.path().join(RELEASE_WORKFLOW);
        std::fs::create_dir_all(wf.parent().unwrap()).unwrap();
        std::fs::write(&wf, "steps:\n  - uses: Swatinem/rust-cache@v2\n").unwrap();
        let plan = tauri_release_fix(tmp.path(), &[v("release-workflow-rust-cache-zizmor")]).unwrap();
        let FileEdit::Write(write) = &plan.edits[0] else {
            panic!("очікується Write")
        };
        assert!(write.content.contains("# zizmor: ignore[cache-poisoning]"));
        std::fs::write(&wf, &write.content).unwrap();
        let again =
            tauri_release_fix(tmp.path(), &[v("release-workflow-rust-cache-zizmor")]).unwrap();
        assert!(again.edits.is_empty(), "повторний прогін нічого не змінює");
    }
}
