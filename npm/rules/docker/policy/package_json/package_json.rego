# Перевірка `package.json` для docker (docker.mdc).
#
# Запуск (локально):
#   conftest test package.json -p npm/policy/docker/package_json \
#     --namespace docker.package_json
#
# Canonical (docker.mdc): якщо у проєкті є правило `docker` (у `.n-cursor.json`),
# у кореневому `package.json` має бути канонічний `scripts.lint-docker`.
#
# Цей пакет перевіряє ЛИШЕ зміст значення `scripts.lint-docker`, якщо ключ
# присутній. Умовну обовʼязковість (правило `docker` у `.n-cursor.json` →
# `scripts.lint-docker` ЗОБОВ'ЯЗАНИЙ існувати) перевіряє `check-bun.mjs` через
# cross-file логіку (читає `.n-cursor.json` і `package.json`). Тут rego видно
# лише один документ, тому без `.n-cursor.json`-контексту вимагати наявність
# `scripts.lint-docker` означало б false-positive порушення для проєктів без docker.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
package docker.package_json

import rego.v1

canonical_lint_docker := "n-cursor lint-docker"

lint_docker_template := concat(" ", [
	"package.json: scripts.lint-docker має бути %q",
	"(зараз: %q) (docker.mdc)",
])

deny contains msg if {
	scripts := object.get(input, "scripts", {})
	lint_docker := object.get(scripts, "lint-docker", "")
	lint_docker != ""
	trim_space(lint_docker) != canonical_lint_docker
	msg := sprintf(lint_docker_template, [canonical_lint_docker, lint_docker])
}
