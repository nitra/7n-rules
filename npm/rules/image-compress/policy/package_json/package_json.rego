# Перевірка `package.json` (image-compress.mdc).
#
# Канон надходить через --data: { "template": { "contains": ..., "deny": ... } }
# Структура --data сформована з template/package.json.{contains,deny}.json.
#
# Логіка, що ЛИШАЄТЬСЯ у rego (inverse-patterns, не виносяться у template):
#  - `--avif` ЗАБОРОНЕНИЙ підрядок у `lint-image` (anti-contains);
#  - агрегатор `lint` (якщо `lint-image` присутній) має містити `bun run lint-image`.
package image_compress.package_json

import rego.v1

# ── deny: scripts.<name> має містити кожен substring з template.contains ─

deny contains msg if {
	some script_name, needles in data.template.contains.scripts
	actual := object.get(object.get(input, "scripts", {}), script_name, "")
	some needle in needles
	not contains(actual, needle)
	msg := sprintf("package.json: scripts.%s має містити %q (image-compress.mdc)", [script_name, needle])
}

# ── deny: top-level deps/devDeps з template.deny ─────────────────────────

deny contains msg if {
	some pkg, reason in data.template.deny.dependencies
	pkg in object.keys(object.get(input, "dependencies", {}))
	msg := sprintf("package.json: dependencies.%s — %s", [pkg, reason])
}

deny contains msg if {
	some pkg, reason in data.template.deny.devDependencies
	pkg in object.keys(object.get(input, "devDependencies", {}))
	msg := sprintf("package.json: devDependencies.%s — %s", [pkg, reason])
}

# ── deny: `--avif` заборонений у `lint-image` (anti-contains, у rego) ────

deny contains msg if {
	lint_image := object.get(object.get(input, "scripts", {}), "lint-image", "")
	contains(lint_image, "--avif")
	msg := "package.json: lint-image не має містити `--avif` — AVIF-генерацію виконує check image-avif (image-compress.mdc)"
}

# ── deny: агрегатор `lint` (якщо `lint-image` є) ─────────────────────────

deny contains msg if {
	"lint-image" in object.keys(object.get(input, "scripts", {}))
	lint := object.get(object.get(input, "scripts", {}), "lint", "")
	lint != ""
	not contains(lint, "bun run lint-image")
	msg := "package.json: агрегований `lint` має містити `bun run lint-image` (image-compress.mdc)"
}
