# Порт перевірок `validateLintGaWorkflowStructure` + `validateLintGaOnTriggers` з
# `npm/scripts/check-ga.mjs` (ga.mdc).
#
# Запуск (локально):
#   conftest test .github/workflows/lint-ga.yml \
#     -p npm/policy/ga --namespace ga.lint_ga
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package ga.lint_ga

import rego.v1

# ── Очікувані значення ─────────────────────────────────────────────────────

expected_concurrency_group := concat("", ["$", "{{ github.ref }}-$", "{{ github.workflow }}"])

expected_name := "Lint GA"

expected_branches := {"dev", "main"}

expected_push_paths := {".github/actions/**", ".github/workflows/**"}

# Шаблон повідомлення про відсутню `concurrency`-секцію — через `concat` для
# regal style/line-length.
concurrency_missing_template := concat(" ", [
	"lint-ga.yml: відсутня секція concurrency —",
	"додай concurrency.group: %s і cancel-in-progress: true (ga.mdc)",
])

# ── Аліаси на input ────────────────────────────────────────────────────────
#
# YAML 1.1 quirk: `on:` → boolean true → у конфтесті ключ "true".

gha_on := input["true"]

# Job-id містить дефіс — звертаємося через `[…]`. Імʼя `job` (без префіксу пакету)
# — щоб уникнути regal-правила `rule-name-repeats-package`.
job := input.jobs["lint-ga"]

# Усі `uses:` зі steps цього job-а — для перевірки членства.
job_uses_set contains job.steps[_].uses

# Усі `run:` зі steps цього job-а, склеєні в один blob — для substring-перевірки.
job_run_blob := concat("\n", [run |
	run := job.steps[_].run
])

# ── deny rules (контигно — regal: messy-rule) ──────────────────────────────

deny contains msg if {
	input.name != expected_name
	msg := sprintf("lint-ga.yml: name має бути %q (ga.mdc)", [expected_name])
}

deny contains msg if {
	not push_branches_have_dev_and_main
	msg := "lint-ga.yml: on.push.branches має містити dev і main (ga.mdc)"
}

deny contains msg if {
	not pr_branches_have_dev_and_main
	msg := "lint-ga.yml: on.pull_request.branches має містити dev і main (ga.mdc)"
}

deny contains msg if {
	not push_paths_have_required
	msg := "lint-ga.yml: on.push.paths має містити .github/actions/** і .github/workflows/** (ga.mdc)"
}

deny contains msg if {
	not is_object(input.concurrency)
	msg := sprintf(concurrency_missing_template, [expected_concurrency_group])
}

deny contains msg if {
	is_object(input.concurrency)
	input.concurrency.group != expected_concurrency_group
	msg := sprintf("lint-ga.yml: concurrency.group має бути %s (ga.mdc)", [expected_concurrency_group])
}

deny contains msg if {
	is_object(input.concurrency)
	input.concurrency["cancel-in-progress"] != true
	msg := "lint-ga.yml: concurrency.cancel-in-progress має бути true (ga.mdc)"
}

deny contains msg if {
	not job
	msg := "lint-ga.yml: jobs.lint-ga відсутній (ga.mdc)"
}

deny contains msg if {
	job["runs-on"] != "ubuntu-latest"
	msg := "lint-ga.yml: runs-on має бути ubuntu-latest (ga.mdc)"
}

deny contains msg if {
	job.permissions.contents != "read"
	msg := "lint-ga.yml: permissions мають бути contents: read (ga.mdc)"
}

deny contains msg if {
	count(job.steps) == 0
	msg := "lint-ga.yml: jobs.lint-ga.steps відсутні (ga.mdc)"
}

deny contains msg if {
	not "actions/checkout@v6" in job_uses_set
	msg := "lint-ga.yml: має бути uses: actions/checkout@v6 (ga.mdc)"
}

deny contains msg if {
	not "./.github/actions/setup-bun-deps" in job_uses_set
	msg := "lint-ga.yml: має бути uses: ./.github/actions/setup-bun-deps (ga.mdc)"
}

deny contains msg if {
	not "astral-sh/setup-uv@v8.0.0" in job_uses_set
	msg := "lint-ga.yml: має бути uses: astral-sh/setup-uv@v8.0.0 (ga.mdc)"
}

deny contains msg if {
	not contains(job_run_blob, "bun run lint-ga")
	msg := "lint-ga.yml: має бути крок run: bun run lint-ga (ga.mdc)"
}

# ── helpers ────────────────────────────────────────────────────────────────

push_branches_have_dev_and_main if {
	branches := gha_on.push.branches
	expected_branches & {b | some b in branches} == expected_branches
}

pr_branches_have_dev_and_main if {
	branches := gha_on.pull_request.branches
	expected_branches & {b | some b in branches} == expected_branches
}

push_paths_have_required if {
	paths := gha_on.push.paths
	expected_push_paths & {p | some p in paths} == expected_push_paths
}
