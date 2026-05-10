# Порт перевірки `httpRouteHasuraCanonViolation` з `npm/scripts/check-k8s.mjs`
# (k8s.mdc): HTTPRoute, що сусідствує з Hasura-Deployment з тим самим
# `metadata.name`, має містити канон з 4 правил у такому порядку:
#
#  1. Exact `<prefix>/ql` → RequestRedirect ReplaceFullPath `<prefix>/ql/console` 302
#  2. Exact `<prefix>/ql/` → таке саме перенаправлення
#  3. PathPrefix `<prefix>/ql` → URLRewrite ReplacePrefixMatch `/`, один backendRef
#  4. WebSocket: PathPrefix `<prefix>/ql` + header `Upgrade: websocket` →
#     URLRewrite ReplacePrefixMatch `/` + RequestHeaderModifier `remove: [Authorization]`,
#     той самий backendRef
#
# Додаткові правила поверх канону дозволені — їх просто пропускаємо при пошуку.
#
# Запуск (локально, лише для HTTPRoute, парного з Hasura-Deployment):
#   conftest test path/to/k8s/.../hr.yaml -p npm/policy/k8s/hasura_httproute \
#     --namespace k8s.hasura_httproute
#
# Прив'язка Deployment-HTTPRoute (cross-file) — у JS (`validateHasuraHttpRouteCanon`,
# `collectHasuraDeploymentsAndHttpRoutes`); JS викликає conftest з цією
# намеспейс лише для відповідних HTTPRoute. JS authoritative.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`.
package k8s.hasura_httproute

import rego.v1

rule1_missing_msg := concat(" ", [
	"не знайдено правило 1 Hasura-канона:",
	"Exact \"<prefix>/ql\" + RequestRedirect ReplaceFullPath",
	"\"<prefix>/ql/console\" statusCode 302 (k8s.mdc)",
])

rule1_filters_template := concat(" ", [
	"правило 1 Hasura-канона (rules[%d], prefix %q):",
	"Exact %q має мати RequestRedirect ReplaceFullPath %q statusCode 302 (k8s.mdc)",
])

rule2_missing_template := concat(" ", [
	"правило 2 Hasura-канона: після правила 1 має бути Exact %q",
	"+ RequestRedirect ReplaceFullPath %q statusCode 302 (k8s.mdc)",
])

rule3_missing_template := concat(" ", [
	"правило 3 Hasura-канона: після правила 2 має бути PathPrefix %q",
	"+ URLRewrite ReplacePrefixMatch \"/\"",
	"+ один backendRef на headless Service (k8s.mdc)",
])

rule4_missing_template := concat(" ", [
	"правило 4 Hasura-канона (WebSocket): після правила 3 має бути PathPrefix %q",
	"+ header \"Upgrade: websocket\" + URLRewrite ReplacePrefixMatch \"/\"",
	"+ RequestHeaderModifier remove [Authorization] + backendRef %q (k8s.mdc)",
])

# ── deny: structural shortcut перевірки до пошуку правила 1 ──────────────

deny contains "HTTPRoute без spec — канон Hasura вимагає 4 правил (k8s.mdc)" if {
	input.kind == "HTTPRoute"
	not is_object(object.get(input, "spec", null))
}

deny contains "spec.rules порожній — канон Hasura вимагає 4 правил у порядку (k8s.mdc)" if {
	input.kind == "HTTPRoute"
	is_object(object.get(input, "spec", null))
	not has_non_empty_rules
}

deny contains rule1_missing_msg if {
	input.kind == "HTTPRoute"
	has_non_empty_rules
	canon_start == null
}

# ── deny: канонічна частина (правила 1-4) ────────────────────────────────

deny contains msg if {
	input.kind == "HTTPRoute"
	canon_outcome.stage == "rule1_filters"
	msg := sprintf(rule1_filters_template, [
		canon_outcome.start_index,
		canon_outcome.prefix,
		canon_outcome.ql_path,
		canon_outcome.console_path,
	])
}

deny contains msg if {
	input.kind == "HTTPRoute"
	canon_outcome.stage == "rule2_missing"
	msg := sprintf(rule2_missing_template, [canon_outcome.ql_slash_path, canon_outcome.console_path])
}

deny contains msg if {
	input.kind == "HTTPRoute"
	canon_outcome.stage == "rule3_missing"
	msg := sprintf(rule3_missing_template, [canon_outcome.ql_path])
}

deny contains msg if {
	input.kind == "HTTPRoute"
	canon_outcome.stage == "rule4_missing"
	msg := sprintf(rule4_missing_template, [canon_outcome.ql_path, canon_outcome.backend_name])
}

# ── helpers ───────────────────────────────────────────────────────────────

has_non_empty_rules if {
	rules := object.get(object.get(input, "spec", {}), "rules", [])
	is_array(rules)
	count(rules) > 0
}

# Перше правило з matches=[{path={type: Exact, value: <prefix>/ql}}] (без headers).
# Повертаємо {prefix, start_index} або null, якщо нема.
default canon_start := null

canon_start := canon_start_candidates[0] if {
	count(canon_start_candidates) > 0
}

canon_start_candidates := [{"prefix": substring(p.value, 0, count(p.value) - 3), "start_index": i} |
	some i, rule in input.spec.rules
	matches := object.get(rule, "matches", [])
	count(matches) == 1
	m := matches[0]
	not m.headers
	p := object.get(m, "path", {})
	p.type == "Exact"
	is_string(p.value)
	endswith(p.value, "/ql")
]

# Стиснений результат канон-перевірки. Повертає об'єкт з полем `stage`:
# "ok" | "rule1_filters" | "rule2_missing" | "rule3_missing" | "rule4_missing".
default canon_outcome := {"stage": "skip"}

canon_outcome := outcome if {
	has_non_empty_rules
	canon_start != null
	prefix := canon_start.prefix
	start_index := canon_start.start_index
	console_path := sprintf("%s/ql/console", [prefix])
	ql_slash_path := sprintf("%s/ql/", [prefix])
	ql_path := sprintf("%s/ql", [prefix])
	outcome := evaluate_canon(prefix, start_index, console_path, ql_slash_path, ql_path)
}

evaluate_canon(prefix, start_index, console_path, ql_slash_path, ql_path) := result if {
	not rule_has_exact_redirect(input.spec.rules[start_index], console_path)
	ctx := canon_ctx(prefix, start_index, console_path, ql_slash_path, ql_path)
	result := object.union(ctx, {"stage": "rule1_filters"})
} else := result if {
	rule_has_exact_redirect(input.spec.rules[start_index], console_path)
	rule2_index(start_index, ql_slash_path, console_path) == -1
	ctx := canon_ctx(prefix, start_index, console_path, ql_slash_path, ql_path)
	result := object.union(ctx, {"stage": "rule2_missing"})
} else := result if {
	rule_has_exact_redirect(input.spec.rules[start_index], console_path)
	i2 := rule2_index(start_index, ql_slash_path, console_path)
	i2 != -1
	rule3_index(i2, ql_path) == -1
	ctx := canon_ctx(prefix, start_index, console_path, ql_slash_path, ql_path)
	result := object.union(ctx, {"stage": "rule3_missing"})
} else := result if {
	rule_has_exact_redirect(input.spec.rules[start_index], console_path)
	i2 := rule2_index(start_index, ql_slash_path, console_path)
	i3 := rule3_index(i2, ql_path)
	i3 != -1
	backend_name := single_backend_name(input.spec.rules[i3])
	rule4_index(i3, ql_path, backend_name) == -1
	result := {
		"stage": "rule4_missing",
		"prefix": prefix,
		"ql_path": ql_path,
		"backend_name": backend_name,
	}
} else := {"stage": "ok"}

canon_ctx(prefix, start_index, console_path, ql_slash_path, ql_path) := {
	"prefix": prefix,
	"start_index": start_index,
	"console_path": console_path,
	"ql_slash_path": ql_slash_path,
	"ql_path": ql_path,
}

# Правило: matches=[{path={type, value}}] без headers.
rule_matches_single_path_no_headers(rule, path_type, path_value) if {
	matches := object.get(rule, "matches", [])
	count(matches) == 1
	m := matches[0]
	not m.headers
	p := object.get(m, "path", {})
	p.type == path_type
	p.value == path_value
}

rule_has_exact_redirect(rule, to_path) if {
	filters := object.get(rule, "filters", [])
	count(filters) == 1
	f := filters[0]
	f.type == "RequestRedirect"
	rr := object.get(f, "requestRedirect", {})
	rr.statusCode == 302
	p := object.get(rr, "path", {})
	p.type == "ReplaceFullPath"
	p.replaceFullPath == to_path
}

# Серед filters є URLRewrite з ReplacePrefixMatch "/".
filters_include_url_rewrite_to_slash(filters) if {
	some f in filters
	f.type == "URLRewrite"
	rw := object.get(f, "urlRewrite", {})
	p := object.get(rw, "path", {})
	p.type == "ReplacePrefixMatch"
	p.replacePrefixMatch == "/"
}

# Серед filters є RequestHeaderModifier з remove=[Authorization].
filters_remove_authorization(filters) if {
	some f in filters
	f.type == "RequestHeaderModifier"
	mod := object.get(f, "requestHeaderModifier", {})
	remove := object.get(mod, "remove", [])
	count(remove) == 1
	remove[0] == "Authorization"
}

default single_backend_name(_) := ""

single_backend_name(rule) := refs[0].name if {
	refs := object.get(rule, "backendRefs", [])
	count(refs) == 1
	is_string(refs[0].name)
}

# Шукаємо індекс правила 2 (після `from`); -1 якщо немає.
default rule2_index(_, _, _) := -1

rule2_index(from, ql_slash_path, console_path) := indices[0] if {
	indices := [i |
		some i, rule in input.spec.rules
		i > from
		rule_matches_single_path_no_headers(rule, "Exact", ql_slash_path)
		rule_has_exact_redirect(rule, console_path)
	]
	count(indices) > 0
}

# Шукаємо індекс правила 3 (після `from`); -1 якщо немає.
default rule3_index(_, _) := -1

rule3_index(from, ql_path) := indices[0] if {
	indices := [i |
		some i, rule in input.spec.rules
		i > from
		rule_matches_single_path_no_headers(rule, "PathPrefix", ql_path)
		filters := object.get(rule, "filters", [])
		count(filters) == 1
		filters_include_url_rewrite_to_slash(filters)
		single_backend_name(rule) != ""
	]
	count(indices) > 0
}

# Шукаємо індекс правила 4 (WebSocket) (після `from`); -1 якщо немає.
default rule4_index(_, _, _) := -1

rule4_index(from, ql_path, backend_name) := indices[0] if {
	indices := [i |
		some i, rule in input.spec.rules
		i > from
		is_websocket_rule(rule, ql_path)
		single_backend_name(rule) == backend_name
	]
	count(indices) > 0
}

is_websocket_rule(rule, ql_path) if {
	matches := object.get(rule, "matches", [])
	count(matches) == 1
	m := matches[0]
	p := object.get(m, "path", {})
	p.type == "PathPrefix"
	p.value == ql_path
	headers := object.get(m, "headers", [])
	count(headers) == 1
	h := headers[0]
	h.type == "Exact"
	h.name == "Upgrade"
	h.value == "websocket"
	filters := object.get(rule, "filters", [])
	count(filters) == 2
	filters_include_url_rewrite_to_slash(filters)
	filters_remove_authorization(filters)
}
