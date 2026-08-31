//! Native fix-домен для builtin-концернів (T1 зрізу 4 + T2 зрізу 5 фази 7,
//! `docs/specs/2026-07-30-rules-v2-rust-core-migration.md` §4) — Rust-порт
//! T0-патернів (`fix-<concern>.mjs`, `npm/scripts/lib/lint-surface/types.mjs`
//! `T0Pattern`). Два пілотні builtin-концерни (T1 зрізу 4):
//! `doc-files/marksman_config` і `hasura/migrations`; розгортання на решту T0
//! (T2 зрізу 5): `tauri/gitignore_target`, `tauri/linux_deps`,
//! `tauri/cargo_mutants_config`, `hasura/internal_urls` — кожен точний
//! семантичний порт свого видаленого `fix-<concern>.mjs`.
//!
//! # T3 — перша хвиля exec-tool + структурного класу (`docs/plans/2026-08-05-open-questions-register.md` §2.67)
//!
//! `text/oxfmt`/`text/markdownlint` — перші native-фікси, чия
//! Rust-функція сама спавнить зовнішній процес (`oxfmt --write`/`npx
//! markdownlint-cli2 --fix`) ПЕРЕД тим, як побудувати [`FixPlan`]: без
//! wasm-пісочниці й без host-diff-протоколу (§2.64, `run_wasm_concern_fix`)
//! — просто `before`/`after`-diff у тій самій синхронній функції, що вже
//! знає, які файли торкнула. `nginx-default-tpl/template` — структурний
//! (два патерни: legacy-rename + директива), reuse геть детектора
//! ([`super::nginx_default_tpl_template`]). Деталі вибору й вимір вартості
//! — §2.67 реєстру.
//!
//! # T4 — друга хвиля exec-tool (ядро): `changelog/consistency`
//!
//! Хвиля бралася трійкою «ядрових exec-tool» концернів плану
//! (`docs/plans/2026-08-29-js-rust-migration-completion-plan.md` §3):
//! `changelog/consistency`, `image-compress/check`, `text/cspell-fix`.
//! Портованим виявився один — решта два вже мали відповідь, і вимірювання
//! її підтвердило (деталі — §2.NN реєстру, `docs/plans/2026-08-05-open-questions-register.md`):
//!
//! - **`changelog/consistency`** — портовано ([`changelog_consistency_fix`]).
//!   Клас exec-tool із підкласом «тул нічого не мутує»: спавн (`git log -1
//!   --format=%s`) лише наповнює ВМІСТ, який планує сам Rust, тож
//!   before/after-diff диска (T3, `text/oxfmt`) тут навіть не потрібен.
//! - **`image-compress/check`** — структурно НЕ виражається [`FixPlan`]:
//!   секція «Свідомо НЕ портовані» нижче.
//! - **`text/cspell-fix`** — не T0-фікс узагалі: це fix-**воркер**
//!   (`fix-worker.mjs`, LLM-драбина), і він УЖЕ портований нативно —
//!   `crates/rules-fix/src/workers.rs::build_cspell_worker` поверх чистих
//!   хелперів [`super::cspell_fix`] (`detect_cspell`/`unknown_words`/
//!   `classify_prompt`/`parse_classify`/`append_words_to_dict`).
//!   [`NATIVE_FIXES`] — реєстр T0-патернів; ключ воркерного концерну тут
//!   створив би фіктивний T0-патерн, який ЗАТІНИВ би реальний шлях
//!   (`loadT0Patterns` повертає РІВНО native-патерн, коли ключ у реєстрі).
//!   Тож запис свідомо не додається — концерн уже native, просто іншим
//!   класом виконавця.
//!
//! # T5 — ядрова пʼятірка родини `vscode_extensions` (§2.75 реєстру)
//!
//! `doc-files/vscode_extensions`, `graphql/vscode_extensions`,
//! `rego/vscode_extensions`, `tauri/vscode_extensions`,
//! `text/vscode_extensions` — усі пʼять стоять на ОДНОМУ JS-рушії
//! (`npm/scripts/lib/fix/vscode-ext-add.mjs`), тож і порт — один рушій плюс
//! пʼять записів конфігурації: [`super::fix_vscode_extensions`] (там же —
//! семантика мержу й перелік полагоджених дефектів канону). Спільний
//! JSONC-парс/серіалізацію бере крейт `rules-template-merge` (§2.71), а не
//! друга копія в ядрі.
//! # T6 — родина `createTemplateFixPattern` (§2.74)
//!
//! `rego/vscode_settings`, `text/vscode_settings`, `worktree/vscode_settings`,
//! `worktree/zed_settings` і `text/oxfmtrc` — пʼять КОНФІГІВ на один рушій,
//! а не пʼять реалізацій: JS-канон цих концернів — тонкі шими навколо
//! `createTemplateFixPattern` (`npm/scripts/lib/fix/template-deep-merge.mjs`),
//! тож і порт конфіг-подібний ([`super::fix_template_merge::TemplateFixCfg`]).
//! Сама семантика мержу живе у спільному крейті `rules-template-merge`
//! (§2.71), який беруть ОБИДВІ колії міграції — ядро тут і wasm-гості
//! `ci-github`/`ci-azure`. Три свідомі відхилення від канону НА КРАЩЕ
//! (JSONC-вхід більше не губиться, не-обʼєктний корінь більше не
//! знищується, коментарі виживають) — доккомент
//! [`super::fix_template_merge`].
//!
//! # T7 — «поодинокі» ядра (§2.79 реєстру)
//!
//! Розділ 4 плану міграції («Поодинокі») дав ядру чотири концерни без
//! спільної форми. Портованих — ДВА, і решта два не «не встигли», а
//! структурно не є T0-фіксами:
//!
//! - **`tauri/updater`** — портовано ([`super::fix_tauri_updater`]).
//!   Чотири патерни `fix-updater.mjs` (package.json, Cargo.toml, lib.rs,
//!   capabilities). У стіну сусіда `tauri/release` (format-preserving
//!   YAML) НЕ впирається — жодного YAML і жодного спавну процесу.
//! - **`text/cspell`** — портовано ([`super::fix_cspell_config`]).
//!   Policy-концерн (детектор лишається на JS-policy-адаптері + rego,
//!   як у родини `vscode_extensions`), T0-патерн — merge-запис
//!   `.cspell.json`. НЕ плутати з `text/cspell-fix` (розділ T4 вище):
//!   то LLM-воркер, і ключа в [`NATIVE_FIXES`] у нього бути не може.
//! - **`doc-files/check`** — НЕ T0-фікс. У концерні є лише
//!   `fix-worker.mjs` (LLM-драбина: docgen-pipeline генерує застарілі
//!   доки й чистить сирітські), а `fix-check.mjs` СВІДОМО відсутній —
//!   його доккомент фіксує інваріант: `crc-mismatch` не можна закривати
//!   детермінованим штампом CRC, бо свіжий CRC поверх старого тексту
//!   назавжди маскує дрейф. Ключ у [`NATIVE_FIXES`] створив би фіктивний
//!   T0-патерн і ЗАТІНИВ би воркерний шлях (`loadT0Patterns` повертає
//!   РІВНО native-патерн, коли ключ у реєстрі) — той самий капкан, що
//!   описано для `text/cspell-fix`. Запис свідомо не додається.
//! - **`test/coverage`** — теж НЕ T0-фікс: `fix-worker.mjs` поверх
//!   fix-hooks coverage-провайдерів мовних плагінів (`generateTests`/
//!   `generateStories`/`fixSurvived`/`fixFailingTests` — агентні сесії),
//!   `concern.json` → `"fixability": "code"`, `"skipLocalTier": true`.
//!   Детермінованого патерну немає взагалі, і ядру він не належить:
//!   робота живе в провайдерах lang-плагінів. Запис у [`NATIVE_FIXES`] —
//!   та сама фікція, що вище.
//!
//! # Свідомо НЕ портовані T0-фікси (лишаються JS)
//!
//! Порожньо. Останній мешканець цієї секції — `tauri/release` — виїхав:
//! [`super::fix_tauri_release`] (§2.97). Його рація трималась на трьох
//! пунктах, з яких два застаріли непоміченими (format-preserving YAML зʼявився
//! з §2.71, а спавн `git` замінився читанням `.git/config`), а третій —
//! позиційна вставка кроку — блокував лише ДВА патерни з пʼятьох, але
//! записаний був як загальний. Урок ширший за концерн: рація «не портуємо»
//! має переглядатись разом із інструментом, інакше вона живе довше за причину.
//!
//! # T8 — бінарна родина `image-*` (§2.85): обидва блокованих концерни портовані
//!
//! `image-compress/check` і `image-avif/avif_generation` роками стояли в
//! секції «свідомо НЕ портовані» вище з ОДНІЄЮ причиною: [`FixPlan`] не мав
//! бінарного edit-у, а обхід «стиснути й повернути порожній план» —
//! мовчазний обман (файли на диску змінені, звіт каже «0 файлів»). Мажор
//! `n-rules:plugin@4.0.0` (§2.84) завів [`FileEdit::WriteBytes`], і ця
//! хвиля — його перші споживачі: [`super::fix_image`].
//!
//! Ключове тут — байти пішли РІВНО туди, де вони справді байти.
//! `image-compress` бінарний наскрізь; `image-avif` — змішаний, і його план
//! лишається текстовим на дві третини (rewrite `.vue`/`.html` —
//! [`FileEdit::Write`], сироти — [`FileEdit::Delete`], і лише згенеровані
//! `.avif`-двійники — [`FileEdit::WriteBytes`]). Розкладка й чотири
//! полагоджені дефекти канону — доккоментарі [`super::fix_image`].
//!
//! Побічний, але не менш важливий наслідок хвилі — полагоджена вада
//! СПІЛЬНОГО хвоста всіх exec-tool фіксів: [`snapshot_before`] знімався
//! `read_to_string`-ом, тож не-UTF-8 файл читався як `None` і до, і після
//! прогону тула — «не змінився». Нативний родич тієї вади, що §2.83 закрила
//! на detect-боці (`String::from_utf8_lossy` у `read_source_files`,
//! `crates/rules-napi`), лише тихіший: там байти калічились, тут зникали.
//!
//! # Форма — спільні типи `rules-contract::fix` (дзеркало злито)
//!
//! [`FixPlan`]/[`FileEdit`]/[`WriteFile`] — реекспорт
//! `rules_contract::fix::{FixPlan, FileEdit, WriteFile}` (той самий
//! `#[serde(tag = "type", rename_all = "lowercase")]` дискримінант
//! `"write"`/`"delete"`, той самий мінімум "повний новий вміст або
//! видалення", доккомент модуля `crates/rules-contract/src/fix.rs`).
//! Раніше тут жило структурне дзеркало БЕЗ залежності на `rules-contract`
//! (задокументований план злиття T1 зрізу 4); умова плану — «коли fix-домен
//! узагальниться до єдиного інтерфейсу builtin ↔ wasm» — виконана з
//! активацією fix-контуру contract v3 (napi `run_wasm_concern_fix` +
//! `run-fix.mjs` подають ОБИДВА шляхи через один конвеєр T0Pattern-обгорток
//! над однаковим JSON-планом), тож дублікат видалено. Напрямок залежності
//! `rules-core` → `rules-contract` — рівно той, що з самого початку
//! документує `crate`-doc-коментар `rules-contract/src/lib.rs` («Залежність
//! — лише в один бік: `rules-core` → `rules-contract`, ніколи навпаки»);
//! `rules-contract` — чистий serde-DTO крейт без WIT-кодогенерації і без
//! wasm-рушія (wasmtime лінкує лише `rules-plugin-host`), тож native-шлях
//! нічого зайвого не тягне. Diagnostics DTO
//! ([`crate::diagnostics::Violation`] ⇄ `rules_contract::diagnostic::Diagnostic`)
//! лишається дзеркалом зі своїм окремим планом злиття (доккомент
//! `rules-contract/src/lib.rs`) — воно поза обсягом цього кроку.
//!
//! # Реєстр [`NATIVE_FIXES`] і диспетчер [`run_concern_fix`]
//!
//! Дзеркалить [`super::NATIVE_CONCERNS`]/[`super::run_concern`]: JS-оркестратор
//! (`run-fix.mjs`) звіряє належність `ruleId/concernId`-ключа до
//! [`NATIVE_FIXES`] ДО виклику — невідомий ключ тут теж повертає
//! `RulesError::Concern`, той самий останній рубіж захисту, не основний
//! контракт маршрутизації.
//!
//! На відміну від [`super::run_concern`] (детектор може мати
//! `files`-параметр), fix-домен нічого не ПИШЕ сам — [`run_concern_fix`]
//! лише БУДУЄ [`FixPlan`] (декларативний список операцій); застосування
//! (`fs::write`/`fs::remove_file`, `ctx.recordWrite` для rollback-контракту)
//! лишається на JS-боці (`run-fix.mjs`, обгортка над T0Pattern — секція
//! нижче). ЧИТАТИ файлову систему від `cwd` фіксам дозволено (і T2-фікси
//! зрізу 5 це роблять: умовний edit залежно від наявного вмісту файлу —
//! splice в `.gitignore`/workflow, rescan `src-tauri/`-каталогів, звірка
//! k8s-yaml) — той самий read-only мандат, що й у детекторів; два пілоти T1
//! (`marksman_config`, `migrations`) `cwd` не потребують.
//!
//! # Зміна семантики: install-guard недосяжний у native
//!
//! JS-версія `fix-marksman_config.mjs` перевіряє `existsSync(MARKSMAN_BASELINE_PATH)`
//! ПЕРЕД копіюванням і кидає дружню помилку «інсталяція @7n/rules пошкоджена,
//! перевстанови пакет» — це install-sanity-guard проти зламаного npm-пакета
//! (відсутній `data/marksman_config/marksman.baseline.toml` через обрізаний
//! `files`-whitelist чи пошкоджений `node_modules`). Native-порт вбудовує
//! baseline у бінарник через `include_str!` НА ЕТАПІ КОМПІЛЯЦІЇ — файл
//! стає частиною самого cdylib/бінаря, а не окремим artifact-ом на диску,
//! який можна «загубити» при встановленні npm-пакета. Це означає:
//!
//!   - клас помилки «canonical baseline відсутній на диску» СТРУКТУРНО
//!     неможливий для native-шляху — якщо аддон завантажився і
//!     [`contract_version`](../../../rules-napi) збігається, baseline ГАРАНТОВАНО
//!     є (він зашитий у той самий бінарний файл, що й код перевірки);
//!   - install-guard і його дружнє повідомлення («перевстанови пакет»)
//!     НЕ портуються — немає стану, який вони мали б ловити;
//!   - це свідома зміна поведінки зламаної інсталяції, не забутий кейс:
//!     стара JS-гілка (і її тест) явно документують, що вона більше не
//!     застосовна до native-шляху (секція в тесті fix-run.mjs/T0-обгортки,
//!     дивись план задачі — «install-guard тест marksman — його онови під
//!     нову семантику»).

use std::path::Path;
use std::process::Command;

use crate::tool_resolve::resolve_cmd;
use crate::{diagnostics::Violation, RulesError};

/// Спільні DTO fix-домену — реекспорт із `rules-contract` (злиття дзеркала,
/// доккомент модуля вище): `FixPlan` — впорядкований список операцій,
/// порожній = «для цих violations фіксити нічого» (контракт «непорожній
/// план» ⇔ «застосовний», який JS-обгортка (`run-fix.mjs`) використовує
/// замість окремого `T0Pattern.test()`); `FileEdit` — `type`-дискримінант
/// `"write"`/`"delete"`; `WriteFile.path` — posix-relative шлях від cwd
/// (той самий контракт, що `rules_contract::detect::SourceFile::path`).
pub use rules_contract::fix::{FileEdit, FixPlan, WriteBytesFile, WriteFile};

/// Canonical baseline `.marksman.toml`, вбудований у бінарник на етапі
/// компіляції — джерело правди те саме, що постачається в npm-пакеті
/// (`npm/rules/doc-files/marksman_config/data/marksman_config/marksman.baseline.toml`,
/// той самий файл, який читає JS-фіксер через `MARKSMAN_BASELINE_PATH`).
/// Секція «Зміна семантики» вище пояснює, чому install-guard,
/// що охороняв JS-версію цього читання, тут не потрібен.
const MARKSMAN_BASELINE: &str = include_str!(
    "../../../../npm/rules/doc-files/marksman_config/data/marksman_config/marksman.baseline.toml"
);

/// Ціль copy-фіксу — порт `MARKSMAN_TARGET_FILENAME`
/// (`fix-marksman_config.mjs:18`, `crates/rules-core/src/concerns/marksman_config.rs:29`).
const MARKSMAN_TARGET_FILENAME: &str = ".marksman.toml";

/// Ключ `data.kind`, за яким детектор [`super::marksman_config`] позначає
/// violation (`crates/rules-core/src/concerns/marksman_config.rs:33,50`) —
/// той самий, за яким матчився JS T0-патерн (`v.data?.kind`).
const MARKSMAN_MISSING_KIND: &str = "marksman-config-missing";

/// T0-фікс `doc-files/marksman_config` — точний семантичний порт
/// `patterns[0]` з `fix-marksman_config.mjs` (мінус install-guard, секція
/// доккомент модуля вище). Застосовність: хоча б одна violation з
/// `data.kind === "marksman-config-missing"` (`test()` у JS-версії) — план
/// непорожній лише тоді.
fn marksman_config_fix(violations: &[Violation]) -> FixPlan {
    let applicable = violations.iter().any(|v| {
        v.data
            .as_ref()
            .and_then(|d| d.get("kind"))
            .and_then(|k| k.as_str())
            == Some(MARKSMAN_MISSING_KIND)
    });
    if !applicable {
        return FixPlan::default();
    }
    FixPlan {
        edits: vec![FileEdit::Write(WriteFile {
            path: MARKSMAN_TARGET_FILENAME.to_string(),
            content: MARKSMAN_BASELINE.to_string(),
        })],
    }
}

/// `reason`, за яким детектор [`super::hasura_migrations`] позначає
/// violation (`crates/rules-core/src/concerns/hasura_migrations.rs:19`) —
/// той самий, за яким матчився JS T0-патерн (`v.reason === 'down-sql-forbidden'`).
const HASURA_DOWN_SQL_REASON: &str = "down-sql-forbidden";

/// T0-фікс `hasura/migrations` — точний семантичний порт `patterns[0]` з
/// `fix-migrations.mjs`: видалити кожен `down.sql`, на який вказує
/// violation з `reason === "down-sql-forbidden"`. Дедуп за шляхом (той самий
/// `[...new Set(...)]` у JS) — план не містить дублікатів `Delete` для
/// одного файлу, навіть якщо кілька violations вказують на нього.
fn hasura_migrations_fix(violations: &[Violation]) -> FixPlan {
    let mut seen = std::collections::HashSet::new();
    let mut edits = Vec::new();
    for v in violations {
        if v.reason != HASURA_DOWN_SQL_REASON {
            continue;
        }
        let Some(file) = &v.file else { continue };
        if !seen.insert(file.clone()) {
            continue;
        }
        edits.push(FileEdit::Delete { path: file.clone() });
    }
    FixPlan { edits }
}

// ── tauri/gitignore_target ──────────────────────────────────────────────────

/// Заголовок-коментар секції Tauri build-артефактів у корінному `.gitignore` —
/// порт `GITIGNORE_TARGET_HEADER` (`fix-gitignore_target.mjs:25`).
const GITIGNORE_TARGET_HEADER: &str = "# Tauri — Rust build artifacts (tauri.mdc)";

/// Знаходить кінець контурного блоку entries, що йде одразу за заголовком
/// (перший порожній рядок, наступний коментар або кінець файла) — точний
/// порт `findBlockEnd` (`fix-gitignore_target.mjs:34-38`).
fn find_gitignore_block_end(lines: &[&str], header_idx: usize) -> usize {
    let mut i = header_idx + 1;
    while i < lines.len() {
        let t = lines[i].trim();
        if t.is_empty() || t.starts_with('#') {
            break;
        }
        i += 1;
    }
    i
}

/// Дописує відсутні `<ws>/src-tauri/target/` entries: якщо секція
/// [`GITIGNORE_TARGET_HEADER`] вже є — вставляє в кінець її блоку (поруч з
/// наявними entries); інакше додає новий блок (заголовок + entries) у кінець
/// файла — точний порт `insertMissingTargetEntries`
/// (`fix-gitignore_target.mjs:48-68`). `None` — нічого не змінилось.
fn insert_missing_target_entries(content: &str, missing: &[String]) -> Option<String> {
    if missing.is_empty() {
        return None;
    }

    let lines: Vec<&str> = content.split('\n').collect();
    if let Some(header_idx) = lines
        .iter()
        .position(|l| l.trim() == GITIGNORE_TARGET_HEADER)
    {
        let block_end = find_gitignore_block_end(&lines, header_idx);
        let mut next: Vec<&str> = lines.clone();
        next.splice(block_end..block_end, missing.iter().map(String::as_str));
        return Some(next.join("\n"));
    }

    let trailing_blank = lines.last() == Some(&"");
    let body = if trailing_blank {
        &lines[..lines.len() - 1]
    } else {
        &lines[..]
    };
    let needs_blank_sep = body.last().is_some_and(|l| !l.trim().is_empty());

    let mut next: Vec<&str> = body.to_vec();
    if needs_blank_sep {
        next.push("");
    }
    next.push(GITIGNORE_TARGET_HEADER);
    next.extend(missing.iter().map(String::as_str));
    next.push("");
    Some(next.join("\n"))
}

/// T0-фікс `tauri/gitignore_target` — точний семантичний порт `patterns[0]` з
/// `fix-gitignore_target.mjs`: для кожної violation з
/// `data.kind == "missing-gitignore-target-entries"` і `file` читає файл від
/// `cwd`, вставляє `data.missing`-entries і планує write повним новим вмістом.
/// Дедуп за шляхом + «перша violation файла перемагає» — той самий
/// `[...new Set(files)]` + `targets.find(x => x.file === rel)` у
/// `applyToFiles`-обгортці JS. Нечитабельний/відсутній файл — skip (той самий
/// `try { readFileSync } catch { continue }` в `apply-to-files.mjs:22-27`:
/// JS-фіксер ніколи не СТВОРЮВАВ `.gitignore` з нуля, лише доповнював
/// наявний — поведінка збережена 1:1).
fn tauri_gitignore_target_fix(cwd: &Path, violations: &[Violation]) -> FixPlan {
    let mut seen = std::collections::HashSet::new();
    let mut edits = Vec::new();
    for v in violations {
        let kind = v
            .data
            .as_ref()
            .and_then(|d| d.get("kind"))
            .and_then(|k| k.as_str());
        if kind != Some(super::tauri_gitignore_target::MISSING_GITIGNORE_TARGET_ENTRIES) {
            continue;
        }
        let Some(file) = &v.file else { continue };
        if !seen.insert(file.clone()) {
            continue;
        }
        let missing: Vec<String> = v
            .data
            .as_ref()
            .and_then(|d| d.get("missing"))
            .and_then(|m| m.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        let Ok(content) = std::fs::read_to_string(cwd.join(file)) else {
            continue;
        };
        if let Some(next) = insert_missing_target_entries(&content, &missing) {
            if next != content {
                edits.push(FileEdit::Write(WriteFile {
                    path: file.clone(),
                    content: next,
                }));
            }
        }
    }
    FixPlan { edits }
}

// ── tauri/linux_deps ────────────────────────────────────────────────────────

/// Порт `TOOLCHAIN_RE` (`fix-linux_deps.mjs:58`,
/// `/uses:\s*dtolnay\/rust-toolchain@/u`).
static TOOLCHAIN_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
    regex::Regex::new(r"uses:\s*dtolnay/rust-toolchain@").expect("valid regex")
});

/// Вставляє канонічний apt-крок перед першим `dtolnay/rust-toolchain@…`
/// кроком (той самий рівень step-list-а). Якщо apt-крок уже є або
/// toolchain-кроку немає (нетипове форматування — лишаємо T1/LLM), нічого не
/// змінює — точний порт `insertLinuxDepsStep` (`fix-linux_deps.mjs:67-84`).
fn insert_linux_deps_step(content: &str) -> Option<String> {
    use super::tauri_linux_deps::{APT_INSTALL_RE, REQUIRED_LINUX_PACKAGES};
    if content.lines().any(|l| APT_INSTALL_RE.is_match(l)) {
        return None;
    }
    let lines: Vec<&str> = content.split('\n').collect();
    let at = lines.iter().position(|l| TOOLCHAIN_RE.is_match(l))?;
    // `uses:` гарантовано присутній (TOOLCHAIN_RE щойно зматчив цей рядок).
    let uses_col = lines[at].find("uses:").unwrap_or(0);
    let ind = " ".repeat(uses_col.saturating_sub(2));
    let step = [
        format!("{ind}- name: Системні залежності Tauri (Linux)"),
        format!("{ind}  run: |"),
        format!("{ind}    sudo apt-get update"),
        format!(
            "{ind}    sudo apt-get install -y {}",
            REQUIRED_LINUX_PACKAGES.join(" ")
        ),
        String::new(),
    ];
    let mut next: Vec<String> = lines.iter().map(|s| (*s).to_string()).collect();
    next.splice(at..at, step);
    Some(next.join("\n"))
}

/// Дописує відсутні канонічні пакети в кінець наявного `apt-get
/// install`-рядка (з урахуванням trailing `\` shell-continuation) — точний
/// порт `appendMissingPackages` (`fix-linux_deps.mjs:92-101`).
fn append_missing_packages(content: &str) -> Option<String> {
    use super::tauri_linux_deps::{APT_INSTALL_RE, REQUIRED_LINUX_PACKAGES};
    let lines: Vec<&str> = content.split('\n').collect();
    let apt_idx = lines.iter().position(|l| APT_INSTALL_RE.is_match(l))?;
    let missing: Vec<&str> = REQUIRED_LINUX_PACKAGES
        .iter()
        .copied()
        .filter(|p| !content.contains(p))
        .collect();
    if missing.is_empty() {
        return None;
    }
    let trimmed = lines[apt_idx].trim_end();
    let new_line = if let Some(stripped) = trimmed.strip_suffix('\\') {
        format!("{} {} \\", stripped.trim_end(), missing.join(" "))
    } else {
        format!("{} {}", trimmed, missing.join(" "))
    };
    let mut next: Vec<&str> = lines.clone();
    next[apt_idx] = &new_line;
    Some(next.join("\n"))
}

/// T0-фікс `tauri/linux_deps` — точний семантичний порт обох патернів з
/// `fix-linux_deps.mjs` (`tauri-linux-deps-insert` +
/// `tauri-linux-deps-packages`): по `data.kind` кожної violation читає
/// workflow-файл від `cwd`, повторно сканує його стан (як JS — індекс
/// apt-рядка не входить у `violation.data`) і планує write повним новим
/// вмістом. Дедуп за шляхом: перша violation файла перемагає — детектор
/// ніколи не емить обидва kind-и для одного файла (`tauri_linux_deps.rs`:
/// step-гілка повертається раніше packages-гілки), тож розбіжності з
/// двопатерновим JS-порядком тут структурно немає.
fn tauri_linux_deps_fix(cwd: &Path, violations: &[Violation]) -> FixPlan {
    use super::tauri_linux_deps::{MISSING_LINUX_DEPS_PACKAGES, MISSING_LINUX_DEPS_STEP};
    let mut seen = std::collections::HashSet::new();
    let mut edits = Vec::new();
    for v in violations {
        let kind = v
            .data
            .as_ref()
            .and_then(|d| d.get("kind"))
            .and_then(|k| k.as_str());
        let transform = match kind {
            Some(k) if k == MISSING_LINUX_DEPS_STEP => insert_linux_deps_step,
            Some(k) if k == MISSING_LINUX_DEPS_PACKAGES => append_missing_packages,
            _ => continue,
        };
        let Some(file) = &v.file else { continue };
        if !seen.insert(file.clone()) {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(cwd.join(file)) else {
            continue;
        };
        if let Some(next) = transform(&content) {
            if next != content {
                edits.push(FileEdit::Write(WriteFile {
                    path: file.clone(),
                    content: next,
                }));
            }
        }
    }
    FixPlan { edits }
}

// ── tauri/cargo_mutants_config ──────────────────────────────────────────────

/// Шапка-коментар канонічного mutants-конфігу Tauri — порт
/// `TAURI_BASELINE_HEADER` (`fix-cargo_mutants_config.mjs:34-37`).
const TAURI_BASELINE_HEADER: &str = "# .cargo/mutants.toml — Tauri canonical cargo-mutants config (tauri.mdc).\n# Виключаємо --bins і --doc щоб бінарник Tauri та doc-tests не збиралися повторно\n# з нуля під кожного мутанта (секунди → хвилини).\n";

/// TOML-фрагмент ключа `additional_cargo_test_args` — порт
/// `TAURI_KEY_SNIPPETS.additional_cargo_test_args`
/// (`fix-cargo_mutants_config.mjs:41`).
const TAURI_SNIPPET_TEST_ARGS: &str = "additional_cargo_test_args = [\"--lib\", \"--tests\"]\n";

/// TOML-фрагмент ключа `exclude_globs` — порт
/// `TAURI_KEY_SNIPPETS.exclude_globs` (`fix-cargo_mutants_config.mjs:42-58`).
const TAURI_SNIPPET_EXCLUDE_GLOBS: &str = r#"# Platform bridge / app shell — boundary-файли (тестуються smoke/e2e, не mutation unit).
# Якщо у bridge-файлі з'являється pure/business logic — винеси її у platform-neutral
# модуль (src/auth/oauth.rs, src/gmail/message.rs, ...) і тестуй mutation-testing там.
# src/lib.rs (Tauri pub fn run) — runtime entrypoint, що запускає весь app shell:
# один мутант там тримає весь Tauri runtime, тому ділить sandbox-фейл з src/main.rs.
exclude_globs = [
  "src/main.rs",
  "src/lib.rs",
  "src/**/android.rs",
  "src/**/ios.rs",
  "src/**/mobile.rs",
  "src/**/desktop.rs",
  "src/**/macos.rs",
  "src/**/windows.rs",
  "src/**/linux.rs"
]
"#;

/// TOML-фрагмент за канонічним ключем — порт `TAURI_KEY_SNIPPETS[key]`
/// (кожен ключ з `TAURI_CANONICAL_KEYS` детектора має свій сніпет).
fn tauri_key_snippet(key: &str) -> &'static str {
    match key {
        "additional_cargo_test_args" => TAURI_SNIPPET_TEST_ARGS,
        "exclude_globs" => TAURI_SNIPPET_EXCLUDE_GLOBS,
        other => unreachable!("невідомий канонічний ключ mutants-конфігу: {other}"),
    }
}

/// Будує повний Tauri-canonical baseline (для випадку, коли файла ще немає) —
/// точний порт `buildBaseline` (`fix-cargo_mutants_config.mjs:110-112`):
/// сніпети через `join('\n')` — між ними порожній рядок (кожен сніпет уже
/// завершується `\n`).
fn build_mutants_baseline() -> String {
    let snippets: Vec<&str> = super::tauri_cargo_mutants_config::TAURI_CANONICAL_KEYS
        .iter()
        .map(|k| tauri_key_snippet(k))
        .collect();
    format!("{TAURI_BASELINE_HEADER}{}", snippets.join("\n"))
}

/// Будує append-блок з відсутніх ключів; існуючий вміст не торкається —
/// точний порт `buildAppended` (`fix-cargo_mutants_config.mjs:99-104`).
fn build_mutants_appended(existing: &str, missing_keys: &[&str]) -> String {
    let tail = if existing.ends_with('\n') {
        existing.to_string()
    } else {
        format!("{existing}\n")
    };
    let mut block = String::from("\n# Tauri canonical cargo-mutants additions (tauri.mdc)\n");
    for key in missing_keys {
        block.push_str(tauri_key_snippet(key));
    }
    format!("{tail}{block}")
}

/// T0-фікс `tauri/cargo_mutants_config` — точний семантичний порт
/// `patterns[0]` з `fix-cargo_mutants_config.mjs`: застосовність — хоч одна
/// violation з reason `mutants-config-missing`/`mutants-keys-missing`;
/// далі (як JS) НЕ читає per-violation дані, а повторно сканує
/// `src-tauri/`-каталоги від `cwd` і стан кожного файла наново (idempotent —
/// already-complete пропускається). Відсутній файл → write повного baseline;
/// неповний → append лише відсутніх ключів (скан —
/// [`super::tauri_cargo_mutants_config::detect_missing_keys`], той самий, що
/// в detector-а; його fail-safe деградація «нечитабельний/побитий TOML → усі
/// ключі відсутні» тут дає append до фактичного вмісту, а не панік — JS у
/// цьому нетестованому edge-кейсі кидав rejected promise).
fn tauri_cargo_mutants_config_fix(cwd: &Path, violations: &[Violation]) -> FixPlan {
    use super::tauri_cargo_mutants_config::{
        detect_missing_keys, MUTANTS_CONFIG_MISSING, MUTANTS_KEYS_MISSING,
    };
    let applicable = violations
        .iter()
        .any(|v| v.reason == MUTANTS_CONFIG_MISSING || v.reason == MUTANTS_KEYS_MISSING);
    if !applicable {
        return FixPlan::default();
    }

    let mut edits = Vec::new();
    for dir in super::find_src_tauri::find_src_tauri_dirs(cwd) {
        let target = dir.join(".cargo").join("mutants.toml");
        let rel = super::find_src_tauri::relative_posix(cwd, &target);
        if !target.exists() {
            edits.push(FileEdit::Write(WriteFile {
                path: rel,
                content: build_mutants_baseline(),
            }));
            continue;
        }
        let missing = detect_missing_keys(&target);
        if missing.is_empty() {
            continue;
        }
        let existing = std::fs::read_to_string(&target).unwrap_or_default();
        edits.push(FileEdit::Write(WriteFile {
            path: rel,
            content: build_mutants_appended(&existing, &missing),
        }));
    }
    FixPlan { edits }
}

// ── hasura/internal_urls ────────────────────────────────────────────────────

/// Mismatch-reasons, які фіксить T0 — порт `MISMATCH_REASONS`
/// (`fix-internal_urls.mjs:30`). Структурно невалідний URL
/// (`internal-url-invalid`) — НЕ T0-фікс: `cluster`/`port` нізвідки
/// достовірно вивести, це людське рішення про інфраструктуру.
const INTERNAL_URL_MISMATCH_REASONS: &[&str] = &[
    "internal-url-service-mismatch",
    "internal-url-namespace-mismatch",
];

/// Переписує значення `HASURA_GRAPHQL_ENDPOINT` у вмісті на очікувані
/// `service`/`namespace`, зберігаючи `cluster`/`port` з наявного значення —
/// точний порт `rewriteEndpoint` (`fix-internal_urls.mjs:91-109`), без
/// запису: повертає новий вміст (`None` — нічого не змінилось).
fn rewrite_hasura_endpoint(
    content: &str,
    expected: &super::hasura_internal_urls::ExpectedSegments,
) -> Option<String> {
    use super::hasura_internal_urls::{parse_internal_hasura_endpoint, HASURA_ENDPOINT_LINE_RE};
    let caps = HASURA_ENDPOINT_LINE_RE.captures(content)?;
    let raw = caps.get(1)?;
    let parsed = parse_internal_hasura_endpoint(raw.as_str().trim())?;

    let service = expected.service.as_deref().unwrap_or(&parsed.service);
    let namespace = expected.namespace.as_deref().unwrap_or(&parsed.namespace);
    let next_value = format!(
        "http://{service}.{namespace}.svc.{}.internal:{}",
        parsed.cluster, parsed.port
    );
    if next_value == raw.as_str().trim() {
        return None;
    }
    Some(format!(
        "{}{next_value}{}",
        &content[..raw.start()],
        &content[raw.end()..]
    ))
}

/// T0-фікс `hasura/internal_urls` — точний семантичний порт `patterns[0]` з
/// `fix-internal_urls.mjs`: для унікальних файлів mismatch-violations читає
/// очікувані `service`/`namespace` з `hasura/k8s/base/{svc-hl,namespace}.yaml`
/// (той самий скан, що в detector-а —
/// [`super::hasura_internal_urls::compute_expected_endpoint_segments`]) і
/// планує write повним новим вмістом `.env`-файла.
fn hasura_internal_urls_fix(cwd: &Path, violations: &[Violation]) -> FixPlan {
    let mut seen = std::collections::HashSet::new();
    let mut files = Vec::new();
    for v in violations {
        if !INTERNAL_URL_MISMATCH_REASONS.contains(&v.reason.as_str()) {
            continue;
        }
        let Some(file) = &v.file else { continue };
        if seen.insert(file.clone()) {
            files.push(file.clone());
        }
    }
    if files.is_empty() {
        return FixPlan::default();
    }

    let expected = super::hasura_internal_urls::compute_expected_endpoint_segments(cwd);
    let mut edits = Vec::new();
    for file in files {
        let Ok(content) = std::fs::read_to_string(cwd.join(&file)) else {
            continue;
        };
        if let Some(next) = rewrite_hasura_endpoint(&content, &expected) {
            edits.push(FileEdit::Write(WriteFile {
                path: file,
                content: next,
            }));
        }
    }
    FixPlan { edits }
}

// ── text/oxfmt (хвиля T3, exec-tool клас) ───────────────────────────────────

/// `data.kind` детектора, за яким матчиться T0 — точний порт
/// `oxfmt-unformatted` (`crates/rules-core/src/concerns/text_oxfmt.rs::REASON`,
/// `fix-oxfmt.mjs:34`, `data.kind === 'oxfmt-unformatted'`).
const OXFMT_UNFORMATTED_KIND: &str = "oxfmt-unformatted";

/// Дедуплікує (зберігаючи порядок першої появи) файли з violations, чий
/// `data.kind` дорівнює `kind` — той самий `[...new Set(violations.filter(...).map(v
/// => v.file))]`, що повторюється в кожному JS T0-патерні цього класу
/// (`fix-oxfmt.mjs:29`, `fix-markdownlint.mjs`-аналог нижче).
fn dedup_files_by_kind(violations: &[Violation], kind: &str) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut files = Vec::new();
    for v in violations {
        let matches = v
            .data
            .as_ref()
            .and_then(|d| d.get("kind"))
            .and_then(|k| k.as_str())
            == Some(kind);
        if !matches {
            continue;
        }
        let Some(file) = &v.file else { continue };
        if seen.insert(file.clone()) {
            files.push(file.clone());
        }
    }
    files
}

/// T0-фікс `text/oxfmt` — перший native-порт exec-tool класу T0-фіксів
/// (хвиля T3, вибір пілотів задокументовано в PR-описі). Точний семантичний
/// порт `patterns[0]` з `fix-oxfmt.mjs`: спавнить `oxfmt --write <files>`
/// над унікальними `file` кожної violation з `data.kind ===
/// "oxfmt-unformatted"`, тоді читає результат кожного файла й планує write
/// лише для тих, чий вміст справді змінився (той самий `before`/`after`-diff,
/// що JS `readOrNull`-порівняння).
///
/// # Різниця з детектор-класом native-фіксів (T1/T2)
///
/// Усі попередні native-фікси (`marksman_config_fix` і далі) — чисті:
/// читають файлову систему, але нічого не спавнять. Тут Rust-бік ВИКОНУЄ
/// зовнішній процес (`oxfmt --write`) як частину побудови [`FixPlan`] —
/// сам план лишається декларативним (повний новий вміст, не «команда, яку
/// ще треба виконати»): `run-fix.mjs` застосовує лише `write`/`delete`,
/// не знає й не повинен знати про `oxfmt` узагалі. Це прямий тест гіпотези
/// «native-шлях не має host-diff/wasm-пісочниці, тож exec-tool T0 — не
/// проблема» (докладніше — PR-опис): підтверджується — спавн у Rust
/// синхронний і прямий, той самий `std::process::Command`, що вже
/// використовує детектор цього самого concern-а
/// ([`super::text_oxfmt::text_oxfmt`]).
///
/// # Резолв тула — той самий канал, що детектор
///
/// `resolve_cmd("oxfmt")` (PATH-lookup) — дзеркало `resolveCmd('oxfmt')`
/// (`fix-oxfmt.mjs:28`). Відсутній тул → порожній план (JS:
/// `if (!oxfmt) return { touchedFiles: [] }`) — не помилка: fix-домен тут
/// повторює м'яку деградацію JS, а не fail-closed детектора (детектор
/// сигналить відсутність тула нотою, фіксер просто нічого не робить).
///
/// # Спавн-помилка ПІСЛЯ успішного резолву
///
/// На відміну від м'якого «тул відсутній», сама невдача запуску вже
/// зарезолвленого бінарника (та сама гонка «resolve-then-spawn», що
/// документує [`super::text_oxfmt`]) — помилка ВИКОНАННЯ фіксу, не
/// порожній план: [`RulesError::Concern`]. JS-канон тут некатчений
/// `await spawnAsync(...)` — той самий канал (виняток валить `apply()`).
fn text_oxfmt_fix(cwd: &Path, violations: &[Violation]) -> Result<FixPlan, RulesError> {
    text_oxfmt_fix_with(cwd, violations, &resolve_cmd)
}

/// Тіло фіксу з інжектованим резолвом тула — той самий мотив ін'єкції, що
/// `text_oxfmt_with` у детекторі (паралельні тести не повинні підміняти
/// процес-глобальний `PATH`).
fn text_oxfmt_fix_with(
    cwd: &Path,
    violations: &[Violation],
    resolve_tool: &dyn Fn(&str) -> Option<std::path::PathBuf>,
) -> Result<FixPlan, RulesError> {
    let files = dedup_files_by_kind(violations, OXFMT_UNFORMATTED_KIND);
    if files.is_empty() {
        return Ok(FixPlan::default());
    }
    let Some(oxfmt) = resolve_tool("oxfmt") else {
        return Ok(FixPlan::default());
    };

    let before = snapshot_before(cwd, &files);

    Command::new(&oxfmt)
        .current_dir(cwd)
        .arg("--write")
        .args(&files)
        .output()
        .map_err(|error| {
            RulesError::Concern(format!("text/oxfmt: не вдалося запустити `oxfmt`: {error}"))
        })?;

    Ok(FixPlan {
        edits: plan_writes_for_changed(cwd, before),
    })
}

// ── text/markdownlint (хвиля T3, exec-tool клас, npx) ───────────────────────

/// `reason` violation-у, за яким матчиться T0 — точний порт `'markdownlint'`
/// (`fix-markdownlint.mjs:38`, той самий рядок, що
/// `crates/rules-core/src/concerns/text_markdownlint.rs::LINT_REASON`).
const MARKDOWNLINT_LINT_REASON: &str = "markdownlint";

/// Track-довані `*.md`/`*.mdc` від `cwd` — точний порт `listMarkdownFiles`
/// (`fix-markdownlint.mjs:24-32`, `git ls-files -z -- '*.md' '*.mdc'`).
/// `status !== 0` (не git-репо / git відсутній) → порожній список, той
/// самий м'який fallback, що JS.
fn list_markdown_files(cwd: &Path) -> Vec<String> {
    let output = Command::new("git")
        .current_dir(cwd)
        .args(["ls-files", "-z", "--", "*.md", "*.mdc"])
        .output();
    let Ok(output) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&output.stdout)
        .split('\0')
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect()
}

/// T0-фікс `text/markdownlint` — другий native-порт exec-tool класу (хвиля
/// T3). Точний семантичний порт `patterns[0]` з `fix-markdownlint.mjs`:
/// застосовність — хоч одна violation з `reason === "markdownlint"` (той
/// самий `test()`, що JS, `standalone: true` — фіксер САМ ре-аналізує
/// вміст, per-violation дані не потрібні); тоді (як і JS) спавнить
/// `markdownlint-cli2 --fix '**/*.md' '**/*.mdc'` над УСІМА track-daними
/// md/mdc файлами repo (не лише violation.file-ами — full-rescan, той
/// самий обсяг, що JS), і планує write лише для файлів, чий вміст справді
/// змінився.
///
/// # `npx`, не бібліотечний імпорт
///
/// JS-канон кличе `markdownlint-cli2` як npm-залежність напряму
/// (`import { main as markdownlintCli2 } from 'markdownlint-cli2'`) — у
/// Rust такого модуля немає. Native-бік спавнить `npx markdownlint-cli2
/// --fix ...` — той самий канал резолву (`resolve_cmd("npx")`), що вже
/// прийнятий для read-only детектора цього concern-а
/// ([`super::text_markdownlint::text_markdownlint`], доккомент модуля
/// там-таки, секція «Тул markdownlint-cli2 — третій канал»). Відсутній
/// `npx` тут — [`RulesError::Concern`], дзеркало fail-closed детектора
/// (npx відсутній на раннері — це не «нічого фіксити», а зламане
/// середовище).
fn text_markdownlint_fix(cwd: &Path, violations: &[Violation]) -> Result<FixPlan, RulesError> {
    text_markdownlint_fix_with(cwd, violations, &resolve_cmd)
}

/// Тіло фіксу з інжектованим резолвом `npx` — той самий мотив, що
/// [`text_oxfmt_fix_with`]/`text_markdownlint_with` у детекторі.
fn text_markdownlint_fix_with(
    cwd: &Path,
    violations: &[Violation],
    resolve_tool: &dyn Fn(&str) -> Option<std::path::PathBuf>,
) -> Result<FixPlan, RulesError> {
    let applicable = violations
        .iter()
        .any(|v| v.reason == MARKDOWNLINT_LINT_REASON);
    if !applicable {
        return Ok(FixPlan::default());
    }

    let files = list_markdown_files(cwd);
    if files.is_empty() {
        return Ok(FixPlan::default());
    }

    let Some(npx) = resolve_tool("npx") else {
        return Err(RulesError::Concern(
            "text/markdownlint: `npx` не знайдено в PATH — потрібен для запуску \
             `markdownlint-cli2 --fix` (text.mdc)."
                .to_string(),
        ));
    };

    let before = snapshot_before(cwd, &files);

    Command::new(&npx)
        .current_dir(cwd)
        .args(["markdownlint-cli2", "--fix", "**/*.md", "**/*.mdc"])
        .output()
        .map_err(|error| {
            RulesError::Concern(format!(
                "text/markdownlint: не вдалося запустити `npx markdownlint-cli2 --fix`: {error}"
            ))
        })?;

    Ok(FixPlan {
        edits: plan_writes_for_changed(cwd, before),
    })
}

// ── exec-tool клас: спільні before/after-хелпери + хвиля §2.82 ──────────────
//
// [`snapshot_before`]/[`plan_writes_for_changed`] беруть УСІ exec-tool фікси
// обох колій — `text/oxfmt`, `text/markdownlint` (T3), `text/run-dotenv-linter`,
// `text/run-shellcheck` (§2.82) і `image-compress`/`image-avif`
// ([`super::fix_image`], §2.85). До §2.85 кожен із перших чотирьох носив
// власну копію цих двох циклів; копії розійшлися б рівно на тому дні, коли
// одна з них навчилась байтам, а решта — ні.

/// Знімок «до» для набору relative-шляхів — той самий `new Map(abs.map(a =>
/// [a, readOrNull(a)]))`, що повторюється в кожному exec-tool T0-патерні
/// (`fix-run-dotenv-linter.mjs`, `fix-run-shellcheck.mjs`, `fix-oxfmt.mjs`).
/// Відсутній/нечитабельний файл → `None`, як `readOrNull`.
///
/// # Чому БАЙТИ, а не `String` (полагоджений дефект, §2.85)
///
/// Знімок раніше знімався [`std::fs::read_to_string`], тобто не-UTF-8 файл
/// давав `None` і **до**, і **після** прогону тула — а `None == None`
/// означало «файл не змінився». Тобто exec-tool, який реально переписав
/// бінарний файл, не давав ЖОДНОГО edit-у, і конвеєр звітував «0 файлів»
/// при змінених байтах на диску. Це той самий клас вади, що §2.83 закрила
/// на detect-боці (`String::from_utf8_lossy` у `read_source_files`,
/// `crates/rules-napi`), лише тихіший: там байти калічились, тут вони
/// зникали безслідно.
///
/// Байтовий знімок робить порівняння «до/після» чесним для БУДЬ-ЯКОГО
/// вмісту; рішення «текстом чи байтами це записувати» ухвалює
/// [`plan_writes_for_changed`] на боці ПЛАНУ, де для цього тепер є
/// [`FileEdit::WriteBytes`].
pub(super) fn snapshot_before(cwd: &Path, files: &[String]) -> Vec<(String, Option<Vec<u8>>)> {
    files
        .iter()
        .map(|f| (f.clone(), std::fs::read(cwd.join(f)).ok()))
        .collect()
}

/// Порівнює знімок «до» з поточним станом диска і планує запис лише для
/// файлів, чий вміст справді змінився — спільне тіло хвоста всіх exec-tool
/// фіксів (`touchedFiles = abs.filter(a => readOrNull(a) !== before.get(a))`).
///
/// Форму edit-а обирає САМ вміст «після»: валідний UTF-8 → [`FileEdit::Write`]
/// (як було), решта → [`FileEdit::WriteBytes`] (мажор контракту `4.0.0`,
/// §2.84). Мовчазного пропуску тут більше немає ЖОДНОГО: доти файл, який
/// після прогону не читався як UTF-8, просто не потрапляв у план —
/// «змінився, але не звітуємо».
///
/// Для тулів хвилі §2.82 (`dotenv-linter fix`, `shellcheck -f diff`+`patch`)
/// байтова гілка недосяжна — вони працюють з текстом; для
/// `image-compress`/`image-avif` (§2.85) вона і є основною.
///
/// Файл, який після прогону ЗНИК (`after == None`, а `before` був `Some`),
/// у план не потрапляє: жоден із тулів цього класу файлів не видаляє, а
/// синтезувати [`FileEdit::Delete`] з «не змогли прочитати» означало б
/// планувати видалення на підставі помилки I/O. Видалення планують ті
/// фікси, які його ЗНАЮТЬ (`image-avif`-сироти), а не ті, що його вгадують.
pub(super) fn plan_writes_for_changed(
    cwd: &Path,
    before: Vec<(String, Option<Vec<u8>>)>,
) -> Vec<FileEdit> {
    let mut edits = Vec::new();
    for (file, before_content) in before {
        let after = std::fs::read(cwd.join(&file)).ok();
        if after == before_content {
            continue;
        }
        let Some(bytes) = after else {
            continue;
        };
        edits.push(byte_or_text_write(file, bytes));
    }
    edits
}

/// Обирає форму edit-а за фактичним вмістом: валідний UTF-8 —
/// [`FileEdit::Write`], інакше [`FileEdit::WriteBytes`].
///
/// Текст НЕ заганяється у байтовий варіант «про всяк випадок»: `Write`
/// лишається читабельним у журналі/логах і зберігає поведінку всіх
/// портованих раніше фіксів до байта, а `WriteBytes` їде base64-рядком на
/// JSON-межі napi→JS — на текстовому файлі це був би і більший payload, і
/// втрата діагностованості.
pub(super) fn byte_or_text_write(path: String, bytes: Vec<u8>) -> FileEdit {
    match String::from_utf8(bytes) {
        Ok(content) => FileEdit::Write(WriteFile { path, content }),
        Err(error) => FileEdit::WriteBytes(rules_contract::fix::WriteBytesFile {
            path,
            content: error.into_bytes(),
        }),
    }
}

/// `reason` violation-у `text/run-dotenv-linter` —
/// [`super::text_run_dotenv_linter`] `REASON`, він же
/// `fix-run-dotenv-linter.mjs:patterns[0].test`.
const DOTENV_LINTER_REASON: &str = "dotenv-linter";

/// Каталоги/файли, виключені з рекурсивного прогону `dotenv-linter` —
/// дзеркало `EXCLUDED_PATHS` детектора й `fix-run-dotenv-linter.mjs:20`.
const DOTENV_EXCLUDED: [&str; 2] = ["node_modules", ".envrc"];

/// `.env*`-файли дерева — порт `listEnvFiles`
/// (`fix-run-dotenv-linter.mjs:118-133`).
///
/// # Розбіжність з каноном (свідома, на користь): обхід не заходить у `node_modules`
///
/// JS робить `readdirSync(cwd, { recursive: true })` — тобто ПОВНІСТЮ
/// вичитує `node_modules` (десятки тисяч записів у типовому репо) і лише
/// потім відкидає їх фільтром. Тут `node_modules` відсікається як цілий
/// каталог на вході — результат той самий до елемента, ціна на порядки
/// менша. Решта фільтра — буквальна: basename починається з `.env`, але не
/// `.envrc` (direnv shell-синтаксис, не `key=value`) і не `*.bak`.
fn list_env_files(cwd: &Path) -> Vec<String> {
    let mut out = std::collections::BTreeSet::new();
    list_env_files_dir(cwd, cwd, &mut out);
    out.into_iter().collect()
}

/// Рекурсивний крок [`list_env_files`]. Недоступний каталог мовчки
/// пропускається — JS-канон на невдалому `readdirSync` теж повертає `[]`.
fn list_env_files_dir(root: &Path, dir: &Path, out: &mut std::collections::BTreeSet<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let name = entry.file_name().to_string_lossy().into_owned();
        if file_type.is_dir() {
            if name == "node_modules" {
                continue;
            }
            list_env_files_dir(root, &entry.path(), out);
            continue;
        }
        if !file_type.is_file() {
            continue;
        }
        if !name.starts_with(".env") || name == ".envrc" || name.ends_with(".bak") {
            continue;
        }
        if let Ok(rel) = entry.path().strip_prefix(root) {
            out.insert(
                rel.components()
                    .map(|c| c.as_os_str().to_string_lossy())
                    .collect::<Vec<_>>()
                    .join("/"),
            );
        }
    }
}

/// T0-фікс `text/run-dotenv-linter` — порт `patterns[0]`
/// (`fix-run-dotenv-linter.mjs:136-158`): один прогін
/// `dotenv-linter fix --no-backup --quiet -r --exclude node_modules
/// --exclude .envrc .`, тоді write для кожного `.env*`, чий вміст змінився.
/// `standalone: true` у каноні — тул сам ре-аналізує, per-violation дані не
/// потрібні, тож застосовність = «є хоч одна violation `dotenv-linter`».
///
/// # Полагоджений дефект канону 1: відсутній тул — МОВЧАЗНИЙ no-op
///
/// `runDotenvLinter` при `resolveCmd('dotenv-linter') === null` друкує
/// підказки в stderr і повертає `1` — а `patterns[0].apply` цей код
/// ІГНОРУЄ цілком (`await runDotenvLinter(ctx.cwd, false)` без
/// присвоєння) і віддає `{ touchedFiles: [] }`. Для рушія `--fix` це
/// нерозрізнюване від «усе вже гаразд»: детектор червоний саме тому, що
/// тула немає, фікс «відпрацював успішно, нічого не змінив», користувач
/// бачить незмінне порушення без причини. Той самий клас, що
/// `resolveCmd('cargo') === null` у `tauri`-контурі. Native:
/// [`RulesError::Concern`] з install-підказкою з
/// [`crate::tool_registry::install_hint_for`].
///
/// Розбіжність із [`text_oxfmt_fix`] (там відсутній тул → порожній план)
/// свідома: `fix-oxfmt.mjs` робить ЯВНИЙ ранній `return { touchedFiles: []
/// }` до будь-якого спавна, тобто «нічого не роблю» — задокументоване
/// рішення канону; тут канон навпаки готує помилку (`return 1`) і
/// втрачає її по дорозі — це вада, а не рішення.
///
/// # Полагоджений дефект канону 2: ненульовий код `dotenv-linter fix` губився
///
/// `await spawnAsync(bin, ['fix', ...])` — результат не читається взагалі
/// (`try/catch` ловить лише невдалий СПАВН, не ненульовий exit). `fix`
/// повертає 0 і на нефіксабельних попередженнях, і на синтаксичному смітті
/// у `.env` — тобто ненульовий код тут означає справжній збій тула
/// (криві аргументи, немає прав на запис). Native підіймає його
/// [`RulesError::Concern`] разом зі stderr тула.
fn text_run_dotenv_linter_fix(cwd: &Path, violations: &[Violation]) -> Result<FixPlan, RulesError> {
    text_run_dotenv_linter_fix_with(cwd, violations, &resolve_cmd)
}

/// Тіло фіксу з інжектованим резолвом тула — той самий мотив ін'єкції, що
/// [`text_oxfmt_fix_with`] і детектор [`super::text_run_dotenv_linter`].
fn text_run_dotenv_linter_fix_with(
    cwd: &Path,
    violations: &[Violation],
    resolve_tool: &dyn Fn(&str) -> Option<std::path::PathBuf>,
) -> Result<FixPlan, RulesError> {
    if !violations.iter().any(|v| v.reason == DOTENV_LINTER_REASON) {
        return Ok(FixPlan::default());
    }

    let Some(bin) = resolve_tool("dotenv-linter") else {
        let hint = crate::tool_registry::install_hint_for("dotenv-linter")
            .unwrap_or_else(|| "dotenv-linter не знайдено в PATH.".to_string());
        return Err(RulesError::Concern(format!(
            "text/run-dotenv-linter: {hint}"
        )));
    };

    let files = list_env_files(cwd);
    if files.is_empty() {
        return Ok(FixPlan::default());
    }
    let before = snapshot_before(cwd, &files);

    let mut command = Command::new(&bin);
    command
        .current_dir(cwd)
        .args(["fix", "--no-backup", "--quiet", "-r"]);
    for excluded in DOTENV_EXCLUDED {
        command.arg("--exclude").arg(excluded);
    }
    command.arg(".");
    let output = command.output().map_err(|error| {
        RulesError::Concern(format!(
            "text/run-dotenv-linter: не вдалося запустити `dotenv-linter fix`: {error}"
        ))
    })?;
    if !output.status.success() {
        return Err(RulesError::Concern(format!(
            "text/run-dotenv-linter: `dotenv-linter fix` завершився з кодом {}: {}",
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

/// `reason` violation-у `text/run-shellcheck` —
/// [`super::text_run_shellcheck`] `LINT_REASON`, він же
/// `fix-run-shellcheck.mjs:patterns[0].test`.
const SHELLCHECK_REASON: &str = "shellcheck";

/// Підрядок у stderr ShellCheck, коли зауваження є, але авто-виправлень до
/// них немає — порт `NON_AUTOFIXABLE_HINT` (`fix-run-shellcheck.mjs:32`).
const SHELLCHECK_NON_AUTOFIXABLE: &str = "none were auto-fixable";

/// Максимум ітерацій `diff`+`patch` на один файл — порт
/// `MAX_FIX_ROUNDS_PER_FILE` (`fix-run-shellcheck.mjs:35`), захист від
/// зациклення, коли патч не збігає стан до нерухомої точки.
const SHELLCHECK_MAX_FIX_ROUNDS: usize = 32;

/// T0-фікс `text/run-shellcheck` — порт `patterns[0]`
/// (`fix-run-shellcheck.mjs:255-277`) разом із `runShellcheckText(cwd,
/// false)`: для КОЖНОГО `*.sh` дерева (той самий full-rescan, що й у
/// [`text_markdownlint_fix`] — не лише `violation.file`) цикл
/// `shellcheck -f diff <file>` → `patch -p1`, до нерухомої точки або
/// [`SHELLCHECK_MAX_FIX_ROUNDS`]; тоді write для змінених файлів.
///
/// # Полагоджений дефект канону 1: відсутній `shellcheck`/`patch` — МОВЧАЗНИЙ no-op
///
/// Точно той самий канал, що описаний у [`text_run_dotenv_linter_fix`]:
/// `runShellcheckText` повертає `1` і за відсутнього `shellcheck`, і за
/// відсутнього `patch` (окрема гілка з власною підказкою), а
/// `patterns[0].apply` цей код відкидає й рапортує успішний no-op.
/// Native: [`RulesError::Concern`] з install-підказкою.
///
/// # Полагоджений дефект канону 2: невдалий `patch` теж губився
///
/// `applyShellcheckDiff` при ненульовому `patch -p1` друкує його вивід і
/// повертає `1`; `autofixOneFile` → `runShellcheckText` віддають цю `1`
/// нагору — і `apply()` її ігнорує. Тобто «diff від shellcheck не
/// приклався» (конфлікт, зіпсований hunk, файл змінили паралельно)
/// оберталося тим самим тихим «нічого не змінено». Native: помилка з
/// іменем файлу і виводом `patch`.
///
/// # Свідомо НЕ портовано: фінальний `runFinalShellcheck`
///
/// Канон після циклу фіксів робить ще один повний прогін `shellcheck` по
/// всіх файлах — і теж викидає його код (`apply()` не дивиться на
/// результат `runShellcheckText`). У fix-домені цей прогін не породжує
/// жодного edit-у: єдиний його ефект — stdout/stderr користувачу і
/// відкинутий код. Залишковий стан перевіряє re-detect
/// ([`super::text_run_shellcheck`]) одразу після застосування плану, тож
/// порт його не повторює — це прибраний мертвий виклик зовнішнього
/// процесу, не втрачена перевірка.
fn text_run_shellcheck_fix(cwd: &Path, violations: &[Violation]) -> Result<FixPlan, RulesError> {
    text_run_shellcheck_fix_with(cwd, violations, &resolve_cmd)
}

/// Тіло фіксу з інжектованим резолвом тулів (`shellcheck`, `patch`, `git`
/// усередині [`super::text_run_shellcheck::list_shell_script_paths`]).
fn text_run_shellcheck_fix_with(
    cwd: &Path,
    violations: &[Violation],
    resolve_tool: &dyn Fn(&str) -> Option<std::path::PathBuf>,
) -> Result<FixPlan, RulesError> {
    if !violations.iter().any(|v| v.reason == SHELLCHECK_REASON) {
        return Ok(FixPlan::default());
    }

    let Some(shellcheck) = resolve_tool("shellcheck") else {
        let hint = crate::tool_registry::install_hint_for("shellcheck")
            .unwrap_or_else(|| "shellcheck не знайдено в PATH.".to_string());
        return Err(RulesError::Concern(format!("text/run-shellcheck: {hint}")));
    };
    let Some(patch_bin) = resolve_tool("patch") else {
        return Err(RulesError::Concern(
            "text/run-shellcheck: `patch` не знайдено в PATH — потрібен для застосування \
             `shellcheck -f diff` (Debian/Ubuntu: sudo apt-get install -y patch; на macOS \
             зазвичай уже є)."
                .to_string(),
        ));
    };

    let files = super::text_run_shellcheck::list_shell_script_paths(cwd, resolve_tool)?;
    if files.is_empty() {
        return Ok(FixPlan::default());
    }
    let before = snapshot_before(cwd, &files);

    for rel in &files {
        shellcheck_autofix_one_file(&shellcheck, &patch_bin, cwd, rel)?;
    }

    Ok(FixPlan {
        edits: plan_writes_for_changed(cwd, before),
    })
}

/// Цикл `shellcheck -f diff` + `patch -p1` для одного файла — порт
/// `autofixOneFile` (`fix-run-shellcheck.mjs:180-196`). Зупинка: exit 0,
/// `none were auto-fixable` у stderr, або порожній stdout
/// (`shouldStopAutofixLoop`).
fn shellcheck_autofix_one_file(
    shellcheck: &Path,
    patch_bin: &Path,
    cwd: &Path,
    rel: &str,
) -> Result<(), RulesError> {
    for _round in 0..SHELLCHECK_MAX_FIX_ROUNDS {
        let output = Command::new(shellcheck)
            .current_dir(cwd)
            .args(["-f", "diff", rel])
            .output()
            .map_err(|error| {
                RulesError::Concern(format!(
                    "text/run-shellcheck: не вдалося запустити `shellcheck -f diff {rel}`: {error}"
                ))
            })?;
        if output.status.success() {
            return Ok(());
        }
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains(SHELLCHECK_NON_AUTOFIXABLE) {
            return Ok(());
        }
        let diff = String::from_utf8_lossy(&output.stdout).into_owned();
        if diff.trim().is_empty() {
            return Ok(());
        }
        apply_shellcheck_diff(patch_bin, cwd, rel, &diff)?;
    }
    Ok(())
}

/// `patch -p1 < diff` у корені `cwd` — порт `applyShellcheckDiff`
/// (`fix-run-shellcheck.mjs:207-224`). Ненульовий код `patch` (і невдалий
/// спавн, і невдалий запис у stdin) → [`RulesError::Concern`] з виводом
/// `patch`, а не тихе «нічого не змінено» (доккомент
/// [`text_run_shellcheck_fix`], дефект 2).
fn apply_shellcheck_diff(
    patch_bin: &Path,
    cwd: &Path,
    rel: &str,
    diff: &str,
) -> Result<(), RulesError> {
    use std::io::Write as _;
    use std::process::Stdio;

    let fail = |detail: String| {
        RulesError::Concern(format!(
            "text/run-shellcheck: patch не застосував diff для {rel}: {detail}"
        ))
    };

    let mut child = Command::new(patch_bin)
        .current_dir(cwd)
        .arg("-p1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| fail(format!("не вдалося запустити `patch`: {error}")))?;
    child
        .stdin
        .take()
        .ok_or_else(|| fail("stdin `patch` недоступний".to_string()))?
        .write_all(diff.as_bytes())
        .map_err(|error| fail(format!("не вдалося передати diff у stdin: {error}")))?;
    let output = child
        .wait_with_output()
        .map_err(|error| fail(format!("`patch` не завершився: {error}")))?;
    if output.status.success() {
        return Ok(());
    }
    Err(fail(format!(
        "{} {}",
        String::from_utf8_lossy(&output.stderr).trim(),
        String::from_utf8_lossy(&output.stdout).trim()
    )))
}

// ── nginx-default-tpl/template (хвиля T3, структурний клас) ─────────────────

/// Знаходить `default.tpl.conf` під `root` (виключно cursor-ignore
/// каталогів) — точний порт inline-`walkDir` виклику всередині
/// `migrateDefaultTplConfFiles` (`fix-template.mjs:56-63`). На відміну від
/// [`super::nginx_default_tpl_template::find_default_conf_template_paths`],
/// тут НЕМАЄ фільтра `fixtures`-сегмента — JS-версія цього конкретного
/// walkDir теж його не має (два різні виклики `findDefaultConfTemplatePaths`
/// у тому самому файлі: один — приватний хелпер із фільтром, другий —
/// inline без нього; порт зберігає цю асиметрію 1:1).
fn find_legacy_tpl_conf_paths(root: &Path, ignore_paths: &[String]) -> Vec<String> {
    let mut files: Vec<String> =
        crate::concerns::cursor_ignore::walk_with_ignore_paths(root, ignore_paths)
            .into_iter()
            .filter(|rel| {
                super::nginx_default_tpl_template::posix_basename(rel) == "default.tpl.conf"
            })
            .collect();
    files.sort();
    files
}

/// T0-фікс `nginx-default-tpl/template`, патерн 1 — точний семантичний
/// порт `migrateDefaultTplConfFiles` + `patterns[0]`
/// (`fix-template.mjs:59-88,131-149`): для кожного знайденого
/// `default.tpl.conf` — якщо поруч уже є `default.conf.template`,
/// перезаписує його вмістом `default.tpl.conf` і видаляє `default.tpl.conf`
/// (`overwritten`-гілка); інакше — перейменування (`renamed`-гілка), у
/// [`FixPlan`] виражене як write нового шляху + delete старого (та сама
/// кінцева файлова структура, що атомарний `rename`, `run-fix.mjs`
/// застосовує edit-и послідовно в порядку списку).
fn nginx_legacy_name_fix(cwd: &Path) -> FixPlan {
    let ignore_paths = crate::concerns::cursor_ignore::load_cursor_ignore_paths(cwd);
    let mut edits = Vec::new();
    for old_rel in find_legacy_tpl_conf_paths(cwd, &ignore_paths) {
        let Some(dir) = old_rel.rsplit_once('/').map(|(d, _)| d) else {
            // Файл у корені `cwd` — dirname порожній, ціль лишається просто
            // "default.conf.template" (той самий `join(dirname(oldPath),
            // 'default.conf.template')` на порожньому dirname у JS).
            let new_rel = "default.conf.template".to_string();
            push_legacy_rename_edits(cwd, &old_rel, &new_rel, &mut edits);
            continue;
        };
        let new_rel = format!("{dir}/default.conf.template");
        push_legacy_rename_edits(cwd, &old_rel, &new_rel, &mut edits);
    }
    FixPlan { edits }
}

/// Один `default.tpl.conf` → `default.conf.template` перехід — спільне
/// тіло циклу [`nginx_legacy_name_fix`], винесене окремо лише щоб уникнути
/// дублювання гілки "новий шлях уже існує" між кореневим і
/// вкладеним випадком.
fn push_legacy_rename_edits(cwd: &Path, old_rel: &str, new_rel: &str, edits: &mut Vec<FileEdit>) {
    let Ok(old_content) = std::fs::read_to_string(cwd.join(old_rel)) else {
        return;
    };
    edits.push(FileEdit::Write(WriteFile {
        path: new_rel.to_string(),
        content: old_content,
    }));
    edits.push(FileEdit::Delete {
        path: old_rel.to_string(),
    });
}

/// T0-фікс `nginx-default-tpl/template`, патерн 2 — точний семантичний
/// порт `migrateErrorLogOffDirective` + `patterns[1]`
/// (`fix-template.mjs:98-108,151-171`): пересканує ВСІ
/// `default.conf.template` під `cwd` (fixtures-виключені, той самий
/// [`super::nginx_default_tpl_template::find_default_conf_template_paths`],
/// що й детектор), замінює `error_log off;` → `error_log /dev/null crit;`
/// у кожному; write планується лише коли або (а) violations цього
/// concern-а не несуть жодного `file` (порожня множина `files` у JS —
/// «фіксити все знайдене»), або (б) шлях файла входить у множину `file`
/// цих violations (`files.length === 0 || files.includes(rel)` —
/// `fix-template.mjs:163`).
fn nginx_error_log_off_fix(cwd: &Path, violations: &[Violation]) -> FixPlan {
    use super::nginx_default_tpl_template::{
        find_default_conf_template_paths, ERROR_LOG_OFF_REASON, ERROR_LOG_OFF_TEST_RE,
    };

    let target_files = dedup_files_by_kind(violations, ERROR_LOG_OFF_REASON);
    let ignore_paths = crate::concerns::cursor_ignore::load_cursor_ignore_paths(cwd);
    let mut edits = Vec::new();
    for abs in find_default_conf_template_paths(cwd, &ignore_paths) {
        let Ok(content) = std::fs::read_to_string(&abs) else {
            continue;
        };
        if !ERROR_LOG_OFF_TEST_RE.is_match(&content) {
            continue;
        }
        let rel = abs
            .strip_prefix(cwd)
            .unwrap_or(&abs)
            .to_string_lossy()
            .replace('\\', "/");
        if !target_files.is_empty() && !target_files.contains(&rel) {
            continue;
        }
        let next = ERROR_LOG_OFF_TEST_RE.replace_all(&content, "error_log /dev/null crit;");
        edits.push(FileEdit::Write(WriteFile {
            path: rel,
            content: next.into_owned(),
        }));
    }
    FixPlan { edits }
}

/// T0-фікс `nginx-default-tpl/template` — обʼєднує обидва патерни JS-канону
/// ([`nginx_legacy_name_fix`]/[`nginx_error_log_off_fix`]) в один [`FixPlan`],
/// у тому самому порядку, що `applyT0` пройшов би два окремі `T0Pattern`
/// цього concern-а (`patterns[0]` тоді `patterns[1]`, `fix-template.mjs`).
/// Застосовність кожного патерна перевіряється НЕЗАЛЕЖНО за `data.kind`
/// відповідної violation — точний порт `test()` обох патернів.
fn nginx_default_tpl_template_fix(cwd: &Path, violations: &[Violation]) -> FixPlan {
    use super::nginx_default_tpl_template::{ERROR_LOG_OFF_REASON, LEGACY_NAME_REASON};

    let mut edits = Vec::new();
    if violations.iter().any(|v| v.reason == LEGACY_NAME_REASON) {
        edits.extend(nginx_legacy_name_fix(cwd).edits);
    }
    if violations.iter().any(|v| v.reason == ERROR_LOG_OFF_REASON) {
        edits.extend(nginx_error_log_off_fix(cwd, violations).edits);
    }
    FixPlan { edits }
}

// ── changelog/consistency (хвиля T4, exec-tool клас) ────────────────────────

/// Маркер, за яким T0-патерн визнає себе застосовним — порт нестрогого
/// `MISSING_CHANGE_RE` (`fix-consistency.mjs:15`, `/є релевантні зміни, але
/// немає change-файлу/u` без якорів).
const MISSING_CHANGE_MARKER: &str = "є релевантні зміни, але немає change-файлу";

/// Строгий екстрактор мітки воркспейсу з message-а — порт
/// `MISSING_CHANGE_LABEL_RE` (`fix-consistency.mjs:17`,
/// `/^(\S+): є релевантні зміни, але немає change-файлу/u`). Джерело самого
/// message-а — `missing_change_file_message`
/// ([`super::changelog_consistency_workspace`]).
static MISSING_CHANGE_LABEL_RE: std::sync::LazyLock<regex::Regex> =
    std::sync::LazyLock::new(|| {
        regex::Regex::new(r"^(\S+): є релевантні зміни, але немає change-файлу")
            .expect("valid regex")
    });

/// Мітка `<root>` позначає кореневий workspace — порт `labelToWorkspace`
/// (`fix-consistency.mjs:38-40`).
const ROOT_LABEL: &str = "<root>";

/// Перше вільне ім'я change-файлу в теці `dir_rel` для мітки часу
/// `timestamp_millis` — декларативний аналог create-only циклу
/// [`super::change_file::write_change`] (`OpenOptions::create_new`, порт
/// `writeFile(..., { flag: 'wx' })`).
///
/// # Чому не `write_change`
///
/// Фікс-домен нічого не пише сам — [`run_concern_fix`] лише БУДУЄ план
/// (доккомент модуля), а запис робить `run-fix.mjs::applyPlanEdit`. Тож
/// замість атомарного `create_new` тут — перевірка наявності перед
/// плануванням: та сама послідовність імен (`YYMMDD-HHMM`, далі `-2`,
/// `-3`…), той самий кінцевий стан. Гонка «файл зʼявився між плануванням і
/// записом» тут теоретична (T0 виконується послідовно, один прогін на
/// concern) і присутня в JS-каноні так само — `writeChange` кличеться
/// всередині `apply()`, тобто теж після `test()`.
fn first_free_change_file_name(cwd: &Path, dir_rel: &str, timestamp_millis: i64) -> String {
    let dir = cwd.join(dir_rel);
    for sequence in 1u32.. {
        let name = super::change_file::change_file_name(timestamp_millis, sequence);
        if !dir.join(&name).exists() {
            return name;
        }
    }
    unreachable!("послідовність sequence нескінченна")
}

/// T0-фікс `changelog/consistency` — точний семантичний порт `patterns[0]`
/// з `fix-consistency.mjs`: для кожного воркспейсу, чиє порушення каже «є
/// релевантні зміни, але немає change-файлу», планує створення
/// `<ws>/.changes/YYMMDD-HHMM[-N].md` з `bump: patch` / `section: Changed`
/// і описом із останнього git-коміту.
///
/// # Клас exec-tool
///
/// Як і `text/oxfmt`/`text/markdownlint` (хвиля T3), фікс спавнить
/// зовнішній процес (`git log -1 --format=%s`, за потреби й
/// `git rev-parse --abbrev-ref HEAD`) ПЕРЕД побудовою плану. Відмінність
/// від тих двох: зовнішній тул тут нічого не мутує — його вивід лише
/// наповнює вміст, який планує сам Rust. Тобто before/after-diff диска не
/// потрібен: план цілком детермінований від виводу git-а.
///
/// # Полагоджені дефекти канону
///
/// 1. **Мовчазний no-op при нерозпізнаній мітці.** JS `test()` матчить
///    НЕСТРОГИМ `MISSING_CHANGE_RE`, а `apply()` витягує мітку СТРОГИМ
///    `MISSING_CHANGE_LABEL_RE` — якщо message не починається з `<мітка>: `,
///    патерн визнає себе застосовним і мовчки повертає `{ touchedFiles: [] }`
///    (`fix-consistency.mjs:54`). Людина бачить порушення, запускає `--fix`,
///    нічого не відбувається — і жодного пояснення. Тут це
///    [`RulesError::Concern`] з переліком нерозпізнаних message-ів.
/// 2. **Дві розбіжні реалізації «звідки взяти опис».** JS-фіксер має власний
///    `autoChangeMessage` (`fix-consistency.mjs:27-31`): лише
///    `git log -1 --format=%s`, і будь-який ненульовий статус (git відсутній,
///    репо без комітів, detached-стан) мовчки дає літерал `'оновлення'`.
///    Детектор того самого concern-а має БАГАТШИЙ `resolveAutoChangeMessage`
///    (`main.mjs:509-515`, порт —
///    [`super::changelog_consistency_workspace::resolve_auto_change_message`]):
///    subject → ім'я гілки → `'оновлення'`. Два шляхи одного concern-а
///    (autofix-гілка детектора під `N_RULES_CHANGELOG_AUTOFIX` і T0-фікс)
///    створювали change-файли з РІЗНИМ описом на тому самому дереві.
///    Native-порт кличе канонічну версію детектора — розбіжність зникає.
///    Практично видимий випадок — коміт із порожнім subject-ом
///    (`--allow-empty-message`): JS-фіксер писав літерал «оновлення»,
///    канонічний резолвер бере ім'я гілки (тест
///    `empty_commit_subject_falls_back_to_branch_name_not_literal`).
fn changelog_consistency_fix(cwd: &Path, violations: &[Violation]) -> Result<FixPlan, RulesError> {
    let candidates: Vec<&Violation> = violations
        .iter()
        .filter(|v| v.message.contains(MISSING_CHANGE_MARKER))
        .collect();
    if candidates.is_empty() {
        return Ok(FixPlan::default());
    }

    let mut seen = std::collections::HashSet::new();
    let mut workspaces = Vec::new();
    let mut unparsed = Vec::new();
    for violation in &candidates {
        let Some(captures) = MISSING_CHANGE_LABEL_RE.captures(&violation.message) else {
            unparsed.push(violation.message.clone());
            continue;
        };
        let label = &captures[1];
        let ws = if label == ROOT_LABEL { "." } else { label };
        if seen.insert(ws.to_string()) {
            workspaces.push(ws.to_string());
        }
    }
    if workspaces.is_empty() {
        return Err(RulesError::Concern(format!(
            "changelog/consistency: {} порушень «{MISSING_CHANGE_MARKER}», але з жодного не \
             вдалося витягти мітку воркспейсу (очікується префікс «<ws>: »): {}",
            unparsed.len(),
            unparsed.join(" | ")
        )));
    }

    let message = super::changelog_consistency_workspace::resolve_auto_change_message(cwd);
    let timestamp_millis = chrono::Utc::now().timestamp_millis();
    let content = super::change_file::serialize_change_file(&super::change_file::ChangeEntry {
        bump: super::changelog_consistency_workspace::AUTOFIX_BUMP.to_string(),
        section: super::changelog_consistency_workspace::AUTOFIX_SECTION.to_string(),
        description: message.trim().to_string(),
    });
    // Той самий self-check, що робить `write_change` перед записом: биті
    // поля мають впасти зрозумілою помилкою тут, а не лягти на диск.
    super::change_file::parse_change_file(&content)
        .map_err(|e| RulesError::Concern(format!("changelog/consistency: {e}")))?;

    let mut edits = Vec::new();
    for ws in workspaces {
        let dir_rel = if ws == "." {
            super::change_file::CHANGES_DIR.to_string()
        } else {
            format!("{ws}/{}", super::change_file::CHANGES_DIR)
        };
        let name = first_free_change_file_name(cwd, &dir_rel, timestamp_millis);
        edits.push(FileEdit::Write(WriteFile {
            path: format!("{dir_rel}/{name}"),
            content: content.clone(),
        }));
    }
    Ok(FixPlan { edits })
}

/// Ключі native-портованих fix-ів (`ruleId/concernId`) — той самий формат,
/// що [`super::NATIVE_CONCERNS`]. Підмножина: не кожен native-детектор має
/// native-фікс (T1 зрізу 4 — два пілоти; T2 зрізу 5 — ще чотири; T3 —
/// перший exec-tool клас (`text/oxfmt`, `text/markdownlint`) плюс один
/// структурний (`nginx-default-tpl/template`), PR-опис; T5 — пʼять
/// конфіг-подібних `createTemplateFixPattern`-концернів родини
/// `vscode_*`/`zed_settings`/`oxfmtrc`; §2.82 — ще два exec-tool
/// (`text/run-dotenv-linter`, `text/run-shellcheck`); §2.85 — бінарна
/// родина `image-*` (`image-compress/check`, `image-avif/avif_generation`);
/// `tauri/release` свідомо лишається JS — доккомент модуля).
pub const NATIVE_FIXES: &[&str] = &[
    "abie/env_dns",
    "abie/firebase_hosting",
    "changelog/consistency",
    "doc-files/marksman_config",
    "doc-files/vscode_extensions",
    "graphql/vscode_extensions",
    "hasura/internal_urls",
    "hasura/migrations",
    "image-avif/avif_generation",
    "image-compress/check",
    "k8s/dremio_logging",
    "k8s/manifests",
    "nginx-default-tpl/template",
    "rego/vscode_extensions",
    "rego/vscode_settings",
    "security/sample_secret",
    "tauri/cargo_mutants_config",
    "tauri/gitignore_target",
    "tauri/linux_deps",
    "tauri/release",
    "tauri/updater",
    "tauri/vscode_extensions",
    "text/cspell",
    "text/markdownlint",
    "text/oxfmt",
    "text/oxfmtrc",
    "text/run-dotenv-linter",
    "text/run-shellcheck",
    "text/vscode_extensions",
    "text/vscode_settings",
    "worktree/vscode_settings",
    "worktree/zed_settings",
];

/// Будує [`FixPlan`] для native-fix-концерну за ключем `ruleId/concernId`.
///
/// - `cwd` — абсолютний корінь consumer-репо: T2-фікси зрізу 5 читають від
///   нього поточний стан файлів (умовні edit-и залежно від наявного вмісту —
///   саме той сценарій, під який параметр закладався в пілоті); два пілоти
///   T1 його не використовують.
/// - `violations` — підмножина результату `detect` для цього concern-а
///   (дзеркало `FixRequest::diagnostics` у `rules-contract::fix`).
///
/// Невідомий ключ → [`RulesError::Concern`] (JS-бік має звіряти належність
/// до [`NATIVE_FIXES`] ДО виклику — остання лінія захисту, не основний
/// контракт, той самий мотив, що документує [`super::run_concern`]).
pub fn run_concern_fix(
    key: &str,
    cwd: &Path,
    violations: &[Violation],
) -> Result<FixPlan, RulesError> {
    match key {
        "abie/env_dns" => Ok(super::fix_env_dremio::env_dns_fix(cwd, violations)),
        "abie/firebase_hosting" => Ok(super::fix_abie_security::firebase_hosting_fix(violations)),
        "doc-files/marksman_config" => Ok(marksman_config_fix(violations)),
        "changelog/consistency" => changelog_consistency_fix(cwd, violations),
        "hasura/internal_urls" => Ok(hasura_internal_urls_fix(cwd, violations)),
        "hasura/migrations" => Ok(hasura_migrations_fix(violations)),
        // Бінарна родина `image-*` (§2.85) — єдині два фікси, чий план несе
        // `FileEdit::WriteBytes` (доккомент [`super::fix_image`]).
        "image-avif/avif_generation" => {
            super::fix_image::image_avif_generation_fix(cwd, violations)
        }
        "image-compress/check" => super::fix_image::image_compress_check_fix(cwd, violations),
        "k8s/dremio_logging" => Ok(super::fix_env_dremio::dremio_logging_fix(cwd, violations)),
        "k8s/manifests" => Ok(super::fix_k8s_manifests::k8s_manifests_fix(cwd, violations)),
        "security/sample_secret" => {
            Ok(super::fix_abie_security::sample_secret_fix(cwd, violations))
        }
        "nginx-default-tpl/template" => Ok(nginx_default_tpl_template_fix(cwd, violations)),
        // Родина `createTemplateFixPattern` (§2.74) — пʼять конфігів на один
        // рушій `rules-template-merge`, доккомент [`super::fix_template_merge`].
        "rego/vscode_settings" => Ok(super::fix_template_merge::rego_vscode_settings_fix(
            cwd, violations,
        )),
        "text/oxfmtrc" => Ok(super::fix_template_merge::text_oxfmtrc_fix(cwd, violations)),
        "text/vscode_settings" => Ok(super::fix_template_merge::text_vscode_settings_fix(
            cwd, violations,
        )),
        "worktree/vscode_settings" => Ok(super::fix_template_merge::worktree_vscode_settings_fix(
            cwd, violations,
        )),
        "worktree/zed_settings" => Ok(super::fix_template_merge::worktree_zed_settings_fix(
            cwd, violations,
        )),
        "tauri/cargo_mutants_config" => Ok(tauri_cargo_mutants_config_fix(cwd, violations)),
        "tauri/gitignore_target" => Ok(tauri_gitignore_target_fix(cwd, violations)),
        "tauri/linux_deps" => Ok(tauri_linux_deps_fix(cwd, violations)),
        "tauri/release" => super::fix_tauri_release::tauri_release_fix(cwd, violations),
        "tauri/updater" => super::fix_tauri_updater::tauri_updater_fix(cwd, violations),
        "text/cspell" => Ok(super::fix_cspell_config::cspell_config_fix(cwd, violations)),
        "text/markdownlint" => text_markdownlint_fix(cwd, violations),
        "text/oxfmt" => text_oxfmt_fix(cwd, violations),
        "text/run-dotenv-linter" => text_run_dotenv_linter_fix(cwd, violations),
        "text/run-shellcheck" => text_run_shellcheck_fix(cwd, violations),
        // Родина `vscode_extensions` — ОДИН рушій на пʼять концернів
        // (доккомент [`super::fix_vscode_extensions`]); ключ передається
        // далі як селектор вшитого канонічного снапшота.
        key @ ("doc-files/vscode_extensions"
        | "graphql/vscode_extensions"
        | "rego/vscode_extensions"
        | "tauri/vscode_extensions"
        | "text/vscode_extensions") => {
            super::fix_vscode_extensions::vscode_extensions_fix(key, cwd, violations)
        }
        other => Err(RulesError::Concern(format!(
            "невідомий native fix: {other}"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostics::Severity;

    fn violation(reason: &str, file: Option<&str>, data: Option<serde_json::Value>) -> Violation {
        Violation {
            reason: reason.to_string(),
            message: "m".to_string(),
            file: file.map(|f| f.to_string()),
            severity: Severity::Error,
            data,
        }
    }

    // ── marksman_config ──

    #[test]
    fn marksman_fix_empty_plan_without_matching_violation() {
        let plan = marksman_config_fix(&[]);
        assert!(plan.edits.is_empty());
        let plan = marksman_config_fix(&[violation("other", None, None)]);
        assert!(plan.edits.is_empty());
    }

    #[test]
    fn marksman_fix_writes_embedded_baseline_when_missing_kind_present() {
        let v = violation(
            "marksman-config-missing",
            Some(".marksman.toml"),
            Some(serde_json::json!({ "kind": "marksman-config-missing" })),
        );
        let plan = marksman_config_fix(&[v]);
        assert_eq!(plan.edits.len(), 1);
        match &plan.edits[0] {
            FileEdit::Write(w) => {
                assert_eq!(w.path, ".marksman.toml");
                assert!(w.content.contains("[core]"));
                assert!(w.content.contains("[completion]"));
                assert!(w.content.contains("[code_action]"));
            }
            other => panic!("очікували write, отримали {other:?}"),
        }
    }

    #[test]
    fn marksman_fix_ignores_violations_without_matching_kind() {
        let v = violation("marksman-config-missing", Some(".marksman.toml"), None);
        assert!(marksman_config_fix(&[v]).edits.is_empty());
    }

    // ── hasura/migrations ──

    #[test]
    fn hasura_fix_empty_plan_without_violations() {
        assert!(hasura_migrations_fix(&[]).edits.is_empty());
    }

    #[test]
    fn hasura_fix_deletes_each_down_sql_file() {
        let violations = vec![
            violation(
                "down-sql-forbidden",
                Some("hasura/migrations/default/1000_add_foo/down.sql"),
                None,
            ),
            violation(
                "down-sql-forbidden",
                Some("hasura/migrations/default/2000_add_bar/down.sql"),
                None,
            ),
        ];
        let plan = hasura_migrations_fix(&violations);
        assert_eq!(plan.edits.len(), 2);
        for edit in &plan.edits {
            match edit {
                FileEdit::Delete { path } => assert!(path.ends_with("down.sql")),
                other => panic!("очікували delete, отримали {other:?}"),
            }
        }
    }

    #[test]
    fn hasura_fix_dedup_same_file_across_multiple_violations() {
        let violations = vec![
            violation(
                "down-sql-forbidden",
                Some("hasura/migrations/default/1000_add_foo/down.sql"),
                None,
            ),
            violation(
                "down-sql-forbidden",
                Some("hasura/migrations/default/1000_add_foo/down.sql"),
                None,
            ),
        ];
        assert_eq!(hasura_migrations_fix(&violations).edits.len(), 1);
    }

    #[test]
    fn hasura_fix_ignores_other_reasons_and_missing_file() {
        let violations = vec![
            violation("other-reason", Some("hasura/migrations/x/down.sql"), None),
            violation("down-sql-forbidden", None, None),
        ];
        assert!(hasura_migrations_fix(&violations).edits.is_empty());
    }

    // ── tauri/gitignore_target ──

    /// Хелпер: violation з `data.kind = missing-gitignore-target-entries` і
    /// переліком missing-entries — та сама форма, що емить detector
    /// (`tauri_gitignore_target.rs`).
    fn gitignore_violation(missing: &[&str]) -> Violation {
        violation(
            "missing-gitignore-target-entries",
            Some(".gitignore"),
            Some(serde_json::json!({
                "kind": "missing-gitignore-target-entries",
                "missing": missing
            })),
        )
    }

    #[test]
    fn gitignore_fix_empty_plan_without_matching_violation() {
        let tmp = tempfile::TempDir::new().unwrap();
        assert!(tauri_gitignore_target_fix(tmp.path(), &[]).edits.is_empty());
        assert!(tauri_gitignore_target_fix(
            tmp.path(),
            &[violation("other", Some(".gitignore"), None)]
        )
        .edits
        .is_empty());
    }

    /// Дзеркало «вставляє новий блок у кінець файла, коли секції ще немає»
    /// (`gitignore_target.test.mjs`, fix-блок до T2-порту).
    #[test]
    fn gitignore_fix_appends_new_block_when_no_section() {
        let tmp = tempfile::TempDir::new().unwrap();
        std::fs::write(tmp.path().join(".gitignore"), "node_modules/\ndist/\n").unwrap();
        let plan = tauri_gitignore_target_fix(
            tmp.path(),
            &[gitignore_violation(&["owner/src-tauri/target/"])],
        );
        assert_eq!(plan.edits.len(), 1);
        match &plan.edits[0] {
            FileEdit::Write(w) => {
                assert_eq!(w.path, ".gitignore");
                assert_eq!(
                    w.content,
                    format!(
                        "node_modules/\ndist/\n\n{GITIGNORE_TARGET_HEADER}\nowner/src-tauri/target/\n"
                    )
                );
            }
            other => panic!("очікували write, отримали {other:?}"),
        }
    }

    /// Дзеркало «дописує запис у вже наявну секцію поруч з іншими entries,
    /// зберігаючи оточення».
    #[test]
    fn gitignore_fix_inserts_into_existing_section_preserving_surroundings() {
        let tmp = tempfile::TempDir::new().unwrap();
        let content =
            format!("node_modules/\n\n{GITIGNORE_TARGET_HEADER}\napp/src-tauri/target/\n\ndist/\n");
        std::fs::write(tmp.path().join(".gitignore"), &content).unwrap();
        let plan = tauri_gitignore_target_fix(
            tmp.path(),
            &[gitignore_violation(&["owner/src-tauri/target/"])],
        );
        assert_eq!(plan.edits.len(), 1);
        match &plan.edits[0] {
            FileEdit::Write(w) => assert_eq!(
                w.content,
                format!(
                    "node_modules/\n\n{GITIGNORE_TARGET_HEADER}\napp/src-tauri/target/\nowner/src-tauri/target/\n\ndist/\n"
                )
            ),
            other => panic!("очікували write, отримали {other:?}"),
        }
    }

    /// JS-паритет: `.gitignore` відсутній на диску → `applyToFiles` скіпав
    /// нечитабельний файл (`try/catch continue`) — план порожній, файл не
    /// створюється з нуля.
    #[test]
    fn gitignore_fix_skips_missing_file_like_js_apply_to_files() {
        let tmp = tempfile::TempDir::new().unwrap();
        let plan = tauri_gitignore_target_fix(
            tmp.path(),
            &[gitignore_violation(&["owner/src-tauri/target/"])],
        );
        assert!(plan.edits.is_empty());
    }

    /// Ідемпотентність: порожній `missing` (нічого дописувати) → без edit-ів.
    #[test]
    fn gitignore_fix_empty_missing_list_is_noop() {
        let tmp = tempfile::TempDir::new().unwrap();
        std::fs::write(tmp.path().join(".gitignore"), "node_modules/\n").unwrap();
        assert!(
            tauri_gitignore_target_fix(tmp.path(), &[gitignore_violation(&[])])
                .edits
                .is_empty()
        );
    }

    /// Дедуп: дві violations на той самий файл → один edit (перша перемагає).
    #[test]
    fn gitignore_fix_dedups_same_file() {
        let tmp = tempfile::TempDir::new().unwrap();
        std::fs::write(tmp.path().join(".gitignore"), "node_modules/\n").unwrap();
        let plan = tauri_gitignore_target_fix(
            tmp.path(),
            &[
                gitignore_violation(&["owner/src-tauri/target/"]),
                gitignore_violation(&["app/src-tauri/target/"]),
            ],
        );
        assert_eq!(plan.edits.len(), 1);
        match &plan.edits[0] {
            FileEdit::Write(w) => {
                assert!(w.content.contains("owner/src-tauri/target/"));
                assert!(!w.content.contains("app/src-tauri/target/"));
            }
            other => panic!("очікували write, отримали {other:?}"),
        }
    }

    // ── tauri/linux_deps ──

    const NO_DEPS_YML: &str = "name: Lint Rust\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v6\n      - uses: dtolnay/rust-toolchain@stable\n        with:\n          components: rustfmt, clippy\n      - run: cargo clippy --all-targets --all-features -- -D warnings\n";
    const PARTIAL_DEPS_YML: &str = "name: Lint Rust\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v6\n      - run: |\n          sudo apt-get update\n          sudo apt-get install -y libwebkit2gtk-4.1-dev\n      - uses: dtolnay/rust-toolchain@stable\n";

    /// Хелпер: violation з `data.kind` linux_deps-детектора.
    fn linux_deps_violation(kind: &str) -> Violation {
        violation(
            kind,
            Some(".github/workflows/lint-rust.yml"),
            Some(serde_json::json!({ "kind": kind })),
        )
    }

    fn write_lint_rust(tmp: &tempfile::TempDir, content: &str) {
        let dir = tmp.path().join(".github/workflows");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("lint-rust.yml"), content).unwrap();
    }

    #[test]
    fn linux_deps_fix_empty_plan_without_matching_violation() {
        let tmp = tempfile::TempDir::new().unwrap();
        write_lint_rust(&tmp, NO_DEPS_YML);
        assert!(tauri_linux_deps_fix(tmp.path(), &[]).edits.is_empty());
        assert!(tauri_linux_deps_fix(
            tmp.path(),
            &[violation(
                "other",
                Some(".github/workflows/lint-rust.yml"),
                None
            )]
        )
        .edits
        .is_empty());
    }

    /// Дзеркало «вставляє apt-крок перед dtolnay/rust-toolchain»
    /// (`linux_deps.test.mjs`, fix-блок до T2-порту).
    #[test]
    fn linux_deps_fix_inserts_step_before_toolchain() {
        let tmp = tempfile::TempDir::new().unwrap();
        write_lint_rust(&tmp, NO_DEPS_YML);
        let plan = tauri_linux_deps_fix(
            tmp.path(),
            &[linux_deps_violation("missing-linux-deps-step")],
        );
        assert_eq!(plan.edits.len(), 1);
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("очікували write");
        };
        let lines: Vec<&str> = w.content.split('\n').collect();
        let apt_idx = lines
            .iter()
            .position(|l| l.contains("apt-get install"))
            .unwrap();
        let toolchain_idx = lines
            .iter()
            .position(|l| l.contains("dtolnay/rust-toolchain"))
            .unwrap();
        let checkout_idx = lines
            .iter()
            .position(|l| l.contains("actions/checkout"))
            .unwrap();
        assert!(apt_idx > checkout_idx);
        assert!(apt_idx < toolchain_idx);
        assert!(w
            .content
            .contains("libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev"));
        // Відступ apt-кроку — той самий рівень step-list-а, що toolchain-крок.
        assert!(w
            .content
            .contains("      - name: Системні залежності Tauri (Linux)"));
    }

    /// Дзеркало «без toolchain-кроку не вставляє (нетипове форматування —
    /// T1/LLM)».
    #[test]
    fn linux_deps_fix_no_toolchain_step_is_noop() {
        let tmp = tempfile::TempDir::new().unwrap();
        write_lint_rust(
            &tmp,
            "jobs:\n  lint:\n    steps:\n      - run: cargo clippy\n",
        );
        assert!(tauri_linux_deps_fix(
            tmp.path(),
            &[linux_deps_violation("missing-linux-deps-step")]
        )
        .edits
        .is_empty());
    }

    /// Дзеркало «appendMissingPackages дописує відсутні пакети в наявний
    /// apt-рядок».
    #[test]
    fn linux_deps_fix_appends_missing_packages() {
        let tmp = tempfile::TempDir::new().unwrap();
        write_lint_rust(&tmp, PARTIAL_DEPS_YML);
        let plan = tauri_linux_deps_fix(
            tmp.path(),
            &[linux_deps_violation("missing-linux-deps-packages")],
        );
        assert_eq!(plan.edits.len(), 1);
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("очікували write");
        };
        assert!(w.content.contains(
            "sudo apt-get install -y libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev"
        ));
    }

    /// Дзеркало «appendMissingPackages зберігає shell-continuation `\`».
    #[test]
    fn linux_deps_fix_append_preserves_shell_continuation() {
        let tmp = tempfile::TempDir::new().unwrap();
        write_lint_rust(
            &tmp,
            "jobs:\n  lint:\n    steps:\n      - run: |\n          sudo apt-get install -y libwebkit2gtk-4.1-dev \\\n            build-essential\n      - uses: dtolnay/rust-toolchain@stable\n",
        );
        let plan = tauri_linux_deps_fix(
            tmp.path(),
            &[linux_deps_violation("missing-linux-deps-packages")],
        );
        assert_eq!(plan.edits.len(), 1);
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("очікували write");
        };
        assert!(w
            .content
            .contains("libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \\"));
        assert!(w.content.contains("            build-essential"));
    }

    /// Ідемпотентність: файл уже канонічний → обидва kind-и дають порожній
    /// план (insert бачить apt-рядок, append не знаходить відсутніх пакетів).
    #[test]
    fn linux_deps_fix_canonical_file_is_noop() {
        let tmp = tempfile::TempDir::new().unwrap();
        write_lint_rust(
            &tmp,
            "jobs:\n  lint:\n    steps:\n      - run: sudo apt-get install -y libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev\n      - uses: dtolnay/rust-toolchain@stable\n",
        );
        assert!(tauri_linux_deps_fix(
            tmp.path(),
            &[linux_deps_violation("missing-linux-deps-step")]
        )
        .edits
        .is_empty());
        assert!(tauri_linux_deps_fix(
            tmp.path(),
            &[linux_deps_violation("missing-linux-deps-packages")]
        )
        .edits
        .is_empty());
    }

    // ── tauri/cargo_mutants_config ──

    fn make_tauri_proj(tmp: &tempfile::TempDir) {
        let write = |rel: &str, content: &str| {
            let path = tmp.path().join(rel);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, content).unwrap();
        };
        write("package.json", r#"{"workspaces":["app"]}"#);
        write("app/package.json", r#"{"name":"app","version":"0.0.0"}"#);
        write(
            "app/src-tauri/Cargo.toml",
            "[package]\nname=\"t\"\nversion=\"0.1.0\"\n",
        );
    }

    #[test]
    fn mutants_fix_empty_plan_without_matching_violation() {
        let tmp = tempfile::TempDir::new().unwrap();
        make_tauri_proj(&tmp);
        assert!(tauri_cargo_mutants_config_fix(tmp.path(), &[])
            .edits
            .is_empty());
        assert!(
            tauri_cargo_mutants_config_fix(tmp.path(), &[violation("other", None, None)])
                .edits
                .is_empty()
        );
    }

    /// Дзеркало «mutants.toml відсутній — створено Tauri canonical baseline»
    /// (`cargo_mutants_config.test.mjs`).
    #[test]
    fn mutants_fix_missing_file_plans_full_baseline() {
        let tmp = tempfile::TempDir::new().unwrap();
        make_tauri_proj(&tmp);
        let plan = tauri_cargo_mutants_config_fix(
            tmp.path(),
            &[violation(
                "mutants-config-missing",
                Some("app/src-tauri/.cargo/mutants.toml"),
                None,
            )],
        );
        assert_eq!(plan.edits.len(), 1);
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("очікували write");
        };
        assert_eq!(w.path, "app/src-tauri/.cargo/mutants.toml");
        let parsed: toml::Table = toml::from_str(&w.content).unwrap();
        assert_eq!(
            parsed["additional_cargo_test_args"],
            toml::Value::try_from(vec!["--lib", "--tests"]).unwrap()
        );
        let globs = parsed["exclude_globs"].as_array().unwrap();
        assert!(globs.iter().any(|g| g.as_str() == Some("src/main.rs")));
        assert!(globs.iter().any(|g| g.as_str() == Some("src/lib.rs")));
        assert!(globs
            .iter()
            .any(|g| g.as_str() == Some("src/**/android.rs")));
        assert!(globs.iter().any(|g| g.as_str() == Some("src/**/macos.rs")));
    }

    /// Дзеркало «частково сконфігурований файл — T0 додає лише відсутні
    /// ключі, наявні байтово незмінні».
    #[test]
    fn mutants_fix_partial_file_appends_only_missing_keys() {
        let tmp = tempfile::TempDir::new().unwrap();
        make_tauri_proj(&tmp);
        let target = tmp.path().join("app/src-tauri/.cargo/mutants.toml");
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        let manual = "additional_cargo_test_args = [\"--lib\"]\ntimeout_multiplier = 5.0\n";
        std::fs::write(&target, manual).unwrap();
        let plan = tauri_cargo_mutants_config_fix(
            tmp.path(),
            &[violation(
                "mutants-keys-missing",
                Some("app/src-tauri/.cargo/mutants.toml"),
                None,
            )],
        );
        assert_eq!(plan.edits.len(), 1);
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("очікували write");
        };
        assert!(w.content.starts_with(manual));
        let parsed: toml::Table = toml::from_str(&w.content).unwrap();
        // Наявний ключ не перетерто (duplicate-key зламав би парсинг).
        assert_eq!(
            parsed["additional_cargo_test_args"],
            toml::Value::try_from(vec!["--lib"]).unwrap()
        );
        assert!(parsed["exclude_globs"]
            .as_array()
            .unwrap()
            .iter()
            .any(|g| g.as_str() == Some("src/main.rs")));
    }

    /// Ідемпотентність: усі канонічні ключі вже є → порожній план (rescan
    /// пропускає already-complete файл).
    #[test]
    fn mutants_fix_complete_file_is_noop() {
        let tmp = tempfile::TempDir::new().unwrap();
        make_tauri_proj(&tmp);
        let target = tmp.path().join("app/src-tauri/.cargo/mutants.toml");
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(
            &target,
            "additional_cargo_test_args = [\"--lib\"]\nexclude_globs = [\"src/custom.rs\"]\n",
        )
        .unwrap();
        // Навіть зі stale violation (напр. race) rescan не знаходить роботи.
        assert!(tauri_cargo_mutants_config_fix(
            tmp.path(),
            &[violation(
                "mutants-keys-missing",
                Some("app/src-tauri/.cargo/mutants.toml"),
                None
            )]
        )
        .edits
        .is_empty());
    }

    /// Дзеркало «кілька src-tauri у різних workspaces — у кожному
    /// з'являється Tauri-config».
    #[test]
    fn mutants_fix_multi_workspace_plans_each_src_tauri() {
        let tmp = tempfile::TempDir::new().unwrap();
        let write = |rel: &str, content: &str| {
            let path = tmp.path().join(rel);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, content).unwrap();
        };
        write("package.json", r#"{"workspaces":["app","desktop"]}"#);
        write("app/package.json", r#"{"name":"app","version":"0.0.0"}"#);
        write(
            "desktop/package.json",
            r#"{"name":"desktop","version":"0.0.0"}"#,
        );
        write("app/src-tauri/Cargo.toml", "[package]\nname=\"a\"\n");
        write("desktop/src-tauri/Cargo.toml", "[package]\nname=\"d\"\n");
        let plan = tauri_cargo_mutants_config_fix(
            tmp.path(),
            &[violation(
                "mutants-config-missing",
                Some("app/src-tauri/.cargo/mutants.toml"),
                None,
            )],
        );
        let paths: Vec<&str> = plan.edits.iter().map(FileEdit::path).collect();
        assert_eq!(
            paths,
            vec![
                "app/src-tauri/.cargo/mutants.toml",
                "desktop/src-tauri/.cargo/mutants.toml"
            ]
        );
    }

    // ── hasura/internal_urls ──

    fn write_hasura_yaml(tmp: &tempfile::TempDir, rel: &str, content: &str) {
        let path = tmp.path().join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }

    #[test]
    fn internal_urls_fix_empty_plan_without_mismatch_reasons() {
        let tmp = tempfile::TempDir::new().unwrap();
        assert!(hasura_internal_urls_fix(tmp.path(), &[]).edits.is_empty());
        // `internal-url-invalid` — НЕ T0-фікс (людське рішення про cluster/port).
        assert!(hasura_internal_urls_fix(
            tmp.path(),
            &[violation("internal-url-invalid", Some("dev.env"), None)]
        )
        .edits
        .is_empty());
    }

    /// Дзеркало «apply: переписує service, зберігаючи namespace/cluster/port»
    /// (`fix-internal_urls.test.mjs`).
    #[test]
    fn internal_urls_fix_rewrites_service_preserving_cluster_and_port() {
        let tmp = tempfile::TempDir::new().unwrap();
        write_hasura_yaml(
            &tmp,
            "hasura/k8s/base/svc-hl.yaml",
            "apiVersion: v1\nkind: Service\nmetadata:\n  name: order-h\n",
        );
        write_hasura_yaml(
            &tmp,
            "dev.env",
            "HASURA_GRAPHQL_ENDPOINT=http://contract-h-hl.ua-contract.svc.abie-ua.internal:8080\n",
        );
        let plan = hasura_internal_urls_fix(
            tmp.path(),
            &[violation(
                "internal-url-service-mismatch",
                Some("dev.env"),
                None,
            )],
        );
        assert_eq!(plan.edits.len(), 1);
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("очікували write");
        };
        assert_eq!(w.path, "dev.env");
        assert_eq!(
            w.content,
            "HASURA_GRAPHQL_ENDPOINT=http://order-h.ua-contract.svc.abie-ua.internal:8080\n"
        );
    }

    /// namespace-mismatch: очікуваний namespace з namespace.yaml, service —
    /// збережений з наявного URL (yaml для service відсутній).
    #[test]
    fn internal_urls_fix_rewrites_namespace_from_namespace_yaml() {
        let tmp = tempfile::TempDir::new().unwrap();
        write_hasura_yaml(
            &tmp,
            "hasura/k8s/base/namespace.yaml",
            "apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ua-order\n",
        );
        write_hasura_yaml(
            &tmp,
            "dev.env",
            "HASURA_GRAPHQL_ENDPOINT=http://contract-h-hl.ua-contract.svc.abie-ua.internal:8080\n",
        );
        let plan = hasura_internal_urls_fix(
            tmp.path(),
            &[violation(
                "internal-url-namespace-mismatch",
                Some("dev.env"),
                None,
            )],
        );
        assert_eq!(plan.edits.len(), 1);
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("очікували write");
        };
        assert_eq!(
            w.content,
            "HASURA_GRAPHQL_ENDPOINT=http://contract-h-hl.ua-order.svc.abie-ua.internal:8080\n"
        );
    }

    /// Ідемпотентність: URL уже збігається з очікуваними сегментами →
    /// порожній план (rewrite повертає `None` на рівному значенні).
    #[test]
    fn internal_urls_fix_matching_url_is_noop() {
        let tmp = tempfile::TempDir::new().unwrap();
        write_hasura_yaml(
            &tmp,
            "hasura/k8s/base/svc-hl.yaml",
            "apiVersion: v1\nkind: Service\nmetadata:\n  name: contract-h-hl\n",
        );
        write_hasura_yaml(
            &tmp,
            "dev.env",
            "HASURA_GRAPHQL_ENDPOINT=http://contract-h-hl.ua-contract.svc.abie-ua.internal:8080\n",
        );
        assert!(hasura_internal_urls_fix(
            tmp.path(),
            &[violation(
                "internal-url-service-mismatch",
                Some("dev.env"),
                None
            )]
        )
        .edits
        .is_empty());
    }

    /// Структурно невалідний URL у файлі mismatch-violation (stale/гонка) —
    /// rewrite не застосовується, план порожній.
    #[test]
    fn internal_urls_fix_invalid_url_in_file_is_noop() {
        let tmp = tempfile::TempDir::new().unwrap();
        write_hasura_yaml(
            &tmp,
            "hasura/k8s/base/svc-hl.yaml",
            "apiVersion: v1\nkind: Service\nmetadata:\n  name: order-h\n",
        );
        write_hasura_yaml(
            &tmp,
            "dev.env",
            "HASURA_GRAPHQL_ENDPOINT=https://vybeerai.com.ua/contract/ql\n",
        );
        assert!(hasura_internal_urls_fix(
            tmp.path(),
            &[violation(
                "internal-url-service-mismatch",
                Some("dev.env"),
                None
            )]
        )
        .edits
        .is_empty());
    }

    /// Кілька env-файлів → по одному edit на унікальний файл (дедуп).
    #[test]
    fn internal_urls_fix_dedups_files_across_violations() {
        let tmp = tempfile::TempDir::new().unwrap();
        write_hasura_yaml(
            &tmp,
            "hasura/k8s/base/svc-hl.yaml",
            "apiVersion: v1\nkind: Service\nmetadata:\n  name: order-h\n",
        );
        for f in ["dev.env", "production.env"] {
            write_hasura_yaml(
                &tmp,
                f,
                "HASURA_GRAPHQL_ENDPOINT=http://contract-h-hl.ua-contract.svc.abie-ua.internal:8080\n",
            );
        }
        let plan = hasura_internal_urls_fix(
            tmp.path(),
            &[
                violation("internal-url-service-mismatch", Some("dev.env"), None),
                violation("internal-url-service-mismatch", Some("dev.env"), None),
                violation(
                    "internal-url-service-mismatch",
                    Some("production.env"),
                    None,
                ),
            ],
        );
        assert_eq!(plan.edits.len(), 2);
    }

    // ── реєстр/диспетчер ──

    #[test]
    fn native_fixes_lists_all_ported_keys() {
        assert_eq!(
            NATIVE_FIXES,
            &[
                "abie/env_dns",
                "abie/firebase_hosting",
                "changelog/consistency",
                "doc-files/marksman_config",
                "doc-files/vscode_extensions",
                "graphql/vscode_extensions",
                "hasura/internal_urls",
                "hasura/migrations",
                "image-avif/avif_generation",
                "image-compress/check",
                "k8s/dremio_logging",
                "k8s/manifests",
                "nginx-default-tpl/template",
                "rego/vscode_extensions",
                "rego/vscode_settings",
                "security/sample_secret",
                "tauri/cargo_mutants_config",
                "tauri/gitignore_target",
                "tauri/linux_deps",
                "tauri/release",
                "tauri/updater",
                "tauri/vscode_extensions",
                "text/cspell",
                "text/markdownlint",
                "text/oxfmt",
                "text/oxfmtrc",
                "text/run-dotenv-linter",
                "text/run-shellcheck",
                "text/vscode_extensions",
                "text/vscode_settings",
                "worktree/vscode_settings",
                "worktree/zed_settings",
            ]
        );
    }

    /// Кожен ключ реєстру диспатчиться без помилки (порожні violations →
    /// порожній план, не `RulesError::Concern`).
    #[test]
    fn run_concern_fix_dispatches_every_registered_key() {
        let tmp = tempfile::TempDir::new().unwrap();
        for key in NATIVE_FIXES {
            let plan = run_concern_fix(key, tmp.path(), &[]).unwrap();
            assert!(
                plan.edits.is_empty(),
                "порожні violations → порожній план для {key}"
            );
        }
    }

    #[test]
    fn run_concern_fix_dispatches_marksman_config() {
        let tmp = tempfile::TempDir::new().unwrap();
        let v = violation(
            "marksman-config-missing",
            Some(".marksman.toml"),
            Some(serde_json::json!({ "kind": "marksman-config-missing" })),
        );
        let plan = run_concern_fix("doc-files/marksman_config", tmp.path(), &[v]).unwrap();
        assert_eq!(plan.edits.len(), 1);
    }

    #[test]
    fn run_concern_fix_dispatches_hasura_migrations() {
        let tmp = tempfile::TempDir::new().unwrap();
        let v = violation(
            "down-sql-forbidden",
            Some("hasura/migrations/x/down.sql"),
            None,
        );
        let plan = run_concern_fix("hasura/migrations", tmp.path(), &[v]).unwrap();
        assert_eq!(plan.edits.len(), 1);
    }

    #[test]
    fn run_concern_fix_rejects_unknown_key() {
        let tmp = tempfile::TempDir::new().unwrap();
        let err = run_concern_fix("k8s/unknown-concern", tmp.path(), &[]).unwrap_err();
        assert!(matches!(err, RulesError::Concern(_)));
        assert!(err.to_string().contains("k8s/unknown-concern"));
    }

    // ── text/oxfmt (T3, exec-tool) ──

    fn oxfmt_available() -> bool {
        Command::new("oxfmt")
            .arg("--version")
            .output()
            .is_ok_and(|out| out.status.success())
    }

    #[test]
    fn oxfmt_fix_empty_plan_without_matching_violation() {
        let tmp = tempfile::TempDir::new().unwrap();
        assert!(text_oxfmt_fix(tmp.path(), &[]).unwrap().edits.is_empty());
        let v = violation("other", Some("bad.mjs"), None);
        assert!(text_oxfmt_fix(tmp.path(), &[v]).unwrap().edits.is_empty());
    }

    #[test]
    fn oxfmt_fix_empty_plan_when_tool_missing() {
        let tmp = tempfile::TempDir::new().unwrap();
        std::fs::write(tmp.path().join("bad.mjs"), "export  const   x=1\n").unwrap();
        let v = violation(
            "oxfmt-unformatted",
            Some("bad.mjs"),
            Some(serde_json::json!({ "kind": "oxfmt-unformatted" })),
        );
        let plan = text_oxfmt_fix_with(tmp.path(), &[v], &|_| None).unwrap();
        assert!(plan.edits.is_empty());
    }

    #[test]
    fn oxfmt_fix_writes_reformatted_content() {
        if !oxfmt_available() {
            eprintln!("text/oxfmt fix: пропуск — oxfmt відсутній у PATH");
            return;
        }
        const SOURCE: &str = "export  const   x=1\nexport const y= 2\n";
        let tmp = tempfile::TempDir::new().unwrap();
        std::fs::write(tmp.path().join("bad.mjs"), SOURCE).unwrap();
        let v = violation(
            "oxfmt-unformatted",
            Some("bad.mjs"),
            Some(serde_json::json!({ "kind": "oxfmt-unformatted" })),
        );
        let plan = text_oxfmt_fix(tmp.path(), std::slice::from_ref(&v)).unwrap();
        assert_eq!(plan.edits.len(), 1, "{plan:?}");
        match &plan.edits[0] {
            FileEdit::Write(w) => {
                assert_eq!(w.path, "bad.mjs");
                assert_ne!(w.content, SOURCE);
            }
            other => panic!("очікували write, отримали {other:?}"),
        }

        // Продакшн-шлях: NATIVE_FIXES → run_concern_fix, не пряме звернення —
        // окремий tempdir з тим самим вихідним вмістом (перший виклик уже
        // переформатував файл на диску, повторний прогін на ТОМУ САМОМУ
        // дереві дав би порожній diff, не парність).
        assert!(NATIVE_FIXES.contains(&"text/oxfmt"));
        let tmp2 = tempfile::TempDir::new().unwrap();
        std::fs::write(tmp2.path().join("bad.mjs"), SOURCE).unwrap();
        let via_dispatch = run_concern_fix("text/oxfmt", tmp2.path(), &[v]).unwrap();
        assert_eq!(via_dispatch, plan);
    }

    #[test]
    fn oxfmt_fix_empty_plan_when_already_formatted() {
        if !oxfmt_available() {
            eprintln!("text/oxfmt fix: пропуск — oxfmt відсутній у PATH");
            return;
        }
        let tmp = tempfile::TempDir::new().unwrap();
        std::fs::write(tmp.path().join("good.mjs"), "export const x = 1;\n").unwrap();
        let v = violation(
            "oxfmt-unformatted",
            Some("good.mjs"),
            Some(serde_json::json!({ "kind": "oxfmt-unformatted" })),
        );
        let plan = text_oxfmt_fix(tmp.path(), &[v]).unwrap();
        assert!(plan.edits.is_empty(), "{plan:?}");
    }

    // ── text/markdownlint (T3, exec-tool, npx) ──

    fn npx_available() -> bool {
        Command::new("npx")
            .arg("--version")
            .output()
            .is_ok_and(|out| out.status.success())
    }

    fn init_git_repo(dir: &Path) {
        let status = Command::new("git")
            .current_dir(dir)
            .args(["init", "-q"])
            .status()
            .expect("git init");
        assert!(status.success());
    }

    fn git_add(dir: &Path, rel: &str) {
        let status = Command::new("git")
            .current_dir(dir)
            .args(["add", rel])
            .status()
            .expect("git add");
        assert!(status.success());
    }

    #[test]
    fn markdownlint_fix_empty_plan_without_matching_violation() {
        let tmp = tempfile::TempDir::new().unwrap();
        assert!(text_markdownlint_fix(tmp.path(), &[])
            .unwrap()
            .edits
            .is_empty());
        let v = violation("other", None, None);
        assert!(text_markdownlint_fix(tmp.path(), &[v])
            .unwrap()
            .edits
            .is_empty());
    }

    #[test]
    fn markdownlint_fix_empty_plan_without_tracked_markdown_files() {
        let tmp = tempfile::TempDir::new().unwrap();
        init_git_repo(tmp.path());
        let v = violation("markdownlint", None, None);
        let plan = text_markdownlint_fix(tmp.path(), &[v]).unwrap();
        assert!(plan.edits.is_empty(), "{plan:?}");
    }

    #[test]
    fn markdownlint_fix_rewrites_tracked_markdown_files() {
        if !npx_available() {
            eprintln!("text/markdownlint fix: пропуск — npx відсутній у PATH");
            return;
        }
        const SOURCE: &str = "# Title\nSome  text with trailing spaces   \n";
        let tmp = tempfile::TempDir::new().unwrap();
        init_git_repo(tmp.path());
        std::fs::write(tmp.path().join("bad.md"), SOURCE).unwrap();
        git_add(tmp.path(), "bad.md");

        let v = violation("markdownlint", None, None);
        let plan = text_markdownlint_fix(tmp.path(), std::slice::from_ref(&v)).unwrap();
        assert_eq!(plan.edits.len(), 1, "{plan:?}");
        match &plan.edits[0] {
            FileEdit::Write(w) => {
                assert_eq!(w.path, "bad.md");
                assert!(!w.content.contains("trailing spaces   \n"));
            }
            other => panic!("очікували write, отримали {other:?}"),
        }

        // Продакшн-шлях: NATIVE_FIXES → run_concern_fix, не пряме звернення —
        // окремий git-tempdir з тим самим вихідним вмістом (той самий мотив,
        // що в oxfmt-тесті вище: перший прогін уже переписав файл на диску).
        assert!(NATIVE_FIXES.contains(&"text/markdownlint"));
        let tmp2 = tempfile::TempDir::new().unwrap();
        init_git_repo(tmp2.path());
        std::fs::write(tmp2.path().join("bad.md"), SOURCE).unwrap();
        git_add(tmp2.path(), "bad.md");
        let via_dispatch = run_concern_fix("text/markdownlint", tmp2.path(), &[v]).unwrap();
        assert_eq!(via_dispatch, plan);
    }

    // ── nginx-default-tpl/template (T3, структурний) ──

    #[test]
    fn nginx_template_fix_empty_plan_without_matching_violation() {
        let tmp = tempfile::TempDir::new().unwrap();
        let plan = nginx_default_tpl_template_fix(tmp.path(), &[]);
        assert!(plan.edits.is_empty());
        let v = violation("other", None, None);
        assert!(nginx_default_tpl_template_fix(tmp.path(), &[v])
            .edits
            .is_empty());
    }

    #[test]
    fn nginx_template_fix_renames_legacy_file_without_sibling() {
        let tmp = tempfile::TempDir::new().unwrap();
        std::fs::create_dir_all(tmp.path().join("web")).unwrap();
        std::fs::write(
            tmp.path().join("web/default.tpl.conf"),
            "server_tokens off;\n",
        )
        .unwrap();

        let v = violation(
            "default-tpl-conf-legacy-name",
            Some("web/default.tpl.conf"),
            Some(serde_json::json!({ "kind": "default-tpl-conf-legacy-name" })),
        );
        let plan = nginx_default_tpl_template_fix(tmp.path(), std::slice::from_ref(&v));
        assert_eq!(plan.edits.len(), 2, "{plan:?}");
        assert!(plan.edits.iter().any(|e| matches!(
            e,
            FileEdit::Write(w) if w.path == "web/default.conf.template" && w.content == "server_tokens off;\n"
        )));
        assert!(plan
            .edits
            .iter()
            .any(|e| matches!(e, FileEdit::Delete { path } if path == "web/default.tpl.conf")));

        // Продакшн-шлях: NATIVE_FIXES → run_concern_fix, не пряме звернення.
        assert!(NATIVE_FIXES.contains(&"nginx-default-tpl/template"));
        let via_dispatch = run_concern_fix("nginx-default-tpl/template", tmp.path(), &[v]).unwrap();
        assert_eq!(via_dispatch, plan);
    }

    #[test]
    fn nginx_template_fix_overwrites_sibling_when_conf_template_exists() {
        let tmp = tempfile::TempDir::new().unwrap();
        std::fs::write(tmp.path().join("default.tpl.conf"), "NEW CONTENT\n").unwrap();
        std::fs::write(tmp.path().join("default.conf.template"), "OLD\n").unwrap();

        let v = violation(
            "default-tpl-conf-legacy-name",
            Some("default.tpl.conf"),
            Some(serde_json::json!({ "kind": "default-tpl-conf-legacy-name" })),
        );
        let plan = nginx_default_tpl_template_fix(tmp.path(), &[v]);
        assert_eq!(plan.edits.len(), 2, "{plan:?}");
        assert!(plan.edits.iter().any(|e| matches!(
            e,
            FileEdit::Write(w) if w.path == "default.conf.template" && w.content == "NEW CONTENT\n"
        )));
        assert!(plan
            .edits
            .iter()
            .any(|e| matches!(e, FileEdit::Delete { path } if path == "default.tpl.conf")));
    }

    #[test]
    fn nginx_template_fix_rewrites_error_log_off_directive() {
        let tmp = tempfile::TempDir::new().unwrap();
        std::fs::write(
            tmp.path().join("default.conf.template"),
            "server {\n  error_log off;\n}\n",
        )
        .unwrap();

        let v = violation(
            "error-log-off-directive",
            Some("default.conf.template"),
            Some(serde_json::json!({ "kind": "error-log-off-directive" })),
        );
        let plan = nginx_default_tpl_template_fix(tmp.path(), &[v]);
        assert_eq!(plan.edits.len(), 1, "{plan:?}");
        match &plan.edits[0] {
            FileEdit::Write(w) => {
                assert_eq!(w.path, "default.conf.template");
                assert_eq!(w.content, "server {\n  error_log /dev/null crit;\n}\n");
            }
            other => panic!("очікували write, отримали {other:?}"),
        }
    }

    #[test]
    fn nginx_template_fix_error_log_off_excludes_fixtures_segment() {
        let tmp = tempfile::TempDir::new().unwrap();
        std::fs::create_dir_all(tmp.path().join("tests/fixtures")).unwrap();
        std::fs::write(
            tmp.path().join("tests/fixtures/default.conf.template"),
            "error_log off;\n",
        )
        .unwrap();

        let v = violation("error-log-off-directive", None, None);
        let plan = nginx_default_tpl_template_fix(tmp.path(), &[v]);
        assert!(plan.edits.is_empty(), "{plan:?}");
    }

    // ── родина vscode_extensions (T5, §2.75) ──

    /// Реєстр і таблиця конфігів родини не мають розходитись: ключ у
    /// [`NATIVE_FIXES`] без конфігу дав би `RulesError` уже в рантаймі
    /// консюмера (JS-канон при цьому вже затінений), а конфіг без ключа —
    /// мертвий код, який ніхто ніколи не викличе.
    #[test]
    fn vscode_extensions_keys_registered_and_dispatched() {
        let tmp = tempfile::TempDir::new().unwrap();
        for key in super::super::fix_vscode_extensions::VSCODE_EXTENSIONS_FIX_KEYS {
            assert!(NATIVE_FIXES.contains(key), "{key} відсутній у NATIVE_FIXES");
            // Продакшн-шлях: run_concern_fix, не пряме звернення до рушія.
            let plan = run_concern_fix(
                key,
                tmp.path(),
                &[violation(
                    "policy-file-missing",
                    Some(".vscode/extensions.json"),
                    None,
                )],
            )
            .unwrap_or_else(|e| panic!("{key}: {e}"));
            assert_eq!(plan.edits.len(), 1, "{key}: очікували створення файлу");
            match &plan.edits[0] {
                FileEdit::Write(w) => assert_eq!(w.path, ".vscode/extensions.json"),
                other => panic!("{key}: очікували write, отримали {other:?}"),
            }
        }
    }

    // ── exec-tool хвиля §2.82: text/run-dotenv-linter + text/run-shellcheck ──

    /// Виконуваний shell-стаб із заданим тілом — усі тести цієї секції
    /// стоять на СТАБАХ, а не на реальних `dotenv-linter`/`shellcheck`:
    /// перевіряються канали (відсутній тул, ненульовий код, невдалий
    /// `patch`), а не поведінка самих тулів. Реальні тули покриті
    /// vitest-інтеграцією (`fix-*-native.test.mjs`), яка гучно скіпається,
    /// якщо тула немає.
    #[cfg(unix)]
    fn fake_exec(dir: &std::path::Path, name: &str, body: &str) -> std::path::PathBuf {
        use std::os::unix::fs::PermissionsExt;
        std::fs::create_dir_all(dir).unwrap();
        let bin = dir.join(name);
        std::fs::write(&bin, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        bin
    }

    /// Резолвер, який нічого не знаходить.
    fn resolver_none(_tool: &str) -> Option<std::path::PathBuf> {
        None
    }

    // --- text/run-dotenv-linter ---

    /// Немає violation `dotenv-linter` → порожній план, і резолв тула навіть
    /// не пробується (інакше `resolver_none` дав би `Err`).
    #[test]
    fn dotenv_fix_without_matching_violation_is_empty_plan() {
        let tmp = tempfile::TempDir::new().unwrap();
        let plan =
            text_run_dotenv_linter_fix_with(tmp.path(), &[violation("other", None, None)], &|t| {
                resolver_none(t)
            })
            .unwrap();
        assert!(plan.edits.is_empty());
    }

    /// Дефект канону 1: відсутній `dotenv-linter` давав МОВЧАЗНИЙ
    /// `{ touchedFiles: [] }`. Native — гучна помилка з install-підказкою.
    #[test]
    fn dotenv_fix_missing_tool_is_loud_error() {
        let tmp = tempfile::TempDir::new().unwrap();
        let error = text_run_dotenv_linter_fix_with(
            tmp.path(),
            &[violation("dotenv-linter", None, None)],
            &|t| resolver_none(t),
        )
        .unwrap_err();
        let text = error.to_string();
        assert!(text.contains("text/run-dotenv-linter"), "{text}");
        assert!(text.contains("dotenv-linter"), "{text}");
    }

    /// Дефект канону 2: ненульовий код `dotenv-linter fix` губився цілком.
    /// Native — помилка з кодом і stderr тула.
    #[cfg(unix)]
    #[test]
    fn dotenv_fix_nonzero_exit_is_loud_error() {
        let tmp = tempfile::TempDir::new().unwrap();
        let bins = tempfile::TempDir::new().unwrap();
        std::fs::write(tmp.path().join(".env"), "A=1\n").unwrap();
        let bin = fake_exec(bins.path(), "dotenv-linter", "echo 'boom' >&2\nexit 3");
        let error = text_run_dotenv_linter_fix_with(
            tmp.path(),
            &[violation("dotenv-linter", None, None)],
            &|_| Some(bin.clone()),
        )
        .unwrap_err();
        let text = error.to_string();
        assert!(text.contains("кодом 3"), "{text}");
        assert!(text.contains("boom"), "{text}");
    }

    /// Змінений тулом `.env` потрапляє у план як `write` з НОВИМ вмістом;
    /// незмінений сусід — ні.
    #[cfg(unix)]
    #[test]
    fn dotenv_fix_plans_write_only_for_changed_files() {
        let tmp = tempfile::TempDir::new().unwrap();
        let bins = tempfile::TempDir::new().unwrap();
        std::fs::write(tmp.path().join(".env"), "b=2\n").unwrap();
        std::fs::write(tmp.path().join(".env.example"), "A=1\n").unwrap();
        let bin = fake_exec(
            bins.path(),
            "dotenv-linter",
            "printf 'B=2\\n' > .env\nexit 0",
        );
        let plan = text_run_dotenv_linter_fix_with(
            tmp.path(),
            &[violation("dotenv-linter", None, None)],
            &|_| Some(bin.clone()),
        )
        .unwrap();
        assert_eq!(plan.edits.len(), 1, "{plan:?}");
        match &plan.edits[0] {
            FileEdit::Write(w) => {
                assert_eq!(w.path, ".env");
                assert_eq!(w.content, "B=2\n");
            }
            other => panic!("очікували write, отримали {other:?}"),
        }
    }

    /// Дерево без жодного `.env*` → порожній план ще ДО спавна (стаб, що
    /// завалив би прогін ненульовим кодом, не викликається взагалі).
    #[cfg(unix)]
    #[test]
    fn dotenv_fix_without_env_files_is_empty_plan_without_spawn() {
        let tmp = tempfile::TempDir::new().unwrap();
        let bins = tempfile::TempDir::new().unwrap();
        let bin = fake_exec(bins.path(), "dotenv-linter", "exit 3");
        let plan = text_run_dotenv_linter_fix_with(
            tmp.path(),
            &[violation("dotenv-linter", None, None)],
            &|_| Some(bin.clone()),
        )
        .unwrap();
        assert!(plan.edits.is_empty());
    }

    /// Фільтр [`list_env_files`]: `.envrc` (direnv), `*.bak` і `node_modules`
    /// поза списком; вкладені `.env.*` — усередині.
    #[test]
    fn list_env_files_filters_envrc_bak_and_node_modules() {
        let tmp = tempfile::TempDir::new().unwrap();
        let root = tmp.path();
        std::fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        std::fs::create_dir_all(root.join("apps/api")).unwrap();
        for (rel, body) in [
            (".env", "A=1\n"),
            (".env.local", "A=1\n"),
            (".envrc", "use flake\n"),
            (".env.bak", "A=1\n"),
            ("node_modules/pkg/.env", "A=1\n"),
            ("apps/api/.env.production", "A=1\n"),
            ("apps/api/notenv", "A=1\n"),
        ] {
            std::fs::write(root.join(rel), body).unwrap();
        }
        assert_eq!(
            list_env_files(root),
            vec![
                ".env".to_string(),
                ".env.local".to_string(),
                "apps/api/.env.production".to_string(),
            ]
        );
    }

    // --- text/run-shellcheck ---

    /// Немає violation `shellcheck` → порожній план без резолву тулів.
    #[test]
    fn shellcheck_fix_without_matching_violation_is_empty_plan() {
        let tmp = tempfile::TempDir::new().unwrap();
        let plan =
            text_run_shellcheck_fix_with(tmp.path(), &[violation("other", None, None)], &|t| {
                resolver_none(t)
            })
            .unwrap();
        assert!(plan.edits.is_empty());
    }

    /// Дефект канону 1, гілка `shellcheck`: відсутній тул → гучна помилка,
    /// не тихий no-op.
    #[test]
    fn shellcheck_fix_missing_tool_is_loud_error() {
        let tmp = tempfile::TempDir::new().unwrap();
        let error = text_run_shellcheck_fix_with(
            tmp.path(),
            &[violation("shellcheck", None, None)],
            &|t| resolver_none(t),
        )
        .unwrap_err();
        let text = error.to_string();
        assert!(text.contains("text/run-shellcheck"), "{text}");
        assert!(text.contains("shellcheck"), "{text}");
    }

    /// Дефект канону 1, гілка `patch`: тул для застосування дифу відсутній —
    /// теж гучна помилка з окремим текстом.
    #[cfg(unix)]
    #[test]
    fn shellcheck_fix_missing_patch_is_loud_error() {
        let tmp = tempfile::TempDir::new().unwrap();
        let bins = tempfile::TempDir::new().unwrap();
        let sc = fake_exec(bins.path(), "shellcheck", "exit 0");
        let error = text_run_shellcheck_fix_with(
            tmp.path(),
            &[violation("shellcheck", None, None)],
            &|tool| (tool == "shellcheck").then(|| sc.clone()),
        )
        .unwrap_err();
        let text = error.to_string();
        assert!(text.contains("`patch` не знайдено"), "{text}");
    }

    /// Чистий `shellcheck` (exit 0) → жодного `patch`, порожній план (стаб
    /// `patch` завалив би тест ненульовим кодом, якби його покликали).
    #[cfg(unix)]
    #[test]
    fn shellcheck_fix_clean_tree_plans_nothing() {
        let tmp = tempfile::TempDir::new().unwrap();
        let bins = tempfile::TempDir::new().unwrap();
        std::fs::write(tmp.path().join("ok.sh"), "#!/bin/sh\necho ok\n").unwrap();
        let sc = fake_exec(bins.path(), "shellcheck", "exit 0");
        let patch = fake_exec(bins.path(), "patch", "exit 1");
        let plan = text_run_shellcheck_fix_with(
            tmp.path(),
            &[violation("shellcheck", None, None)],
            &|tool| match tool {
                "shellcheck" => Some(sc.clone()),
                "patch" => Some(patch.clone()),
                _ => None,
            },
        )
        .unwrap();
        assert!(plan.edits.is_empty(), "{plan:?}");
    }

    /// `none were auto-fixable` у stderr зупиняє цикл так само, як exit 0 —
    /// порт `shouldStopAutofixLoop` (`patch` знову «зламаний» стаб).
    #[cfg(unix)]
    #[test]
    fn shellcheck_fix_non_autofixable_stops_loop() {
        let tmp = tempfile::TempDir::new().unwrap();
        let bins = tempfile::TempDir::new().unwrap();
        std::fs::write(tmp.path().join("warn.sh"), "#!/bin/sh\necho ok\n").unwrap();
        let sc = fake_exec(
            bins.path(),
            "shellcheck",
            "echo 'In warn.sh line 2: ... none were auto-fixable' >&2\nexit 1",
        );
        let patch = fake_exec(bins.path(), "patch", "exit 1");
        let plan = text_run_shellcheck_fix_with(
            tmp.path(),
            &[violation("shellcheck", None, None)],
            &|tool| match tool {
                "shellcheck" => Some(sc.clone()),
                "patch" => Some(patch.clone()),
                _ => None,
            },
        )
        .unwrap();
        assert!(plan.edits.is_empty(), "{plan:?}");
    }

    /// Повний цикл: `shellcheck -f diff` (стаб, один раунд) → РЕАЛЬНИЙ
    /// `patch -p1` → план з новим вмістом файла. `patch` — базовий POSIX-тул
    /// (macOS/Linux); якщо його раптом нема, тест ГУЧНО падає, а не мовчки
    /// скіпається.
    #[cfg(unix)]
    #[test]
    fn shellcheck_fix_applies_diff_and_plans_write() {
        let patch = resolve_cmd("patch")
            .expect("`patch` відсутній у PATH — базовий POSIX-тул, потрібен цьому тесту (не skip)");
        let tmp = tempfile::TempDir::new().unwrap();
        let bins = tempfile::TempDir::new().unwrap();
        std::fs::write(tmp.path().join("x.sh"), "#!/bin/sh\necho $foo\n").unwrap();

        let diff = bins.path().join("x.diff");
        std::fs::write(
            &diff,
            "--- a/x.sh\n+++ b/x.sh\n@@ -1,2 +1,2 @@\n #!/bin/sh\n-echo $foo\n+echo \"$foo\"\n",
        )
        .unwrap();
        let state = bins.path().join("round");
        let sc = fake_exec(
            bins.path(),
            "shellcheck",
            &format!(
                "if [ -f {state} ]; then exit 0; fi\n: > {state}\ncat {diff}\nexit 1",
                state = state.display(),
                diff = diff.display()
            ),
        );

        let plan = text_run_shellcheck_fix_with(
            tmp.path(),
            &[violation("shellcheck", None, None)],
            &|tool| match tool {
                "shellcheck" => Some(sc.clone()),
                "patch" => Some(patch.clone()),
                _ => None,
            },
        )
        .unwrap();
        assert_eq!(plan.edits.len(), 1, "{plan:?}");
        match &plan.edits[0] {
            FileEdit::Write(w) => {
                assert_eq!(w.path, "x.sh");
                assert_eq!(w.content, "#!/bin/sh\necho \"$foo\"\n");
            }
            other => panic!("очікували write, отримали {other:?}"),
        }
    }

    /// Дефект канону 2: ненульовий `patch` губився разом із кодом
    /// `runShellcheckText`. Native — помилка з іменем файлу і виводом
    /// `patch`.
    #[cfg(unix)]
    #[test]
    fn shellcheck_fix_failed_patch_is_loud_error() {
        let tmp = tempfile::TempDir::new().unwrap();
        let bins = tempfile::TempDir::new().unwrap();
        std::fs::write(tmp.path().join("x.sh"), "#!/bin/sh\necho $foo\n").unwrap();
        let sc = fake_exec(
            bins.path(),
            "shellcheck",
            "printf -- '--- a/x.sh\\n+++ b/x.sh\\n'\nexit 1",
        );
        let patch = fake_exec(bins.path(), "patch", "echo 'malformed patch' >&2\nexit 2");
        let error = text_run_shellcheck_fix_with(
            tmp.path(),
            &[violation("shellcheck", None, None)],
            &|tool| match tool {
                "shellcheck" => Some(sc.clone()),
                "patch" => Some(patch.clone()),
                _ => None,
            },
        )
        .unwrap_err();
        let text = error.to_string();
        assert!(text.contains("x.sh"), "{text}");
        assert!(text.contains("malformed patch"), "{text}");
    }

    /// Обидва ключі §2.82 диспатчаться продакшн-шляхом (`run_concern_fix`),
    /// не прямим викликом — той самий інваріант, що й у решти реєстру.
    #[test]
    fn run_concern_fix_dispatches_exec_tool_wave_keys() {
        assert!(NATIVE_FIXES.contains(&"text/run-dotenv-linter"));
        assert!(NATIVE_FIXES.contains(&"text/run-shellcheck"));
        let tmp = tempfile::TempDir::new().unwrap();
        // Без відповідних violations — порожній план і жодного звернення до
        // PATH (гілка застосовності стоїть ПЕРЕД резолвом тула).
        for key in ["text/run-dotenv-linter", "text/run-shellcheck"] {
            let plan = run_concern_fix(key, tmp.path(), &[violation("other", None, None)]).unwrap();
            assert!(plan.edits.is_empty(), "{key}");
        }
    }
}
