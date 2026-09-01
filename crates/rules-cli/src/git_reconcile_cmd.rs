//! cspell:ignore worktrees ancestor Cleanupped незамерджен
//!
//! Native-ефекти скіла `git-reconcile` (`n-rules git-reconcile <verb>`) —
//! §2.136 реєстру відкритих питань, той самий патерн, що вже довів себе на
//! `taze` (§2.125): `skills/git-reconcile/js/orchestrate.mjs` (3 484 рядки)
//! знесено, а з нього лишається портованим/зведеним у текст РІВНО те, що
//! описано нижче.
//!
//! # Розподіл
//!
//! - **`inventory`** — детермінована класифікація Git-фактів (branch/stash/
//!   worktree/open-PR відносно `origin/<base>`): merged / patch-equivalent /
//!   protected / review. Лишається нативним не через обсяг, а тому що
//!   класифікація мусить бути ІДЕНТИЧНОЮ щоразу — той самий мотив, яким
//!   `taze diff` лишився недоторканим слот-диспатчем (§2.125 п.2), тільки
//!   тут порт, а не dispatch, бо це чиста Git-семантика, не ecosystem-плагін.
//! - **`cleanup`** — safe archive→verify→delete lifecycle, вимога ADR #334
//!   (PR #334, "WASM git-reconcile harness" — архітектура ADR ВІДХИЛЕНА
//!   рішенням власника 2026-09-01 на користь цього патерну, але сама ВИМОГА
//!   лишається: "локальний Git-стан не видаляється, доки його незалежна
//!   remote копія не перевірена"). Це НЕ можна звести до тексту `SKILL.md`:
//!   агент, що виконує послідовність команд сам, неминуче матиме вікно, де
//!   remote push "здається" успішним, а верифікація (remote ref існує,
//!   manifest валідний, tree відтворюється) ще не пройшла — і саме в цьому
//!   вікні LLM-агент, під тиском "далі по кроках", може передчасно
//!   видалити локальний стан. Атомарність цього переходу — точна причина,
//!   чому це верб, а не інструкція.
//! - **`gc`** — 45-денний sweep `origin/tempo/git-reconcile/*` (ADR #334,
//!   "More Information"). Dry-run за замовчуванням (`--apply` для реального
//!   видалення) — той самий fail-closed принцип: відсутній/невалідний
//!   manifest чи недоступність перевірки open-PR є причиною ПРОПУСТИТИ ref,
//!   не видаляти.
//!
//! Решта чотирьох фаз старого оркестратора (semantic triage, apply/cherry-
//! pick, scoped gates, PR create+checks-polling, фінальний звіт) —
//! ПОСЛІДОВНІ кроки, які агент виконує сам за текстом `SKILL.md`, тим самим
//! `git`/`gh`, який він і так має в робочому worktree: жодної обгортки не
//! потрібно, бо це не atomic-critical операції, а звичайний git-flow, що й
//! так є щоденною роботою агента (клас, симетричний до кроків 2/4-6 `taze`).
//!
//! # Чому porcelain (`std::process::Command`), не `gix`
//!
//! ADR #334 називав `gix` частиною цільової архітектури, але сама
//! архітектура (WASM harness) відхилена. `crates/rules-core::changed_base`
//! і `mt-core/src/git/compat.rs` вже встановили прецедент: porcelain —
//! ДОЗВОЛЕНА capability для операцій, яких `gix` 0.86 не покриває
//! (worktree/stash/remote push/`commit-tree`/`mktree` plumbing тут — весь
//! набір), а не загальний "просто спавнимо шелл". `mktree`/`hash-object`/
//! `commit-tree` — Git plumbing, не shell-логіка: побудова archive-дерева
//! точна й тестована так само, як були б виклики `gix::ObjectDb`.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::process::ExitCode;

use chrono::{DateTime, Duration, Utc};
use rules_core::worktree::sanitize_name;
use serde_json::{json, Value};

use crate::cli::{
    GitReconcileCleanupArgs, GitReconcileGcArgs, GitReconcileInventoryArgs, GitReconcileKind,
};

/// Друкує помилку в stderr і повертає код невдачі — той самий формат, що
/// `skill_cmd::fail`.
fn fail(message: &str) -> ExitCode {
    eprintln!("❌ {message}");
    ExitCode::FAILURE
}

fn cwd() -> Result<PathBuf, String> {
    std::env::current_dir().map_err(|error| format!("немає робочої директорії: {error}"))
}

/// Виконує `git <args>` у `cwd`, повертає trim-нутий stdout. Ненульовий exit
/// або spawn-фейл → `Err` із stderr (fail-closed — на відміну від
/// `changed_files::git_lines`, тут це продуктивна команда з реальними
/// побічними ефектами, мовчазне ковтання помилки неприйнятне).
fn run_git(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .current_dir(cwd)
        .args(args)
        .output()
        .map_err(|error| format!("git {args:?}: не вдалося запустити ({error})"))?;
    if !output.status.success() {
        return Err(format!(
            "git {args:?}: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// `run_git`, але зі stdin (для `hash-object -w --stdin`, `mktree`).
fn run_git_stdin(cwd: &Path, args: &[&str], stdin: &[u8]) -> Result<String, String> {
    use std::io::Write as _;
    let mut child = Command::new("git")
        .current_dir(cwd)
        .args(args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| format!("git {args:?}: не вдалося запустити ({error})"))?;
    child
        .stdin
        .take()
        .expect("stdin piped")
        .write_all(stdin)
        .map_err(|error| format!("git {args:?}: не вдалося записати stdin ({error})"))?;
    let output = child
        .wait_with_output()
        .map_err(|error| format!("git {args:?}: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "git {args:?}: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// `git <args>`, читає лише exit-код: `0` → `Ok(true)`, `1` → `Ok(false)`,
/// інакше `Err` (не-git-репо, spawn-фейл тощо) — для `--is-ancestor`/
/// `diff --quiet`, де exit-код НЕСЕ семантику, а не лише «вдалось/ні».
fn git_bool(cwd: &Path, args: &[&str]) -> Result<bool, String> {
    let status = Command::new("git")
        .current_dir(cwd)
        .args(args)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map_err(|error| format!("git {args:?}: не вдалося запустити ({error})"))?;
    match status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => Err(format!("git {args:?}: неочікуваний exit {status}")),
    }
}

/// Найкращий за зусиллями виклик `gh` — відсутність тула чи мережева
/// помилка не є фатальними: викликачі трактують `None` як "не вдалось
/// перевірити" (fail-closed на боці GC/inventory, не тут).
fn run_gh(cwd: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("gh").current_dir(cwd).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

// ────────────────────────── inventory ──────────────────────────

pub fn run_inventory(args: &GitReconcileInventoryArgs) -> ExitCode {
    let cwd = match cwd() {
        Ok(cwd) => cwd,
        Err(message) => return fail(&message),
    };
    let base = args.base.clone().unwrap_or_else(|| "main".to_string());
    match inventory_report(&cwd, &base) {
        Ok(report) => {
            println!(
                "{}",
                serde_json::to_string_pretty(&report).unwrap_or_default()
            );
            ExitCode::SUCCESS
        }
        Err(message) => fail(&message),
    }
}

struct WorktreeEntry {
    path: String,
    branch: Option<String>,
}

fn parse_worktrees(raw: &str) -> Vec<WorktreeEntry> {
    let mut entries = Vec::new();
    let mut path: Option<String> = None;
    let mut branch: Option<String> = None;
    for line in raw.lines() {
        if let Some(value) = line.strip_prefix("worktree ") {
            if let Some(previous_path) = path.take() {
                entries.push(WorktreeEntry {
                    path: previous_path,
                    branch: branch.take(),
                });
            }
            path = Some(value.to_string());
        } else if let Some(value) = line.strip_prefix("branch ") {
            branch = Some(value.trim_start_matches("refs/heads/").to_string());
        }
    }
    if let Some(path) = path {
        entries.push(WorktreeEntry { path, branch });
    }
    entries
}

fn open_pull_requests(cwd: &Path) -> Option<Vec<Value>> {
    let raw = run_gh(
        cwd,
        &[
            "pr",
            "list",
            "--state",
            "open",
            "--json",
            "number,headRefName,url",
        ],
    )?;
    serde_json::from_str::<Vec<Value>>(&raw).ok()
}

fn inventory_report(cwd: &Path, base: &str) -> Result<Value, String> {
    run_git(cwd, &["fetch", "origin", base])?;
    let base_ref = format!("origin/{base}");
    let current_branch = run_git(cwd, &["rev-parse", "--abbrev-ref", "HEAD"]).ok();

    let worktrees = parse_worktrees(&run_git(cwd, &["worktree", "list", "--porcelain"])?);
    let prs = open_pull_requests(cwd);
    let prs_checked = prs.is_some();
    let prs = prs.unwrap_or_default();

    let branches_raw = run_git(
        cwd,
        &[
            "for-each-ref",
            "--format=%(refname:short)%09%(objectname)",
            "refs/heads/",
        ],
    )?;
    let mut branches = Vec::new();
    for line in branches_raw.lines() {
        let Some((name, oid)) = line.split_once('\t') else {
            continue;
        };
        let is_ancestor = git_bool(
            cwd,
            &["merge-base", "--is-ancestor", oid, &base_ref],
        )
        .unwrap_or(false);
        let patch_equivalent = !is_ancestor
            && git_bool(cwd, &["diff", "--quiet", &base_ref, oid]).unwrap_or(false);
        let live_worktree = worktrees
            .iter()
            .find(|entry| entry.branch.as_deref() == Some(name));
        let open_pr = prs
            .iter()
            .find(|pr| pr.get("headRefName").and_then(Value::as_str) == Some(name));
        let is_current = current_branch.as_deref() == Some(name);

        let state = if is_ancestor {
            "merged"
        } else if patch_equivalent {
            "patch-equivalent"
        } else if live_worktree.is_some() || open_pr.is_some() || is_current {
            "protected"
        } else {
            "review"
        };

        branches.push(json!({
            "name": name,
            "oid": oid,
            "state": state,
            "mergedIntoBase": is_ancestor,
            "patchEquivalent": patch_equivalent,
            "liveWorktree": live_worktree.map(|entry| &entry.path),
            "openPr": open_pr.and_then(|pr| pr.get("url")).and_then(Value::as_str),
            "current": is_current,
        }));
    }

    let stashes_raw = run_git(
        cwd,
        &["stash", "list", "--format=%gd%09%H%09%gs"],
    )
    .unwrap_or_default();
    let mut stashes = Vec::new();
    for line in stashes_raw.lines() {
        let mut parts = line.splitn(3, '\t');
        let (Some(reference), Some(oid), Some(subject)) =
            (parts.next(), parts.next(), parts.next())
        else {
            continue;
        };
        let patch_equivalent =
            git_bool(cwd, &["diff", "--quiet", &base_ref, oid]).unwrap_or(false);
        let state = if patch_equivalent {
            "patch-equivalent"
        } else {
            "review"
        };
        stashes.push(json!({
            "ref": reference,
            "oid": oid,
            "subject": subject,
            "state": state,
            "patchEquivalent": patch_equivalent,
        }));
    }

    Ok(json!({
        "base": base,
        "baseRef": base_ref,
        "currentBranch": current_branch,
        "branches": branches,
        "stashes": stashes,
        "worktrees": worktrees.iter().map(|entry| json!({
            "path": entry.path,
            "branch": entry.branch,
        })).collect::<Vec<_>>(),
        "openPrsChecked": prs_checked,
    }))
}

// ────────────────────────── cleanup (archive → verify → delete) ──────────────────────────

const ARCHIVE_SCHEMA_VERSION: u32 = 1;
const ARCHIVE_RETENTION_DAYS: i64 = 45;

fn kind_str(kind: GitReconcileKind) -> &'static str {
    match kind {
        GitReconcileKind::Branch => "branch",
        GitReconcileKind::Stash => "stash",
    }
}

pub fn run_cleanup(args: &GitReconcileCleanupArgs) -> ExitCode {
    match cwd() {
        Ok(cwd) => run_cleanup_at(&cwd, args),
        Err(message) => fail(&message),
    }
}

/// `run_cleanup`, параметризований `cwd` — окремо, щоб тести НЕ мутували
/// process-wide `std::env::set_current_dir` (небезпечно під паралельними
/// `cargo test`-потоками того самого бінаря).
fn run_cleanup_at(cwd: &Path, args: &GitReconcileCleanupArgs) -> ExitCode {
    let base = args.base.clone().unwrap_or_else(|| "main".to_string());
    let reason = args
        .reason
        .clone()
        .unwrap_or_else(|| "git-reconcile cleanup".to_string());

    let oid = match args.kind {
        GitReconcileKind::Branch => {
            run_git(&cwd, &["rev-parse", &format!("refs/heads/{}", args.source)])
        }
        GitReconcileKind::Stash => run_git(&cwd, &["rev-parse", &args.source]),
    };
    let oid = match oid {
        Ok(oid) => oid,
        Err(message) => return fail(&format!("{}: {message}", args.source)),
    };

    if let Err(message) = run_git(&cwd, &["fetch", "origin", &base]) {
        return fail(&message);
    }
    let base_ref = format!("origin/{base}");

    if args.no_archive {
        let merged = git_bool(&cwd, &["merge-base", "--is-ancestor", &oid, &base_ref])
            .unwrap_or(false);
        let equivalent =
            merged || git_bool(&cwd, &["diff", "--quiet", &base_ref, &oid]).unwrap_or(false);
        if !equivalent {
            return fail(&format!(
                "{}: --no-archive вимагає merged або patch-equivalent проти {base_ref} — kept",
                args.source
            ));
        }
        if args.dry_run {
            println!(
                "{}",
                json!({"source": args.source, "action": "would-delete-no-archive"})
            );
            return ExitCode::SUCCESS;
        }
        return match delete_source(&cwd, args.kind, &args.source) {
            Ok(()) => {
                println!(
                    "{}",
                    json!({"source": args.source, "action": "deleted-no-archive"})
                );
                ExitCode::SUCCESS
            }
            Err(message) => fail(&message),
        };
    }

    match archive_and_verify(
        &cwd,
        &oid,
        kind_str(args.kind),
        &args.source,
        &reason,
        args.dry_run,
    ) {
        Ok(mut record) => {
            if args.dry_run {
                println!("{}", record);
                return ExitCode::SUCCESS;
            }
            match delete_source(&cwd, args.kind, &args.source) {
                Ok(()) => {
                    record["deleted"] = json!(true);
                    println!("{}", record);
                    ExitCode::SUCCESS
                }
                Err(message) => fail(&format!(
                    "{}: архів верифіковано ({}), але локальне видалення провалилось — {message}",
                    args.source, record["ref"]
                )),
            }
        }
        Err(message) => fail(&format!("{}: kept — {message}", args.source)),
    }
}

fn delete_source(cwd: &Path, kind: GitReconcileKind, source: &str) -> Result<(), String> {
    match kind {
        GitReconcileKind::Branch => run_git(cwd, &["branch", "-D", source]).map(|_| ()),
        GitReconcileKind::Stash => run_git(cwd, &["stash", "drop", source]).map(|_| ()),
    }
}

/// Archive→verify lifecycle, ADR #334. Повертає JSON-запис `{ref, commit,
/// manifest, restore}` ЛИШЕ якщо push і верифікація пройшли; будь-яка
/// помилка на будь-якому кроці — `Err`, і КОЖЕН такий шлях у [`run_cleanup`]
/// не доходить до локального видалення (fail-closed за конструкцією
/// функції, не за домовленістю виклику).
fn archive_and_verify(
    cwd: &Path,
    oid: &str,
    kind: &str,
    source_name: &str,
    reason: &str,
    dry_run: bool,
) -> Result<Value, String> {
    let short = &oid[..oid.len().min(12)];
    let slug = sanitize_name(source_name);
    let date = Utc::now().format("%Y-%m-%d").to_string();
    let archive_branch = format!("tempo/git-reconcile/{date}/{kind}-{slug}-{short}");
    let restore = format!("git switch --track origin/{archive_branch}");

    let base_tree = run_git(cwd, &[&format!("rev-parse"), &format!("{oid}^{{tree}}")])?;
    let root_entries: Vec<String> = run_git(cwd, &["ls-tree", &base_tree])?
        .lines()
        .filter(|line| !line.ends_with("\t.git-reconcile") && !line.ends_with("\tARCHIVE.md"))
        .map(str::to_string)
        .collect();

    let created_at = Utc::now();
    let delete_after = created_at + Duration::days(ARCHIVE_RETENTION_DAYS);
    let manifest = json!({
        "schemaVersion": ARCHIVE_SCHEMA_VERSION,
        "kind": kind,
        "source": { "ref": source_name, "oid": oid },
        "reason": reason,
        "createdAt": created_at.to_rfc3339(),
        "deleteAfter": delete_after.to_rfc3339(),
        "restore": restore,
    });
    let manifest_text = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
    let archive_md = format!(
        "# Archived by git-reconcile\n\nSource: `{source_name}` ({kind})\nOID: `{oid}`\nReason: {reason}\nDelete after: {}\n\nRestore:\n\n```\n{restore}\n```\n",
        delete_after.to_rfc3339()
    );

    let manifest_blob = run_git_stdin(cwd, &["hash-object", "-w", "--stdin"], manifest_text.as_bytes())?;
    let subtree = run_git_stdin(
        cwd,
        &["mktree"],
        format!("100644 blob {manifest_blob}\tarchive.json\n").as_bytes(),
    )?;
    let archive_md_blob = run_git_stdin(cwd, &["hash-object", "-w", "--stdin"], archive_md.as_bytes())?;

    let mut new_tree_input = root_entries.join("\n");
    if !new_tree_input.is_empty() {
        new_tree_input.push('\n');
    }
    new_tree_input.push_str(&format!("040000 tree {subtree}\t.git-reconcile\n"));
    new_tree_input.push_str(&format!("100644 blob {archive_md_blob}\tARCHIVE.md\n"));
    let new_tree = run_git_stdin(cwd, &["mktree"], new_tree_input.as_bytes())?;

    let commit_message = format!("archive({kind}): {source_name} — {reason}");
    let metadata_commit = run_git(
        cwd,
        &["commit-tree", &new_tree, "-p", oid, "-m", &commit_message],
    )?;

    if dry_run {
        return Ok(json!({
            "wouldArchive": archive_branch,
            "commit": metadata_commit,
            "manifest": manifest,
            "restore": restore,
        }));
    }

    run_git(
        cwd,
        &[
            "push",
            "origin",
            &format!("{metadata_commit}:refs/heads/{archive_branch}"),
        ],
    )?;

    // Верифікація: remote ref фізично існує НА ОЧІКУВАНОМУ commit, і його
    // tree byte-точно збігається з тим, що ми щойно побудували — сильніша
    // гарантія за "чекаутиться без помилки", бо порівнює саме те дерево, яке
    // ми хотіли архівувати, не будь-яке валідне дерево.
    let remote_oid = run_git(
        cwd,
        &["ls-remote", "origin", &format!("refs/heads/{archive_branch}")],
    )?;
    let remote_oid = remote_oid
        .split_whitespace()
        .next()
        .ok_or_else(|| format!("{archive_branch}: origin не повернув oid — verify провалено"))?;
    if remote_oid != metadata_commit {
        return Err(format!(
            "{archive_branch}: origin має {remote_oid}, очікували {metadata_commit} — verify провалено"
        ));
    }
    run_git(cwd, &["fetch", "origin", &format!("refs/heads/{archive_branch}")])?;
    let fetched_tree = run_git(cwd, &["rev-parse", "FETCH_HEAD^{tree}"])?;
    if fetched_tree != new_tree {
        return Err(format!(
            "{archive_branch}: fetched tree {fetched_tree} != {new_tree} — verify провалено"
        ));
    }

    Ok(json!({
        "archived": true,
        "ref": archive_branch,
        "commit": metadata_commit,
        "manifest": manifest,
        "restore": restore,
    }))
}

// ────────────────────────── gc (45-денний sweep) ──────────────────────────

pub fn run_gc(args: &GitReconcileGcArgs) -> ExitCode {
    let cwd = match cwd() {
        Ok(cwd) => cwd,
        Err(message) => return fail(&message),
    };
    let now = match args.now.as_deref().map(DateTime::parse_from_rfc3339) {
        Some(Ok(parsed)) => parsed.with_timezone(&Utc),
        Some(Err(error)) => return fail(&format!("--now: {error}")),
        None => Utc::now(),
    };
    match gc_report(&cwd, now, args.apply) {
        Ok(report) => {
            println!(
                "{}",
                serde_json::to_string_pretty(&report).unwrap_or_default()
            );
            ExitCode::SUCCESS
        }
        Err(message) => fail(&message),
    }
}

fn gc_report(cwd: &Path, now: DateTime<Utc>, apply: bool) -> Result<Value, String> {
    run_git(cwd, &["fetch", "origin", "--prune"])?;
    let refs_raw = run_git(
        cwd,
        &[
            "for-each-ref",
            "--format=%(refname)",
            "refs/remotes/origin/tempo/git-reconcile/",
        ],
    )?;

    let mut swept = Vec::new();
    let mut kept = Vec::new();
    for remote_ref in refs_raw.lines() {
        let Some(branch) = remote_ref.strip_prefix("refs/remotes/origin/") else {
            continue;
        };
        let heads_ref = format!("refs/heads/{branch}");
        let manifest_text = run_git(
            cwd,
            &["show", &format!("{remote_ref}:.git-reconcile/archive.json")],
        );
        let Ok(manifest_text) = manifest_text else {
            kept.push(json!({"ref": branch, "reason": "manifest відсутній/недоступний"}));
            continue;
        };
        let Ok(manifest) = serde_json::from_str::<Value>(&manifest_text) else {
            kept.push(json!({"ref": branch, "reason": "manifest не парситься"}));
            continue;
        };
        let schema_ok = manifest.get("schemaVersion").and_then(Value::as_u64)
            == Some(u64::from(ARCHIVE_SCHEMA_VERSION));
        let delete_after = manifest
            .get("deleteAfter")
            .and_then(Value::as_str)
            .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
            .map(|value| value.with_timezone(&Utc));
        let Some(delete_after) = delete_after else {
            kept.push(json!({"ref": branch, "reason": "deleteAfter відсутній/невалідний"}));
            continue;
        };
        if !schema_ok {
            kept.push(json!({"ref": branch, "reason": "невідома schemaVersion"}));
            continue;
        }
        if now < delete_after {
            kept.push(json!({"ref": branch, "reason": "deleteAfter ще не настав", "deleteAfter": delete_after.to_rfc3339()}));
            continue;
        }
        let source_ref = manifest
            .get("source")
            .and_then(|source| source.get("ref"))
            .and_then(Value::as_str);
        let referenced_by_open_pr = source_ref.is_some_and(|source_ref| {
            open_pull_requests(cwd)
                .map(|prs| {
                    prs.iter().any(|pr| {
                        pr.get("headRefName").and_then(Value::as_str) == Some(source_ref)
                    })
                })
                .unwrap_or(true) // gh недоступний → не можемо виключити open PR → keep
        });
        if referenced_by_open_pr {
            kept.push(json!({"ref": branch, "reason": "джерело досі має open PR або перевірка недоступна"}));
            continue;
        }

        if apply {
            run_git(cwd, &["push", "origin", "--delete", &heads_ref])?;
        }
        swept.push(json!({"ref": branch, "manifest": manifest, "applied": apply}));
    }

    Ok(json!({
        "now": now.to_rfc3339(),
        "apply": apply,
        "swept": swept,
        "kept": kept,
    }))
}

#[cfg(test)]
mod tests {
    use std::process::Command;

    use tempfile::TempDir;

    use super::*;

    fn git(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .status()
            .unwrap_or_else(|error| panic!("git {args:?}: {error}"));
        assert!(status.success(), "git {args:?} failed у {}", dir.display());
    }

    fn git_out(dir: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .output()
            .unwrap();
        assert!(output.status.success(), "git {args:?} failed");
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    /// Bare remote + клон з одним комітом на `main`, `origin` уже
    /// прив'язаний — той самий setup-мотив, що `worktree::tests::init_repo`,
    /// плюс реальний remote (локальний шлях), бо cleanup/gc пушать.
    fn init_repo_with_remote() -> (TempDir, TempDir) {
        let remote = TempDir::new().unwrap();
        git(remote.path(), &["init", "--quiet", "--bare"]);

        let work = TempDir::new().unwrap();
        git(work.path(), &["init", "--quiet", "--initial-branch=main"]);
        git(work.path(), &["config", "user.name", "test"]);
        git(work.path(), &["config", "user.email", "test@localhost"]);
        std::fs::write(work.path().join("README.md"), "x").unwrap();
        git(work.path(), &["add", "-A"]);
        git(work.path(), &["commit", "--quiet", "-m", "init"]);
        git(
            work.path(),
            &["remote", "add", "origin", remote.path().to_str().unwrap()],
        );
        git(work.path(), &["push", "-q", "origin", "main"]);
        (remote, work)
    }

    // ── inventory ──

    #[test]
    fn inventory_classifies_merged_and_review_branches() {
        let (_remote, work) = init_repo_with_remote();

        git(work.path(), &["checkout", "-q", "-b", "merged-branch"]);
        git(work.path(), &["checkout", "-q", "main"]);
        git(work.path(), &["merge", "-q", "--no-ff", "-m", "merge", "merged-branch"]);
        git(work.path(), &["push", "-q", "origin", "main"]);

        git(work.path(), &["checkout", "-q", "-b", "review-branch"]);
        std::fs::write(work.path().join("new.txt"), "y").unwrap();
        git(work.path(), &["add", "-A"]);
        git(work.path(), &["commit", "-q", "-m", "unrelated work"]);
        git(work.path(), &["checkout", "-q", "main"]);

        let report = inventory_report(work.path(), "main").unwrap();
        let branches = report["branches"].as_array().unwrap();
        let merged = branches
            .iter()
            .find(|branch| branch["name"] == "merged-branch")
            .unwrap();
        assert_eq!(merged["state"], "merged");
        let review = branches
            .iter()
            .find(|branch| branch["name"] == "review-branch")
            .unwrap();
        assert_eq!(review["state"], "review");
    }

    #[test]
    fn inventory_protects_branch_with_live_worktree() {
        let (_remote, work) = init_repo_with_remote();
        git(work.path(), &["checkout", "-q", "-b", "wt-branch"]);
        // Унікальний, немерджений коміт: без нього гілка тривіально
        // "merged" (той самий tip, що origin/main), і `state` ніколи не
        // дійде до гілки worktree-протекції — те, що ця перевірка й тестує.
        std::fs::write(work.path().join("wt.txt"), "z").unwrap();
        git(work.path(), &["add", "-A"]);
        git(work.path(), &["commit", "-q", "-m", "wt work"]);
        git(work.path(), &["checkout", "-q", "main"]);
        let wt_path = work.path().join("wt");
        git(
            work.path(),
            &[
                "worktree",
                "add",
                wt_path.to_str().unwrap(),
                "wt-branch",
            ],
        );

        let report = inventory_report(work.path(), "main").unwrap();
        let branch = report["branches"]
            .as_array()
            .unwrap()
            .iter()
            .find(|branch| branch["name"] == "wt-branch")
            .unwrap();
        assert_eq!(branch["state"], "protected");
    }

    // ── archive_and_verify / cleanup ──

    #[test]
    fn archive_and_verify_pushes_manifest_and_reproduces_tree() {
        let (remote, work) = init_repo_with_remote();
        git(work.path(), &["checkout", "-q", "-b", "feature/orphan"]);
        std::fs::write(work.path().join("orphan.txt"), "z").unwrap();
        git(work.path(), &["add", "-A"]);
        git(work.path(), &["commit", "-q", "-m", "orphan work"]);
        let oid = git_out(work.path(), &["rev-parse", "feature/orphan"]);
        git(work.path(), &["checkout", "-q", "main"]);

        let record = archive_and_verify(
            work.path(),
            &oid,
            "branch",
            "feature/orphan",
            "stale, no open PR",
            false,
        )
        .unwrap();

        assert_eq!(record["archived"], true);
        let archive_ref = record["ref"].as_str().unwrap();
        assert!(archive_ref.starts_with("tempo/git-reconcile/"));
        assert!(archive_ref.ends_with(&format!("branch-feature-orphan-{}", &oid[..12])));

        // Remote справді має цей ref і manifest відповідає реальному oid.
        let remote_manifest = Command::new("git")
            .arg("-C")
            .arg(remote.path())
            .args(["show", &format!("{archive_ref}:.git-reconcile/archive.json")])
            .output()
            .unwrap();
        assert!(remote_manifest.status.success());
        let manifest: Value =
            serde_json::from_slice(&remote_manifest.stdout).unwrap();
        assert_eq!(manifest["source"]["oid"], oid);
        assert_eq!(manifest["schemaVersion"], 1);
    }

    #[test]
    fn cleanup_deletes_local_branch_only_after_verified_archive() {
        let (_remote, work) = init_repo_with_remote();
        git(work.path(), &["checkout", "-q", "-b", "feature/gone"]);
        std::fs::write(work.path().join("gone.txt"), "z").unwrap();
        git(work.path(), &["add", "-A"]);
        git(work.path(), &["commit", "-q", "-m", "gone work"]);
        git(work.path(), &["checkout", "-q", "main"]);

        let args = GitReconcileCleanupArgs {
            source: "feature/gone".to_string(),
            kind: GitReconcileKind::Branch,
            reason: Some("test cleanup".to_string()),
            base: Some("main".to_string()),
            no_archive: false,
            dry_run: false,
        };
        let code = run_cleanup_at(work.path(), &args);
        assert_eq!(code, ExitCode::SUCCESS);

        let branches = git_out(work.path(), &["branch", "--list", "feature/gone"]);
        assert!(branches.is_empty(), "гілку мали видалити локально");
    }

    #[test]
    fn cleanup_no_archive_refuses_unmerged_source() {
        let (_remote, work) = init_repo_with_remote();
        git(work.path(), &["checkout", "-q", "-b", "feature/unmerged"]);
        std::fs::write(work.path().join("unmerged.txt"), "z").unwrap();
        git(work.path(), &["add", "-A"]);
        git(work.path(), &["commit", "-q", "-m", "unmerged work"]);
        git(work.path(), &["checkout", "-q", "main"]);

        let args = GitReconcileCleanupArgs {
            source: "feature/unmerged".to_string(),
            kind: GitReconcileKind::Branch,
            reason: None,
            base: Some("main".to_string()),
            no_archive: true,
            dry_run: false,
        };
        let code = run_cleanup_at(work.path(), &args);
        assert_eq!(code, ExitCode::FAILURE);

        let branches = git_out(work.path(), &["branch", "--list", "feature/unmerged"]);
        assert!(
            !branches.is_empty(),
            "--no-archive без merged/patch-equivalent не мав видаляти локально"
        );
    }

    // ── gc ──

    #[test]
    fn gc_dry_run_keeps_expired_archive_without_apply() {
        let (_remote, work) = init_repo_with_remote();
        git(work.path(), &["checkout", "-q", "-b", "feature/expired"]);
        std::fs::write(work.path().join("expired.txt"), "z").unwrap();
        git(work.path(), &["add", "-A"]);
        git(work.path(), &["commit", "-q", "-m", "expired work"]);
        let oid = git_out(work.path(), &["rev-parse", "feature/expired"]);
        git(work.path(), &["checkout", "-q", "main"]);

        let record = archive_and_verify(
            work.path(),
            &oid,
            "branch",
            "feature/expired",
            "old",
            false,
        )
        .unwrap();
        let archive_ref = record["ref"].as_str().unwrap().to_string();

        // "Зараз" — через 46 днів після архівації: за межею 45-денного TTL.
        let future = Utc::now() + Duration::days(46);
        let report = gc_report(work.path(), future, false).unwrap();
        let swept = report["swept"].as_array().unwrap();
        let kept = report["kept"].as_array().unwrap();
        // Куди саме потрапляє прострочений архів залежить від того, чи
        // `gh` у sandbox доступний і автентифікований: якщо так — open-PR
        // перевірка проходить (немає PR на `feature/expired`) і запис іде у
        // `swept`; якщо `gh` недоступний/неавтентифікований —
        // `open_pull_requests` повертає `None`, і fail-closed гілка ADR #334
        // ("недоступність перевірки — причина `keep`, не delete") лишає
        // запис у `kept`. Обидва — коректна поведінка; тест перевіряє САМЕ
        // dry-run інваріант (нижче), а не який із двох шляхів обрав sandbox.
        assert!(
            swept.iter().any(|entry| entry["ref"] == archive_ref)
                || kept.iter().any(|entry| entry["ref"] == archive_ref),
            "прострочений архів мав з'явитись або у swept, або у kept (fail-closed без `gh`): {report}"
        );

        // Dry-run: ref і досі існує на remote (`--apply` не передавали) —
        // це справджується НЕЗАЛЕЖНО від того, який із двох шляхів вище
        // спрацював.

        let still_there = git_out(
            work.path(),
            &["ls-remote", "origin", &format!("refs/heads/{archive_ref}")],
        );
        assert!(!still_there.is_empty(), "dry-run не мав нічого видаляти");
    }

    #[test]
    fn gc_keeps_fresh_archive() {
        let (_remote, work) = init_repo_with_remote();
        git(work.path(), &["checkout", "-q", "-b", "feature/fresh"]);
        std::fs::write(work.path().join("fresh.txt"), "z").unwrap();
        git(work.path(), &["add", "-A"]);
        git(work.path(), &["commit", "-q", "-m", "fresh work"]);
        let oid = git_out(work.path(), &["rev-parse", "feature/fresh"]);
        git(work.path(), &["checkout", "-q", "main"]);

        archive_and_verify(work.path(), &oid, "branch", "feature/fresh", "new", false).unwrap();

        let report = gc_report(work.path(), Utc::now(), false).unwrap();
        let kept = report["kept"].as_array().unwrap();
        assert!(
            kept.iter().any(|entry| entry["reason"] == "deleteAfter ще не настав"),
            "свіжий архів мав лишитись kept: {kept:?}"
        );
    }
}
