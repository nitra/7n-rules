# Порт перевірок `.github/workflows/npm-publish.yml` з `npm/scripts/check-npm-module.mjs`
# (npm-module.mdc).
#
# Запуск (локально):
#   conftest test .github/workflows/npm-publish.yml -p npm/policy/npm_module \
#     --namespace npm_module.npm_publish_yml
#
# Перевіряє: `on.push.paths` містить glob з `npm/**`, `on.push.branches` містить
# `main`, у jobs є `permissions.id-token: write` (OIDC), є крок з
# `uses: JS-DevTools/npm-publish` і `with.package: npm/package.json`.
#
# Універсальні workflow-перевірки (concurrency, заборонені setup-bun/cache/install,
# shell line-continuation) — у `ga.workflow_common`.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package npm_module.npm_publish_yml

import rego.v1

# YAML 1.1 quirk: ключ `on:` → boolean true → у конфтесті ключ "true".
gha_on := input["true"]

# Шаблон повідомлення про відсутній JS-DevTools/npm-publish крок — через `concat`
# для regal style/line-length.
npm_publish_step_template := concat(" ", [
	"npm-publish.yml: очікується `uses: JS-DevTools/npm-publish`",
	"з `with.package: npm/package.json` (npm-module.mdc)",
])

# ── deny: paths/branches ──────────────────────────────────────────────────

deny contains msg if {
	not push_paths_have_npm_glob
	msg := "npm-publish.yml: у on.push.paths має бути `npm/**` (npm-module.mdc)"
}

deny contains msg if {
	not push_branches_have_main
	msg := "npm-publish.yml: on.push.branches має містити `main` (npm-module.mdc)"
}

# ── deny: id-token: write у permissions хоч одного job ────────────────────

deny contains msg if {
	not any_job_has_id_token_write
	msg := "npm-publish.yml: permissions має містити `id-token: write` (OIDC) (npm-module.mdc)"
}

# ── deny: крок з uses JS-DevTools/npm-publish та with.package ─────────────

deny contains npm_publish_step_template if {
	not has_npm_publish_step
}

# ── helpers ────────────────────────────────────────────────────────────────

push_paths_have_npm_glob if {
	some p in gha_on.push.paths
	is_string(p)
	contains(p, "npm/**")
}

push_branches_have_main if {
	"main" in {b | some b in gha_on.push.branches}
}

any_job_has_id_token_write if {
	some job in object.get(input, "jobs", {})
	job.permissions["id-token"] == "write"
}

has_npm_publish_step if {
	some job in object.get(input, "jobs", {})
	some step in object.get(job, "steps", [])
	contains(object.get(step, "uses", ""), "JS-DevTools/npm-publish")
	step.with.package == "npm/package.json"
}
