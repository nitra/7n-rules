# Перевірка `.vscode/extensions.json` для nginx-default-tpl (nginx-default-tpl.mdc).
#
# Викликається з `rules/nginx-default-tpl/fix.mjs` через `runConftestBatch` лише
# ПІСЛЯ того, як JS виявив `default.conf.template` у дереві (умовне правило).
# Глобально без `target.json` поруч (не auto-discoverable через `n-cursor check`).
#
# Canonical: `recommendations` має містити `ahmadalli.vscode-nginx-conf`.
package nginx_default_tpl.vscode_extensions

import rego.v1

deny contains msg if {
	recs := object.get(input, "recommendations", [])
	not "ahmadalli.vscode-nginx-conf" in {r | some r in recs}
	msg := ".vscode/extensions.json: recommendations має містити \"ahmadalli.vscode-nginx-conf\" (nginx-default-tpl.mdc)"
}
