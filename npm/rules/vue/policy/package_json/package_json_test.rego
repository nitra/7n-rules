package vue.package_json_test

import data.vue.package_json
import rego.v1

valid_vue_package := {
	"dependencies": {"vue": "^3.5.0"},
	"devDependencies": {
		"vite": "^8.0.0",
		"@vitejs/plugin-vue": "^6.0.0",
		"vue-macros": "^3.0.0",
		"unplugin-auto-import": "^20.0.0",
		"vite-plugin-vue-layouts-next": "^1.0.0",
	},
}

test_valid_vue_package if {
	count(package_json.deny) == 0 with input as valid_vue_package
}

test_non_vue_package_is_ignored if {
	count(package_json.deny) == 0 with input as {"devDependencies": {}}
}

test_missing_vue_dependencies if {
	count(package_json.deny) == 4 with input as {
		"dependencies": {"vue": "^3.5.0"},
		"devDependencies": {"vite": "^8.0.0"},
	}
}

test_rejects_esbuild_and_old_vite if {
	count(package_json.deny) == 2 with input as object.union(valid_vue_package, {"devDependencies": object.union(valid_vue_package.devDependencies, {
		"vite": "^7.0.0",
		"esbuild": "^0.25.0",
	})})
}

test_rejects_vitest_and_jsdom if {
	count(package_json.deny) == 2 with input as object.union(valid_vue_package, {"devDependencies": object.union(valid_vue_package.devDependencies, {
		"vitest": "^3.0.0",
		"jsdom": "^25.0.0",
	})})
}

test_non_vue_package_ignores_vitest_and_jsdom if {
	count(package_json.deny) == 0 with input as {"devDependencies": {"vitest": "^3.0.0", "jsdom": "^25.0.0"}}
}
