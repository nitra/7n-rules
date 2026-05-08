# Порт перевірки `package.json` з `npm/scripts/check-image-compress.mjs`
# (image-compress.mdc).
#
# Запуск (локально):
#   conftest test package.json -p npm/policy/image_compress \
#     --namespace image_compress.package_json
#
# Перевіряє: скрипт `lint-image` викликає `npx @nitra/minify-image` з `--src=.`
# і `--write`, без `--avif` (AVIF — окреме правило); агрегатор `lint` (якщо є)
# містить `bun run lint-image`; `@nitra/minify-image` НЕ в dependencies / devDependencies.
#
# FS-перевірки (`.minify-image-cache.tsv` legacy-файл, `.gitignore` правил для
# `.n-minify-image.tsv`) — у JS.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package image_compress.package_json

import rego.v1

minify_pkg := "@nitra/minify-image"

dep_template := concat(" ", [
	"package.json: %q не повинен бути в %s —",
	"використовуй npx (image-compress.mdc)",
])

avif_in_lint_image_template := concat(" ", [
	"package.json: lint-image не має містити `--avif` —",
	"AVIF-генерацію виконує check image-avif (image-compress.mdc)",
])

# ── deny: lint-image ──────────────────────────────────────────────────────

deny contains msg if {
	scripts := object.get(input, "scripts", {})
	not "lint-image" in object.keys(scripts)
	msg := "package.json: відсутній scripts.lint-image (image-compress.mdc)"
}

deny contains msg if {
	lint_image := object.get(object.get(input, "scripts", {}), "lint-image", "")
	lint_image != ""
	not contains(lint_image, sprintf("npx %s", [minify_pkg]))
	msg := sprintf("package.json: lint-image має викликати `npx %s` (image-compress.mdc)", [minify_pkg])
}

deny contains msg if {
	lint_image := object.get(object.get(input, "scripts", {}), "lint-image", "")
	contains(lint_image, sprintf("npx %s", [minify_pkg]))
	not has_src_flag(lint_image)
	msg := "package.json: lint-image має містити `--src=.` (image-compress.mdc)"
}

deny contains msg if {
	lint_image := object.get(object.get(input, "scripts", {}), "lint-image", "")
	contains(lint_image, sprintf("npx %s", [minify_pkg]))
	not contains(lint_image, "--write")
	msg := "package.json: lint-image має містити `--write` (image-compress.mdc)"
}

deny contains avif_in_lint_image_template if {
	lint_image := object.get(object.get(input, "scripts", {}), "lint-image", "")
	contains(lint_image, "--avif")
}

# ── deny: агрегований `lint` має кликати `bun run lint-image` ─────────────

deny contains msg if {
	"lint-image" in object.keys(object.get(input, "scripts", {}))
	lint := object.get(object.get(input, "scripts", {}), "lint", "")
	lint != ""
	not contains(lint, "bun run lint-image")
	msg := "package.json: агрегований `lint` має містити `bun run lint-image` (image-compress.mdc)"
}

# ── deny: `@nitra/minify-image` НЕ в dependencies/devDependencies ────────

deny contains msg if {
	minify_pkg in object.keys(object.get(input, "dependencies", {}))
	msg := sprintf(dep_template, [minify_pkg, "dependencies"])
}

deny contains msg if {
	minify_pkg in object.keys(object.get(input, "devDependencies", {}))
	msg := sprintf(dep_template, [minify_pkg, "devDependencies"])
}

# ── helpers ────────────────────────────────────────────────────────────────

has_src_flag(s) if contains(s, "--src=.")

has_src_flag(s) if contains(s, "--src .")
