#!/usr/bin/env bash
# Stop hook: extract ADR/Runbook/Knowledge drafts from session transcript.
# Runs async. Recursion guard: env var prevents the inner LLM CLI from
# re-triggering this hook (the inner session inherits CAPTURE_DECISIONS_RUNNING=1).
#
# Orchestrator sessions (JS-orchestrated `lint`/`skill`/`taze`/`release`/... that spawn
# an internal agent/LLM session) set `ADR_HOOKS_SKIP=1` before spawning — this hook exits
# silently, no log, before touching transcript or hook directories (spec 2026-06-30).
#
# Capture backend — `CAPTURE_DECISIONS_BACKEND` (default: pi):
#   pi            — local `pi` only (npm-first lookup, offline/hermetic flags); unavailable
#                   or no local model (`CAPTURE_DECISIONS_PI_MODEL`/`N_LOCAL_MIN_MODEL`) → skip
#   claude        — force `claude -p --model "$CAPTURE_DECISIONS_CLAUDE_MODEL"` (default: sonnet)
#   cursor-agent  — force `cursor-agent -p --mode ask --model "$CAPTURE_DECISIONS_CURSOR_MODEL"`
#                   (default: claude-4.6-sonnet-medium)
#   auto          — cascade by availability: pi → claude → cursor-agent → skip
# In every mode an empty response from the chosen backend is final (no cascade on empty).
#
# Hook payloads:
#   - Claude Code Stop: `transcript_path`, `session_id`, `CLAUDE_PROJECT_DIR`
#   - Cursor stop: `transcript_path`, `conversation_id` / `generation_id`, `workspace_roots[]`
#
# Bundled with @7n/rules; project copy is auto-synced by the `adr` rule.
set -euo pipefail

if [[ -n "${CAPTURE_DECISIONS_RUNNING:-}" ]]; then
  exit 0
fi
export CAPTURE_DECISIONS_RUNNING=1

if [[ -n "${ADR_HOOKS_SKIP:-}" ]]; then
  exit 0
fi

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

# Файли, змінені в сесії (file_path із tool_use Edit/Write/MultiEdit) — спільне
# джерело для structural-скіпів нижче.
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

# Cross-project skip: якщо в сесії редагувалися файли, але ЖОДЕН не під $PROJECT_ROOT —
# це паралельна робота в іншому проєкті; ADR сюди не пишемо (чужі рішення не змішуємо).
# Сесії без редагувань (чисте Q&A / дизайн-дискусія) не відкидаємо — це валідний ADR.
# ENV `ADR_CAPTURE_SKIP_CROSS_PROJECT=0` вимикає скіп.
if [[ "${ADR_CAPTURE_SKIP_CROSS_PROJECT:-1}" = "1" && -n "$CHANGED_FILES" ]]; then
  if ! printf '%s\n' "$CHANGED_FILES" | has_in_project_change "$PROJECT_ROOT"; then
    log "  → skipping ADR capture: cross-project session (no in-project changes)"
    log "    files: $(printf '%s' "$CHANGED_FILES" | tr '\n' ' ')"
    exit 0
  fi
fi

# Structural skip: якщо в сесії змінювалися лише tooling-файли — не викликаємо LLM.
# ENV `ADR_NORMALIZE_SKIP_TOOLING_ONLY=0` вимикає скіп.
if [[ "${ADR_NORMALIZE_SKIP_TOOLING_ONLY:-1}" = "1" && -n "$CHANGED_FILES" ]]; then
  if printf '%s\n' "$CHANGED_FILES" | is_tooling_only_change "$PROJECT_ROOT"; then
    log "  → skipping ADR capture: tooling-only session"
    log "    files: $(printf '%s' "$CHANGED_FILES" | tr '\n' ' ')"
    exit 0
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

# Scope: обмежуємо рішення поточним проєктом. Для змішаних сесій (правки і тут, і в
# чужих репо) детермінований cross-project gate не спрацьовує, тож звужуємо обсяг у промпті.
# Йде ПЕРЕД інструкціями, щоб не сприйматись як перший рядок транскрипту.
SCOPE_LINE="CURRENT PROJECT ROOT: $PROJECT_ROOT
SCOPE: Document ONLY decisions evidenced by changes within this project root. Ignore edits and discussion about files outside it (parallel work in other repositories)."
PROMPT_FULL=$(printf '%s\n\n%s\n%s\n' "$SCOPE_LINE" "$PROMPT" "$TRANSCRIPT")

CLAUDE_MODEL="${CAPTURE_DECISIONS_CLAUDE_MODEL:-sonnet}"
CURSOR_MODEL="${CAPTURE_DECISIONS_CURSOR_MODEL:-claude-4.6-sonnet-medium}"
BACKEND="${CAPTURE_DECISIONS_BACKEND:-pi}"

# npm-first pi lookup: без npx/npm exec/bunx у hook (мережа, кеш, package-manager locks
# сповільнили б async hook). Root .bin (hoisted) -> nested @7n/rules .bin -> system PATH.
find_pi_cmd() {
  local candidate
  for candidate in \
    "$PROJECT_ROOT/node_modules/.bin/pi" \
    "$PROJECT_ROOT/node_modules/@7n/rules/node_modules/.bin/pi" \
    "$PROJECT_ROOT/node_modules/@nitra/cursor/node_modules/.bin/pi"
  do
    if [[ -x "$candidate" ]]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  command -v pi 2>/dev/null || true
}

# Повертає 0 і виставляє RESPONSE/USED_BACKEND, якщо pi реально викликано (навіть з
# порожньою відповіддю — це фінальний результат, не привід переходити до наступного). Повертає 1,
# якщо pi недоступний або модель не сконфігурована — тільки це запускає auto-каскад.
try_pi() {
  local pi_cmd model
  pi_cmd="$(find_pi_cmd)"
  if [[ -z "$pi_cmd" ]]; then
    log "  → pi not found, skipping capture"
    return 1
  fi
  model="${CAPTURE_DECISIONS_PI_MODEL:-${N_LOCAL_MIN_MODEL:-}}"
  if [[ -z "$model" ]]; then
    log "  → no local model configured (CAPTURE_DECISIONS_PI_MODEL / N_LOCAL_MIN_MODEL), skipping capture"
    return 1
  fi
  log "  → using pi (model: $model)"
  RESPONSE=$(printf '%s' "$PROMPT_FULL" \
    | "$pi_cmd" -p \
        --no-session \
        --mode text \
        --no-tools \
        --no-context-files \
        --no-extensions \
        --no-skills \
        --no-prompt-templates \
        --offline \
        --model "$model" \
    2>>"$LOG" || true)
  USED_BACKEND="pi"
  return 0
}

try_claude() {
  if ! command -v claude >/dev/null 2>&1; then
    return 1
  fi
  log "  → using claude CLI (model: $CLAUDE_MODEL)"
  RESPONSE=$(printf '%s' "$PROMPT_FULL" | claude -p --model "$CLAUDE_MODEL" 2>>"$LOG" || true)
  USED_BACKEND="claude"
  return 0
}

try_cursor_agent() {
  if ! command -v cursor-agent >/dev/null 2>&1; then
    return 1
  fi
  log "  → using cursor-agent CLI (model: $CURSOR_MODEL)"
  RESPONSE=$(cursor-agent -p --mode ask --output-format text --model "$CURSOR_MODEL" -- "$PROMPT_FULL" 2>>"$LOG" || true)
  USED_BACKEND="cursor-agent"
  return 0
}

case "$BACKEND" in
  pi)
    if ! try_pi; then
      exit 0
    fi
    ;;
  claude)
    if ! try_claude; then
      log "  → claude CLI not found (CAPTURE_DECISIONS_BACKEND=claude), skipping"
      exit 0
    fi
    ;;
  cursor-agent)
    if ! try_cursor_agent; then
      log "  → cursor-agent CLI not found (CAPTURE_DECISIONS_BACKEND=cursor-agent), skipping"
      exit 0
    fi
    ;;
  auto)
    # Каскад за доступністю бекенду (pi -> claude -> cursor-agent), НЕ за результатом
    # виклику: щойно якийсь бекенд реально викликано, `try_*` повертає 0 і `&&`
    # коротко замикає ланцюг — наступні бекенди не викликаються навіть при порожній відповіді.
    if ! try_pi && ! try_claude && ! try_cursor_agent; then
      log "  → no backend available (pi/claude/cursor-agent), skipping"
      exit 0
    fi
    ;;
  *)
    log "  → unknown CAPTURE_DECISIONS_BACKEND=$BACKEND, skipping"
    exit 0
    ;;
esac

RESPONSE_TRIMMED=$(printf '%s' "$RESPONSE" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')

log "  → response length: ${#RESPONSE_TRIMMED}, first 200: ${RESPONSE_TRIMMED:0:200}"

if [[ -z "$RESPONSE_TRIMMED" ]]; then
  log "  → empty response from $USED_BACKEND"
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
