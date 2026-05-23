# Порт перевірки версій з `package.json` для Vue+Vite пакетів з
# `npm/scripts/rules/vue/fix.mjs` (vue.mdc).
#
# Запуск (локально, у Vue+Vite-пакеті):
#   conftest test path/to/package.json -p npm/policy/vue \
#     --namespace vue.package_json
#
# Перевіряє: якщо в `dependencies` є `vue`, то потрібні канонічні Vue/Vite
# залежності, `devDependencies.vite` має бути мажорної версії ≥ 8, а `esbuild`
# (міграція на rolldown), `vitest` (заміна на Bun Test Runner) і `jsdom`
# (заміна на happy-dom) у dependencies/devDependencies заборонені.
#
# AST-сканування коду (заборона явних value-імпортів `from 'vue'`, заборона
# Node-нативних модулів у `.vue` SFC, перевірка `vite.config` на
# `process.env.npm_lifecycle_event`, vue-macros, auto-import тощо), а також
# FS-перевірки (`src/vite-env.d.ts`, `jsconfig.json` у корені пакета) — у JS.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package vue.package_json

import rego.v1

deny contains msg if {
	uses_vue
	not vite_in_dev_dependencies
	msg := "Vue-пакет: відсутня залежність `vite` у devDependencies (vue.mdc)"
}

deny contains msg if {
	uses_vue
	vite_in_dev_dependencies
	not vite_major_at_least_8
	vite_range := input.devDependencies.vite
	msg := sprintf("Vue-пакет: vite має бути >= 8 (зараз %q) (vue.mdc)", [vite_range])
}

deny contains msg if {
	uses_vue
	not "@vitejs/plugin-vue" in dev_dependency_names
	msg := "Vue-пакет: @vitejs/plugin-vue відсутній у devDependencies (vue.mdc)"
}

deny contains msg if {
	uses_vue
	not "vue-macros" in all_dependency_names
	msg := "Vue-пакет: vue-macros відсутній (vue.mdc)"
}

deny contains msg if {
	uses_vue
	not "unplugin-auto-import" in all_dependency_names
	msg := "Vue-пакет: unplugin-auto-import відсутній (vue.mdc)"
}

deny contains msg if {
	uses_vue
	not "vite-plugin-vue-layouts-next" in all_dependency_names
	msg := "Vue-пакет: vite-plugin-vue-layouts-next відсутній (vue.mdc)"
}

deny contains msg if {
	uses_vue
	"esbuild" in all_dependency_names
	msg := "Vue-пакет: esbuild заборонено — заміни на rolldown і прибери залежність (vue.mdc)"
}

deny contains msg if {
	uses_vue
	"vitest" in all_dependency_names
	msg := "Vue-пакет: vitest заборонено — використовуй Bun Test Runner (`bun test`) і прибери залежність (vue.mdc)"
}

deny contains msg if {
	uses_vue
	"jsdom" in all_dependency_names
	msg := "Vue-пакет: jsdom заборонено — використовуй happy-dom і прибери залежність (vue.mdc)"
}

# ── helpers ────────────────────────────────────────────────────────────────

uses_vue if {
	"vue" in object.keys(object.get(input, "dependencies", {}))
}

dependency_names := {n | some n in object.keys(object.get(input, "dependencies", {}))}

dev_dependency_names := {n | some n in object.keys(object.get(input, "devDependencies", {}))}

all_dependency_names contains n if {
	some n in dependency_names
}

all_dependency_names contains n if {
	some n in dev_dependency_names
}

vite_in_dev_dependencies if {
	"vite" in object.keys(object.get(input, "devDependencies", {}))
}

vite_major_at_least_8 if {
	range := input.devDependencies.vite

	# Перша мажорна цифра з рядка: `^8`, `>=8.0.0`, `8.x` → 8.
	match := regex.find_n(`\d+`, range, 1)
	count(match) > 0
	to_number(match[0]) >= 8
}
