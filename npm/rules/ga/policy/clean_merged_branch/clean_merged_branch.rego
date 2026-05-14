# Порт перевірки `validateCleanMergedBranch` з `npm/scripts/check-ga.mjs` (ga.mdc).
#
# Запуск (локально):
#   conftest test .github/workflows/clean-merged-branch.yml \
#     -p npm/policy/ga --namespace ga.clean_merged_branch
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package ga.clean_merged_branch

import rego.v1

# ── Очікувані значення ─────────────────────────────────────────────────────
#
# Шаблонні токени GitHub Actions (`${{ … }}`) збираємо з фрагментів через
# `concat`, бо `{{` у Rego починає string interpolation.

expected_github_token := concat("", ["$", "{{ github.token }}"])

expected_deleted_branches_expr := concat("", ["$", "{{ steps.delete_stuff.outputs.deleted_branches }}"])

expected_echo_substring := concat("", ["echo \"Deleted branches: $", "{DELETED_BRANCHES}\""])

expected_name := "Clean abandoned branches"

expected_cron := "0 1 15 * *"

# ── Аліаси на input ────────────────────────────────────────────────────────
#
# YAML 1.1 quirk: `on:` → boolean true → у конфтесті ключ "true".

gha_on := input["true"]

steps := input.jobs.cleanup_old_branches.steps

step0 := steps[0]

step1 := steps[1]

# ── deny rules (контигно — regal: messy-rule) ──────────────────────────────

deny contains msg if {
	input.name != expected_name
	msg := sprintf("clean-merged-branch.yml: name має бути %q (ga.mdc)", [expected_name])
}

deny contains msg if {
	not has_expected_cron
	msg := sprintf("clean-merged-branch.yml: on.schedule має містити cron: '%s' (ga.mdc)", [expected_cron])
}

deny contains msg if {
	not has_workflow_dispatch
	msg := "clean-merged-branch.yml: має бути workflow_dispatch: {} (ga.mdc)"
}

deny contains msg if {
	not input.jobs.cleanup_old_branches
	msg := "clean-merged-branch.yml: jobs.cleanup_old_branches відсутній (ga.mdc)"
}

deny contains msg if {
	input.jobs.cleanup_old_branches.permissions.contents != "write"
	msg := "clean-merged-branch.yml: permissions мають бути contents: write (ga.mdc)"
}

deny contains msg if {
	count(steps) < 2
	msg := "clean-merged-branch.yml: steps має містити 2 кроки як у ga.mdc"
}

# ── Step 0 (delete_stuff) ──────────────────────────────────────────────────

deny contains msg if {
	step0.id != "delete_stuff"
	msg := "clean-merged-branch.yml: перший крок має id: delete_stuff (ga.mdc)"
}

deny contains msg if {
	step0.uses != "phpdocker-io/github-actions-delete-abandoned-branches@v2.0.3"
	msg := "clean-merged-branch.yml: перший крок має uses як у ga.mdc"
}

deny contains msg if {
	step0.with.github_token != expected_github_token
	msg := sprintf("clean-merged-branch.yml: with.github_token має бути %s (ga.mdc)", [expected_github_token])
}

deny contains msg if {
	step0.with.last_commit_age_days != 90
	msg := "clean-merged-branch.yml: with.last_commit_age_days має бути 90 (ga.mdc)"
}

deny contains msg if {
	not ignore_branches_has_main_and_dev
	msg := "clean-merged-branch.yml: with.ignore_branches має містити main,dev (ga.mdc)"
}

# `dry_run: no` у YAML парситься як boolean `false`. JS-перевірка порівнює зі
# рядком "no", але в нас input уже Go-yaml-парсений — тому очікуємо `false`.
# (Якщо комусь схочеться явного `"no"` — треба буде брати in quotes у YAML.)
deny contains msg if {
	step0.with.dry_run != false # noqa: rules-style-no-equality-with-false
	msg := "clean-merged-branch.yml: with.dry_run має бути no (ga.mdc)"
}

# ── Step 1 (Get output) ────────────────────────────────────────────────────

deny contains msg if {
	step1.name != "Get output"
	msg := "clean-merged-branch.yml: другий крок має name: Get output (ga.mdc)"
}

deny contains msg if {
	step1.env.DELETED_BRANCHES != expected_deleted_branches_expr
	msg := "clean-merged-branch.yml: env.DELETED_BRANCHES має бути як у ga.mdc"
}

deny contains msg if {
	not echo_deleted_branches
	msg := "clean-merged-branch.yml: run має echo Deleted branches як у ga.mdc"
}

# ── helpers ────────────────────────────────────────────────────────────────

has_expected_cron if {
	gha_on.schedule[_].cron == expected_cron
}

has_workflow_dispatch if {
	is_object(gha_on.workflow_dispatch)
}

ignore_branches_has_main_and_dev if {
	contains(step0.with.ignore_branches, "main")
	contains(step0.with.ignore_branches, "dev")
}

echo_deleted_branches if {
	contains(step1.run, expected_echo_substring)
}
