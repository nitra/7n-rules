//! Host-валідатори — семантичні перевірки, які WIT-типізація не покриває
//! (safe-path, id-regex), рішення Л спеки
//! `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md`: «типів WIT
//! для них замало». Порт `npm/scripts/lib/slot-contracts-ci.mjs`.

/// Валідатори слоту `ci.artifact@1` — 1:1 семантичний порт
/// `npm/scripts/lib/slot-contracts-ci.mjs`
/// (`validateCiArtifactPayload`/`isSafeRepoRelativePath`/`isSafeTemplateRelPath`/`CI_ARTIFACT_ID_RE`).
pub mod ci_artifact;
/// Валідатор [`crate::fix::FixPlan`]-ів wasm-плагінів — safe-path (переюз
/// `ci_artifact::is_safe_repo_relative_path`) і ліміти розміру; викликається
/// хостом (`rules-plugin-host::LoadedPlugin::fix`) до передачі плану
/// оркестрації.
pub mod fix;
/// Валідатор [`crate::manifest::Manifest`]-ів wasm-плагінів — взаємна
/// виключність `concerns` і `fix-only-concerns` та відсутність дублікатів
/// у кожному зі списків (мажор `4.0.0`, §2.84), плюс форма/ядровий
/// world/дублікати `worlds` (мажор `5.0.0`, §2.109); викликається хостом
/// (`rules-plugin-host::PluginHost::load`) ОДРАЗУ після probe-`describe()`,
/// до того як плагін потрапить у мапу концернів.
pub mod manifest;
/// Валідатор рядка `Manifest::tools` (схеми резолву `pinned:`/`path:`,
/// рішення В спеки v3.1) і запиту `exec-tool` — safe-path для `cwd` і
/// `scratch-file.path` (переюз `ci_artifact::is_safe_repo_relative_path`)
/// плюс ліміти scratch-обміну; викликається хостом
/// (`rules-plugin-host::HostState::exec_tool`) ДО спавна процесу.
pub mod tool;
