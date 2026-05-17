#!/usr/bin/env bash
# Stop hook: normalize ADR drafts in docs/adr/ via LLM.
#
# Triggers when number of draft files (with `session:` in YAML frontmatter)
# reaches ADR_NORMALIZE_THRESHOLD (default 30). Asks LLM to return a JSON list
# of operations (rewrite / delete / merge-into) and applies them to the working
# tree. Never invokes git — developer reviews via `git status` / `git diff`.
#
# LLM CLI selection (first available wins):
#   1. claude        — `claude -p --model "$ADR_NORMALIZE_MODEL"` (default: sonnet)
#   2. cursor-agent  — `cursor-agent -p --mode ask --output-format text --model …`
#                      (default: claude-4.6-sonnet-medium)
#   neither          — exit 0 silently
#
# Hook payloads:
#   - Claude Code Stop: `CLAUDE_PROJECT_DIR`
#   - Cursor stop: `workspace_roots[]`
#
# Portable bash 3.2 (macOS /bin/bash): no `mapfile`, no associative arrays.
#
# Bundled with @nitra/cursor; project copy is auto-synced by the `adr` rule.
set -eu
set -o pipefail

if [ -n "${ADR_NORMALIZE_RUNNING:-}" ]; then
  exit 0
fi
export ADR_NORMALIZE_RUNNING=1

INPUT=$(cat || true)
CURSOR_WORKSPACE_ROOT=$(printf '%s' "$INPUT" | jq -r '.workspace_roots[0] // empty' 2>/dev/null || true)
PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-${CURSOR_WORKSPACE_ROOT:-$PWD}}"
ADR_DIR="$PROJECT_ROOT/docs/adr"
LOG_DIR="$PROJECT_ROOT/.claude/hooks"
LOG="$LOG_DIR/normalize-decisions.log"
STATE_FILE="$LOG_DIR/.normalize-state"
LOCK_FILE="$LOG_DIR/.normalize.lock"
mkdir -p "$LOG_DIR"

log() { printf '%s %s\n' "$(date -Iseconds)" "$*" >> "$LOG"; }

# Skip if repo is mid-rebase / mid-merge — editing files now would tangle the user.
if [ -d "$PROJECT_ROOT/.git" ]; then
  for marker in MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD rebase-apply rebase-merge; do
    if [ -e "$PROJECT_ROOT/.git/$marker" ]; then
      log "skip: git is mid-$marker"
      exit 0
    fi
  done
fi

if [ ! -d "$ADR_DIR" ]; then
  exit 0
fi

# Acquire lock if `flock` is available (Linux). macOS lacks flock by default —
# treat absence as "no concurrent runs expected" and skip locking.
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    log "skip: another normalize run holds the lock"
    exit 0
  fi
fi

# Min interval between attempts — when LLM returns nothing for the batch, do not
# spin on every Stop event. Default 6 hours.
MIN_INTERVAL_HOURS="${ADR_NORMALIZE_MIN_INTERVAL_HOURS:-6}"
if [ -f "$STATE_FILE" ]; then
  LAST_ATTEMPT=$(cat "$STATE_FILE" 2>/dev/null || printf '0')
  NOW=$(date +%s)
  ELAPSED=$(( NOW - LAST_ATTEMPT ))
  MIN_SECS=$(( MIN_INTERVAL_HOURS * 3600 ))
  if [ "$ELAPSED" -lt "$MIN_SECS" ]; then
    log "skip: only $ELAPSED s since last attempt (min ${MIN_SECS}s)"
    exit 0
  fi
fi

THRESHOLD="${ADR_NORMALIZE_THRESHOLD:-30}"
BATCH_SIZE="${ADR_NORMALIZE_BATCH:-30}"
DRY_RUN="${ADR_NORMALIZE_DRY:-0}"

# Detects whether a markdown file is a draft: has YAML frontmatter with `session:` field.
is_draft() {
  awk '
    NR==1 && /^---$/ { fm=1; next }
    fm && /^---$/    { exit }
    fm && /^session: / { found=1 }
    END              { exit !found }
  ' "$1" 2>/dev/null
}

TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/adr-normalize.XXXXXX")
trap 'rm -rf "$TMP_DIR"' EXIT

DRAFTS_LIST="$TMP_DIR/drafts.txt"
CLEAN_LIST="$TMP_DIR/clean.txt"
BATCH_LIST="$TMP_DIR/batch.txt"
CLAIMED_SLUGS="$TMP_DIR/claimed.txt"
: > "$DRAFTS_LIST"
: > "$CLEAN_LIST"
: > "$CLAIMED_SLUGS"

# Find all draft files (recursive) under docs/adr/.
find "$ADR_DIR" -type f -name '*.md' 2>/dev/null | while IFS= read -r f; do
  if is_draft "$f"; then
    printf '%s\n' "$f"
  fi
done | sort > "$DRAFTS_LIST"

DRAFT_COUNT=$(wc -l < "$DRAFTS_LIST" | tr -d ' ')
log "drafts found: $DRAFT_COUNT (threshold: $THRESHOLD)"

if [ "$DRAFT_COUNT" -lt "$THRESHOLD" ]; then
  exit 0
fi

head -n "$BATCH_SIZE" "$DRAFTS_LIST" > "$BATCH_LIST"
BATCH_COUNT=$(wc -l < "$BATCH_LIST" | tr -d ' ')
log "batch size: $BATCH_COUNT"

# Find clean ADR files at root of docs/adr/ (no `session:`).
find "$ADR_DIR" -maxdepth 1 -type f -name '*.md' 2>/dev/null | while IFS= read -r f; do
  if ! is_draft "$f"; then
    basename "$f"
  fi
done | sort > "$CLEAN_LIST"

# Build prompt input section.
INPUT_FILE="$TMP_DIR/input.md"
{
  i=0
  while IFS= read -r f; do
    i=$(( i + 1 ))
    idx=$(printf '%03d' "$i")
    rel="${f#"$ADR_DIR/"}"
    printf '\n[DRAFT-%s] %s\n' "$idx" "$rel"
    cat "$f"
    printf '\n[END DRAFT-%s]\n' "$idx"
  done < "$BATCH_LIST"
} > "$INPUT_FILE"

CLEAN_SECTION_FILE="$TMP_DIR/clean-section.md"
: > "$CLEAN_SECTION_FILE"
if [ -s "$CLEAN_LIST" ]; then
  {
    printf '\nClean ADR files already in docs/adr/ (potential merge-into targets):\n'
    while IFS= read -r c; do
      printf '%s\n' "- $c"
    done < "$CLEAN_LIST"
  } > "$CLEAN_SECTION_FILE"
fi

PROMPT_HEADER=$(cat <<'EOF'
Ти нормалізуєш чернетки ADR/Runbook/Knowledge у `docs/adr/` репозиторію. Для кожного драфта обери одну з трьох операцій і поверни ЛИШЕ JSON-обʼєкт без markdown-обгортки, без передмови.

Схема відповіді:

{
  "operations": [
    { "op": "delete",     "file": "<basename>.md", "reason": "..." },
    { "op": "rewrite",    "file": "<basename>.md", "slug": "<kebab-case-ukrainian>", "content": "<повний markdown файлу у MADR 4.0.0>" },
    { "op": "merge-into", "file": "<basename>.md", "target": "<slug>.md", "additions": "<markdown для дописування>" }
  ]
}

Правила:

1. `delete` — драфт тривіальний / повністю покритий іншим існуючим clean-ADR-ом / порожній. Поясни короткою причиною українською.

2. `rewrite` — драфт має самостійну цінність як decision record. Повертай у `content` повний фінальний вміст файлу у форматі MADR 4.0.0 minimal:
   - Без YAML frontmatter (жодного `session:`, `captured:`, `transcript:`).
   - Заголовок `# <Title>` українською.
   - Один рядок `**Status:** Accepted` і один рядок `**Date:** YYYY-MM-DD` — дату беремо з поля `captured:` оригінальної чернетки (перші 10 символів ISO-дати).
   - Далі секції з точними MADR headings англійською: `## Context and Problem Statement`, `## Considered Options`, `## Decision Outcome`, `### Consequences`, `## More Information`.
   - У `## Considered Options` перелічуй лише варіанти, які є в драфті/transcript. Якщо альтернатив не було, додай bullet `Інші варіанти в transcript не обговорювалися.`
   - У `## Decision Outcome` використовуй форму `Chosen option: "<option>", because <reason>.` Причина має спиратися на драфт/transcript, без вигаданого business/context.
   - У `### Consequences` пиши bullets `Good, because ...`, `Bad, because ...`, `Neutral, because ...`. Якщо наслідок не зафіксований, явно пиши `transcript не містить підтвердження ...`, не вигадуй.
   - У `## More Information` перенеси файли, команди, публічні API, конфіги й transcript facts. Якщо нема — `Додаткової інформації в transcript не зафіксовано.`
   - `slug` — kebab-case українською (наприклад `ланцюжок-запуску-abie`, `npm-publish-flow`). Без розширення `.md`. Літери малі, дозволено цифри, дефіс, кирилиця. Якщо тема технічна англійською (назва пакету, ключове слово) — лиши англійською без транслітерації.

3. `merge-into` — драфт повторює тему вже існуючого clean-файлу зі списку нижче. `target` — точна назва файлу зі списку (з `.md`). `additions` — лише новий зміст, який варто дописати в кінець target-файлу під підзаголовком `## Update YYYY-MM-DD` (date з `captured` драфта). Якщо нічого нового додати — використовуй `delete`.

Жорсткі обмеження:

- Поверни валідний JSON, нічого крім нього. Жодних code-fence, жодних коментарів.
- Кожен файл з вхідного списку має зʼявитися у `operations` рівно один раз.
- Слаги не повторювати між операціями того самого батча. Якщо дві чернетки про одну тему — одна `rewrite`, інша `merge-into target: <slug>.md` з тим самим slug-ом.
- Не вигадуй target, якого нема у списку clean-файлів.
- Не вигадуй альтернативи, decision drivers, наслідки, людей або зовнішній контекст. Якщо даних бракує — явно напиши, що transcript цього не містить.

Вхідні драфти і clean-список — нижче.
EOF
)

FULL_PROMPT_FILE="$TMP_DIR/prompt.md"
{
  printf '%s\n' "$PROMPT_HEADER"
  cat "$CLEAN_SECTION_FILE"
  printf '\n=== DRAFTS ===\n'
  cat "$INPUT_FILE"
} > "$FULL_PROMPT_FILE"

# Update state BEFORE calling LLM — even if LLM fails, we honor min-interval.
date +%s > "$STATE_FILE"

CLAUDE_MODEL="${ADR_NORMALIZE_MODEL:-sonnet}"
CURSOR_MODEL="${ADR_NORMALIZE_CURSOR_MODEL:-claude-4.6-sonnet-medium}"

RESPONSE_FILE="$TMP_DIR/response.txt"

if command -v claude >/dev/null 2>&1; then
  log "using claude CLI (model: $CLAUDE_MODEL)"
  claude -p --model "$CLAUDE_MODEL" < "$FULL_PROMPT_FILE" > "$RESPONSE_FILE" 2>>"$LOG" || true
elif command -v cursor-agent >/dev/null 2>&1; then
  log "using cursor-agent CLI (model: $CURSOR_MODEL)"
  FULL_PROMPT=$(cat "$FULL_PROMPT_FILE")
  cursor-agent -p --mode ask --output-format text --model "$CURSOR_MODEL" -- "$FULL_PROMPT" > "$RESPONSE_FILE" 2>>"$LOG" || true
else
  log "no LLM CLI found, skipping"
  exit 0
fi

if [ ! -s "$RESPONSE_FILE" ]; then
  log "empty LLM response"
  exit 0
fi

# Strip markdown code-fence lines and surrounding blank lines.
# Use awk to avoid backtick/end-anchor lint false positives in sed regex.
RESPONSE_CLEAN_FILE="$TMP_DIR/response-clean.json"
awk '
  /^[[:space:]]*```/ { next }
  started || /[^[:space:]]/ { started = 1; print }
' "$RESPONSE_FILE" > "$RESPONSE_CLEAN_FILE"

# Validate JSON.
if ! jq -e '.operations | type == "array"' "$RESPONSE_CLEAN_FILE" >/dev/null 2>&1; then
  HEAD200=$(head -c 200 "$RESPONSE_CLEAN_FILE" | tr '\n' ' ')
  log "invalid JSON response (first 200 chars): $HEAD200"
  exit 0
fi

OP_COUNT=$(jq '.operations | length' "$RESPONSE_CLEAN_FILE")
log "operations parsed: $OP_COUNT"

if [ "$DRY_RUN" = "1" ]; then
  log "DRY RUN — would apply $OP_COUNT operations:"
  jq -r '.operations[] | "  " + .op + " " + .file + (if .slug then " → " + .slug else "" end) + (if .target then " → " + .target else "" end)' \
    "$RESPONSE_CLEAN_FILE" >> "$LOG"
  exit 0
fi

# Resolve unique target path for slug — appends -2, -3 on collision.
# Tracks claims via CLAIMED_SLUGS file (one slug per line).
resolve_unique_slug_path() {
  slug="$1"
  base="$ADR_DIR/${slug}.md"
  if [ ! -e "$base" ] && ! grep -Fxq "$slug" "$CLAIMED_SLUGS" 2>/dev/null; then
    printf '%s\n' "$slug" >> "$CLAIMED_SLUGS"
    printf '%s\n' "$base"
    return
  fi
  n=2
  while :; do
    cand="$ADR_DIR/${slug}-${n}.md"
    key="${slug}-${n}"
    if [ ! -e "$cand" ] && ! grep -Fxq "$key" "$CLAIMED_SLUGS" 2>/dev/null; then
      printf '%s\n' "$key" >> "$CLAIMED_SLUGS"
      printf '%s\n' "$cand"
      return
    fi
    n=$(( n + 1 ))
  done
}

APPLIED=0
SKIPPED=0

jq -c '.operations[]' "$RESPONSE_CLEAN_FILE" | while IFS= read -r op_json; do
  OP=$(printf '%s' "$op_json" | jq -r '.op // empty')
  FILE=$(printf '%s' "$op_json" | jq -r '.file // empty')
  SRC_PATH="$ADR_DIR/$FILE"

  if [ -z "$OP" ] || [ -z "$FILE" ]; then
    log "skip: malformed op (missing op/file)"
    SKIPPED=$(( SKIPPED + 1 ))
    continue
  fi
  case "$FILE" in
    */*|.*)
      log "skip: refusing path-like file '$FILE'"
      SKIPPED=$(( SKIPPED + 1 ))
      continue
      ;;
  esac

  # Resolve nested batch files by basename if not at docs/adr/ root.
  if [ ! -f "$SRC_PATH" ]; then
    while IFS= read -r bf; do
      bn=$(basename "$bf")
      if [ "$bn" = "$FILE" ]; then
        SRC_PATH="$bf"
        break
      fi
    done < "$BATCH_LIST"
  fi
  if [ ! -f "$SRC_PATH" ]; then
    log "skip: source missing '$FILE'"
    SKIPPED=$(( SKIPPED + 1 ))
    continue
  fi

  case "$OP" in
    delete)
      REASON=$(printf '%s' "$op_json" | jq -r '.reason // ""')
      rm -- "$SRC_PATH"
      log "delete: $FILE — $REASON"
      APPLIED=$(( APPLIED + 1 ))
      ;;
    rewrite)
      SLUG=$(printf '%s' "$op_json" | jq -r '.slug // empty')
      CONTENT=$(printf '%s' "$op_json" | jq -r '.content // empty')
      if [ -z "$SLUG" ] || [ -z "$CONTENT" ]; then
        log "skip rewrite: missing slug or content for '$FILE'"
        SKIPPED=$(( SKIPPED + 1 ))
        continue
      fi
      case "$SLUG" in
        */*|.*)
          log "skip rewrite: refusing path-like slug '$SLUG'"
          SKIPPED=$(( SKIPPED + 1 ))
          continue
          ;;
      esac
      DEST_PATH=$(resolve_unique_slug_path "$SLUG")
      printf '%s\n' "$CONTENT" > "$DEST_PATH"
      rm -- "$SRC_PATH"
      log "rewrite: $FILE → $(basename "$DEST_PATH")"
      APPLIED=$(( APPLIED + 1 ))
      ;;
    merge-into)
      TARGET=$(printf '%s' "$op_json" | jq -r '.target // empty')
      ADDITIONS=$(printf '%s' "$op_json" | jq -r '.additions // empty')
      if [ -z "$TARGET" ] || [ -z "$ADDITIONS" ]; then
        log "skip merge-into: missing target or additions for '$FILE'"
        SKIPPED=$(( SKIPPED + 1 ))
        continue
      fi
      case "$TARGET" in
        */*|.*)
          log "skip merge-into: refusing path-like target '$TARGET'"
          SKIPPED=$(( SKIPPED + 1 ))
          continue
          ;;
      esac
      TARGET_PATH="$ADR_DIR/$TARGET"
      if [ ! -f "$TARGET_PATH" ]; then
        log "skip merge-into: target '$TARGET' missing"
        SKIPPED=$(( SKIPPED + 1 ))
        continue
      fi
      if is_draft "$TARGET_PATH"; then
        log "skip merge-into: target '$TARGET' is itself a draft"
        SKIPPED=$(( SKIPPED + 1 ))
        continue
      fi
      printf '\n%s\n' "$ADDITIONS" >> "$TARGET_PATH"
      rm -- "$SRC_PATH"
      log "merge-into: $FILE → $TARGET"
      APPLIED=$(( APPLIED + 1 ))
      ;;
    *)
      log "skip: unknown op '$OP' for '$FILE'"
      SKIPPED=$(( SKIPPED + 1 ))
      ;;
  esac
done

log "done"
