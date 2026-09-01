//! cspell:ignore ARCHIVE tempo
//!
//! Native-verb-и `git-reconcile <archive|cleanup|gc|restore|status>` —
//! декомпозиція скіла `git-reconcile` за патерном `taze` (§2.125 реєстру
//! `docs/plans/2026-08-05-open-questions-register.md`), рішення власника
//! §7 `docs/plans/2026-08-31-full-rust-migration-plan.md` (2026-09-01).
//!
//! # Чому ЦЯ частина лишається нативною зі своїм станом, а не текстом `SKILL.md`
//!
//! Решта колишнього `orchestrate.mjs` (3 484 рядки) стала покроковими
//! інструкціями агенту в `SKILL.md`: inventory (агент читає `git branch -vv`/
//! `git worktree list`/`git stash list`/`gh pr list` напряму), semantic
//! triage й розв'язання конфліктів (агент — і є той самий LLM, що раніше
//! викликався ІЗ JS), gates і PR (агент запускає test/lint/doc-files/
//! `gh pr create` сам). Це не лягає в текст: **безпечний lifecycle
//! незворотних локальних Git-мутацій** (видалення branch/worktree/stash).
//!
//! ADR #334 (`docs/adr/260731-безпечне-віддалене-архівування-git-стану.md`,
//! 2026-07-31, НЕ змерджений) вимагає: перед будь-яким локальним видаленням
//! джерело архівується в `origin/tempo/git-reconcile/*` з окремим metadata
//! commit і перевіряється в remote; GC чистить лише власні архіви старші за
//! 45 днів. Якщо процес агента обірветься МІЖ "запушено архів" і "видалено
//! локально" — без персистентного стану наступний запуск або продублює
//! push (нешкідливо, але марно), або, гірше, видалить локальний артефакт,
//! не знаючи, чи архів справді дійшов до `origin`. Текстова інструкція
//! `SKILL.md` не може нести цей стан між ходами агента: агент читає
//! `SKILL.md` наново щоразу, файл на диску (`state.json` нижче) — може.
//! Тому [`run_archive`]/[`run_cleanup`]/[`run_gc`] лишаються тут, зі своїм
//! `<git-common-dir>/n-rules/git-reconcile/state.json` (той самий підхід
//! каталогу стану, що [`crate::tool_lock::lock_cache_dir`]), а НЕ описом
//! кроків у `SKILL.md`.
//!
//! ADR обирав ЦІЛЬОВУ архітектуру «WASM resumable orchestration harness» —
//! рішення власника (§7 плану, «Ухвалені рішення») explicitly ЦЮ частину
//! ADR відхилило: контракту `5.0.0`/WASI P3 тоді ще не було, і §2.125 вже
//! довела дешевший патерн (native CLI verb-и + текст, без WASM-harness).
//! Що з ADR ЗБЕРЕЖЕНО буквально — сам lifecycle-контракт (namespace
//! `tempo/git-reconcile/<date>/<kind>-<slug>-<sha12>`, metadata commit із
//! `.git-reconcile/archive.json` + `ARCHIVE.md`, 45-денний
//! `deleteAfter`, dry-run-за-замовчуванням GC); що НЕ збережено — сама
//! WASM-модель виконання (effects/checkpoints/resumable state machine
//! компонента) і Gix/`mt-core` як обов'язковий шар (тут — прямі виклики
//! `git`, той самий підхід, що вже використовує [`crate::tool_lock`] і
//! `rules_core::worktree` для схожих git-plumbing задач).
//!
//! # Свідомо звужено відносно ADR
//!
//! - **Stash-архів пушить сам stash-commit, не перезбирає його.** ADR каже
//!   «dirty worktree і stash спочатку materialize-иться в archive commit».
//!   `refs/stash`-запис і так є ПОВНОЦІННИМ commit-об'єктом git (найчастіше
//!   multi-parent: HEAD + index + untracked) — пушити його як є й додати ЩЕ
//!   один metadata commit зверху (той самий формат, що для branch/worktree)
//!   дає ідентичний результат («стан відтворюваний з `origin`») без
//!   переписування tree вручну. Дешевше й не менш безпечно.
//! - **Перевірка «немає open PR на цей ref» перед GC — за агентом, не за
//!   цією командою.** `tempo/git-reconcile/*`-гілки НІКОЛИ не є head
//!   PR-а за конструкцією (PR відкривається з підготовленого worktree, не з
//!   архівної гілки) — GitHub-виклик (`gh`) додав би мережеву залежність у
//!   код, що інакше працює повністю на локальному/`origin`-git. `gc`
//!   лишається dry-run-за-замовчуванням (ADR), і `--apply` — свідомий крок
//!   агента.
//! - **`cleanup` не сам вирішує "no open PR"** — SKILL.md явно каже агенту
//!   перевірити `gh pr list --head <branch>` ПЕРЕД викликом `cleanup`; сама
//!   команда лише відмовляє видаляти current-branch/worktree поточного
//!   процесу.
//!
//! `cwd` скрізь передається явно (не читається з `std::env::current_dir()`
//! усередині), як [`rules_core::worktree::create_dev_worktree`] — єдиний
//! реальний виклик з процесного cwd лишається в [`crate::main`], а тести
//! цього модуля ганяють ізольовані фікстури паралельно, без мутації
//! процес-wide робочого каталогу.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Output};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::cli::{
    GitReconcileArchiveArgs, GitReconcileCleanupArgs, GitReconcileGcArgs, GitReconcileKind,
    GitReconcileRestoreArgs, GitReconcileStatusArgs,
};

/// 45 днів (ADR `deleteAfter`), у секундах — дефолт `gc --max-age-days`.
const DEFAULT_RETENTION_DAYS: u32 = 45;

/// Один архівований запис — персистується у `state.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ArchiveRecord {
    kind: String,
    #[serde(rename = "sourceRef")]
    source_ref: String,
    #[serde(rename = "sourceOid")]
    source_oid: String,
    #[serde(rename = "archiveBranch")]
    archive_branch: String,
    #[serde(rename = "archiveSha")]
    archive_sha: String,
    #[serde(rename = "createdAtSecs")]
    created_at_secs: u64,
    #[serde(rename = "deleteAfterSecs")]
    delete_after_secs: u64,
    #[serde(rename = "cleanedLocally")]
    cleaned_locally: bool,
    reason: String,
}

/// Стан `git-reconcile`, ключ — `"<kind>:<sourceRef>"`.
#[derive(Debug, Default, Serialize, Deserialize)]
struct State {
    #[serde(default)]
    archives: BTreeMap<String, ArchiveRecord>,
}

fn state_key(kind: &str, source_ref: &str) -> String {
    format!("{kind}:{source_ref}")
}

/// Каталог стану — дзеркало [`crate::tool_lock::lock_cache_dir`]:
/// `<git-common-dir>/n-rules/git-reconcile`, спільний для головного checkout
/// і всіх linked worktree.
fn state_dir(cwd: &Path) -> PathBuf {
    let common_dir = Command::new("git")
        .arg("rev-parse")
        .arg("--git-common-dir")
        .current_dir(cwd)
        .output()
        .ok()
        .filter(|out| out.status.success())
        .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
        .filter(|dir| !dir.is_empty());
    match common_dir {
        Some(dir) => cwd.join(dir).join("n-rules").join("git-reconcile"),
        None => cwd.join(".git-reconcile-state"),
    }
}

fn state_path(cwd: &Path) -> PathBuf {
    state_dir(cwd).join("state.json")
}

fn load_state(cwd: &Path) -> State {
    std::fs::read_to_string(state_path(cwd))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save_state(cwd: &Path, state: &State) -> Result<(), String> {
    let dir = state_dir(cwd);
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("не вдалося створити {}: {error}", dir.display()))?;
    let json = serde_json::to_string_pretty(state)
        .map_err(|error| format!("state.json не серіалізується: {error}"))?;
    std::fs::write(state_path(cwd), json)
        .map_err(|error| format!("не вдалося записати state.json: {error}"))
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_secs()
}

fn run_git(cwd: &Path, args: &[&str]) -> Result<Output, String> {
    Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(args)
        .output()
        .map_err(|error| format!("git {args:?} не запустився: {error}"))
}

fn git_ok(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let out = run_git(cwd, args)?;
    if !out.status.success() {
        return Err(format!(
            "git {args:?} провалився: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn kind_str(kind: GitReconcileKind) -> &'static str {
    match kind {
        GitReconcileKind::Branch => "branch",
        GitReconcileKind::Worktree => "worktree",
        GitReconcileKind::Stash => "stash",
    }
}

fn fail(message: &str) -> ExitCode {
    eprintln!("❌ {message}");
    ExitCode::FAILURE
}

fn slugify(raw: &str) -> String {
    let mut out = String::new();
    for ch in raw.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    out.trim_matches('-').to_string()
}

/// Календарна дата UTC "сьогодні" для namespace `tempo/git-reconcile/<date>/…`
/// — epoch-математика (Howard Hinnant civil-from-days), без `chrono`, якого
/// немає серед залежностей цього крейта.
fn civil_date_from_secs(secs: u64) -> String {
    let days = secs / 86_400;
    let z = days as i64 + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}")
}

fn today() -> String {
    civil_date_from_secs(now_secs())
}

/// `git-reconcile archive` — архівує джерело в
/// `origin/tempo/git-reconcile/<date>/<kind>-<slug>-<sha12>` окремим metadata
/// commit ПЕРЕД будь-яким локальним видаленням (ADR-вимога). Ідемпотентно:
/// повторний виклик з тим самим `kind`+`ref` і вже наявним валідним записом
/// у стані (перевіреним `ls-remote`) не пушить вдруге.
pub fn run_archive(args: &GitReconcileArchiveArgs, cwd: &Path) -> ExitCode {
    let kind = kind_str(args.kind);
    let key = state_key(kind, &args.reference);

    let source_oid = match args.kind {
        GitReconcileKind::Branch | GitReconcileKind::Stash => {
            git_ok(cwd, &["rev-parse", &args.reference])
        }
        GitReconcileKind::Worktree => {
            let Some(path) = &args.worktree_path else {
                return fail("--worktree-path обов'язковий для --kind worktree");
            };
            run_git(Path::new(path), &["rev-parse", "HEAD"]).and_then(|out| {
                if out.status.success() {
                    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
                } else {
                    Err(format!(
                        "git rev-parse HEAD у {path} провалився: {}",
                        String::from_utf8_lossy(&out.stderr).trim()
                    ))
                }
            })
        }
    };
    let source_oid = match source_oid {
        Ok(oid) => oid,
        Err(message) => return fail(&message),
    };

    let mut state = load_state(cwd);
    if let Some(existing) = state.archives.get(&key) {
        if existing.source_oid == source_oid
            && remote_ref_matches(cwd, &existing.archive_branch, &existing.archive_sha)
        {
            println!(
                "♻️  вже заархівовано: {} → origin/{}",
                args.reference, existing.archive_branch
            );
            return ExitCode::SUCCESS;
        }
    }

    let slug = slugify(&args.reference);
    let sha12 = &source_oid[..source_oid.len().min(12)];
    let archive_branch = format!("tempo/git-reconcile/{}/{kind}-{slug}-{sha12}", today());
    let created_at = now_secs();
    let delete_after = created_at + u64::from(DEFAULT_RETENTION_DAYS) * 86_400;
    let manifest = serde_json::json!({
        "schemaVersion": 1,
        "kind": kind,
        "source": { "ref": args.reference, "oid": source_oid },
        "baseOid": source_oid,
        "reason": args.reason,
        "createdAt": created_at,
        "deleteAfter": delete_after,
        "restore": format!(
            "n-rules git-reconcile restore --archive-branch {archive_branch}"
        ),
    });
    let manifest_text = match serde_json::to_string_pretty(&manifest) {
        Ok(text) => text,
        Err(error) => return fail(&format!("archive.json не серіалізується: {error}")),
    };
    let archive_md = format!(
        "# git-reconcile archive\n\n- kind: {kind}\n- source: {} ({source_oid})\n- reason: {}\n- created (unix): {created_at}\n- delete after (unix): {delete_after}\n- restore: `n-rules git-reconcile restore --archive-branch {archive_branch}`\n",
        args.reference, args.reason
    );

    match build_and_push_metadata_commit(
        cwd,
        &source_oid,
        &manifest_text,
        &archive_md,
        &archive_branch,
        kind,
        &args.reference,
    ) {
        Ok(metadata_sha) => {
            state.archives.insert(
                key,
                ArchiveRecord {
                    kind: kind.to_string(),
                    source_ref: args.reference.clone(),
                    source_oid,
                    archive_branch: archive_branch.clone(),
                    archive_sha: metadata_sha,
                    created_at_secs: created_at,
                    delete_after_secs: delete_after,
                    cleaned_locally: false,
                    reason: args.reason.clone(),
                },
            );
            if let Err(message) = save_state(cwd, &state) {
                return fail(&message);
            }
            println!(
                "✅ заархівовано {} → origin/{archive_branch}",
                args.reference
            );
            ExitCode::SUCCESS
        }
        Err(message) => fail(&message),
    }
}

/// Чи ref на `origin` існує і вказує саме на очікуваний sha — remote-перевірка
/// перед тим, як довіряти локальному запису стану (ADR: "Локальне очищення
/// дозволене лише після того, як archive branch успішно запушено й
/// перевірено безпосередньо в `origin`").
fn remote_ref_matches(cwd: &Path, branch: &str, expected_sha: &str) -> bool {
    let Ok(out) = run_git(cwd, &["ls-remote", "origin", &format!("refs/heads/{branch}")]) else {
        return false;
    };
    if !out.status.success() {
        return false;
    }
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .next()
        .is_some_and(|line| line.starts_with(expected_sha))
}

/// `read-tree(sourceOid)` у тимчасовий index → додати два файли
/// `.git-reconcile/{archive.json,ARCHIVE.md}` → `write-tree` → `commit-tree`
/// з `-p sourceOid` → `push` на `origin/<archiveBranch>`. Тимчасовий index —
/// через `GIT_INDEX_FILE`, щоб не займати робочий index репозиторію (агент
/// може одночасно мати незакомічені зміни в поточному worktree).
#[allow(clippy::too_many_arguments)]
fn build_and_push_metadata_commit(
    cwd: &Path,
    source_oid: &str,
    manifest_text: &str,
    archive_md: &str,
    archive_branch: &str,
    kind: &str,
    source_ref: &str,
) -> Result<String, String> {
    let manifest_blob = hash_object_stdin(cwd, manifest_text)?;
    let archive_md_blob = hash_object_stdin(cwd, archive_md)?;

    let index_path = state_dir(cwd).join(format!("index-{}", std::process::id()));
    std::fs::create_dir_all(index_path.parent().unwrap())
        .map_err(|error| format!("не вдалося створити каталог стану: {error}"))?;
    let _cleanup = IndexCleanup(index_path.clone());

    let run_with_index = |args: &[&str]| -> Result<String, String> {
        let out = Command::new("git")
            .arg("-C")
            .arg(cwd)
            .env("GIT_INDEX_FILE", &index_path)
            .args(args)
            .output()
            .map_err(|error| format!("git {args:?} не запустився: {error}"))?;
        if !out.status.success() {
            return Err(format!(
                "git {args:?} провалився: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    };

    run_with_index(&["read-tree", source_oid])?;
    run_with_index(&[
        "update-index",
        "--add",
        "--cacheinfo",
        &format!("100644,{manifest_blob},.git-reconcile/archive.json"),
    ])?;
    run_with_index(&[
        "update-index",
        "--add",
        "--cacheinfo",
        &format!("100644,{archive_md_blob},.git-reconcile/ARCHIVE.md"),
    ])?;
    let tree = run_with_index(&["write-tree"])?;

    let message = format!("git-reconcile: archive {kind} {source_ref}");
    let metadata_sha = git_ok(cwd, &["commit-tree", &tree, "-p", source_oid, "-m", &message])?;

    git_ok(
        cwd,
        &[
            "push",
            "origin",
            &format!("{metadata_sha}:refs/heads/{archive_branch}"),
        ],
    )?;

    if !remote_ref_matches(cwd, archive_branch, &metadata_sha) {
        return Err(
            "archive запушено, але ls-remote не підтвердив sha — fail-closed, не видаляю нічого локально"
                .to_string(),
        );
    }

    Ok(metadata_sha)
}

struct IndexCleanup(PathBuf);
impl Drop for IndexCleanup {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

fn hash_object_stdin(cwd: &Path, content: &str) -> Result<String, String> {
    use std::io::Write as _;
    let mut child = Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(["hash-object", "-w", "--stdin"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| format!("git hash-object не запустився: {error}"))?;
    child
        .stdin
        .take()
        .ok_or("немає stdin у git hash-object")?
        .write_all(content.as_bytes())
        .map_err(|error| format!("не вдалося передати вміст у git hash-object: {error}"))?;
    let out = child
        .wait_with_output()
        .map_err(|error| format!("git hash-object не завершився: {error}"))?;
    if !out.status.success() {
        return Err(format!(
            "git hash-object провалився: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// `git-reconcile cleanup` — видаляє локальний branch/worktree/stash
/// ЛИШЕ якщо для нього вже є перевірений remote-архів у стані (запис
/// `run_archive`, звірений `ls-remote` заново — не довіряємо кешу мовчки).
/// Захищені: поточна гілка (`git symbolic-ref HEAD`), worktree поточного
/// процесу — узгоджено з ADR "Поточний worktree процесу не є кандидатом як
/// технічний інваріант".
pub fn run_cleanup(args: &GitReconcileCleanupArgs, cwd: &Path) -> ExitCode {
    let kind = kind_str(args.kind);
    let key = state_key(kind, &args.reference);

    let mut state = load_state(cwd);
    let Some(record) = state.archives.get(&key).cloned() else {
        return fail(&format!(
            "{kind} {} не заархівовано (немає запису в стані) — спершу `git-reconcile archive`",
            args.reference
        ));
    };
    if !remote_ref_matches(cwd, &record.archive_branch, &record.archive_sha) {
        return fail(&format!(
            "archive origin/{} не підтверджено ls-remote — fail-closed, cleanup не виконується",
            record.archive_branch
        ));
    }

    match args.kind {
        GitReconcileKind::Branch => {
            if let Ok(current) = git_ok(cwd, &["symbolic-ref", "--short", "HEAD"]) {
                if current == args.reference {
                    return fail("не видаляю поточну гілку (protected)");
                }
            }
            if let Err(message) = git_ok(cwd, &["branch", "-D", &args.reference]) {
                return fail(&message);
            }
        }
        GitReconcileKind::Worktree => {
            let Some(path) = &args.worktree_path else {
                return fail("--worktree-path обов'язковий для --kind worktree");
            };
            if same_path(cwd, Path::new(path)) {
                return fail("не видаляю worktree поточного процесу (protected)");
            }
            if let Err(message) = git_ok(cwd, &["worktree", "remove", "--force", path]) {
                return fail(&message);
            }
        }
        GitReconcileKind::Stash => {
            // `args.reference` — повний sha stash-коміту (не `stash@{N}`,
            // індекс якого зсувається між ходами агента); шукаємо ПОТОЧНИЙ
            // `stash@{N}` для цього sha прямо перед drop.
            let Ok(list) = git_ok(cwd, &["stash", "list", "--format=%H %gd"]) else {
                return fail("git stash list провалився");
            };
            let entry = list.lines().find(|line| line.starts_with(&args.reference));
            let Some(entry) = entry else {
                return fail(&format!(
                    "stash {} вже відсутній у stash list — нічого прибирати",
                    args.reference
                ));
            };
            let stash_ref = entry.split_whitespace().nth(1).unwrap_or_default();
            if let Err(message) = git_ok(cwd, &["stash", "drop", stash_ref]) {
                return fail(&message);
            }
        }
    }

    if let Some(entry) = state.archives.get_mut(&key) {
        entry.cleaned_locally = true;
    }
    if let Err(message) = save_state(cwd, &state) {
        return fail(&message);
    }
    println!("🧹 прибрано локально: {kind} {}", args.reference);
    ExitCode::SUCCESS
}

fn same_path(a: &Path, b: &Path) -> bool {
    let canon = |p: &Path| std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    canon(a) == canon(b)
}

/// `git-reconcile gc` — прибирає `origin/tempo/git-reconcile/*` старші за
/// `--max-age-days` (дефолт 45, ADR) від СВОГО часу архівування
/// (`createdAtSecs`, не збереженого `deleteAfterSecs`, щоб `--max-age-days`
/// реально міняв поріг, а не лише документував дефолт). dry-run за
/// замовчуванням (ADR: "GC працюватиме лише у dry-run за замовчуванням") —
/// `--apply` для реального видалення.
pub fn run_gc(args: &GitReconcileGcArgs, cwd: &Path) -> ExitCode {
    let max_age_secs = u64::from(args.max_age_days.unwrap_or(DEFAULT_RETENTION_DAYS)) * 86_400;

    let Ok(out) = run_git(
        cwd,
        &["ls-remote", "origin", "refs/heads/tempo/git-reconcile/*"],
    ) else {
        return fail("git ls-remote origin провалився");
    };
    if !out.status.success() {
        return fail(&format!(
            "git ls-remote origin провалився: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let refs = String::from_utf8_lossy(&out.stdout).into_owned();

    let mut state = load_state(cwd);
    let now = now_secs();
    let mut removed = 0usize;
    let mut skipped = 0usize;
    for line in refs.lines() {
        let mut parts = line.split_whitespace();
        let (Some(sha), Some(ref_name)) = (parts.next(), parts.next()) else {
            continue;
        };
        let Some(branch) = ref_name.strip_prefix("refs/heads/") else {
            continue;
        };
        // manifest — без локального fetch читати не можемо; читаємо стан за
        // ключем, чий archiveBranch/archiveSha збігається (записаний саме
        // цією командою `archive`). Ref без відповідного запису в стані
        // (наприклад, архівований іншим клоном/агентом) пропускається
        // fail-closed — ADR: "відсутній або невалідний manifest… є
        // причиною пропустити ref, а не видаляти його".
        let record = state
            .archives
            .values()
            .find(|record| record.archive_branch == branch && record.archive_sha == sha);
        let Some(record) = record else {
            skipped += 1;
            continue;
        };
        if now < record.created_at_secs + max_age_secs {
            skipped += 1;
            continue;
        }
        if args.apply {
            if let Err(message) = git_ok(cwd, &["push", "origin", "--delete", branch]) {
                eprintln!("⚠️  не вдалося видалити {branch}: {message}");
                continue;
            }
        }
        println!(
            "{} origin/{branch} (заархівовано {})",
            if args.apply {
                "🗑️  видалено"
            } else {
                "🔍 кандидат"
            },
            record.created_at_secs
        );
        removed += 1;
    }

    if args.apply {
        // Stale-записи (вже видалені на origin цим проходом) прибираються зі
        // `state.json`, лишаючи лише живі архіви.
        state
            .archives
            .retain(|_, record| remote_ref_matches(cwd, &record.archive_branch, &record.archive_sha));
        if let Err(message) = save_state(cwd, &state) {
            return fail(&message);
        }
    }

    println!(
        "gc: {} {removed}, {skipped} лишилось (ще не прострочені або без запису в стані)",
        if args.apply {
            "видалено"
        } else {
            "кандидатів на видалення"
        }
    );
    ExitCode::SUCCESS
}

/// `git-reconcile restore` — відновлює локальну гілку з archive-tip:
/// metadata-коміт має ЄДИНОГО parent-а — точний `sourceOid`, тож
/// відновлення — просте створення branch на цьому parent, без розбору
/// manifest (сам факт, що parent існує й є валідним деревом, — уже
/// достатня перевірка відтворюваності).
pub fn run_restore(args: &GitReconcileRestoreArgs, cwd: &Path) -> ExitCode {
    if let Err(message) = git_ok(cwd, &["fetch", "origin", &args.archive_branch]) {
        return fail(&message);
    }
    let Ok(parent) = git_ok(cwd, &["rev-parse", "FETCH_HEAD^1"]) else {
        return fail("archive branch не має parent-коміту — не вдалось знайти sourceOid");
    };
    let local_name = args
        .as_branch
        .clone()
        .unwrap_or_else(|| args.archive_branch.replace('/', "-"));
    if let Err(message) = git_ok(cwd, &["branch", &local_name, &parent]) {
        return fail(&message);
    }
    println!(
        "♻️  відновлено {local_name} ({parent}) з origin/{}",
        args.archive_branch
    );
    ExitCode::SUCCESS
}

/// `git-reconcile status` — друкує стан (людський або `--json`).
pub fn run_status(args: &GitReconcileStatusArgs, cwd: &Path) -> ExitCode {
    let state = load_state(cwd);
    if args.json {
        return match serde_json::to_string_pretty(&state) {
            Ok(json) => {
                println!("{json}");
                ExitCode::SUCCESS
            }
            Err(error) => fail(&format!("state.json не серіалізується: {error}")),
        };
    }
    if state.archives.is_empty() {
        println!("git-reconcile: немає активних архівів");
        return ExitCode::SUCCESS;
    }
    for (key, record) in &state.archives {
        println!(
            "{key}: origin/{} ({}), locally-cleaned={}",
            record.archive_branch, record.archive_sha, record.cleaned_locally
        );
    }
    ExitCode::SUCCESS
}

#[cfg(test)]
mod tests {
    use std::process::Command as StdCommand;

    use tempfile::TempDir;

    use super::*;

    fn git(dir: &Path, args: &[&str]) {
        let status = StdCommand::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .status()
            .unwrap_or_else(|error| panic!("git {args:?}: {error}"));
        assert!(status.success(), "git {args:?} failed у {}", dir.display());
    }

    /// Bare "origin" + клон із першим комітом на `main` — весь тест-контур
    /// git-reconcile працює проти ЛОКАЛЬНОГО bare-репо як remote, без мережі
    /// (правило задачі: жодних push-ів у реальний origin під час ручного
    /// тестування).
    fn init_repo_with_origin() -> (TempDir, TempDir) {
        let origin = TempDir::new().unwrap();
        git(origin.path(), &["init", "--quiet", "--bare"]);

        let work = TempDir::new().unwrap();
        git(work.path(), &["init", "--quiet", "--initial-branch=main"]);
        git(work.path(), &["config", "user.name", "git-reconcile-test"]);
        git(
            work.path(),
            &["config", "user.email", "git-reconcile-test@localhost"],
        );
        std::fs::write(work.path().join("README.md"), "x").unwrap();
        git(work.path(), &["add", "-A"]);
        git(work.path(), &["commit", "--quiet", "-m", "init"]);
        git(
            work.path(),
            &["remote", "add", "origin", origin.path().to_str().unwrap()],
        );
        git(work.path(), &["push", "-q", "origin", "main"]);
        (origin, work)
    }

    // ── civil_date_from_secs ──

    #[test]
    fn civil_date_matches_known_epoch_day() {
        // 2024-01-01T00:00:00Z = 1704067200
        assert_eq!(civil_date_from_secs(1_704_067_200), "2024-01-01");
        // 2026-09-01T00:00:00Z = 1788220800
        assert_eq!(civil_date_from_secs(1_788_220_800), "2026-09-01");
    }

    // ── archive + cleanup (branch) ──

    #[test]
    fn archive_then_cleanup_branch_round_trip() {
        let (_origin, work) = init_repo_with_origin();
        git(work.path(), &["branch", "feature-x"]);

        let archive_args = GitReconcileArchiveArgs {
            kind: GitReconcileKind::Branch,
            reference: "feature-x".to_string(),
            worktree_path: None,
            reason: "merged".to_string(),
        };
        assert_eq!(run_archive(&archive_args, work.path()), ExitCode::SUCCESS);

        let state = load_state(work.path());
        let record = state.archives.get("branch:feature-x").unwrap();
        assert!(record.archive_branch.starts_with("tempo/git-reconcile/"));
        assert!(!record.cleaned_locally);
        assert!(remote_ref_matches(
            work.path(),
            &record.archive_branch,
            &record.archive_sha
        ));

        // Метадані реально пушнуті й читаються: manifest є в дереві.
        let show = git_ok(
            work.path(),
            &[
                "show",
                &format!("{}:.git-reconcile/archive.json", record.archive_sha),
            ],
        )
        .unwrap();
        assert!(show.contains("\"kind\": \"branch\""));
        assert!(show.contains("feature-x"));

        let cleanup_args = GitReconcileCleanupArgs {
            kind: GitReconcileKind::Branch,
            reference: "feature-x".to_string(),
            worktree_path: None,
        };
        assert_eq!(run_cleanup(&cleanup_args, work.path()), ExitCode::SUCCESS);
        let branches = git_ok(work.path(), &["branch", "--list", "feature-x"]).unwrap();
        assert!(branches.is_empty(), "гілка мала зникнути локально");

        let state = load_state(work.path());
        assert!(
            state
                .archives
                .get("branch:feature-x")
                .unwrap()
                .cleaned_locally
        );
    }

    #[test]
    fn cleanup_without_archive_refuses() {
        let (_origin, work) = init_repo_with_origin();
        git(work.path(), &["branch", "feature-y"]);
        let cleanup_args = GitReconcileCleanupArgs {
            kind: GitReconcileKind::Branch,
            reference: "feature-y".to_string(),
            worktree_path: None,
        };
        assert_eq!(run_cleanup(&cleanup_args, work.path()), ExitCode::FAILURE);
        let branches = git_ok(work.path(), &["branch", "--list", "feature-y"]).unwrap();
        assert!(!branches.is_empty(), "без архіву гілка лишається");
    }

    #[test]
    fn cleanup_refuses_current_branch() {
        let (_origin, work) = init_repo_with_origin();
        let archive_args = GitReconcileArchiveArgs {
            kind: GitReconcileKind::Branch,
            reference: "main".to_string(),
            worktree_path: None,
            reason: "test".to_string(),
        };
        assert_eq!(run_archive(&archive_args, work.path()), ExitCode::SUCCESS);
        let cleanup_args = GitReconcileCleanupArgs {
            kind: GitReconcileKind::Branch,
            reference: "main".to_string(),
            worktree_path: None,
        };
        assert_eq!(run_cleanup(&cleanup_args, work.path()), ExitCode::FAILURE);
    }

    // ── resumability: archive двічі не пушить вдруге ──

    #[test]
    fn archive_is_idempotent_for_same_source_oid() {
        let (_origin, work) = init_repo_with_origin();
        git(work.path(), &["branch", "feature-z"]);
        let archive_args = GitReconcileArchiveArgs {
            kind: GitReconcileKind::Branch,
            reference: "feature-z".to_string(),
            worktree_path: None,
            reason: "merged".to_string(),
        };
        assert_eq!(run_archive(&archive_args, work.path()), ExitCode::SUCCESS);
        let first = load_state(work.path())
            .archives
            .get("branch:feature-z")
            .unwrap()
            .archive_branch
            .clone();
        assert_eq!(run_archive(&archive_args, work.path()), ExitCode::SUCCESS);
        let second = load_state(work.path())
            .archives
            .get("branch:feature-z")
            .unwrap()
            .archive_branch
            .clone();
        assert_eq!(first, second, "повторний archive не мав створити НОВУ гілку");
    }

    // ── stash ──

    #[test]
    fn archive_and_cleanup_stash() {
        let (_origin, work) = init_repo_with_origin();
        std::fs::write(work.path().join("README.md"), "dirty").unwrap();
        git(work.path(), &["stash", "push", "-m", "wip"]);
        let stash_sha = git_ok(work.path(), &["rev-parse", "stash@{0}"]).unwrap();

        let archive_args = GitReconcileArchiveArgs {
            kind: GitReconcileKind::Stash,
            reference: stash_sha.clone(),
            worktree_path: None,
            reason: "stale stash".to_string(),
        };
        assert_eq!(run_archive(&archive_args, work.path()), ExitCode::SUCCESS);

        let cleanup_args = GitReconcileCleanupArgs {
            kind: GitReconcileKind::Stash,
            reference: stash_sha,
            worktree_path: None,
        };
        assert_eq!(run_cleanup(&cleanup_args, work.path()), ExitCode::SUCCESS);
        let list = git_ok(work.path(), &["stash", "list"]).unwrap();
        assert!(list.is_empty(), "stash мав зникнути після cleanup");
    }

    // ── gc ──

    #[test]
    fn gc_dry_run_lists_but_does_not_delete() {
        let (_origin, work) = init_repo_with_origin();
        git(work.path(), &["branch", "feature-gc"]);
        let archive_args = GitReconcileArchiveArgs {
            kind: GitReconcileKind::Branch,
            reference: "feature-gc".to_string(),
            worktree_path: None,
            reason: "merged".to_string(),
        };
        assert_eq!(run_archive(&archive_args, work.path()), ExitCode::SUCCESS);

        // max-age-days 0 → архів одразу "простроченим".
        let gc_args = GitReconcileGcArgs {
            apply: false,
            max_age_days: Some(0),
        };
        assert_eq!(run_gc(&gc_args, work.path()), ExitCode::SUCCESS);

        let record = load_state(work.path())
            .archives
            .get("branch:feature-gc")
            .unwrap()
            .clone();
        assert!(
            remote_ref_matches(work.path(), &record.archive_branch, &record.archive_sha),
            "dry-run не мав нічого видаляти"
        );
    }

    #[test]
    fn gc_apply_deletes_expired_archive() {
        let (_origin, work) = init_repo_with_origin();
        git(work.path(), &["branch", "feature-gc2"]);
        let archive_args = GitReconcileArchiveArgs {
            kind: GitReconcileKind::Branch,
            reference: "feature-gc2".to_string(),
            worktree_path: None,
            reason: "merged".to_string(),
        };
        assert_eq!(run_archive(&archive_args, work.path()), ExitCode::SUCCESS);
        let branch = load_state(work.path())
            .archives
            .get("branch:feature-gc2")
            .unwrap()
            .archive_branch
            .clone();

        let gc_args = GitReconcileGcArgs {
            apply: true,
            max_age_days: Some(0),
        };
        assert_eq!(run_gc(&gc_args, work.path()), ExitCode::SUCCESS);

        let out = run_git(
            work.path(),
            &["ls-remote", "origin", &format!("refs/heads/{branch}")],
        )
        .unwrap();
        assert!(String::from_utf8_lossy(&out.stdout).trim().is_empty());
        assert!(load_state(work.path()).archives.is_empty());
    }

    // ── restore ──

    #[test]
    fn restore_recreates_local_branch_at_source_oid() {
        let (_origin, work) = init_repo_with_origin();
        git(work.path(), &["branch", "feature-r"]);
        let source_oid = git_ok(work.path(), &["rev-parse", "feature-r"]).unwrap();
        let archive_args = GitReconcileArchiveArgs {
            kind: GitReconcileKind::Branch,
            reference: "feature-r".to_string(),
            worktree_path: None,
            reason: "merged".to_string(),
        };
        assert_eq!(run_archive(&archive_args, work.path()), ExitCode::SUCCESS);
        let branch = load_state(work.path())
            .archives
            .get("branch:feature-r")
            .unwrap()
            .archive_branch
            .clone();
        git(work.path(), &["branch", "-D", "feature-r"]);

        let restore_args = GitReconcileRestoreArgs {
            archive_branch: branch,
            as_branch: Some("feature-r-restored".to_string()),
        };
        assert_eq!(run_restore(&restore_args, work.path()), ExitCode::SUCCESS);
        let restored_oid = git_ok(work.path(), &["rev-parse", "feature-r-restored"]).unwrap();
        assert_eq!(restored_oid, source_oid);
    }
}
