# PoC-порт перевірки `validateCleanGaWorkflows` з `npm/scripts/check-ga.mjs`.
#
# Запуск (локально):
#   conftest test .github/workflows/clean-ga-workflows.yml -p npm/policy/ga
#
# Conftest читає YAML і дає його в `input`. Кожне правило `deny contains msg if { … }`,
# що матчиться, друкується як порушення; пустий список — exit 0.
#
# Rego v1 синтаксис (OPA 1.x за замовчуванням; `import rego.v1` робить файл портованим
# і на старі OPA 0.x): `contains` для partial set rules, `if` перед тілом правила.
package main

import rego.v1

# GHA YAML quirk: ключ `on:` парситься як YAML 1.1 boolean `true`, після чого conftest
# серіалізує його в Rego-input як рядок `"true"`. Тому `input.on` / `input["on"]` /
# `input[true]` всі недоступні; реальний шлях — `input["true"]`. Виносимо в alias, щоб
# решта правил читалася як `gha_on.schedule` без бойлерплейту.
gha_on := input["true"]

# `${{ … }}` — це шаблонний синтаксис GitHub Actions, але `{{` у Rego починає
# string interpolation. Збираємо очікувані рядки з фрагментів, як це зроблено в
# check-ga.mjs, щоб і Rego-парсер, і людина-читач не плуталися.
expected_concurrency_group := concat("", ["$", "{{ github.ref }}-$", "{{ github.workflow }}"])

expected_github_token := concat("", ["$", "{{ github.token }}"])

expected_name := "Clean action for removing completed workflow runs"

expected_cron := "0 1 16 * *"

# --- name --------------------------------------------------------------------

deny contains msg if {
	input.name != expected_name
	msg := sprintf("clean-ga-workflows.yml: name має бути %q (ga.mdc)", [expected_name])
}

# --- on.schedule.cron --------------------------------------------------------

deny contains msg if {
	not has_expected_cron
	msg := sprintf("clean-ga-workflows.yml: on.schedule має містити cron: '%s' (ga.mdc)", [expected_cron])
}

has_expected_cron if {
	gha_on.schedule[_].cron == expected_cron
}

# --- on.workflow_dispatch ----------------------------------------------------

deny contains msg if {
	not has_workflow_dispatch
	msg := "clean-ga-workflows.yml: має бути workflow_dispatch: {} (ga.mdc)"
}

has_workflow_dispatch if {
	is_object(gha_on.workflow_dispatch)
}

# --- concurrency -------------------------------------------------------------

deny contains msg if {
	not is_object(input.concurrency)
	msg := sprintf(
		"clean-ga-workflows.yml: відсутня секція concurrency — додай concurrency.group: %s і cancel-in-progress: true (ga.mdc)",
		[expected_concurrency_group],
	)
}

deny contains msg if {
	is_object(input.concurrency)
	input.concurrency.group != expected_concurrency_group
	msg := sprintf("clean-ga-workflows.yml: concurrency.group має бути %s (ga.mdc)", [expected_concurrency_group])
}

deny contains msg if {
	is_object(input.concurrency)
	input.concurrency["cancel-in-progress"] != true
	msg := "clean-ga-workflows.yml: concurrency.cancel-in-progress має бути true (ga.mdc)"
}

# --- jobs.cleanup_old_workflows ---------------------------------------------

deny contains msg if {
	not input.jobs.cleanup_old_workflows
	msg := "clean-ga-workflows.yml: jobs.cleanup_old_workflows відсутній (ga.mdc)"
}

deny contains msg if {
	job := input.jobs.cleanup_old_workflows
	job["runs-on"] != "ubuntu-latest"
	msg := "clean-ga-workflows.yml: runs-on має бути ubuntu-latest (ga.mdc)"
}

deny contains msg if {
	perms := input.jobs.cleanup_old_workflows.permissions
	not actions_write_contents_read(perms)
	msg := "clean-ga-workflows.yml: permissions мають бути actions: write, contents: read (ga.mdc)"
}

actions_write_contents_read(perms) if {
	perms.actions == "write"
	perms.contents == "read"
}

# --- jobs.cleanup_old_workflows.steps[0] ------------------------------------

step0 := input.jobs.cleanup_old_workflows.steps[0]

deny contains msg if {
	step0.name != "Delete workflow runs"
	msg := "clean-ga-workflows.yml: перший крок має мати name: Delete workflow runs (ga.mdc)"
}

deny contains msg if {
	step0.uses != "dmvict/clean-workflow-runs@v1"
	msg := "clean-ga-workflows.yml: перший крок має uses: dmvict/clean-workflow-runs@v1 (ga.mdc)"
}

# Триплет полів `with`: token (gh-токен), save_period=31, save_min_runs_number=0.
# В JS-перевірці помилка спільна для всіх трьох — лишаємо такий самий формат, щоб
# повідомлення збігалися. Окремі правила нижче роблять діагноз точнішим.
deny contains msg if {
	not step0_with_canonical
	msg := "clean-ga-workflows.yml: with має містити token/save_period/save_min_runs_number як у ga.mdc"
}

step0_with_canonical if {
	step0.with.token == expected_github_token
	step0.with.save_period == 31
	step0.with.save_min_runs_number == 0
}
