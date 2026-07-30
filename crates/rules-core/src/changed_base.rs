//! Точний порт `resolveChangedBase` з `npm/scripts/lib/changed-files.mjs:63-82`
//! (задача T3 фази 1, `docs/specs/2026-07-30-rules-v2-rust-core-migration.md`).
//!
//! # П1 — merge-base у gix 0.86
//!
//! Верифіковано: `gix::Repository::merge_base` (feature `revision`, тягне
//! `index`; плюс `sha1` для object-hash backend) доступний у пін 0.86 і
//! покриває і `git merge-base <a> <b>`, і `--is-ancestor a b` (останнє —
//! `merge_base(a, b) == a`, той самий трюк, що й голий git: ancestor-check
//! через merge-base без окремого API). Porcelain-межа (`std::process::Command`)
//! тут НЕ знадобилась — на відміну від `mt-core/src/git/compat.rs`, де вона
//! покриває capability, яких немає в gix узагалі.
//!
//! # Семантика (parity з JS)
//!
//! JS-версія (`mergeBaseWith` у changed-files.mjs) ковтає будь-яку помилку
//! git (ref не існує, не резолвиться, немає HEAD, не git-репо) і повертає
//! `''`/`null` — ніколи не кидає. Rust-порт дзеркалить це: усі негаразди
//! резолву зводяться до `None`/пропуску кандидата; [`RulesError::Git`]
//! лишається лише для випадків, які в JS не могли статись у принципі
//! (наразі — жодних; сигнатура повертає `Result` про запас під майбутні
//! use case-и gix-запитів, що можуть провалитись «по-справжньому»).
//!
//! # Shallow-репо — тимчасова porcelain-межа
//!
//! Виявлений parity-розрив (A4): на shallow-клоні (`git clone --depth 1
//! --no-single-branch`) голий `git merge-base` бачить `.git/shallow` —
//! межові коміти позначені як «без батьків», тож traversal, що впирається в
//! межу раніше спільного предка, падає з ненульовим exit-кодом і
//! дореформений JS повертав `null` (fail-closed: consumer-CI з
//! `fetch-depth: 1` краще лишити без scope, ніж помилково звузити його).
//! `gix::Repository::merge_base` (пін 0.86) shallow-межу НЕ пильнує:
//! traversal іде звичайним object-graph і доходить до предка, якщо той
//! фізично лежить в локальному object-store (наприклад, притягнутий через
//! іншу гілку при `--no-single-branch`), — тобто повертає sha там, де голий git
//! мовчки здається. Для consumer-CI це небезпечніше за стару поведінку
//! (реальний scope замість fail-closed «немає scope»), тож приймати
//! розходження не можна.
//!
//! Рішення — детектувати shallow (`Repository::is_shallow()`, завжди
//! доступний у 0.86, без додаткових features) і на shallow-репо рахувати
//! merge-base/is-ancestor НЕ через gix, а через вузьку porcelain-межу
//! (`std::process::Command` виклики `git merge-base`, за зразком
//! `mt-core/src/git/compat.rs` — «дозволена capability, якої бракує
//! pinned-крейту», не загальний exec-API). Це свідомо тимчасово, до
//! shallow-aware traversal у майбутній версії gix; non-shallow шлях
//! лишається чистим gix (швидше, без subprocess).

use std::{path::Path, process::Command};

use gix::ObjectId;

use crate::RulesError;

/// Визначає git base для scoped-перевірок — Rust-порт `resolveChangedBase`
/// (changed-files.mjs:63-82).
///
/// - `base_ref` заданий: результат — merge-base між `HEAD` і цим ref, або
///   `None`; `candidates` ігноруються (як у JS).
/// - інакше: по кожному з `candidates` (уже розгорнутий список
///   `origin/<name>`/`<name>` — розгортання policy лишається в JS, Р5)
///   рахуємо merge-base з `HEAD`, відкидаємо порожні; серед знайдених sha
///   беремо «найновіший» — перший, що не є предком жодного пізнішого
///   кандидата, ітеративно замінюється кандидатом, якщо є предком нього.
///
/// Повертає повний 40-символьний hex sha (як `git merge-base` на друк).
pub fn resolve_changed_base(
    cwd: &Path,
    candidates: &[String],
    base_ref: Option<&str>,
) -> Result<Option<String>, RulesError> {
    // Не git-репо (чи взагалі не резолвиться) — це не помилка, а порожній
    // результат: JS-версія так само мовчки повертає null, коли `git
    // merge-base` падає (spawnSync не кидає — просто non-zero exit).
    let Ok(repo) = gix::discover(cwd) else {
        return Ok(None);
    };
    // Shallow — вимикає gix-шлях цілком (і для base_ref, і для candidates):
    // JS так само не розрізняв «явний base_ref» і «policy candidates» —
    // обидва йшли через той самий `mergeBaseWith`/`spawnSync`.
    let shallow = repo.is_shallow();

    if let Some(base_ref) = base_ref {
        return Ok(merge_base_with(&repo, cwd, base_ref, shallow));
    }

    let mut bases: Vec<String> = candidates
        .iter()
        .filter_map(|candidate| merge_base_with(&repo, cwd, candidate, shallow))
        .collect();
    if bases.is_empty() {
        return Ok(None);
    }

    let mut newest = bases.remove(0);
    for candidate in bases {
        if candidate == newest {
            continue;
        }
        if is_ancestor(&repo, cwd, &newest, &candidate, shallow) {
            newest = candidate;
        }
    }
    Ok(Some(newest))
}

/// `git merge-base HEAD <ref_name>` — `None` при будь-якій помилці резолву
/// (ref не існує, HEAD відсутній, merge-base не знайдено, shallow-межа).
/// `shallow` перемикає на porcelain-шлях (див. doc-коментар модуля).
fn merge_base_with(
    repo: &gix::Repository,
    cwd: &Path,
    ref_name: &str,
    shallow: bool,
) -> Option<String> {
    if shallow {
        return merge_base_with_process(cwd, ref_name);
    }
    // Peel до commit — той самий ефект, що й у голого git, коли ref
    // вказує на annotated tag.
    let head = peel_to_commit_id(repo, "HEAD")?;
    let other = peel_to_commit_id(repo, ref_name)?;
    let base = repo.merge_base(head, other).ok()?;
    Some(base.detach().to_string())
}

/// `git merge-base --is-ancestor ancestor descendant` ⇔
/// `merge_base(ancestor, descendant) == ancestor`. `ancestor`/`descendant` —
/// уже повні sha (продукт [`merge_base_with`]), не довільні ref-и.
/// `shallow` перемикає на porcelain-шлях (див. doc-коментар модуля).
fn is_ancestor(
    repo: &gix::Repository,
    cwd: &Path,
    ancestor: &str,
    descendant: &str,
    shallow: bool,
) -> bool {
    if shallow {
        return is_ancestor_process(cwd, ancestor, descendant);
    }
    let (Ok(ancestor_id), Ok(descendant_id)) = (
        ObjectId::from_hex(ancestor.as_bytes()),
        ObjectId::from_hex(descendant.as_bytes()),
    ) else {
        return false;
    };
    match repo.merge_base(ancestor_id, descendant_id) {
        Ok(base) => base.detach() == ancestor_id,
        Err(_) => false,
    }
}

/// Резолвить ref у commit id, peel-ячи крізь annotated tags. `None` при
/// будь-якій помилці резолву (не тільки «ref не існує» — і «не commit-ish»).
fn peel_to_commit_id(repo: &gix::Repository, spec: &str) -> Option<ObjectId> {
    let id = repo.rev_parse_single(spec).ok()?;
    let commit = id.object().ok()?.peel_to_commit().ok()?;
    Some(commit.id)
}

/// Porcelain-шлях для shallow-репо: `git merge-base HEAD <ref_name>` як
/// зовнішній процес, з cwd = `cwd` (не repo root) — той самий спосіб
/// виклику, що й `spawnSync('git', ..., { cwd })` у дореформеному JS, аби
/// зберегти й auto-discovery репо з підкаталогу/linked worktree, і саму
/// shallow fail-closed поведінку голого git.
fn merge_base_with_process(cwd: &Path, ref_name: &str) -> Option<String> {
    let output = Command::new("git")
        .current_dir(cwd)
        .args(["merge-base", "HEAD", ref_name])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let sha = String::from_utf8(output.stdout).ok()?.trim().to_string();
    if sha.is_empty() {
        None
    } else {
        Some(sha)
    }
}

/// Porcelain-шлях для shallow-репо: `git merge-base --is-ancestor ancestor
/// descendant` як зовнішній процес (див. [`merge_base_with_process`]).
fn is_ancestor_process(cwd: &Path, ancestor: &str, descendant: &str) -> bool {
    Command::new("git")
        .current_dir(cwd)
        .args(["merge-base", "--is-ancestor", ancestor, descendant])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use std::{path::Path, process::Command};

    use tempfile::TempDir;

    use super::resolve_changed_base;

    /// Запускає git-команду у фікстурі, панікує при non-zero exit —
    /// setup-хелпер тестів має бути «тихим» і надійним, помилки тут завжди
    /// баг тесту, не кейс під перевірку.
    fn git(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .status()
            .unwrap_or_else(|error| panic!("git {args:?}: {error}"));
        assert!(status.success(), "git {args:?} failed у {}", dir.display());
    }

    /// Порожній репо з ізольованою identity (без залежності від глобального
    /// git-config середовища CI/локальної машини).
    fn init_repo(dir: &Path) {
        git(dir, &["init", "--quiet", "--initial-branch=main"]);
        git(dir, &["config", "user.name", "rules-core-test"]);
        git(dir, &["config", "user.email", "rules-core-test@localhost"]);
    }

    fn commit(dir: &Path, message: &str) {
        std::fs::write(dir.join(format!("{message}.txt")), message).unwrap();
        git(dir, &["add", "-A"]);
        git(dir, &["commit", "--quiet", "-m", message]);
    }

    fn head_sha(dir: &Path) -> String {
        let out = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(["rev-parse", "HEAD"])
            .output()
            .unwrap();
        String::from_utf8(out.stdout).unwrap().trim().to_string()
    }

    #[test]
    fn single_candidate_merge_base() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();
        init_repo(dir);
        commit(dir, "base");
        let base_sha = head_sha(dir);
        git(dir, &["branch", "integration"]);
        commit(dir, "feature");

        let result = resolve_changed_base(dir, &["integration".to_string()], None).unwrap();
        assert_eq!(result, Some(base_sha));
    }

    #[test]
    fn multiple_candidates_pick_newest() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();
        init_repo(dir);
        commit(dir, "c1");
        git(dir, &["branch", "old-base"]);
        commit(dir, "c2");
        git(dir, &["branch", "new-base"]);
        let new_base_sha = head_sha(dir);
        commit(dir, "feature");

        // "old-base" — предок "new-base", тож merge-base з HEAD для обох
        // кандидатів різні (old_base_sha і new_base_sha); «найновіший» —
        // той, що є нащадком іншого.
        let result =
            resolve_changed_base(dir, &["old-base".to_string(), "new-base".to_string()], None)
                .unwrap();
        assert_eq!(result, Some(new_base_sha));
    }

    #[test]
    fn explicit_base_ref_overrides_candidates() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();
        init_repo(dir);
        commit(dir, "base");
        let base_sha = head_sha(dir);
        git(dir, &["branch", "explicit"]);
        git(dir, &["branch", "ignored-candidate"]);
        commit(dir, "feature");

        let result =
            resolve_changed_base(dir, &["ignored-candidate".to_string()], Some("explicit"))
                .unwrap();
        assert_eq!(result, Some(base_sha));
    }

    #[test]
    fn no_valid_ref_returns_none() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();
        init_repo(dir);
        commit(dir, "only");

        let result = resolve_changed_base(dir, &["does-not-exist".to_string()], None).unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn non_git_directory_returns_none() {
        let tmp = TempDir::new().unwrap();
        let result = resolve_changed_base(tmp.path(), &["main".to_string()], None).unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn linked_worktree_resolves_from_inside() {
        let tmp = TempDir::new().unwrap();
        let main_dir = tmp.path().join("main");
        std::fs::create_dir_all(&main_dir).unwrap();
        init_repo(&main_dir);
        commit(&main_dir, "base");
        let base_sha = head_sha(&main_dir);
        git(&main_dir, &["branch", "integration"]);
        commit(&main_dir, "feature");

        let worktree_dir = tmp.path().join("linked");
        git(
            &main_dir,
            &[
                "worktree",
                "add",
                "--quiet",
                worktree_dir.to_str().unwrap(),
                "-b",
                "wt-branch",
            ],
        );

        let result =
            resolve_changed_base(&worktree_dir, &["integration".to_string()], None).unwrap();
        assert_eq!(result, Some(base_sha));
    }

    /// Shallow-клон (`--depth 1 --no-single-branch`, дзеркало
    /// `npm/scripts/lib/tests/changed-files.test.mjs`, кейс "shallow
    /// clone"): `other` — корінний коміт c1, `main` іде далі на m2. Після
    /// shallow-clone `.git/shallow` позначає m2 як межовий (без батьків),
    /// хоча об'єкт c1 фізично присутній локально — притягнутий окремо як
    /// tip гілки `other` через `--no-single-branch`. Голий `git merge-base`
    /// зупиняється на межі й падає; porcelain-fallback (shallow-детект у
    /// [`resolve_changed_base`]) повторює цю fail-closed поведінку.
    #[test]
    fn shallow_clone_fails_closed_like_bare_git() {
        let tmp = TempDir::new().unwrap();
        let src_dir = tmp.path().join("src");
        std::fs::create_dir_all(&src_dir).unwrap();
        init_repo(&src_dir);
        commit(&src_dir, "c1");
        git(&src_dir, &["branch", "other"]); // other = c1, залишається позаду
        commit(&src_dir, "m2"); // main випереджає other на 1 коміт

        let clone_dir = tmp.path().join("clone");
        let clone_status = Command::new("git")
            .args([
                "clone",
                "--quiet",
                "--depth",
                "1",
                "--no-single-branch",
                &format!("file://{}", src_dir.display()),
                clone_dir.to_str().unwrap(),
            ])
            .status()
            .unwrap();
        assert!(clone_status.success());

        // Контрольна перевірка фікстури: голий `git merge-base` на
        // shallow-клоні падає (shallow-межа приховує спільного предка) —
        // якщо колись перестане падати, тест сам про це просигналить,
        // а не мовчки почне перевіряти щось інше.
        let cli_merge_base = Command::new("git")
            .current_dir(&clone_dir)
            .args(["merge-base", "HEAD", "origin/other"])
            .status()
            .unwrap();
        assert!(!cli_merge_base.success());

        let result = resolve_changed_base(
            &clone_dir,
            &["origin/other".to_string(), "other".to_string()],
            None,
        )
        .unwrap();
        assert_eq!(result, None);
    }
}
