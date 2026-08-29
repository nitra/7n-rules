//! Ядрові бінарні exec-tool фікси родини `image-*` — `image-compress/check`
//! і `image-avif/avif_generation` (§2.85 реєстру
//! `docs/plans/2026-08-05-open-questions-register.md`, розділ «Ядро» плану
//! `docs/plans/2026-08-29-js-rust-migration-completion-plan.md`).
//!
//! # Чому ці два стояли останніми
//!
//! Обидва концерни блокувала ОДНА відсутність: у [`FixPlan`] не було
//! бінарного edit-у. `WriteFile::content` — WIT `string`, тобто валідний
//! UTF-8, а результат `@nitra/minify-image` — нові БАЙТИ jpg/png/gif/webp.
//! Обхід «стиснути й повернути порожній план» був відхилений як мовчазний
//! обман: файли на диску змінені, а конвеєр звітує «0 файлів» — і JS-канон
//! при цьому вже затінений (ключ у [`super::fix::NATIVE_FIXES`] робить
//! native-патерн ЄДИНИМ, `loadT0Patterns`).
//!
//! Мажор `n-rules:plugin@4.0.0` (§2.84) відкрив поверхню —
//! [`rules_contract::fix::FileEdit::WriteBytes`], `list<u8>` у WIT,
//! base64-рядок на JSON-межі napi→JS, `Buffer` без кодування в
//! `run-fix.mjs::applyPlanEdit`. Ця хвиля — споживачі тієї поверхні.
//!
//! # Клас: exec-tool із мутуючим тулом
//!
//! Механіка та сама, що вже розвʼязана в `text/oxfmt` (§2.67) і
//! `text/run-dotenv-linter`/`text/run-shellcheck` (§2.82): план будує
//! СИНХРОННА функція, яка сама читає диск ДО спавна, спавнить тул, читає
//! ПІСЛЯ і планує запис лише для того, що справді змінилось
//! ([`super::fix::snapshot_before`]/[`super::fix::plan_writes_for_changed`]).
//! Тул мутує дерево сам — план потім переписує ті самі байти ідемпотентно,
//! і саме він, а не тул, є тим, що бачить журнал і `t0_touched`.
//!
//! # Байти — рівно там, де вони справді байти
//!
//! `image-compress/check` — бінарний НАСКРІЗЬ: єдина дія фіксу — нові байти
//! растрових файлів.
//!
//! `image-avif/avif_generation` — **змішаний**, і заганяти його цілком у
//! [`FileEdit::WriteBytes`] було б помилкою в інший бік. Його план — три
//! різні речі:
//!
//! | частина плану | форма edit-а |
//! |---|---|
//! | згенеровані `.avif`-двійники | [`FileEdit::WriteBytes`] |
//! | rewrite raster-посилань у `.vue`/`.html` | [`FileEdit::Write`] (UTF-8) |
//! | прибирання `.avif`-сиріт | [`FileEdit::Delete`] |
//!
//! # Полагоджені дефекти канону
//!
//! Перелік — доккоментарі [`image_compress_check_fix`] і
//! [`image_avif_generation_fix`]. Спільна форма всіх чотирьох одна: канон
//! друкує `console.log('⚠️ …')` і повертає `{ touchedFiles: [] }`, що для
//! рушія `--fix` нерозрізнюване від «усе вже гаразд».

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use super::cursor_ignore::{load_cursor_ignore_paths, walk_with_ignore_paths};
use super::fix::{
    byte_or_text_write, plan_writes_for_changed, snapshot_before, FileEdit, FixPlan, WriteBytesFile,
};
use super::image_avif_generation::{scan_avif, AVIF_MISSING, AVIF_NEEDS_REWRITE, AVIF_ORPHAN};
use crate::diagnostics::Violation;
use crate::tool_resolve::resolve_cmd;
use crate::RulesError;

/// Імʼя CLI-пакета, який стискає й перекодовує зображення — спільне для
/// обох концернів (`fix-check.mjs:12`, `fix-avif_generation.mjs:41`).
const MINIFY_PACKAGE_NAME: &str = "@nitra/minify-image";

/// `reason` violation-у `image-compress/check`, за яким матчиться T0 —
/// `fix-check.mjs:patterns[0].test`, він же `NEEDS_COMPRESSION_REASON`
/// детектора [`super::image_compress_check`].
const NEEDS_COMPRESSION_REASON: &str = "needs-compression";

/// Розширення растрових/векторних файлів, які стискає `@nitra/minify-image`
/// — дзеркало `concern.json#lint.glob`
/// (`npm/rules/image-compress/check/concern.json`):
/// `**/*.{jpg,jpeg,png,svg,gif,webp}`.
const COMPRESSIBLE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "svg", "gif", "webp"];

/// `reason`-и `image-avif/avif_generation`, за якими матчиться T0 — порт
/// `TRIGGER_REASONS` (`fix-avif_generation.mjs:335`).
const AVIF_TRIGGER_REASONS: &[&str] = &[AVIF_NEEDS_REWRITE, AVIF_MISSING, AVIF_ORPHAN];

/// Env-вимикач генерації AVIF — порт `NITRA_CURSOR_NO_AVIF_RUN`
/// (`fix-avif_generation.mjs:346`): `'1'` вимикає САМ спавн, лишаючи
/// rescan-частину плану. Тести й ізольовані середовища, де бінарної
/// залежності немає.
const NO_AVIF_RUN_ENV: &str = "NITRA_CURSOR_NO_AVIF_RUN";

/// Підказка встановлення для тулів цієї родини, яких немає в
/// [`crate::tool_registry`] (`bunx`/`npx` приходять із bun/Node, не з brew
/// як окремі формули).
fn runner_install_hint(runner: &str) -> String {
    match runner {
        "bunx" => "`bunx` не знайдено в PATH — постав bun (https://bun.sh); \
             пакет `@nitra/minify-image` v4 стоїть на `Bun.Image` і під Node не стискає нічого"
            .to_string(),
        other => format!("`{other}` не знайдено в PATH — постав Node.js (https://nodejs.org)"),
    }
}

/// Усі файли дерева з розширенням із `extensions` (lower-case порівняння),
/// відносними posix-шляхами, з поваги до consumer-ignore (`.n-rules.json`).
fn list_files_with_extensions(cwd: &Path, extensions: &[&str]) -> Vec<String> {
    let ignore_paths = load_cursor_ignore_paths(cwd);
    let mut files: Vec<String> = walk_with_ignore_paths(cwd, &ignore_paths)
        .into_iter()
        .filter(|rel| {
            Path::new(rel)
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|ext| {
                    let lower = ext.to_ascii_lowercase();
                    extensions.contains(&lower.as_str())
                })
        })
        .collect();
    files.sort();
    files
}

/// T0-фікс `image-compress/check` — порт `patterns[0]`
/// (`fix-check.mjs:73-85`): один прогін
/// `bunx @nitra/minify-image --src=. --write`, тоді запис для кожного
/// image-файлу, чиї БАЙТИ змінились.
///
/// `bunx`, не `npx` — свідомо, як у каноні й у детекторі: пакет v4 стоїть
/// на `Bun.Image` (bun-only global) і під Node мовчки не стискає нічого.
///
/// # Розбіжність із каноном (свідома, на користь): джерело переліку файлів
///
/// Канон бере перелік стиснутих файлів із ДРУГОГО спавна
/// (`--json`-звіт після `--write`) і довіряє полю `report.compressed`.
/// Native рахує його з before/after-diff байтів на диску — рівно те, що
/// зробив тул, без другого спавна й без залежності від того, чи звіт
/// сходиться з фактом. Побічно це знімає ще й `JSON.parse`-гілку, яка в
/// каноні на невалідному звіті мовчки давала `[]`.
///
/// # Полагоджений дефект канону 1: відсутній `bunx` — МОВЧАЗНИЙ no-op
///
/// `runCompression` при `resolveCmd('bunx') === null` друкує
/// `⚠️ 'bunx' не знайдено в PATH` у stdout і повертає `[]`, а `apply`
/// віддає `{ touchedFiles: [] }`. Для рушія `--fix` це нерозрізнювано від
/// «усе вже гаразд»: детектор червоний саме тому, що зображення не
/// стиснуті, фікс «відпрацював успішно, нічого не змінив». Native:
/// [`RulesError::Concern`] з install-підказкою.
///
/// # Полагоджений дефект канону 2: ненульовий код `--write` губився
///
/// Канон читає `writeResult.exitCode`, друкує варн — і **все одно**
/// повертає `[]`, тобто той самий нерозрізнюваний успіх. Native підіймає
/// код разом зі stderr тула [`RulesError::Concern`]-ом.
///
/// # Полагоджений дефект канону 3: зникнення бінарних правок у знімку
///
/// Не в самому `fix-check.mjs`, а в спільному хвості exec-tool фіксів, куди
/// цей концерн приїхав: [`super::fix::snapshot_before`] знімався
/// `read_to_string`-ом, тож не-UTF-8 файл давав `None` і до, і після
/// прогону — «не змінився». Це закрито байтовим знімком (доккоментар тієї
/// функції) — інакше цей порт був би стовідсотково порожнім планом.
pub fn image_compress_check_fix(
    cwd: &Path,
    violations: &[Violation],
) -> Result<FixPlan, RulesError> {
    image_compress_check_fix_with(cwd, violations, &resolve_cmd)
}

/// Тіло фіксу з інжектованим резолвом тула — той самий мотив інʼєкції, що
/// `text_oxfmt_fix_with`/`text_run_dotenv_linter_fix_with`: паралельні
/// тести не повинні підміняти процес-глобальний `PATH`.
pub fn image_compress_check_fix_with(
    cwd: &Path,
    violations: &[Violation],
    resolve_tool: &dyn Fn(&str) -> Option<std::path::PathBuf>,
) -> Result<FixPlan, RulesError> {
    if !violations
        .iter()
        .any(|v| v.reason == NEEDS_COMPRESSION_REASON)
    {
        return Ok(FixPlan::default());
    }

    let Some(bunx) = resolve_tool("bunx") else {
        return Err(RulesError::Concern(format!(
            "image-compress/check: {}",
            runner_install_hint("bunx")
        )));
    };

    let files = list_files_with_extensions(cwd, COMPRESSIBLE_EXTENSIONS);
    if files.is_empty() {
        return Ok(FixPlan::default());
    }
    let before = snapshot_before(cwd, &files);

    let output = Command::new(&bunx)
        .current_dir(cwd)
        .args([MINIFY_PACKAGE_NAME, "--src=.", "--write"])
        .output()
        .map_err(|error| {
            RulesError::Concern(format!(
                "image-compress/check: не вдалося запустити `bunx {MINIFY_PACKAGE_NAME} --write`: {error}"
            ))
        })?;
    if !output.status.success() {
        return Err(RulesError::Concern(format!(
            "image-compress/check: `bunx {MINIFY_PACKAGE_NAME} --write` завершився з кодом {}: {}",
            output
                .status
                .code()
                .map_or_else(|| "signal".to_string(), |c| c.to_string()),
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }

    Ok(FixPlan {
        edits: plan_writes_for_changed(cwd, before),
    })
}

/// T0-фікс `image-avif/avif_generation` — порт `patterns[0]`
/// (`fix-avif_generation.mjs:337-370`): спавн
/// `npx @nitra/minify-image --src=. --write --avif`, тоді rescan
/// ([`scan_avif`], уже native) і план із трьох різних частин.
///
/// # Що саме потрапляє в план
///
/// - **`.avif`-двійники, які створив/переписав тул** — [`FileEdit::WriteBytes`].
///   Це головна змістовна відмінність від канону, і не косметична: канон
///   ЖОДНОГО згенерованого `.avif` не кладе в `touchedFiles` — вони просто
///   зʼявляються на диску як side-effect спавна. Тобто звіт каже «rewrote 3
///   file(s)», поки на диску додалось ще пʼятнадцять бінарних файлів, яких
///   ніхто не бачив: ані журнал, ані collateral-veto, ані `git`-огляд
///   користувача. Це рівно той мовчазний обман, який заборонений для
///   `image-compress` — просто в іншій формі.
/// - **rewrite raster-посилань у `.vue`/`.html`** — [`FileEdit::Write`],
///   ТЕКСТОМ: `scan_avif` повертає готовий новий вміст, він завжди валідний
///   UTF-8 (це `.vue`/`.html`, прочитані як текст). Байтовий варіант тут був
///   би і зайвим payload-ом (base64 +33%), і втратою діагностованості.
/// - **`.avif`-сироти** — [`FileEdit::Delete`], як у каноні (`unlink`).
///
/// `missing` (raster-посилання без двійника) у план не входить — як і в
/// каноні: це ЗВІТ детектора, а не дія. Фікс не вигадує зображень.
///
/// # Порядок edit-ів значущий
///
/// `WriteBytes` згенерованих двійників іде ПЕРШИМ, `Delete` сиріт —
/// ОСТАННІМ. Проміжний стан «посилання вже переписане, а файлу ще немає»
/// у застосованому плані не виникає.
///
/// # Сироти не перетинаються зі щойно згенерованим
///
/// `scan_avif` рахує сироти проти дерева ПІСЛЯ спавна, тож щойно
/// згенерований двійник, на який є живе посилання, сиротою не є. Але шлях,
/// який усе-таки потрапив в обидва списки (двійник без посилань —
/// наприклад, тул згенерував його для зображення, яке ніде не імпортується),
/// з `WriteBytes` викидається: планувати запис і видалення одного файлу
/// означало б і зайвий I/O, і незрозумілий журнал.
///
/// # Полагоджений дефект канону 1: відсутній `npx` — МОВЧАЗНИЙ no-op
///
/// `runAvifGeneration` при `resolveCmd('npx') === null` друкує варн і
/// `return`-ає, після чого `apply` іде далі на rescan і майже завжди
/// віддає `{ touchedFiles: [] }` (двійників не згенеровано → rewrite
/// нікуди робити). Той самий нерозрізнюваний успіх. Native:
/// [`RulesError::Concern`] з install-підказкою.
///
/// # Полагоджений дефект канону 2: ненульовий код `--avif` губився
///
/// `spawnSync` → `result.status !== 0` друкує варн і **провалюється далі**
/// (`console.log` без `return`) — фікс продовжує так, ніби генерація
/// вдалася. Native підіймає код зі stderr тула.
///
/// # Полагоджений дефект канону 3: `--avif` без `--write`… власне, з ним
///
/// Тут розбіжності немає — канон уже передає `--write`; згадано, бо
/// доккомент модуля концерну (`fix-avif_generation.mjs:3`) описує виклик як
/// `npx @nitra/minify-image --avif` без `--write`, і саме за цим описом
/// його цитує `fix.rs`. Порт слідує КОДУ, не доккоментарю.
pub fn image_avif_generation_fix(
    cwd: &Path,
    violations: &[Violation],
) -> Result<FixPlan, RulesError> {
    image_avif_generation_fix_with(cwd, violations, &resolve_cmd)
}

/// Тіло фіксу з інжектованим резолвом тула — мотив той самий, що в
/// [`image_compress_check_fix_with`].
pub fn image_avif_generation_fix_with(
    cwd: &Path,
    violations: &[Violation],
    resolve_tool: &dyn Fn(&str) -> Option<std::path::PathBuf>,
) -> Result<FixPlan, RulesError> {
    if !violations
        .iter()
        .any(|v| AVIF_TRIGGER_REASONS.contains(&v.reason.as_str()))
    {
        return Ok(FixPlan::default());
    }

    // Байтовий знімок УСІХ наявних `.avif` до спавна — тільки він відрізняє
    // «тул щойно згенерував цей двійник» від «двійник лежав тут і раніше».
    let avif_before: BTreeMap<String, Option<Vec<u8>>> =
        snapshot_before(cwd, &list_files_with_extensions(cwd, &["avif"]))
            .into_iter()
            .collect();

    if std::env::var(NO_AVIF_RUN_ENV).as_deref() != Ok("1") {
        run_avif_generation(cwd, resolve_tool)?;
    }

    let scan = scan_avif(cwd);
    if scan.skipped {
        return Ok(FixPlan::default());
    }

    let orphans: Vec<String> = scan
        .orphans
        .iter()
        .filter_map(|abs| rel_posix(cwd, abs))
        .collect();

    let mut edits: Vec<FileEdit> = Vec::new();

    // 1. Згенеровані/перегенеровані `.avif` — байтами, і лише ті, що справді
    //    зʼявились або змінились (before/after-diff, як в усіх exec-tool).
    for file in list_files_with_extensions(cwd, &["avif"]) {
        if orphans.contains(&file) {
            continue;
        }
        let after = std::fs::read(cwd.join(&file)).ok();
        if after == *avif_before.get(&file).unwrap_or(&None) {
            continue;
        }
        let Some(bytes) = after else { continue };
        edits.push(FileEdit::WriteBytes(WriteBytesFile {
            path: file,
            content: bytes,
        }));
    }

    // 2. Rewrite-и `.vue`/`.html` — текстом, з готовим вмістом від `scan_avif`.
    for (abs, content) in &scan.rewrites {
        let Some(path) = rel_posix(cwd, abs) else {
            continue;
        };
        edits.push(byte_or_text_write(path, content.clone().into_bytes()));
    }

    // 3. Сироти — видалення, останніми.
    for path in orphans {
        edits.push(FileEdit::Delete { path });
    }

    Ok(FixPlan { edits })
}

/// Спавн генератора AVIF — порт `runAvifGeneration`
/// (`fix-avif_generation.mjs:344-366`) з обома полагодженими дефектами
/// (доккоментар [`image_avif_generation_fix`]).
fn run_avif_generation(
    cwd: &Path,
    resolve_tool: &dyn Fn(&str) -> Option<std::path::PathBuf>,
) -> Result<(), RulesError> {
    let Some(npx) = resolve_tool("npx") else {
        return Err(RulesError::Concern(format!(
            "image-avif/avif_generation: {}",
            runner_install_hint("npx")
        )));
    };

    let output = Command::new(&npx)
        .current_dir(cwd)
        .args([MINIFY_PACKAGE_NAME, "--src=.", "--write", "--avif"])
        .output()
        .map_err(|error| {
            RulesError::Concern(format!(
                "image-avif/avif_generation: не вдалося запустити `npx {MINIFY_PACKAGE_NAME} --avif`: {error}"
            ))
        })?;
    if !output.status.success() {
        return Err(RulesError::Concern(format!(
            "image-avif/avif_generation: `npx {MINIFY_PACKAGE_NAME} --avif` завершився з кодом {}: {}",
            output
                .status
                .code()
                .map_or_else(|| "signal".to_string(), |c| c.to_string()),
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    Ok(())
}

/// Абсолютний шлях під `cwd` → relative posix-шлях плану ([`FixPlan`] їх і
/// чекає — як `plan_writes_for_changed`). Шлях поза `cwd` дає `None`: у план
/// такий потрапити не може (safe-path валідатор контракту його все одно
/// відкине), і мовчки прокинути абсолютний шлях було б гірше.
fn rel_posix(cwd: &Path, abs: &Path) -> Option<String> {
    let rel = abs.strip_prefix(cwd).ok()?;
    Some(
        rel.components()
            .map(|c| c.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/"),
    )
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;
    use crate::diagnostics::Severity;

    /// Мінімальна валідна PNG-сигнатура — байти, які через `String` не
    /// проходять (той самий приклад, що в `rules-contract::fix`).
    const PNG_MAGIC: &[u8] = &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe];

    fn violation(reason: &str) -> Violation {
        Violation {
            reason: reason.to_string(),
            message: "m".to_string(),
            file: None,
            severity: Severity::Error,
            data: None,
        }
    }

    /// Резолвер, який не знаходить нічого — «тула немає в PATH».
    fn no_tool(_: &str) -> Option<std::path::PathBuf> {
        None
    }

    // ── image-compress/check ──

    #[test]
    fn compress_fix_without_matching_violation_is_empty_and_never_spawns() {
        let tmp = TempDir::new().unwrap();
        // Резолвер, що впав би панікою, якби його покликали: гейт по
        // violation-ах МУСИТЬ спрацювати до будь-якого пошуку тула.
        let boom = |_: &str| -> Option<std::path::PathBuf> {
            panic!("резолв тула до гейту")
        };
        let plan = image_compress_check_fix_with(tmp.path(), &[], &boom).unwrap();
        assert!(plan.edits.is_empty());
        let plan = image_compress_check_fix_with(tmp.path(), &[violation("other")], &boom).unwrap();
        assert!(plan.edits.is_empty());
    }

    /// Полагоджений дефект канону 1: відсутній `bunx` — ГУЧНА помилка, не
    /// `{ touchedFiles: [] }`.
    #[test]
    fn compress_fix_errors_loudly_when_bunx_is_missing() {
        let tmp = TempDir::new().unwrap();
        let error = image_compress_check_fix_with(
            tmp.path(),
            &[violation(NEEDS_COMPRESSION_REASON)],
            &no_tool,
        )
        .expect_err("відсутній bunx мусить бути помилкою, а не порожнім планом");
        let RulesError::Concern(message) = error else {
            panic!("очікували RulesError::Concern");
        };
        assert!(message.contains("image-compress/check"), "{message}");
        assert!(message.contains("bun.sh"), "install-підказка: {message}");
    }

    /// Дерево без жодного image-файлу — порожній план, і тул не спавниться:
    /// нема чого стискати. Резолвер віддає завідомо неіснуючий шлях, тож
    /// спавн упав би помилкою, якби до нього дійшло.
    #[test]
    fn compress_fix_is_empty_when_tree_has_no_images() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("readme.md"), "текст").unwrap();
        let fake = |_: &str| Some(std::path::PathBuf::from("/nonexistent/bunx"));
        let plan = image_compress_check_fix_with(
            tmp.path(),
            &[violation(NEEDS_COMPRESSION_REASON)],
            &fake,
        )
        .unwrap();
        assert!(plan.edits.is_empty());
    }

    /// Стаб замість `@nitra/minify-image`: shell-скрипт, який дописує байт
    /// у кожен `.png` — імітація «тул стиснув зображення». Зовнішнього
    /// пакета цей тест не потребує ЗОВСІМ (прецедент стабів — §2.82).
    #[test]
    fn compress_fix_plans_write_bytes_for_files_the_tool_changed() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("logo.png"), PNG_MAGIC).unwrap();
        fs::write(tmp.path().join("icon.png"), PNG_MAGIC).unwrap();

        // Стаб мутує РІВНО один файл — другий мусить лишитись поза планом.
        let stub = write_stub(
            tmp.path(),
            "bunx-stub",
            "printf '\\001' >> \"$PWD/logo.png\"\nexit 0\n",
        );
        let resolve = move |_: &str| Some(stub.clone());

        let plan = image_compress_check_fix_with(
            tmp.path(),
            &[violation(NEEDS_COMPRESSION_REASON)],
            &resolve,
        )
        .unwrap();

        assert_eq!(plan.edits.len(), 1, "у плані лише реально змінений файл");
        match &plan.edits[0] {
            FileEdit::WriteBytes(write) => {
                assert_eq!(write.path, "logo.png");
                assert_eq!(
                    write.content,
                    [PNG_MAGIC, &[0x01]].concat(),
                    "план несе БАЙТИ після прогону, не lossy-текст"
                );
            }
            other => panic!("бінарний файл мусить давати WriteBytes, а не {other:?}"),
        }
    }

    /// Полагоджений дефект канону 2: ненульовий код `--write` — ГУЧНА
    /// помилка, а не варн і порожній список.
    #[test]
    fn compress_fix_errors_loudly_when_tool_exits_non_zero() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("logo.png"), PNG_MAGIC).unwrap();
        let stub = write_stub(
            tmp.path(),
            "bunx-fail",
            "echo 'minify: не вдалось' >&2\nexit 3\n",
        );
        let resolve = move |_: &str| Some(stub.clone());

        let error = image_compress_check_fix_with(
            tmp.path(),
            &[violation(NEEDS_COMPRESSION_REASON)],
            &resolve,
        )
        .expect_err("ненульовий код тула мусить бути помилкою");
        let RulesError::Concern(message) = error else {
            panic!("очікували RulesError::Concern");
        };
        assert!(message.contains("кодом 3"), "{message}");
        assert!(message.contains("не вдалось"), "stderr тула: {message}");
    }

    // ── image-avif/avif_generation ──

    #[test]
    fn avif_fix_without_matching_violation_is_empty_and_never_spawns() {
        let tmp = TempDir::new().unwrap();
        let boom = |_: &str| -> Option<std::path::PathBuf> {
            panic!("резолв тула до гейту")
        };
        let plan = image_avif_generation_fix_with(tmp.path(), &[], &boom).unwrap();
        assert!(plan.edits.is_empty());
        let plan =
            image_avif_generation_fix_with(tmp.path(), &[violation("other")], &boom).unwrap();
        assert!(plan.edits.is_empty());
    }

    /// Полагоджений дефект канону 1: відсутній `npx` — ГУЧНА помилка.
    #[test]
    fn avif_fix_errors_loudly_when_npx_is_missing() {
        let tmp = TempDir::new().unwrap();
        let error =
            image_avif_generation_fix_with(tmp.path(), &[violation(AVIF_MISSING)], &no_tool)
                .expect_err("відсутній npx мусить бути помилкою");
        let RulesError::Concern(message) = error else {
            panic!("очікували RulesError::Concern");
        };
        assert!(message.contains("image-avif/avif_generation"), "{message}");
        assert!(
            message.contains("nodejs.org"),
            "install-підказка: {message}"
        );
    }

    /// Полагоджений дефект канону 2: ненульовий код `--avif` більше не
    /// «провалюється далі» на rescan.
    #[test]
    fn avif_fix_errors_loudly_when_generator_exits_non_zero() {
        let tmp = TempDir::new().unwrap();
        let stub = write_stub(tmp.path(), "npx-fail", "echo 'avif: збій' >&2\nexit 2\n");
        let resolve = move |_: &str| Some(stub.clone());
        let error =
            image_avif_generation_fix_with(tmp.path(), &[violation(AVIF_MISSING)], &resolve)
                .expect_err("ненульовий код генератора мусить бути помилкою");
        let RulesError::Concern(message) = error else {
            panic!("очікували RulesError::Concern");
        };
        assert!(message.contains("кодом 2"), "{message}");
        assert!(message.contains("збій"), "stderr тула: {message}");
    }

    /// Змішаний план: згенерований двійник — байтами, rewrite `.vue` —
    /// текстом. Саме та розкладка, заради якої концерн НЕ заганяється у
    /// `WriteBytes` цілком.
    #[test]
    fn avif_fix_mixes_byte_writes_for_avif_with_text_writes_for_vue() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("package.json"), r#"{"name":"t"}"#).unwrap();
        fs::write(tmp.path().join("hero.png"), PNG_MAGIC).unwrap();
        fs::write(
            tmp.path().join("App.vue"),
            "<template><img src=\"./hero.png\" /></template>\n",
        )
        .unwrap();

        // Стаб-генератор кладе бінарний `.avif` поряд — те, що робить
        // справжній `@nitra/minify-image --avif`.
        let stub = write_stub(
            tmp.path(),
            "npx-avif",
            "printf '\\000\\000\\000\\034ftypavif\\377' > \"$PWD/hero.png.avif\"\nexit 0\n",
        );
        let resolve = move |_: &str| Some(stub.clone());

        let plan =
            image_avif_generation_fix_with(tmp.path(), &[violation(AVIF_NEEDS_REWRITE)], &resolve)
                .unwrap();

        let bytes: Vec<&str> = plan
            .edits
            .iter()
            .filter_map(|e| match e {
                FileEdit::WriteBytes(w) => Some(w.path.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(
            bytes,
            vec!["hero.png.avif"],
            "згенерований двійник мусить бути у плані — і саме байтами"
        );

        let texts: Vec<&str> = plan
            .edits
            .iter()
            .filter_map(|e| match e {
                FileEdit::Write(w) => Some(w.path.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(texts, vec!["App.vue"], "rewrite шаблона лишається ТЕКСТОМ");

        let FileEdit::Write(vue) = plan
            .edits
            .iter()
            .find(|e| matches!(e, FileEdit::Write(w) if w.path == "App.vue"))
            .unwrap()
        else {
            unreachable!()
        };
        assert!(
            vue.content.contains("./hero.png.avif"),
            "посилання переписане: {}",
            vue.content
        );
    }

    /// Сироти йдуть у план `Delete`-ами й НЕ дублюються `WriteBytes`-ом.
    #[test]
    fn avif_fix_plans_delete_for_orphans_without_also_writing_them() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("package.json"), r#"{"name":"t"}"#).unwrap();
        fs::write(tmp.path().join("hero.png"), PNG_MAGIC).unwrap();
        fs::write(
            tmp.path().join("App.vue"),
            // Растрове посилання потрібне, щоб `scan_avif` не пішов у
            // ранній `skipped` — сироти рахуються лише за реального скану.
            "<template><img src=\"./hero.png\" /></template>\n",
        )
        .unwrap();
        fs::write(
            tmp.path().join("hero.png.avif"),
            b"\x00\x00\x00\x1cftypavif",
        )
        .unwrap();
        // Двійник, на який НІХТО не посилається — сирота.
        fs::write(
            tmp.path().join("gone.png.avif"),
            b"\x00\x00\x00\x1cftypavif",
        )
        .unwrap();

        // Генерацію вимикаємо тим самим env-перемикачем, що й канон, —
        // сироти рахує rescan, а не тул.
        let stub = write_stub(tmp.path(), "npx-noop", "exit 0\n");
        let resolve = move |_: &str| Some(stub.clone());

        let plan = image_avif_generation_fix_with(tmp.path(), &[violation(AVIF_ORPHAN)], &resolve)
            .unwrap();

        let deletes: Vec<&str> = plan
            .edits
            .iter()
            .filter_map(|e| match e {
                FileEdit::Delete { path } => Some(path.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(deletes, vec!["gone.png.avif"]);
        assert!(
            !plan
                .edits
                .iter()
                .any(|e| matches!(e, FileEdit::WriteBytes(w) if w.path == "gone.png.avif")),
            "сирота не може одночасно плануватись на запис і на видалення"
        );
    }

    /// Хелпер: виконуваний sh-стаб у теці, ЗОВНІШНІЙ щодо сканованого дерева
    /// (інакше сам стаб потрапив би в обхід і в план).
    fn write_stub(near: &Path, name: &str, body: &str) -> std::path::PathBuf {
        let dir = near.parent().unwrap_or(near).join(format!("{name}-bin"));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        fs::write(&path, format!("#!/bin/sh\n{body}")).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        }
        path
    }
}
