# ADR cspell + Tooling-Only Skip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Розірвати lint-петлю `cspell → ADR draft → normalize → знов cspell` у споживацьких репо. Цвях 1: канонічний `.cspell.json` ігнорує `docs/adr/**`. Цвях 2: capture- і normalize-хуки структурно пропускають tooling-only сесії (лише `.cspell.json`/ADR/CHANGELOG/version-bump) ще до виклику LLM.

**Architecture:**
- `rules/text/policy/cspell/template/.cspell.json.snippet.json` — додаємо `"docs/adr/**"` у `ignorePaths`; rego subset-of підтягне у споживача через `npx @nitra/cursor fix text` автоматично.
- В обох bash-скриптах (`.claude-template/hooks/capture-decisions.sh`, `normalize-decisions.sh`) — **inline** функція `is_tooling_only_change` (bash 3.2, без mapfile/асоц. масивів). User вимагає НЕ виносити в окремий файл (`.claude-template/hooks/` копіюється плоско). Дублікат у двох файлах, навмисно.
- `capture-decisions.sh`: після парсингу `TRANSCRIPT_PATH`, до збору `PROMPT_FULL`, дістаємо `file_path` з `tool_use`-записів (`Edit`/`Write`/`MultiEdit`/`NotebookEdit`) через `jq`. Якщо `is_tooling_only_change` → `log "skipping ADR capture: tooling-only session"` + `exit 0`.
- `normalize-decisions.sh`: після збору `BATCH_LIST`, до виклику LLM, для кожної чернетки читаємо `transcript:` з frontmatter; якщо файл існує — той самий jq-екстракт; tooling-only → видаляємо чернетку без LLM (decrement-ить ефективний `BATCH_COUNT`). Якщо після видалень `BATCH_COUNT == 0` → `exit 0`.
- ENV-перемикач `ADR_NORMALIZE_SKIP_TOOLING_ONLY` (default `1`) — у обидвох скриптах. `0` = старий behavior.

**Tech Stack:** Bash 3.2, `jq`, Bun (test runner), Node `child_process` для bun-тестів інтеграції.

**Spec:** Завдання у користувацькому brief'і (внутрішній контекст — не файл у репо).

**Commit policy:** За user preference коміти НЕ створюються в межах плану. Кожна задача завершується `git status && git diff` для review.

---

## File Structure

### Модифікуються

- `npm/rules/text/policy/cspell/template/.cspell.json.snippet.json` — +1 елемент у `ignorePaths`.
- `npm/rules/text/policy/cspell/cspell_test.rego` — оновити `template_data` і `valid_cfg` (синхронізувати з новим snippet).
- `npm/rules/text/text.mdc` — параграф про `docs/adr/**`; оновити приклади у фрагментах `.cspell.json`.
- `npm/.claude-template/hooks/capture-decisions.sh` — inline `is_tooling_only_change` + ранній exit.
- `npm/.claude-template/hooks/normalize-decisions.sh` — те саме, плюс per-draft delete.
- `npm/rules/adr/adr.mdc` — параграф про скіп tooling-only + рядок у таблиці ENV.
- `npm/skills/adr-normalize/SKILL.md` — пункт у «Tuning через ENV» + діагностика у «Якщо щось пішло не так».
- `npm/package.json` — `1.18.0 → 1.19.0` (minor).
- `npm/CHANGELOG.md` — секція `[1.19.0]`.

### Створюються (тести)

- `npm/rules/adr/js/tests/capture-decisions-tooling-only.test.mjs` — інтеграційний тест capture-хука з синтетичним transcript-fixture-ом.
- `npm/rules/adr/js/tests/normalize-decisions-tooling-only.test.mjs` — інтеграційний тест normalize-хука з фейковим `docs/adr/` і fake-transcript.

---

## Task 1: Cspell — додати `docs/adr/**` у канонічний `ignorePaths`

**Files:**
- Modify: `npm/rules/text/policy/cspell/template/.cspell.json.snippet.json`
- Modify: `npm/rules/text/policy/cspell/cspell_test.rego`
- Modify: `npm/rules/text/text.mdc`

- [ ] **Step 1.1: Оновити rego-тест (TDD) — додати тест, що канонічний snippet ВИМАГАЄ `docs/adr/**`**

Open `npm/rules/text/policy/cspell/cspell_test.rego` і додай новий тест перед закриваючим `}` файла:

```rego
# canon має включати docs/adr/** (адр-чернетки)
test_deny_missing_docs_adr if {
	bad := json.patch(valid_cfg, [{"op": "replace", "path": "/ignorePaths", "value": [
		"**/node_modules/**",
		"**/vscode-extension/**",
		"**/.git/**",
		".vscode",
		"report",
		"*.svg",
		"**/k8s/**/*.yaml",
	]}])
	some msg in cspell.deny with input as bad with data.template as template_data
	contains(msg, "docs/adr/**")
}
```

- [ ] **Step 1.2: Запустити тест — має FAIL (`docs/adr/**` ще не в `template_data`)**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm
bun run lint-rego 2>&1 | tail -30
```

Expected: тест `test_deny_missing_docs_adr` падає або `test_allow_canonical` падає (бо `valid_cfg` тепер має зайвий елемент). Точну поведінку фіксує наступний крок.

- [ ] **Step 1.3: Додати `docs/adr/**` у `template_data` і `valid_cfg`**

У `npm/rules/text/policy/cspell/cspell_test.rego` оновити обидва місця:

```rego
template_data := {
	"snippet": {
		"version": "0.2",
		"ignorePaths": [
			"**/node_modules/**",
			"**/vscode-extension/**",
			"**/.git/**",
			".vscode",
			"report",
			"*.svg",
			"**/k8s/**/*.yaml",
			"docs/adr/**",
		],
	},
	"contains": {"import": ["@nitra/cspell-dict"]},
	"deny": {"import-substrings": {"@cspell/dict-": "використовуй лише @nitra/cspell-dict (text.mdc)"}},
}

valid_cfg := {
	"version": "0.2",
	"language": "en,uk",
	"import": ["@nitra/cspell-dict/cspell-ext.json"],
	"ignorePaths": [
		"**/node_modules/**",
		"**/vscode-extension/**",
		"**/.git/**",
		".vscode",
		"report",
		"*.svg",
		"**/k8s/**/*.yaml",
		"docs/adr/**",
	],
}
```

- [ ] **Step 1.4: Додати `docs/adr/**` у канонічний snippet**

Edit `npm/rules/text/policy/cspell/template/.cspell.json.snippet.json`:

```json
{
  "version": "0.2",
  "ignorePaths": [
    "**/node_modules/**",
    "**/vscode-extension/**",
    "**/.git/**",
    ".vscode",
    "report",
    "*.svg",
    "**/k8s/**/*.yaml",
    "docs/adr/**"
  ]
}
```

- [ ] **Step 1.5: Прогнати rego-тести знову — мають PASS**

```bash
cd /Users/vitaliytv/www/nitra/cursor/npm
bun run lint-rego 2>&1 | tail -30
```

Expected: усі тести PASS, включно з новим `test_deny_missing_docs_adr`.

- [ ] **Step 1.6: Оновити `text.mdc` — приклади і пояснення**

У `npm/rules/text/text.mdc`:

**A. Bump `version:` frontmatter** з `'1.29'` на `'1.30'` (один param у каноні змінився).

**B. У двох прикладах `.cspell.json`** (рядки ~189 і ~233) додай `"docs/adr/**"` в кінець `ignorePaths`-масиву.

Перший фрагмент (рядок 189):
```json
"ignorePaths": ["**/node_modules/**", "**/vscode-extension/**", "**/.git/**", ".vscode", "report", "*.svg", "**/k8s/**/*.yaml", "docs/adr/**"],
```

Другий фрагмент (рядок 233): аналогічно.

**C. Після таблиці канонів** (рядок ~195, відразу після рядка про `.cspell.json.deny.json`), додай новий абзац:

```markdown
`docs/adr/**` у канонічному `ignorePaths` — машинно-генеровані MADR-документи (драфти `capture-decisions.sh` + clean-ADR-и після `normalize-decisions.sh`). cspell-перевірка там безглузда: чернетка стирається наступним прогоном пайплайна, а будь-яка ручна правка правопису перезаписується. Локальні розширення `ignorePaths` дозволені — це лише мінімум.
```

- [ ] **Step 1.7: Перевірити стан — `git status && git diff npm/rules/text/`**

```bash
cd /Users/vitaliytv/www/nitra/cursor
git status npm/rules/text/
git diff npm/rules/text/
```

Expected: 3 файли змінено (snippet, test, mdc). Жодного нового.

---

## Task 2: Інтеграційний тест capture-decisions.sh — tooling-only

**Files:**
- Create: `npm/rules/adr/js/tests/capture-decisions-tooling-only.test.mjs`

Тест жодних реальних LLM не викликає: ми очищаємо `PATH` так, щоб ані `claude`, ані `cursor-agent` не були доступні. Розрізняємо випадки за рядком у `.claude/hooks/capture-decisions.log` і за фактом створення/нестворення файлу в `docs/adr/`.

- [ ] **Step 2.1: Створити фейкову jsonl-фікстуру для transcript'у**

В тесті будемо генерувати JSONL inline. Базова форма однієї лінії транскрипту з `tool_use`:

```jsonl
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/proj/.cspell.json","old_string":"a","new_string":"b"}}]}}
```

- [ ] **Step 2.2: Написати failing-тест**

Створи `npm/rules/adr/js/tests/capture-decisions-tooling-only.test.mjs`:

```javascript
/**
 * Інтеграційний тест capture-decisions.sh: structural skip для tooling-only сесій.
 * Запускає реальний bash-скрипт; LLM-виклик блокуємо порожнім PATH (без `claude` /
 * `cursor-agent` хук виходить мовчки). Розрізнюємо tooling-only vs normal по логу
 * + фактом створення `docs/adr/*.md`.
 */
import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { withTmpCwd } from '../../../../scripts/utils/test-helpers.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const HOOK_SCRIPT = resolve(here, '..', '..', '..', '..', '.claude-template', 'hooks', 'capture-decisions.sh')

/**
 * Build a JSONL transcript with given tool_use edits.
 * @param {Array<{name: string, file: string}>} edits масив правок
 * @returns {string} jsonl content
 */
function transcriptJsonl(edits) {
  return edits
    .map(e =>
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', name: e.name, input: { file_path: e.file } }]
        }
      })
    )
    .join('\n')
}

/**
 * Run capture-decisions.sh in tmp cwd with empty PATH-сегмент для LLM CLI.
 * @param {string} payload JSON stdin для скрипта (`{transcript_path, session_id}`)
 * @returns {{exitCode: number, log: string, adrFiles: string[]}}
 */
function runCaptureHook(payload) {
  const result = spawnSync('bash', [HOOK_SCRIPT], {
    input: payload,
    env: {
      // Тільки системні шляхи без `claude`/`cursor-agent`.
      PATH: '/usr/bin:/bin',
      CLAUDE_PROJECT_DIR: process.cwd(),
      HOME: process.env.HOME
    },
    encoding: 'utf8'
  })
  const logPath = '.claude/hooks/capture-decisions.log'
  const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
  const adrFiles = existsSync('docs/adr') ? readdirSync('docs/adr') : []
  return { exitCode: result.status ?? -1, log, adrFiles }
}

describe('capture-decisions.sh — structural tooling-only skip', () => {
  test('tooling-only: лише `.cspell.json` → skip, нічого в docs/adr/', async () => {
    await withTmpCwd(async () => {
      await mkdir('docs/adr', { recursive: true })
      const cwd = process.cwd()
      const tpath = join(cwd, 'transcript.jsonl')
      await writeFile(tpath, transcriptJsonl([{ name: 'Edit', file: join(cwd, '.cspell.json') }]))
      const { log, adrFiles } = runCaptureHook(JSON.stringify({ transcript_path: tpath, session_id: 'abc12345' }))
      expect(log).toContain('skipping ADR capture: tooling-only session')
      expect(adrFiles).toEqual([])
    })
  })

  test('tooling-only: лише docs/adr/ + CHANGELOG → skip', async () => {
    await withTmpCwd(async () => {
      await mkdir('docs/adr', { recursive: true })
      const cwd = process.cwd()
      const tpath = join(cwd, 'transcript.jsonl')
      await writeFile(
        tpath,
        transcriptJsonl([
          { name: 'Write', file: join(cwd, 'docs/adr/20260520-101010-foo.md') },
          { name: 'Edit', file: join(cwd, 'CHANGELOG.md') }
        ])
      )
      const { log, adrFiles } = runCaptureHook(JSON.stringify({ transcript_path: tpath, session_id: 'abc12346' }))
      expect(log).toContain('tooling-only session')
      expect(adrFiles).toEqual([])
    })
  })

  test('non-tooling: правка `src/foo.ts` → НЕ skip (хук іде до LLM-логіки)', async () => {
    await withTmpCwd(async () => {
      await mkdir('docs/adr', { recursive: true })
      const cwd = process.cwd()
      const tpath = join(cwd, 'transcript.jsonl')
      await writeFile(
        tpath,
        transcriptJsonl([
          { name: 'Edit', file: join(cwd, 'src/foo.ts') },
          { name: 'Edit', file: join(cwd, '.cspell.json') }
        ])
      )
      const { log } = runCaptureHook(JSON.stringify({ transcript_path: tpath, session_id: 'abc12347' }))
      // Без LLM CLI хук доходить до перевірки і виходить з "no LLM CLI found".
      // НЕ повинно містити tooling-only skip.
      expect(log).not.toContain('tooling-only session')
      expect(log).toContain('no LLM CLI found')
    })
  })

  test('ADR_NORMALIZE_SKIP_TOOLING_ONLY=0 вимикає скіп навіть для чистого tooling', async () => {
    await withTmpCwd(async () => {
      await mkdir('docs/adr', { recursive: true })
      const cwd = process.cwd()
      const tpath = join(cwd, 'transcript.jsonl')
      await writeFile(tpath, transcriptJsonl([{ name: 'Edit', file: join(cwd, '.cspell.json') }]))
      const result = spawnSync('bash', [HOOK_SCRIPT], {
        input: JSON.stringify({ transcript_path: tpath, session_id: 'abc12348' }),
        env: {
          PATH: '/usr/bin:/bin',
          CLAUDE_PROJECT_DIR: cwd,
          HOME: process.env.HOME,
          ADR_NORMALIZE_SKIP_TOOLING_ONLY: '0'
        },
        encoding: 'utf8'
      })
      expect(result.status).toBe(0)
      const log = readFileSync('.claude/hooks/capture-decisions.log', 'utf8')
      expect(log).not.toContain('tooling-only session')
    })
  })
})
```

- [ ] **Step 2.3: Запустити — мають усі FAIL**

```bash
cd /Users/vitaliytv/www/nitra/cursor
bun test npm/rules/adr/js/tests/capture-decisions-tooling-only.test.mjs 2>&1 | tail -30
```

Expected: всі 4 тести падають (capture-decisions.sh ще не має скіп-логіки).

---

## Task 3: Реалізувати tooling-only skip у capture-decisions.sh

**Files:**
- Modify: `npm/.claude-template/hooks/capture-decisions.sh`

- [ ] **Step 3.1: Додати inline-функцію `is_tooling_only_change` після `log()`-визначення**

У `npm/.claude-template/hooks/capture-decisions.sh`, відразу після рядка `log() { printf '%s %s\n' "$(date -Iseconds)" "$*" >> "$LOG"; }`, додай:

```bash
# Структурний скіп ADR-генерації для "tooling-only" сесій.
# Вхід: рядки-шляхи у stdin (один шлях на лінію), відносні до $PROJECT_ROOT
# або абсолютні з префіксом $PROJECT_ROOT (нормалізуємо тут).
# Вихід: 0 — усі шляхи в allowlist; 1 — є хоч один змістовний шлях.
# Bash 3.2: без mapfile/асоц. масивів.
is_tooling_only_change() {
  local proj="$1"
  local had_file=0
  local f rel
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    had_file=1
    # Нормалізуємо до relative.
    case "$f" in
      "$proj"/*) rel="${f#"$proj"/}" ;;
      /*) return 1 ;;  # абсолютний шлях поза проєктом — не tooling
      *)  rel="$f" ;;
    esac
    case "$rel" in
      .cspell.json) ;;
      docs/adr/*.md) ;;
      AGENTS.md|CLAUDE.md) ;;
      CHANGELOG.md) ;;
      */CHANGELOG.md) ;;
      package.json|*/package.json)
        # Дозволено лише якщо diff чіпає виключно ключ "version".
        if ! git_diff_only_version_field "$proj" "$rel"; then
          return 1
        fi
        ;;
      *) return 1 ;;
    esac
  done
  # Порожній список — не tooling-only (нема сигналу).
  [ "$had_file" = "1" ] && return 0
  return 1
}

# Допоміжна: чи git-diff для файлу торкається ЛИШЕ рядків з `"version":`.
# Поза git-репо або при помилці — вертаємо 1 (не tooling).
git_diff_only_version_field() {
  local proj="$1" path="$2"
  [ -d "$proj/.git" ] || return 1
  local diff
  diff=$(cd "$proj" && git diff HEAD --unified=0 -- "$path" 2>/dev/null) || return 1
  [ -z "$diff" ] && return 1
  # Усі змінені рядки (+/-, крім header'ів +++/---) мають містити `"version":`.
  local line
  while IFS= read -r line; do
    case "$line" in
      '+++ '*|'--- '*|'@@ '*|'') continue ;;
      [+-]*'"version":'*) continue ;;
      [+-]*) return 1 ;;
    esac
  done <<EOF
$diff
EOF
  return 0
}
```

- [ ] **Step 3.2: Додати ранній exit ПЕРЕД збором `PROMPT_FULL`**

У `npm/.claude-template/hooks/capture-decisions.sh`, відразу **перед** рядком `PROMPT=$(cat <<'EOF'` (тобто після перевірки `if [[ -z "$TRANSCRIPT" ]]; then ... fi`), додай:

```bash
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
```

- [ ] **Step 3.3: Прогнати інтеграційні тести з Task 2**

```bash
cd /Users/vitaliytv/www/nitra/cursor
bun test npm/rules/adr/js/tests/capture-decisions-tooling-only.test.mjs 2>&1 | tail -30
```

Expected: всі 4 тести PASS.

- [ ] **Step 3.4: Прогнати існуючі adr-тести (regression-check)**

```bash
cd /Users/vitaliytv/www/nitra/cursor
bun test npm/rules/adr/ 2>&1 | tail -30
```

Expected: усі тести PASS, включно з оригінальним `hooks.test.mjs` (порівняння байт-у-байт із bundled-скриптом — у проекті-тест-фікстурі копіюється нова версія скрипта).

- [ ] **Step 3.5: `git status && git diff` для review**

```bash
git status npm/.claude-template/hooks/ npm/rules/adr/js/tests/
git diff npm/.claude-template/hooks/capture-decisions.sh
```

---

## Task 4: Інтеграційний тест normalize-decisions.sh — per-draft tooling-only delete

**Files:**
- Create: `npm/rules/adr/js/tests/normalize-decisions-tooling-only.test.mjs`

- [ ] **Step 4.1: Написати failing-тест**

Створи файл:

```javascript
/**
 * Інтеграційний тест normalize-decisions.sh: для чернеток сесій, де змінювалися
 * лише tooling-файли, виконувати `delete` без виклику LLM.
 */
import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { withTmpCwd } from '../../../../scripts/utils/test-helpers.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const HOOK_SCRIPT = resolve(here, '..', '..', '..', '..', '.claude-template', 'hooks', 'normalize-decisions.sh')

/**
 * Build a draft markdown file content with frontmatter.
 * @param {object} fm frontmatter
 * @returns {string}
 */
function draftMd(fm) {
  return `---\nsession: ${fm.session}\ncaptured: ${fm.captured}\ntranscript: ${fm.transcript}\n---\n\n## ADR Тестова чернетка\n\n## Context and Problem Statement\nstub\n`
}

/**
 * jsonl helper: assistant tool_use edits.
 * @param {Array<{name: string, file: string}>} edits масив правок
 * @returns {string}
 */
function transcriptJsonl(edits) {
  return edits
    .map(e =>
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', name: e.name, input: { file_path: e.file } }]
        }
      })
    )
    .join('\n')
}

/**
 * Run normalize-decisions.sh з обходом порогів і без LLM CLI.
 * @returns {{ exitCode: number, log: string, drafts: string[] }}
 */
function runNormalizeHook() {
  const result = spawnSync('bash', [HOOK_SCRIPT], {
    input: '{}',
    env: {
      PATH: '/usr/bin:/bin',
      CLAUDE_PROJECT_DIR: process.cwd(),
      HOME: process.env.HOME,
      ADR_NORMALIZE_THRESHOLD: '1',
      ADR_NORMALIZE_MIN_INTERVAL_HOURS: '0'
    },
    encoding: 'utf8'
  })
  const logPath = '.claude/hooks/normalize-decisions.log'
  const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
  const drafts = existsSync('docs/adr') ? readdirSync('docs/adr') : []
  return { exitCode: result.status ?? -1, log, drafts }
}

describe('normalize-decisions.sh — structural tooling-only delete', () => {
  test('tooling-only чернетка → видалена без LLM', async () => {
    await withTmpCwd(async () => {
      await mkdir('docs/adr', { recursive: true })
      const cwd = process.cwd()
      const tpath = join(cwd, 'transcript.jsonl')
      await writeFile(tpath, transcriptJsonl([{ name: 'Edit', file: join(cwd, '.cspell.json') }]))
      const draftPath = 'docs/adr/20260520-101010-foo.md'
      await writeFile(
        draftPath,
        draftMd({ session: 'sess1', captured: '2026-05-20T10:10:10+00:00', transcript: tpath })
      )
      const { log, drafts } = runNormalizeHook()
      expect(log).toContain('tooling-only')
      expect(drafts).not.toContain('20260520-101010-foo.md')
    })
  })

  test('non-tooling чернетка → лишається (LLM-крок мовчки no-op без CLI)', async () => {
    await withTmpCwd(async () => {
      await mkdir('docs/adr', { recursive: true })
      const cwd = process.cwd()
      const tpath = join(cwd, 'transcript.jsonl')
      await writeFile(tpath, transcriptJsonl([{ name: 'Edit', file: join(cwd, 'src/foo.ts') }]))
      const draftPath = 'docs/adr/20260520-101010-bar.md'
      await writeFile(
        draftPath,
        draftMd({ session: 'sess2', captured: '2026-05-20T10:10:10+00:00', transcript: tpath })
      )
      const { drafts } = runNormalizeHook()
      expect(drafts).toContain('20260520-101010-bar.md')
    })
  })

  test('батч повністю tooling-only → exit 0 без LLM', async () => {
    await withTmpCwd(async () => {
      await mkdir('docs/adr', { recursive: true })
      const cwd = process.cwd()
      const tpath = join(cwd, 'transcript.jsonl')
      await writeFile(tpath, transcriptJsonl([{ name: 'Edit', file: join(cwd, '.cspell.json') }]))
      for (const id of ['a', 'b', 'c']) {
        await writeFile(
          `docs/adr/20260520-10101${id.charCodeAt(0) % 10}-${id}.md`,
          draftMd({ session: `sess${id}`, captured: '2026-05-20T10:10:10+00:00', transcript: tpath })
        )
      }
      const { log, drafts } = runNormalizeHook()
      // Усі три чернетки видалені, LLM не викликався.
      expect(drafts.length).toBe(0)
      expect(log).not.toContain('using claude CLI')
      expect(log).not.toContain('using cursor-agent CLI')
    })
  })

  test('ADR_NORMALIZE_SKIP_TOOLING_ONLY=0 вимикає скіп', async () => {
    await withTmpCwd(async () => {
      await mkdir('docs/adr', { recursive: true })
      const cwd = process.cwd()
      const tpath = join(cwd, 'transcript.jsonl')
      await writeFile(tpath, transcriptJsonl([{ name: 'Edit', file: join(cwd, '.cspell.json') }]))
      await writeFile(
        'docs/adr/20260520-101010-foo.md',
        draftMd({ session: 'sess1', captured: '2026-05-20T10:10:10+00:00', transcript: tpath })
      )
      const result = spawnSync('bash', [HOOK_SCRIPT], {
        input: '{}',
        env: {
          PATH: '/usr/bin:/bin',
          CLAUDE_PROJECT_DIR: process.cwd(),
          HOME: process.env.HOME,
          ADR_NORMALIZE_THRESHOLD: '1',
          ADR_NORMALIZE_MIN_INTERVAL_HOURS: '0',
          ADR_NORMALIZE_SKIP_TOOLING_ONLY: '0'
        },
        encoding: 'utf8'
      })
      expect(result.status).toBe(0)
      const drafts = readdirSync('docs/adr')
      // Skip вимкнено, LLM CLI відсутній → чернетка лишається.
      expect(drafts).toContain('20260520-101010-foo.md')
    })
  })
})
```

- [ ] **Step 4.2: Запустити — мають FAIL**

```bash
cd /Users/vitaliytv/www/nitra/cursor
bun test npm/rules/adr/js/tests/normalize-decisions-tooling-only.test.mjs 2>&1 | tail -30
```

Expected: всі 4 тести падають.

---

## Task 5: Реалізувати tooling-only delete у normalize-decisions.sh

**Files:**
- Modify: `npm/.claude-template/hooks/normalize-decisions.sh`

- [ ] **Step 5.1: Додати inline-функції `is_tooling_only_change` + `git_diff_only_version_field`**

У `npm/.claude-template/hooks/normalize-decisions.sh`, відразу після рядка `log() { printf '%s %s\n' "$(date -Iseconds)" "$*" >> "$LOG"; }`, додай **той самий** код, що в capture (Task 3.1). Дублікат навмисний.

Також додай функцію, що з draft-файлу витягає transcript-шлях:

```bash
# Витягає поле `transcript:` з YAML frontmatter ADR-чернетки.
# Друкує шлях у stdout або порожньо, якщо відсутнє.
draft_transcript_path() {
  awk '
    NR==1 && /^---$/ { fm=1; next }
    fm && /^---$/    { exit }
    fm && /^transcript: / { sub(/^transcript: /, ""); print; exit }
  ' "$1" 2>/dev/null
}
```

- [ ] **Step 5.2: Pre-LLM фільтр — видалити tooling-only чернетки з BATCH_LIST**

У `npm/.claude-template/hooks/normalize-decisions.sh`, **відразу після** рядка:

```bash
head -n "$BATCH_SIZE" "$DRAFTS_LIST" > "$BATCH_LIST"
BATCH_COUNT=$(wc -l < "$BATCH_LIST" | tr -d ' ')
log "batch size: $BATCH_COUNT"
```

додай:

```bash
# Structural skip: чернетки, у яких сесія чіпала лише tooling-файли — видаляємо
# без виклику LLM. ENV `ADR_NORMALIZE_SKIP_TOOLING_ONLY=0` вимикає.
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
        log "tooling-only delete: $(basename "$draft") (session $(printf '%s' "$changed" | tr '\n' ' '))"
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
```

- [ ] **Step 5.3: Прогнати тести normalize з Task 4**

```bash
cd /Users/vitaliytv/www/nitra/cursor
bun test npm/rules/adr/js/tests/normalize-decisions-tooling-only.test.mjs 2>&1 | tail -30
```

Expected: всі 4 тести PASS.

- [ ] **Step 5.4: Прогнати всі adr-тести (regression)**

```bash
cd /Users/vitaliytv/www/nitra/cursor
bun test npm/rules/adr/ 2>&1 | tail -30
```

Expected: усі PASS.

- [ ] **Step 5.5: `git diff` для review**

```bash
git diff npm/.claude-template/hooks/normalize-decisions.sh
```

---

## Task 6: Документація — adr.mdc + skills/adr-normalize/SKILL.md

**Files:**
- Modify: `npm/rules/adr/adr.mdc`
- Modify: `npm/skills/adr-normalize/SKILL.md`

- [ ] **Step 6.1: Оновити `adr.mdc` — параграф про скіп tooling-only**

У `npm/rules/adr/adr.mdc`:

**A. Bump `version:`** з `'2.1'` на `'2.2'` (поведінка хуків змінилася).

**B. У розділ «### Фаза 1 — Capture»** (після останнього параграфа про Cursor payload, рядок ~30), додай:

```markdown
**Tooling-only skip:** перед викликом LLM `capture-decisions.sh` дивиться у transcript на `tool_use`-правки (`Edit`/`Write`/`MultiEdit`). Якщо всі змінені файли потрапляють у вузький allowlist — `.cspell.json`, `docs/adr/*.md`, `CHANGELOG.md`, кореневі `AGENTS.md`/`CLAUDE.md`, або `package.json` з diff виключно по ключу `version` — хук виходить з `exit 0` без LLM-виклику. Це розриває петлю «`/n-lint` править `.cspell.json` → з'являється новий ADR-draft → наступний `/n-lint` знов псує правопис у цьому draft». Поведінку вимикає `ADR_NORMALIZE_SKIP_TOOLING_ONLY=0`.
```

**C. У розділ «### Фаза 2 — Normalize»**, перед таблицею з `op`, додай ще один bullet у список причин раннього виходу:

```markdown
- Перед викликом LLM для кожної чернетки batch'а читає `transcript:` із frontmatter і той самий tool_use-список. Чернетки tooling-only — видаляє без виклику LLM. Якщо після фільтра batch порожній — `exit 0`.
```

**D. У таблицю ENV** додай рядок:

```markdown
| `ADR_NORMALIZE_SKIP_TOOLING_ONLY` | `1` | `0` — вимкнути structural skip tooling-only сесій (старий behavior). |
```

- [ ] **Step 6.2: Оновити `skills/adr-normalize/SKILL.md`**

У `npm/skills/adr-normalize/SKILL.md`, секція **«Tuning через ENV»** — додай рядок:

```markdown
- `ADR_NORMALIZE_SKIP_TOOLING_ONLY=0` — вимкнути structural skip для tooling-only сесій (default `1`). Корисно лише якщо хочеш зберегти чернетки навіть для правок у `.cspell.json` / `CHANGELOG.md` / `version`-bump-ів.
```

У секцію **«Якщо щось пішло не так»** додай:

```markdown
- ADR-чернетки видаляються мовчки → це structural tooling-only skip. Перевір лог: `tail .claude/hooks/normalize-decisions.log | grep tooling-only`. Для діагностики на capture-стороні: `tail .claude/hooks/capture-decisions.log | grep tooling-only`. Аби тимчасово вимкнути — `ADR_NORMALIZE_SKIP_TOOLING_ONLY=0 bash .claude/hooks/normalize-decisions.sh`.
```

- [ ] **Step 6.3: Перевірити стан**

```bash
git diff npm/rules/adr/adr.mdc npm/skills/adr-normalize/SKILL.md
```

---

## Task 7: Bump версії + CHANGELOG

**Files:**
- Modify: `npm/package.json`
- Modify: `npm/CHANGELOG.md`

- [ ] **Step 7.1: Bump version у `npm/package.json`**

`"version": "1.18.0"` → `"version": "1.19.0"`.

- [ ] **Step 7.2: Додати запис у `npm/CHANGELOG.md`**

Вставити нову секцію перед `[1.18.0]`:

```markdown
## [1.19.0] - 2026-05-25

### Added

- `text`: `docs/adr/**` у канонічному `ignorePaths` правила `.cspell.json` (`policy/cspell/template/.cspell.json.snippet.json`). Машинно-генеровані ADR-документи більше не валідуються cspell-ом — це розриває петлю «правка `.cspell.json` → новий ADR-draft → знову `cspell` ламається на ньому». Локальні розширення `ignorePaths` лишаються дозволені (rego subset-of).
- `adr`: ENV `ADR_NORMALIZE_SKIP_TOOLING_ONLY` (default `1`) — вимикає structural skip у capture-/normalize-хуках. Документація в `adr.mdc` (таблиця ENV) і `skills/adr-normalize/SKILL.md`.

### Changed

- `adr`: `.claude-template/hooks/capture-decisions.sh` — перед LLM-викликом перевіряє список `tool_use`-правок із transcript'у. Якщо всі правки у вузькому allowlist (`.cspell.json`, `docs/adr/*.md`, кореневі `AGENTS.md`/`CLAUDE.md`, `CHANGELOG.md`, `*/package.json` із diff виключно по ключу `version`) — `exit 0` із записом `skipping ADR capture: tooling-only session` у лог. Inline-функція `is_tooling_only_change` + `git_diff_only_version_field`, bash 3.2-сумісно.
- `adr`: `.claude-template/hooks/normalize-decisions.sh` — після формування батча для кожної чернетки читає `transcript:` із frontmatter і та сама перевірка allowlist'у. Tooling-only чернетки видаляються без виклику LLM; якщо батч порожній — `exit 0`.

### Notes

- Існуючі ENV (`ADR_NORMALIZE_THRESHOLD`, `…_MIN_INTERVAL_HOURS`, `…_BATCH`, `…_DRY`, recursion-guard `CAPTURE_DECISIONS_RUNNING` / `ADR_NORMALIZE_RUNNING`) поведінку не змінюють.
- `cspell.rego` subset-of-перевірку зберігає — нічого не зламано для проєктів, де користувач уже руками додав `docs/adr/**` у свій `.cspell.json`.
```

- [ ] **Step 7.3: Перевірити CHANGELOG згідно правила**

```bash
cd /Users/vitaliytv/www/nitra/cursor
npx @nitra/cursor check changelog 2>&1 | tail -20
```

Expected: 0 errors.

---

## Task 8: Повна верифікація

- [ ] **Step 8.1: bun test для всіх зачеплених правил**

```bash
cd /Users/vitaliytv/www/nitra/cursor
bun test npm/rules/text/ npm/rules/adr/ 2>&1 | tail -50
```

Expected: усі тести PASS.

- [ ] **Step 8.2: rego-тести**

```bash
cd /Users/vitaliytv/www/nitra/cursor
bun run lint-rego 2>&1 | tail -20
```

Expected: усі PASS.

- [ ] **Step 8.3: Self-перевірка `npx @nitra/cursor check`**

```bash
cd /Users/vitaliytv/www/nitra/cursor
npx @nitra/cursor check 2>&1 | tail -40
```

Expected: 0 errors. Можуть бути fail-и у `text` (cspell хоче `docs/adr/**` у власному `.cspell.json` репо) — якщо так, виправити:

```bash
npx @nitra/cursor fix text
```

…і повторити check. Це нормально: канон додався і репо-само-теж є його споживачем.

- [ ] **Step 8.4: Кінцевий стан — git status**

```bash
git status
git diff --stat
```

Expected зачеплені шляхи:
- `npm/rules/text/policy/cspell/template/.cspell.json.snippet.json`
- `npm/rules/text/policy/cspell/cspell_test.rego`
- `npm/rules/text/text.mdc`
- `npm/.claude-template/hooks/capture-decisions.sh`
- `npm/.claude-template/hooks/normalize-decisions.sh`
- `npm/rules/adr/adr.mdc`
- `npm/skills/adr-normalize/SKILL.md`
- `npm/package.json`
- `npm/CHANGELOG.md`
- `.cspell.json` (репо-споживач — якщо `fix text` прогнано)
- `npm/rules/adr/js/tests/capture-decisions-tooling-only.test.mjs` (new)
- `npm/rules/adr/js/tests/normalize-decisions-tooling-only.test.mjs` (new)

---

## Risks / Open questions

- **`git_diff_only_version_field` поза git-repo:** функція повертає 1 (не tooling) — `package.json` тоді виключає сесію зі скіпу. Це консервативно правильно: без git'а ми не можемо переконатися, що поза `version` нічого більше не змінилося.
- **Transcript missing для normalize:** якщо `transcript:` файл уже видалено (rotation), функція fallback'не на «не tooling-only» → чернетка залишиться. Це безпечно — погана сторона помилки тут «зайвий ADR», не «втрачений ADR».
- **`@cspell/dict-` ще активний:** не зачіпається.
- **Subset-of cspell rego:** користувацькі додаткові elements в `ignorePaths` дозволені — нічого не зламається у репо, де команда вже руками додала свої виключення.
