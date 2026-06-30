---
bump: major
section: Changed
---

Unified lint surface: усі concern-и зведено до одного detector-контракту `lint(ctx) → { violations }` (read-only); fix став окремою роллю central pipeline (T0 → tier-ladder). Policy-concern-и генеруються codegen-ом (`@generated main.mjs` + source-hash drift-gate). CLI: `n-cursor lint` (fix-by-default) / `lint --no-fix` (detect-only); прибрано `fix`, `fix-t0`, `--read-only`, `llmFix`. Видалено старий conformance/orchestrator-стек (`run-lint`, `run-rule`, `orchestrator`, `run-conformance-check`, `t0`).
