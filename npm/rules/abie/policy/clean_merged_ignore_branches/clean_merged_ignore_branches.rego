# Порт перевірки `parseCleanMergedIgnoreBranches` + `ignoreBranchesIncludesRequired`
# з `npm/scripts/check-abie.mjs` (abie.mdc): у workflow
# `.github/workflows/clean-merged-branch.yml` крок з
# `uses: phpdocker-io/github-actions-delete-abandoned-branches` має у
# `with.ignore_branches` містити усі обовʼязкові токени `dev,ua`
# (case-insensitive, кома-розділені).
#
# Запуск (локально):
#   conftest test .github/workflows/clean-merged-branch.yml \
#     -p npm/policy/abie/clean_merged_ignore_branches \
#     --namespace abie.clean_merged_ignore_branches
#
# JS authoritative (`check-abie.mjs`: `checkCleanMergedBranch`,
# `parseCleanMergedIgnoreBranches`, `ignoreBranchesIncludesRequired`); ця Rego —
# швидкий gate для одиничного workflow YAML. Cross-file гейтинг (правило
# `abie` у `.n-cursor.json`) — у JS.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package abie.clean_merged_ignore_branches

import rego.v1

# Обовʼязкові гілки в `ignore_branches` (узгоджено з `ABIE_REQUIRED_IGNORE_BRANCHES`).
required_branches := {"dev", "ua"}

# Префікс `uses:` для GitHub Action, у якого читаємо `with.ignore_branches`.
target_action_marker := "phpdocker-io/github-actions-delete-abandoned-branches"

step_missing_msg := concat(" ", [
	"clean-merged-branch.yml: не знайдено крок з uses: phpdocker-io/github-actions-delete-abandoned-branches",
	"(abie.mdc)",
])

ignore_branches_missing_msg := concat(" ", [
	"clean-merged-branch.yml: не знайдено with.ignore_branches у кроці",
	"phpdocker-io/github-actions-delete-abandoned-branches (abie.mdc)",
])

# ── deny: крок не знайдено ────────────────────────────────────────────────

deny contains step_missing_msg if {
	count(target_steps) == 0
}

# ── deny: з step нема with.ignore_branches ────────────────────────────────

deny contains ignore_branches_missing_msg if {
	count(target_steps) > 0
	not has_ignore_branches_value
}

# ── deny: ignore_branches не містить усіх обов'язкових токенів ────────────

deny contains msg if {
	count(target_steps) > 0
	ignore_branches_value != ""
	missing := required_branches - parsed_ignore_tokens(ignore_branches_value)
	count(missing) > 0
	msg := sprintf(
		"clean-merged-branch.yml: ignore_branches має містити %v (зараз: %q; не вистачає: %v) (abie.mdc)",
		[concat(",", sort(required_branches)), ignore_branches_value, concat(",", sort(missing))],
	)
}

# ── helpers ───────────────────────────────────────────────────────────────

# Усі steps з усіх jobs у workflow (підтримує jobs.<job>.steps[]).
target_steps contains step if {
	some job in object.get(input, "jobs", {})
	some step in object.get(job, "steps", [])
	uses := object.get(step, "uses", "")
	is_string(uses)
	contains(uses, target_action_marker)
}

# Чи у знайдених steps хоча б у одного є with.ignore_branches непорожнім рядком.
has_ignore_branches_value if {
	some step in target_steps
	v := object.get(object.get(step, "with", {}), "ignore_branches", null)
	is_string(v)
}

default ignore_branches_value := ""

ignore_branches_value := values[0] if {
	values := [v |
		some step in target_steps
		v := object.get(object.get(step, "with", {}), "ignore_branches", null)
		is_string(v)
	]
	count(values) > 0
}

# Розбирає `ignore_branches` як `,`-розділений список, нормалізує через trim+lower.
parsed_ignore_tokens(value) := {lower(trim_space(part)) |
	some part in split(value, ",")
	trim_space(part) != ""
}
