//! DTO типів окремих WIT-пакетів слот-payload-ів (`n-rules:slots`,
//! `wit/deps/slots/`) — незалежний від `n-rules:plugin` цикл версіонування
//! (рішення Л спеки `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md`).

/// `CiArtifactDescriptor` — WIT-дзеркало payload-у слоту `ci.artifact@1`
/// (`wit/deps/slots/ci-artifact.wit`), витягнуте з canonical JS-контракту
/// `npm/scripts/lib/slot-contracts-ci.mjs`.
pub mod ci_artifact;
