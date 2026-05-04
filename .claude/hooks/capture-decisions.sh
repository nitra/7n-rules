#!/usr/bin/env bash
# Stop hook: extract ADR/Runbook/Knowledge drafts from session transcript.
# Runs async; uses `claude --bare -p` (skips hooks → no recursion).
set -euo pipefail

INPUT=$(cat)
TRANSCRIPT_PATH=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty')
SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // "unknown"')

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
INBOX="$PROJECT_ROOT/docs/adr/_inbox"
LOG_DIR="$PROJECT_ROOT/.claude/hooks"
LOG="$LOG_DIR/capture-decisions.log"
mkdir -p "$INBOX" "$LOG_DIR"

log() { printf '%s %s\n' "$(date -Iseconds)" "$*" >> "$LOG"; }

if [[ -z "$TRANSCRIPT_PATH" || ! -f "$TRANSCRIPT_PATH" ]]; then
  exit 0
fi

# Extract role+text from JSONL transcript (skip tool noise to keep prompt small).
TRANSCRIPT=$(jq -r '
  select(.type == "user" or .type == "assistant")
  | .message as $m
  | ($m.role // .type) as $role
  | ($m.content
      | if type == "string" then .
        else (map(select(.type == "text") | .text) | join("\n"))
        end) as $txt
  | select($txt | length > 0)
  | "[" + $role + "]\n" + $txt
' "$TRANSCRIPT_PATH" 2>/dev/null || true)

# Cap input size to keep latency/cost predictable.
MAX_CHARS=120000
if (( ${#TRANSCRIPT} > MAX_CHARS )); then
  TRANSCRIPT="${TRANSCRIPT: -$MAX_CHARS}"
fi

if [[ -z "$TRANSCRIPT" ]]; then
  exit 0
fi

PROMPT=$(cat <<'EOF'
You analyze a Claude Code session transcript and extract durable knowledge worth saving as ADR / Runbook / Knowledge drafts.

OUTPUT RULES:
- If NO clear architectural decision, runbook-worthy procedure, or non-obvious knowledge was established, output the single token: NONE
- Otherwise, emit one or more markdown blocks in this exact shape (no preamble, no trailing prose):

## [ADR|Runbook|Knowledge] <short title>
**Context:** <what triggered this — 1-2 sentences>
**Decision/Procedure/Fact:** <what was decided / the steps / the fact>
**Rationale:** <why this over alternatives>
**Alternatives considered:** <list, or "none discussed">

WHAT COUNTS:
- ADR: a tradeoff was discussed and a choice made (library, pattern, architecture)
- Runbook: a non-trivial sequence of steps to reproduce/fix/operate something
- Knowledge: a non-obvious constraint, gotcha, or invariant uncovered

WHAT DOES NOT COUNT (output NONE):
- Routine code edits, typo fixes, lint passes
- Obvious answers to direct questions
- Work that anyone could derive by reading the diff

Be conservative. NONE is the right answer most of the time.

TRANSCRIPT FOLLOWS:
---
EOF
)

RESPONSE=$(printf '%s\n%s\n' "$PROMPT" "$TRANSCRIPT" \
  | claude --bare -p --model haiku 2>>"$LOG" || true)

RESPONSE_TRIMMED=$(printf '%s' "$RESPONSE" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')

if [[ -z "$RESPONSE_TRIMMED" || "$RESPONSE_TRIMMED" == "NONE" ]] || ! printf '%s' "$RESPONSE_TRIMMED" | grep -q '^## \['; then
  exit 0
fi

TS=$(date +%Y%m%d-%H%M%S)
OUT="$INBOX/$TS-${SESSION_ID:0:8}.md"
{
  printf -- '---\nsession: %s\ncaptured: %s\ntranscript: %s\n---\n\n' \
    "$SESSION_ID" "$(date -Iseconds)" "$TRANSCRIPT_PATH"
  printf '%s\n' "$RESPONSE_TRIMMED"
} > "$OUT"
log "wrote: $OUT"
