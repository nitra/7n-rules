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

# Підвантажуємо спільний helper (sourcing — не sub-shell, функції видимі поточному скрипту).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/tooling-only.sh disable=SC1091
. "$SCRIPT_DIR/lib/tooling-only.sh"

# Витягає поле `transcript:` з YAML frontmatter ADR-чернетки.
draft_transcript_path() {
  awk '
    NR==1 && /^---$/ { fm=1; next }
    fm && /^---$/    { exit }
    fm && /^transcript: / { sub(/^transcript: /, ""); print; exit }
  ' "$1" 2>/dev/null
}

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
BATCH_SIZE="${ADR_NORMALIZE_BATCH:-10}"
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

# Structural skip: чернетки з tooling-only сесій видаляємо без виклику LLM.
if [ "${ADR_NORMALIZE_SKIP_TOOLING_ONLY:-1}" = "1" ]; then
  FILTERED_LIST="$TMP_DIR/batch-filtered.txt"
  : > "$FILTERED_LIST"
  TOOLING_REMOVED=0
  while IFS= read -r draft; do
    [ -f "$draft" ] || continue
    tpath=$(draft_transcript_path "$draft")
    if [ -n "$tpath" ] && [ -f "$tpath" ]; then
      changed=$(jq -r '
        select(.type == "assistant" or .role == "assistant")
        | .message as $m
        | ($m.content // [])
        | if type == "array" then
            map(select(.type == "tool_use" and (.name == "Edit" or .name == "Write" or .name == "MultiEdit"))
                | .input.file_path // empty)
            | .[]
          else empty end
      ' "$tpath" 2>/dev/null | sort -u || true)
      if [ -n "$changed" ] && printf '%s\n' "$changed" | is_tooling_only_change "$PROJECT_ROOT"; then
        rm -f -- "$draft"
        log "tooling-only delete: $(basename "$draft") (files: $(printf '%s' "$changed" | tr '\n' ' '))"
        TOOLING_REMOVED=$(( TOOLING_REMOVED + 1 ))
        continue
      fi
    fi
    printf '%s\n' "$draft" >> "$FILTERED_LIST"
  done < "$BATCH_LIST"
  mv "$FILTERED_LIST" "$BATCH_LIST"
  BATCH_COUNT=$(wc -l < "$BATCH_LIST" | tr -d ' ')
  if [ "$TOOLING_REMOVED" -gt 0 ]; then
    log "after tooling-only filter: $BATCH_COUNT drafts remain (removed $TOOLING_REMOVED)"
  fi
  if [ "$BATCH_COUNT" -eq 0 ]; then
    log "batch is empty after tooling-only filter — exit"
    exit 0
  fi
fi

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

Принцип вибору операції: уникай дрібних дублів. Перш ніж обрати `rewrite`, звір тему драфта з clean-списком і з рештою драфтів цього батча. Якщо рішення по суті вже зафіксоване — у наявному clean-ADR або в драфті, який ти переписуєш через `rewrite`, — і драфт лише уточнює / доповнює / виправляє / продовжує його, обери `merge-into`, а не `rewrite`. `rewrite` (новий файл) виправданий лише для справді самостійного, нового рішення. Краще один повний наскрізний ADR, ніж кілька майже однакових файлів.

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

3. `merge-into` — рішення драфта НЕ самостійне: воно лише уточнює, доповнює, виправляє або продовжує рішення, яке вже зафіксоване або (а) в clean-файлі зі списку нижче, або (б) у драфті цього ж батча, який ти переписуєш через `rewrite`. `target`:
   - для (а) — точна назва clean-файлу зі списку (з `.md`);
   - для (б) — `<slug>.md`, де `<slug>` дорівнює полю `slug` тієї `rewrite`-операції (timestamp-префікс скрипт додасть сам — не дописуй його).
   `additions` — лише новий зміст, який варто дописати в кінець target-файлу під підзаголовком `## Update YYYY-MM-DD` (date з `captured` драфта). Якщо нічого нового додати — використовуй `delete`.

Жорсткі обмеження:

- Поверни валідний JSON, нічого крім нього. Жодних code-fence, жодних коментарів.
- Кожен файл з вхідного списку має зʼявитися у `operations` рівно один раз.
- Слаги не повторювати між операціями того самого батча. Якщо дві чернетки про одну тему — одна `rewrite`, інша `merge-into target: <slug>.md` з тим самим slug-ом.
- `target` у `merge-into` — це або файл зі списку clean-файлів, або `<slug>.md` rewrite-операції цього ж батча. Іншого target не вигадуй.
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

# Apply operations in two ordered groups — delete/rewrite first, merge-into
# last — so a merge-into can target a clean file that a rewrite of the same
# batch only just created. Looping over a file (not a pipe) keeps the loop in
# the main shell, so APPLIED/SKIPPED survive to the final summary line.
OPS_FILE="$TMP_DIR/ops.jsonl"
{
  jq -c '.operations[] | select(.op != "merge-into")' "$RESPONSE_CLEAN_FILE"
  jq -c '.operations[] | select(.op == "merge-into")' "$RESPONSE_CLEAN_FILE"
} > "$OPS_FILE"

# slug → created clean-file path: written by rewrite ops, read by merge-into
# ops (one tab-separated "slug<TAB>path" line per rewrite).
SLUG_MAP="$TMP_DIR/slug-map.txt"
: > "$SLUG_MAP"

while IFS= read -r op_json; do
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
      # Keep the draft's timestamp prefix on the clean file: the name
      # stays anchored to capture time, only the slug part changes between draft
      # and clean, and docs/adr/ keeps sorting chronologically. New drafts use
      # `YYMMDD-HHMM-`; older `YYYYMMDD-HHMMSS-` drafts are still supported.
      # Drafts without a timestamp prefix fall back to a bare `<slug>.md`.
      case "$FILE" in
        [0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]-*)
          DEST_SLUG="$(printf '%s' "$FILE" | cut -c1-11)-$SLUG"
          ;;
        [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]-*)
          DEST_SLUG="$(printf '%s' "$FILE" | cut -c1-15)-$SLUG"
          ;;
        *)
          DEST_SLUG="$SLUG"
          ;;
      esac
      DEST_PATH=$(resolve_unique_slug_path "$DEST_SLUG")
      printf '%s\n' "$CONTENT" > "$DEST_PATH"
      rm -- "$SRC_PATH"
      # Record bare slug → final path so a same-batch merge-into can target
      # this freshly created file by `<slug>.md` despite the timestamp prefix.
      printf '%s\t%s\n' "$SLUG" "$DEST_PATH" >> "$SLUG_MAP"
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
      # Resolve the target clean file. The LLM gives a bare `<slug>.md`, but the
      # real file usually carries a timestamp prefix. Try, in order:
      #   1. exact name in docs/adr/,
      #   2. a rewrite of this batch that produced that slug (SLUG_MAP),
      #   3. a unique existing clean file whose name ends with `-<slug>.md`.
      TARGET_PATH="$ADR_DIR/$TARGET"
      if [ ! -f "$TARGET_PATH" ]; then
        TSLUG="${TARGET%.md}"
        MAPPED=$(awk -F'\t' -v s="$TSLUG" '$1 == s { print $2; exit }' "$SLUG_MAP")
        if [ -z "$MAPPED" ]; then
          SUFFIX_HITS=0
          for cf in "$ADR_DIR"/*-"$TSLUG".md; do
            [ -f "$cf" ] || continue
            MAPPED="$cf"
            SUFFIX_HITS=$(( SUFFIX_HITS + 1 ))
          done
          if [ "$SUFFIX_HITS" -gt 1 ]; then
            log "skip merge-into: target '$TARGET' ambiguous ($SUFFIX_HITS matches)"
            SKIPPED=$(( SKIPPED + 1 ))
            continue
          fi
        fi
        if [ -n "$MAPPED" ]; then
          TARGET_PATH="$MAPPED"
        fi
      fi
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
      log "merge-into: $FILE → $(basename "$TARGET_PATH")"
      APPLIED=$(( APPLIED + 1 ))
      ;;
    *)
      log "skip: unknown op '$OP' for '$FILE'"
      SKIPPED=$(( SKIPPED + 1 ))
      ;;
  esac
done < "$OPS_FILE"

log "done (applied $APPLIED, skipped $SKIPPED)"
