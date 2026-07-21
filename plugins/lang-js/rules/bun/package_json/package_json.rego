# Перевірка кореневого `package.json` для bun (bun.mdc).
#
# Канон надходить через --data: { "template": { "deny": ... } }
# Структура --data сформована з template/package.json.deny.json
# (top-level fields заборонені у root).
#
# Логіка, що ЛИШАЄТЬСЯ у rego (inverse-patterns, не виносяться у template):
#  - `devDependencies` лише `@nitra/*` + root-only тестові peer/tools для `@7n/test coverage`
#    (правило `test` enabled завжди — див. `test/auto.md`; published workspace-и не мають
#     `devDependencies` за `npm-module.mdc`)
#  - `@vitest/browser`/`playwright`/`@storybook/addon-vitest` (browser-mode provider +
#    `storybookTest`-плагін для named vitest project "storybook", лише chromium — канон
#    Storybook кластер 5) теж root-only test peers: той самий vitest.config, що й
#    `unit`-проект, живе в корені монорепо-споживача. Storybook-специфічні
#    identity-пакети (`storybook`, `@storybook/vue3*`, `msw*`) НЕ сюди — вони живуть у
#    `npm/package.json` (канон Storybook кластер 7, `npm-module.mdc`), бо
#    `isStorybookRoot()` @7n/test читає саме той файл, не кореневий package.json.
#    `@storybook/addon-vitest` — виняток із цього правила: це test-tooling (плагін
#    vitest-конфіга), а не Storybook-identity-маркер, тож root, а не npm/package.json.
#
# Перевірки, які потребують FS / cross-file контексту, лишаються у JS.
package bun.package_json

import rego.v1

# ── deny: заборонені top-level поля (template-driven) ─────────────────────

# Сентинельний value відрізняє «поле відсутнє» від «поле є з будь-яким значенням»
# (наприклад `dependencies: {}` — присутнє але порожнє → теж заборонено).
deny contains msg if {
	some field, reason in data.template.deny
	object.get(input, field, "__bun_missing__") != "__bun_missing__"
	msg := sprintf("package.json: поле %s — %s", [field, reason])
}

# ── deny: scripts.lint / scripts.lint-* заборонені (bun.mdc lint) ────────

deny contains msg if {
	is_object(input.scripts)
	some script_name, _ in input.scripts
	regex.match(`^lint(-.*)?$`, script_name)
	msg := sprintf(
		"package.json: scripts.%s заборонений — лінт запускається через n-rules lint, не через package.json-скрипти (bun.mdc)",
		[script_name],
	)
}

# ── deny: devDependencies — лише `@nitra/*`/`@7n/*` + root-only тестові peer/tools ─

deny contains msg if {
	is_object(input.devDependencies)
	some name, _ in input.devDependencies
	not allowed_root_dev_dependency(name)
	msg := sprintf("Кореневі devDependencies: дозволені лише @nitra/*/@7n/* або root-only test peers — прибери або перенеси: %s (bun.mdc)", [name])
}

# ── helpers ────────────────────────────────────────────────────────────────

# @stryker-mutator/core — обов'язковий exact-pin peer vitest-runner@9+ (раніше тягнувся транзитивно)
# @7n/test — оркестратор `coverage` (npx @7n/test coverage); devDependency, щоб npx резолвив
# локально без мережевого fetch щоразу.
# @vitest/browser + playwright — провайдер browser-mode для named vitest project
# "storybook" (канон Storybook кластер 5: лише chromium, PR — швидкий
# --project=storybook). `playwright` (не `@playwright/test`) — сирий driver, який
# @vitest/browser використовує як provider; `@playwright/test` лишається окремо для
# змістовних E2E-сценаріїв (n-vue.mdc).
# @storybook/addon-vitest — постачає `storybookTest` для vitest-плагіна в канонічному
# vitest.config named-проекту "storybook" (той самий канон Storybook кластер 5); версія
# з лінійки Storybook 9.x (узгоджена з `storybook`@9.1.10, запіненим у
# npm_package_json.rego) — allowlist тут за іменем, точний пінінг версії root-tooling
# не робимо (на відміну від Storybook-identity-пакетів у npm/package.json).
allowed_root_test_deps := {
	"vitest",
	"@vitest/coverage-v8",
	"@vitest/browser",
	"@stryker-mutator/vitest-runner",
	"@stryker-mutator/core",
	"@playwright/test",
	"playwright",
	"@storybook/addon-vitest",
	"@7n/test",
}

allowed_root_dev_dependency(name) if {
	startswith(name, "@nitra/")
} else if {
	startswith(name, "@7n/")
} else if {
	# Vitest/Stryker peer/tools + @7n/test (`coverage`) для `@7n/test coverage` живуть у корені
	# будь-якого монорепо-споживача: правило `test` enabled завжди, а published workspace-и
	# не мають `devDependencies` (`npm-module.mdc`).
	name in allowed_root_test_deps
}
