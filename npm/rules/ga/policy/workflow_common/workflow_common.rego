# Універсальні перевірки для будь-якого `.github/workflows/*.yml` (ga.mdc).
#
# Порт `verifyNoDirectBunOrCache`, `verifyNoRunShellLineContinuationBackslash`,
# `verifyCheckoutBeforeLocalSetupBunDeps` та `validateConcurrencyOnRoot` з
# `npm/scripts/check-ga.mjs`. На відміну від `lint_ga`/`clean_ga_workflows`/
# `clean_merged_branch`/`git_ai`, цей пакет не привʼязаний до конкретного
# workflow — `conftest test` запускається на кожному файлі окремо з
# `--namespace ga.workflow_common`, і `input` — це окремий розпарсений YAML.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package ga.workflow_common

import rego.v1

# ── Очікувані значення ─────────────────────────────────────────────────────

expected_concurrency_group := concat("", ["$", "{{ github.ref }}-$", "{{ github.workflow }}"])

# Локальні composite setup-bun-deps (ga.mdc) — два варіанти шляху:
# `.github/actions/...` (cursor-репо) і `npm/github-actions/...` (npm-пакет dev-локально).
local_setup_bun_markers := {
	"./.github/actions/setup-bun-deps",
	"./npm/github-actions/setup-bun-deps",
}

# Заборонені підрядки в кроках `uses` та `run` (ga.mdc): дублюючі setup/cache/install,
# які мають бути всередині composite-action `setup-bun-deps`.
forbidden_step_substrings := {
	"oven-sh/setup-bun": "використовуй .github/actions/setup-bun-deps замість oven-sh/setup-bun",
	"actions/cache": "використовуй .github/actions/setup-bun-deps замість actions/cache",
	"bun install": "використовуй .github/actions/setup-bun-deps замість bun install",
}

# Заборонені бінарки у `run:` кроках (ga.mdc). `depcheck` мігровано на `knip`
# у `lint-js.mdc` — окремий крок у workflow не потрібен. Регексп ловить виклики
# через `npx`, `bunx`, `npm exec`, або як standalone-команду на початку рядка.
forbidden_run_command_patterns := {"depcheck": `(?:^|[\s;&|])(?:npx|bunx|npm exec|pnpm exec)?[ \t]*depcheck\b`}

# Шаблони довгих повідомлень — через `concat`, щоб дотримуватися regal style/line-length.

concurrency_missing_template := concat(" ", [
	"відсутня секція concurrency —",
	"додай concurrency.group: %s і cancel-in-progress: true (ga.mdc)",
])

shell_continuation_template := concat(" ", [
	"jobs.%s.steps[%d]: у run заборонено продовження рядків через зворотний сліш;",
	"оформи як folded block (run: >-) (ga.mdc)",
])

setup_bun_no_checkout_template := concat(" ", [
	"jobs.%s: перед локальним setup-bun-deps потрібен крок actions/checkout@v6 —",
	"інакше runner не знайде action.yml (ga.mdc)",
])

forbidden_run_command_template := concat(" ", [
	"jobs.%s.steps[%d]: `%s` заборонено у workflow —",
	"мігровано на knip (js-lint.mdc, ga.mdc)",
])

# ── Аліаси на input ────────────────────────────────────────────────────────

# Усі jobs (з гарантією, що це обʼєкт) — щоб не падати на нетипових YAML.
jobs := input.jobs

# Плоский список усіх кроків з усіх jobs з метаданими — для перевірок, де job-id
# і позиція кроку нам потрібні в повідомленні (shell line continuation).
all_flat_steps contains entry if {
	some job_id, step_index
	step := jobs[job_id].steps[step_index]
	entry := {"job_id": job_id, "step_index": step_index, "step": step}
}

# ── deny: заборонені setup-bun/cache/install у будь-якому кроці ────────────

deny contains msg if {
	some entry in all_flat_steps
	some pattern, hint in forbidden_step_substrings
	step_uses_or_run_blob(entry.step) != ""
	contains(step_uses_or_run_blob(entry.step), pattern)
	msg := sprintf("jobs.%s.steps[%d]: %s (ga.mdc)", [entry.job_id, entry.step_index, hint])
}

# ── deny: depcheck у будь-якому `run:` ────────────────────────────────────
#
# `depcheck` мігровано на `knip` (js-lint.mdc); `knip` вже запускається у lint-js
# CI як частина `bunx knip` у скрипті, тож окремий depcheck-крок зайвий і має
# бути видалений з workflow-файлів.

deny contains msg if {
	some entry in all_flat_steps
	some name, pattern in forbidden_run_command_patterns
	regex.match(pattern, step_run_text(entry.step))
	msg := sprintf(forbidden_run_command_template, [entry.job_id, entry.step_index, name])
}

# ── deny: shell-продовження `\` перед переносом рядка у `run:` ─────────────
#
# `\` + `\n` — bash line-continuation; у workflow замінюй на folded block `>-`
# без зворотних слішів (ga.mdc).

deny contains msg if {
	some entry in all_flat_steps
	run_text := step_run_text(entry.step)
	regex.match(`\\\r?\n`, run_text)
	msg := sprintf(shell_continuation_template, [entry.job_id, entry.step_index])
}

# ── deny: setup-bun-deps без попереднього checkout у тому ж job ────────────
#
# Без `actions/checkout` локальний composite-action недоступний — runner не
# знайде `action.yml` у дереві. Перевіряємо порядок індексів кроків у кожному
# job: setup-bun-deps має бути після принаймні одного `actions/checkout@`.

deny contains msg if {
	some job_id, job in jobs
	first_setup := first_local_setup_bun_index(job)
	first_setup >= 0
	not has_checkout_before(job, first_setup)
	msg := sprintf(setup_bun_no_checkout_template, [job_id])
}

# ── deny: concurrency блок ─────────────────────────────────────────────────
#
# Дублює окремі per-workflow перевірки для clean-ga-workflows / clean-merged-branch /
# lint-ga / git-ai, але вкриває й решту workflow-файлів (apply-k8s, lint-js, …),
# для яких поки немає виділеної polysi.

deny contains msg if {
	# `object.get(…, default)` повертає `false` коли ключа немає — інакше `not is_object(…)`
	# над відсутнім полем дає `undefined`, не `true`, і правило мовчки не спрацьовує.
	not is_object(object.get(input, "concurrency", false))
	msg := sprintf(concurrency_missing_template, [expected_concurrency_group])
}

deny contains msg if {
	is_object(object.get(input, "concurrency", false))
	input.concurrency.group != expected_concurrency_group
	msg := sprintf("concurrency.group має бути %s (ga.mdc)", [expected_concurrency_group])
}

deny contains msg if {
	is_object(object.get(input, "concurrency", false))
	input.concurrency["cancel-in-progress"] != true
	msg := "concurrency.cancel-in-progress має бути true (ga.mdc)"
}

# ── helpers ────────────────────────────────────────────────────────────────

# Об'єднаний рядок `uses` + `run` для одного кроку — для substring-пошуку
# заборонених патернів. `run` може бути рядком або масивом рядків (YAML).
step_uses_or_run_blob(step) := blob if {
	uses := object.get(step, "uses", "")
	run_text := step_run_text(step)
	blob := concat("\n", [uses, run_text])
}

# Текст `run:` як один рядок: підтримує рядкові та масивові форми (YAML).
step_run_text(step) := step.run if is_string(step.run)

else := concat("\n", [s | some s in step.run]) if is_array(step.run)

else := ""

# Індекс першого кроку з локальним setup-bun-deps; -1 якщо такого немає.
first_local_setup_bun_index(job) := min(indices) if {
	indices := [i |
		some i, step in job.steps
		uses := object.get(step, "uses", "")
		some marker in local_setup_bun_markers
		contains(uses, marker)
	]
	count(indices) > 0
} else := -1

# Чи є в `job.steps[0..before]` крок `actions/checkout@…`.
has_checkout_before(job, before) if {
	some i, step in job.steps
	i < before
	uses := object.get(step, "uses", "")
	contains(uses, "actions/checkout@")
}
