---
bump: patch
section: Removed
---

Знято 936 рядків мертвого/уже-портованого JS у `npm/scripts/lib/lint-surface/`
(кроки 1–2 `docs/plans/2026-08-31-full-rust-migration-plan.md`): `tier-sampling-bench.mjs`,
`tier-sampling-experiment.mjs`, `policy-test-step.mjs` (896 рядків, живих
викликів не було) і `render.mjs` (40 рядків, тонкий факад над native —
споживачі тепер кличуть `loadNative().renderViolations()` напряму, а
непортований `renderDiagnostics` перенесено в `run-detectors.mjs`).

`ladder.mjs`, `snapshot.mjs`, `collateral-veto.mjs`, `test-gate.mjs` (408
рядків) НЕ знято, попри клас D у розвідці: Rust-порт (`n7n-harness` 0.3.0)
підключений лише за прапорцем `--native-fix`, який не дефолт — штатний
(без прапорця) fix-конвеєр і сьогодні виконує саме ці чотири JS-модулі.
Зняття зламало б поведінку мовчки. Деталі — §2.104
`docs/plans/2026-08-05-open-questions-register.md`.
