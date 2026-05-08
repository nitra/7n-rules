# Порт перевірки `validateCleanGaWorkflows` з `npm/scripts/check-ga.mjs` (ga.mdc).
#
# Запуск (локально):
#   conftest test .github/workflows/clean-ga-workflows.yml \
#     -p npm/policy/ga --namespace ga.clean_ga_workflows
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
#
# Усі `deny`-правила йдуть контигно (regal: messy-rule); helpers і константи —
# секціями вище та нижче.
package ga.clean_ga_workflows

import rego.v1

# ── Очікувані значення ─────────────────────────────────────────────────────
#
# `${{ … }}` — шаблонний синтаксис GitHub Actions; `{{` у Rego починає string
# interpolation. Збираємо очікувані рядки з фрагментів через `concat`, як це
# зроблено в check-ga.mjs, щоб і Rego-парсер, і людина-читач не плуталися.

expected_github_token := concat("", ["$", "{{ github.token }}"])

expected_name := "Clean action for removing completed workflow runs"

expected_cron := "0 1 16 * *"

# ── Аліаси на input ────────────────────────────────────────────────────────
#
# GHA YAML quirk: ключ `on:` — YAML 1.1 boolean `true`, конфтест серіалізує його
# як рядковий ключ "true". Ані `input.on`, ані `input["on"]`, ані `input[true]`
# не працюють — лише `input["true"]`.

gha_on := input["true"]

step0 := input.jobs.cleanup_old_workflows.steps[0]

# ── deny rules (контигно — regal: messy-rule) ──────────────────────────────

deny contains msg if {
	input.name != expected_name
	msg := sprintf("clean-ga-workflows.yml: name має бути %q (ga.mdc)", [expected_name])
}

deny contains msg if {
	not has_expected_cron
	msg := sprintf("clean-ga-workflows.yml: on.schedule має містити cron: '%s' (ga.mdc)", [expected_cron])
}

deny contains msg if {
	not has_workflow_dispatch
	msg := "clean-ga-workflows.yml: має бути workflow_dispatch: {} (ga.mdc)"
}

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
# повідомлення збігалися.
deny contains msg if {
	not step0_with_canonical
	msg := "clean-ga-workflows.yml: with має містити token/save_period/save_min_runs_number як у ga.mdc"
}

# ── helpers ────────────────────────────────────────────────────────────────

has_expected_cron if {
	gha_on.schedule[_].cron == expected_cron
}

has_workflow_dispatch if {
	is_object(gha_on.workflow_dispatch)
}

actions_write_contents_read(perms) if {
	perms.actions == "write"
	perms.contents == "read"
}

step0_with_canonical if {
	step0.with.token == expected_github_token
	step0.with.save_period == 31
	step0.with.save_min_runs_number == 0
}
