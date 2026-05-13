# Перевірка `.github/workflows/lint-docker.yml` (docker.mdc).
#
# Запуск (локально):
#   conftest test .github/workflows/lint-docker.yml -p npm/policy/docker/lint_docker_yml \
#     --namespace docker.lint_docker_yml
#
# Canonical (docker.mdc):
#   - `on.push.paths` містить glob-и для Dockerfile (`**/Dockerfile`, `**/*.Dockerfile`,
#     `**/*.dockerfile`);
#   - крок `Install hadolint` з URL версії `v2.12.0` (узгоджено з `HADOLINT_IMAGE`
#     у `npm/scripts/utils/docker-hadolint.mjs`);
#   - крок `uses: ./.github/actions/setup-bun-deps` (canonical composite per ga.mdc;
#     прямі `oxen-sh/setup-bun`/`actions/cache`/`bun install` заборонено через
#     `ga.workflow_common`);
#   - крок `run: bun run lint-docker`.
#
# Універсальні workflow-перевірки (concurrency, заборонені setup-bun/cache/install,
# shell line-continuation) — у `ga.workflow_common`.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
package docker.lint_docker_yml

import rego.v1

required_push_paths := {"**/Dockerfile", "**/*.Dockerfile", "**/*.dockerfile"}
required_hadolint_version := "v2.12.0"
canonical_setup_bun_action := "./.github/actions/setup-bun-deps"

# Усі тексти `uses:` зі steps усіх jobs (incremental set rule per regal:
# prefer-set-or-object-rule — це краще за comprehension).
all_step_uses contains u if {
	some job in object.get(input, "jobs", {})
	some step in object.get(job, "steps", [])
	u := object.get(step, "uses", "")
	u != ""
}

all_run_text := concat("\n", [run_text |
	some job in object.get(input, "jobs", {})
	some step in object.get(job, "steps", [])
	run_text := step_run_to_text(step)
])

# Множина значень `on.push.paths` (підтримує `on: { push: { paths: [...] } }`).
push_paths_set := {p |
	some p in object.get(object.get(object.get(input, "on", {}), "push", {}), "paths", [])
}

# ── deny: on.push.paths ──────────────────────────────────────────────────

deny contains msg if {
	some required in required_push_paths
	not required in push_paths_set
	msg := sprintf("lint-docker.yml: on.push.paths має містити %q (docker.mdc)", [required])
}

# ── deny: hadolint install version ───────────────────────────────────────

deny contains msg if {
	not contains(all_run_text, required_hadolint_version)
	msg := sprintf(
		"lint-docker.yml: крок hadolint install має містити версію %q (узгоджено з HADOLINT_IMAGE) (docker.mdc)",
		[required_hadolint_version],
	)
}

# ── deny: setup-bun-deps composite ───────────────────────────────────────

deny contains msg if {
	not canonical_setup_bun_action in all_step_uses
	msg := concat(" ", [
		"lint-docker.yml: відсутній крок",
		"`uses: ./.github/actions/setup-bun-deps` (canonical composite per ga.mdc) (docker.mdc)",
	])
}

# ── deny: bun run lint-docker ────────────────────────────────────────────

deny contains msg if {
	not contains(all_run_text, "bun run lint-docker")
	msg := "lint-docker.yml: жоден крок run не містить `bun run lint-docker` (docker.mdc)"
}

# ── helpers ──────────────────────────────────────────────────────────────

# Текст `run:` як один рядок: підтримує string і array форми (YAML).
step_run_to_text(step) := step.run if is_string(step.run)

else := concat("\n", [s | some s in step.run]) if is_array(step.run)

else := ""
