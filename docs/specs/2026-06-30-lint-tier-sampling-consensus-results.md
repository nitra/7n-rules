# Tier Sampling / Consensus Experiment Results

Date: 2026-06-30

Worktree: `.worktrees/codex-lint-tier-sampling-experiment`

Raw result: `docs/specs/2026-06-30-lint-tier-sampling-consensus-results.json`

## Setup

The experiment ran the experiment-only lint fix harness across two deterministic fixtures:

- `package-script-no-fix`: remove forbidden `--fix` from `package.json` lint script.
- `missing-jscpd-config`: create a valid `.jscpd.json` with the required policy fields.

Tiers:

- `local-min`: one conservative candidate.
- `cloud-min`: conservative + exploratory candidates.
- `cloud-avg`: conservative + exploratory candidates.
- `cloud-max`: one conservative candidate.

Models:

| Tier | Model |
| --- | --- |
| `local-min` | `omlx/gemma-4-e4b-it-OptiQ-4bit` |
| `cloud-min` | `openai-codex/gpt-5.4-mini` |
| `cloud-avg` | `openai-codex/gpt-5.5` |
| `cloud-max` | `openai-codex/gpt-5.5` |

## Summary

| Tier | Clean | Attempts | Clean attempts | Avg attempt |
| --- | ---: | ---: | ---: | ---: |
| `local-min` | 2/2 | 2 | 2/2 | 12.204s |
| `cloud-min` | 2/2 | 4 | 4/4 | 11.977s |
| `cloud-avg` | 2/2 | 4 | 4/4 | 12.949s |
| `cloud-max` | 2/2 | 2 | 2/2 | 9.722s |

## Fixture Results

| Fixture | Tier | Selected profile | Attempts |
| --- | --- | --- | --- |
| `package-script-no-fix` | `local-min` | `conservative` | `conservative`: clean, 12.151s, 93 bytes |
| `package-script-no-fix` | `cloud-min` | `exploratory` | `conservative`: clean, 12.792s, 93 bytes; `exploratory`: clean, 11.578s, 93 bytes |
| `package-script-no-fix` | `cloud-avg` | `conservative` | `conservative`: clean, 9.437s, 93 bytes; `exploratory`: clean, 19.336s, 93 bytes |
| `package-script-no-fix` | `cloud-max` | `conservative` | `conservative`: clean, 10.230s, 93 bytes |
| `missing-jscpd-config` | `local-min` | `conservative` | `conservative`: clean, 12.256s, 86 bytes |
| `missing-jscpd-config` | `cloud-min` | `conservative` | `conservative`: clean, 13.661s, 78 bytes; `exploratory`: clean, 9.876s, 87 bytes |
| `missing-jscpd-config` | `cloud-avg` | `exploratory` | `conservative`: clean, 12.817s, 79 bytes; `exploratory`: clean, 10.205s, 70 bytes |
| `missing-jscpd-config` | `cloud-max` | `conservative` | `conservative`: clean, 9.214s, 70 bytes |

## Conclusion

The full run produced 12 clean attempts out of 12. That is good for validating the harness, but it also means the fixtures were too easy to measure rescue value: `local-min` solved both cases, so there was no failed baseline for cloud sampling or consensus to rescue.

Dual sampling on `cloud-min` and `cloud-avg` did not improve clean rate on this set. It doubled the number of model calls for those tiers, while selection sometimes preferred a slower candidate because the chooser optimizes smaller touched/changed surface before latency.

`cloud-max` was the fastest tier in this small run by average attempt latency, but it did not demonstrate unique quality because every tier was already clean. It should remain experiment-only until harder fixtures show a real rescue signal.

Recommended next experiment: add harder fixtures with multi-file edits, misleading first patches, and real historical lint failures. The decision rule should be based on rescue rate per extra call, not on clean rate for already-simple violations.
