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
# Hook payloads:
#   - Claude Code Stop: `transcript_path`, `session_id`, `CLAUDE_PROJECT_DIR`
#   - Cursor stop: `transcript_path`, `conversation_id` / `generation_id`, `workspace_roots[]`
#
# Bundled with @nitra/cursor; project copy is auto-synced by the `adr` rule.
set -euo pipefail

if [[ -n "${CAPTURE_DECISIONS_RUNNING:-}" ]]; then
  exit 0
fi
export CAPTURE_DECISIONS_RUNNING=1

INPUT=$(cat)
TRANSCRIPT_PATH=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty')
SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // .conversation_id // .generation_id // "unknown"')
CURSOR_WORKSPACE_ROOT=$(printf '%s' "$INPUT" | jq -r '.workspace_roots[0] // empty')

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-${CURSOR_WORKSPACE_ROOT:-$PWD}}"
ADR_DIR="$PROJECT_ROOT/docs/adr"
LOG_DIR="$PROJECT_ROOT/.claude/hooks"
LOG="$LOG_DIR/capture-decisions.log"
mkdir -p "$ADR_DIR" "$LOG_DIR"

log() { printf '%s %s\n' "$(date -Iseconds)" "$*" >> "$LOG"; }

# Підвантажуємо спільний helper (sourcing — не sub-shell, функції видимі поточному скрипту).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/tooling-only.sh disable=SC1091
. "$SCRIPT_DIR/lib/tooling-only.sh"

log "fired: $SESSION_ID"

if [[ -z "$TRANSCRIPT_PATH" || ! -f "$TRANSCRIPT_PATH" ]]; then
  log "  → no transcript path"
  exit 0
fi

# Extract role + text + thinking + tool_use names from JSONL transcript.
# We keep reasoning/decisions visible to the analyzer but drop large tool outputs.
TRANSCRIPT=$(jq -r '
  select(
    .type == "user" or .type == "assistant"
    or .role == "user" or .role == "assistant"
  )
  | .message as $m
  | ($m.role // .role // .type) as $role
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
  log "  → empty transcript after jq (Claude Code: .type; Cursor Agent: .role)"
  exit 0
fi

# Structural skip: якщо в сесії змінювалися лише tooling-файли — не викликаємо LLM.
# ENV `ADR_NORMALIZE_SKIP_TOOLING_ONLY=0` вимикає скіп.
if [[ "${ADR_NORMALIZE_SKIP_TOOLING_ONLY:-1}" = "1" ]]; then
  CHANGED_FILES=$(jq -r '
    select(.type == "assistant" or .role == "assistant")
    | .message as $m
    | ($m.content // [])
    | if type == "array" then
        map(select(.type == "tool_use" and (.name == "Edit" or .name == "Write" or .name == "MultiEdit"))
            | .input.file_path // empty)
        | .[]
      else empty end
  ' "$TRANSCRIPT_PATH" 2>/dev/null | sort -u || true)

  if [[ -n "$CHANGED_FILES" ]]; then
    if printf '%s\n' "$CHANGED_FILES" | is_tooling_only_change "$PROJECT_ROOT"; then
      log "  → skipping ADR capture: tooling-only session"
      log "    files: $(printf '%s' "$CHANGED_FILES" | tr '\n' ' ')"
      exit 0
    fi
  fi
fi

PROMPT=$(cat <<'EOF'
You analyze an AI coding session transcript and produce durable decision documentation.

LANGUAGE: Write the content in Ukrainian. Keep MADR section headings in English exactly as shown below. Keep code identifiers, file paths, commands, and tool or library names in their original form (do not translate `walkDir`, `package.json`, `npm`, etc.).

IMPORTANT: by "decision" we mean the design choice expressed in the session — even if the user pre-specified it in their brief. The user dictating the approach IS the decision; capture it, including the rationale they gave or that became apparent during implementation. Do NOT return NONE just because the user gave detailed instructions upfront.

ANTI-HALLUCINATION RULES:
- Use only facts present in the transcript, tool calls, changed file paths, or direct implications of those facts.
- Do not invent decision makers, stakeholders, business context, requirements, alternatives, or consequences.
- If alternatives were not discussed, write exactly: "Інші варіанти в transcript не обговорювалися."
- If a consequence is unknown, write it as "Neutral, because transcript не містить підтвердження наслідку."
- Prefer specific file paths and commands from the transcript over generic prose.

OUTPUT RULES:
- Emit one or more markdown blocks in this exact shape (no preamble, no trailing prose):

## ADR <короткий заголовок українською>

## Context and Problem Statement
<1-3 речення: яка проблема / ситуація спричинила рішення.>

## Considered Options
* <назва явно обговореного варіанта>
* <або "Інші варіанти в transcript не обговорювалися.">

## Decision Outcome
Chosen option: "<назва обраного варіанта>", because <коротке обґрунтування з transcript>.

### Consequences
* Good, because <підтверджений позитивний наслідок або "transcript фіксує очікувану користь: ...">.
* Bad, because <підтверджений негативний наслідок або "transcript не містить підтверджених негативних наслідків.">.

## More Information
<файли, команди, публічні API, конфіги, transcript facts. Якщо нема — "Додаткової інформації в transcript не зафіксовано.">

WHEN TO PICK EACH TYPE:
- Emit ADR for design choices: library, schema, pattern, file layout, hook semantics, API behavior, validation semantics.
- Do not emit Runbook or Knowledge blocks here. This hook stores MADR-style decision records only.

OUTPUT NONE ONLY IF the session is genuinely trivial:
- A single typo fix, comment edit, or lint cleanup with no design content
- A pure question/answer with no durable decision
- An aborted/empty session

When in doubt, emit a conservative ADR with explicit "not discussed" placeholders rather than inventing missing details.

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

TS=$(date +%y%m%d-%H%M)

# Slug із першого `## [ADR|Runbook|Knowledge] <heading>`-рядка відповіді.
# Логіка локальна (без додаткового LLM-виклику): використовуємо вже згенерований heading.
# Конвенція кебаб-slug-у — як у normalize-decisions.sh:171: малі літери, дозволено цифри, дефіс,
# кирилиця; англомовні технічні терміни лишаються англійською без транслітерації.
HEADING=$(printf '%s' "$RESPONSE_TRIMMED" \
  | awk '/^## (\[?(ADR|Runbook|Knowledge)\]?)/{ sub(/^## /,""); sub(/^\[?(ADR|Runbook|Knowledge)\]?[[:space:]]*:?[[:space:]]*/,""); print; exit }')
SLUG=$(printf '%s' "$HEADING" \
  | tr '[:upper:]' '[:lower:]' \
  | sed -E 's/[`«»"]//g; s/[ /,.:;()—–]+/-/g; s/[^a-zа-яёіїєґ0-9-]//g; s/-+/-/g; s/^-//; s/-$//' \
  | cut -c1-60 \
  | sed -E 's/-$//')

if [[ -z "$SLUG" ]]; then
  # Fallback на старий формат, якщо heading не спарсився
  OUT="$ADR_DIR/$TS-${SESSION_ID:0:8}.md"
else
  # Колізії: <timestamp>-<slug>-<n>.md (n=2,3,...), як у normalize-decisions.sh:244-257
  BASE="$ADR_DIR/$TS-$SLUG.md"
  OUT="$BASE"
  n=2
  while [[ -e "$OUT" ]]; do
    OUT="$ADR_DIR/$TS-$SLUG-$n.md"
    n=$((n+1))
  done
fi

{
  printf -- '---\nsession: %s\ncaptured: %s\ntranscript: %s\n---\n\n' \
    "$SESSION_ID" "$(date -Iseconds)" "$TRANSCRIPT_PATH"
  printf '%s\n' "$RESPONSE_TRIMMED"
} > "$OUT"
log "wrote: $OUT"
