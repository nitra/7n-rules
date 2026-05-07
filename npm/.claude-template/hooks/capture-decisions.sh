#!/usr/bin/env bash
# Stop hook: extract ADR/Runbook/Knowledge drafts from session transcript.
# Runs async. Recursion guard: env var prevents the inner LLM CLI from
# re-triggering this hook (the inner session inherits CAPTURE_DECISIONS_RUNNING=1).
#
# LLM CLI selection (first available wins):
#   1. claude        — use `claude -p --model "$CAPTURE_DECISIONS_CLAUDE_MODEL"` (default: sonnet)
#   2. cursor-agent  — use `cursor-agent -p --mode ask --model "$CAPTURE_DECISIONS_CURSOR_MODEL"`
#                       (default: claude-4.6-sonnet-medium)
#   neither          — exit 0 silently
#
# Bundled with @nitra/cursor; project copy is auto-synced by the `adr` rule.
set -euo pipefail

if [[ -n "${CAPTURE_DECISIONS_RUNNING:-}" ]]; then
  exit 0
fi
export CAPTURE_DECISIONS_RUNNING=1

INPUT=$(cat)
TRANSCRIPT_PATH=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty')
SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // "unknown"')

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
INBOX="$PROJECT_ROOT/docs/adr/_inbox"
LOG_DIR="$PROJECT_ROOT/.claude/hooks"
LOG="$LOG_DIR/capture-decisions.log"
mkdir -p "$INBOX" "$LOG_DIR"

log() { printf '%s %s\n' "$(date -Iseconds)" "$*" >> "$LOG"; }

log "fired: $SESSION_ID"

if [[ -z "$TRANSCRIPT_PATH" || ! -f "$TRANSCRIPT_PATH" ]]; then
  log "  → no transcript path"
  exit 0
fi

# Extract role + text + thinking + tool_use names from JSONL transcript.
# We keep reasoning/decisions visible to the analyzer but drop large tool outputs.
TRANSCRIPT=$(jq -r '
  select(.type == "user" or .type == "assistant")
  | .message as $m
  | ($m.role // .type) as $role
  | ($m.content
      | if type == "string" then .
        else (
          map(
            if .type == "text" then .text
            elif .type == "thinking" then "[thinking]\n" + (.thinking // "")
            elif .type == "tool_use" then
              "[tool: " + .name + "]" +
              (if .input then
                " " + (.input | tostring | .[0:300])
              else "" end)
            elif .type == "tool_result" then
              "[tool_result] " + (
                (.content
                  | if type == "string" then . else (map(select(.type=="text") | .text) | join(" ")) end
                ) // "" | .[0:300]
              )
            else "" end
          ) | map(select(length > 0)) | join("\n")
        )
        end) as $body
  | select($body | length > 0)
  | "[" + $role + "]\n" + $body
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
You analyze a Claude Code session transcript and produce a durable knowledge artifact (ADR, Runbook, or Knowledge note) capturing what was done and why.

LANGUAGE: Write the ENTIRE output in Ukrainian. This applies to the title, all section content, prose, and rationale. Keep code identifiers, file paths, commands, and tool or library names in their original form (do not translate `walkDir`, `package.json`, `npm`, etc.) — only translate the natural-language prose around them. Section labels themselves stay in Ukrainian per the template below.

IMPORTANT: by "decision" we mean the design choice expressed in the session — even if the user pre-specified it in their brief. The user dictating the approach IS the decision; capture it, including the rationale they gave or that became apparent during implementation. Do NOT return NONE just because the user gave detailed instructions upfront.

OUTPUT RULES:
- Emit one or more markdown blocks in this exact shape (no preamble, no trailing prose):

## [ADR|Runbook|Knowledge] <короткий заголовок українською>
**Контекст:** <яка проблема / ситуація це спричинила — 1-2 речення>
**Рішення/Процедура/Факт:** <що було зроблено — конкретно: змінені файли, введена семантика, кроки>
**Обґрунтування:** <чому саме такий підхід — з ТЗ користувача або міркувань асистента>
**Розглянуті альтернативи:** <перелік явно обговорених, або «не обговорювалися»>
**Зачіпає:** <файли, модулі, публічні API, конфіги>

WHEN TO PICK EACH TYPE:
- ADR: a design choice (library, schema, pattern, semantics of a field/API). Most substantive code work qualifies.
- Runbook: a procedure to operate, fix, deploy, or reproduce something.
- Knowledge: a non-obvious constraint, gotcha, or invariant uncovered (without a corresponding code change).

OUTPUT NONE ONLY IF the session is genuinely trivial:
- A single typo fix, comment edit, or lint cleanup with no design content
- A pure question/answer with no code change and no surprising fact
- An aborted/empty session

When in doubt, emit a block. Capturing too much is acceptable; missing real work is not.

TRANSCRIPT FOLLOWS:
---
EOF
)

PROMPT_FULL=$(printf '%s\n%s\n' "$PROMPT" "$TRANSCRIPT")

CLAUDE_MODEL="${CAPTURE_DECISIONS_CLAUDE_MODEL:-sonnet}"
CURSOR_MODEL="${CAPTURE_DECISIONS_CURSOR_MODEL:-claude-4.6-sonnet-medium}"

if command -v claude >/dev/null 2>&1; then
  log "  → using claude CLI (model: $CLAUDE_MODEL)"
  RESPONSE=$(printf '%s' "$PROMPT_FULL" | claude -p --model "$CLAUDE_MODEL" 2>>"$LOG" || true)
elif command -v cursor-agent >/dev/null 2>&1; then
  log "  → using cursor-agent CLI (model: $CURSOR_MODEL)"
  RESPONSE=$(cursor-agent -p --mode ask --output-format text --model "$CURSOR_MODEL" -- "$PROMPT_FULL" 2>>"$LOG" || true)
else
  log "  → no LLM CLI found (claude/cursor-agent), skipping"
  exit 0
fi

RESPONSE_TRIMMED=$(printf '%s' "$RESPONSE" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')

log "  → response length: ${#RESPONSE_TRIMMED}, first 200: ${RESPONSE_TRIMMED:0:200}"

if [[ -z "$RESPONSE_TRIMMED" ]]; then
  log "  → empty response from LLM CLI"
  exit 0
fi
if [[ "$RESPONSE_TRIMMED" == "NONE" ]]; then
  log "  → NONE"
  exit 0
fi
if ! printf '%s' "$RESPONSE_TRIMMED" | grep -q '^## '; then
  log "  → response missing '## ' header"
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
