# Тести для `k8s.manifest`. Запуск:
#   conftest verify -p npm/policy/k8s/manifest --namespace k8s.manifest
#
# Покриваємо deny-правила: Ingress, autoscaling/v1, Service GCP-анотації,
# Deployment cpu/memory/image (Hasura), topologySpreadConstraints. Тести
# перевіряють як спрацювання правила (count(deny) > 0), так і його відсутність
# для коректного маніфесту.
package k8s.manifest_test

import rego.v1

import data.k8s.manifest

# ── Ingress / autoscaling/v1 ──────────────────────────────────────────────

test_deny_ingress if {
	count(manifest.deny) > 0 with input as {
		"apiVersion": "networking.k8s.io/v1",
		"kind": "Ingress",
		"metadata": {"name": "x"},
	}
}

test_deny_autoscaling_v1 if {
	count(manifest.deny) > 0 with input as {
		"apiVersion": "autoscaling/v1",
		"kind": "HorizontalPodAutoscaler",
		"metadata": {"name": "x"},
	}
}

test_allow_autoscaling_v2 if {
	count(manifest.deny) == 0 with input as {
		"apiVersion": "autoscaling/v2",
		"kind": "HorizontalPodAutoscaler",
		"metadata": {"name": "x"},
	}
}

# ── Service: GCP-анотації ─────────────────────────────────────────────────

test_deny_service_neg_annotation if {
	count(manifest.deny) > 0 with input as {
		"apiVersion": "v1",
		"kind": "Service",
		"metadata": {
			"name": "api",
			"annotations": {"cloud.google.com/neg": "{}"},
		},
	}
}

test_deny_service_backend_config_annotation if {
	count(manifest.deny) > 0 with input as {
		"apiVersion": "v1",
		"kind": "Service",
		"metadata": {
			"name": "api",
			"annotations": {"cloud.google.com/backend-config": "{}"},
		},
	}
}

test_allow_service_clean_annotations if {
	count(manifest.deny) == 0 with input as {
		"apiVersion": "v1",
		"kind": "Service",
		"metadata": {
			"name": "api",
			"namespace": "dev",
			"annotations": {"foo": "bar"},
		},
		"spec": {"type": "ClusterIP"},
	}
}

# ── Deployment: resources.requests.cpu ────────────────────────────────────

test_deny_deployment_missing_cpu if {
	count(manifest.deny) > 0 with input as {
		"apiVersion": "apps/v1",
		"kind": "Deployment",
		"metadata": {"name": "api", "namespace": "dev"},
		"spec": {
			"selector": {"matchLabels": {"app": "api"}},
			"template": {"spec": {"containers": [{
				"name": "main",
				"image": "registry.example.com/api:1.0",
				"resources": {"requests": {"memory": "64Mi"}},
			}]}},
		},
	}
}

test_deny_deployment_empty_cpu if {
	count(manifest.deny) > 0 with input as {
		"apiVersion": "apps/v1",
		"kind": "Deployment",
		"metadata": {"name": "api", "namespace": "dev"},
		"spec": {
			"selector": {"matchLabels": {"app": "api"}},
			"template": {"spec": {"containers": [{
				"name": "main",
				"image": "registry.example.com/api:1.0",
				"resources": {"requests": {"cpu": "", "memory": "64Mi"}},
			}]}},
		},
	}
}

# ── Deployment: resources.requests.memory ─────────────────────────────────

test_deny_deployment_missing_memory if {
	count(manifest.deny) > 0 with input as {
		"apiVersion": "apps/v1",
		"kind": "Deployment",
		"metadata": {"name": "api", "namespace": "dev"},
		"spec": {
			"selector": {"matchLabels": {"app": "api"}},
			"template": {"spec": {"containers": [{
				"name": "main",
				"image": "registry.example.com/api:1.0",
				"resources": {"requests": {"cpu": "100m"}},
			}]}},
		},
	}
}

test_deny_deployment_empty_memory if {
	count(manifest.deny) > 0 with input as {
		"apiVersion": "apps/v1",
		"kind": "Deployment",
		"metadata": {"name": "api", "namespace": "dev"},
		"spec": {
			"selector": {"matchLabels": {"app": "api"}},
			"template": {"spec": {"containers": [{
				"name": "main",
				"image": "registry.example.com/api:1.0",
				"resources": {"requests": {"cpu": "100m", "memory": ""}},
			}]}},
		},
	}
}

test_deny_init_container_missing_resources if {
	count(manifest.deny) > 0 with input as {
		"apiVersion": "apps/v1",
		"kind": "Deployment",
		"metadata": {"name": "api", "namespace": "dev"},
		"spec": {
			"selector": {"matchLabels": {"app": "api"}},
			"template": {"spec": {
				"containers": [{
					"name": "main",
					"image": "registry.example.com/api:1.0",
					"resources": {"requests": {"cpu": "100m", "memory": "64Mi"}},
				}],
				"initContainers": [{"name": "wait", "image": "busybox:1"}],
			}},
		},
	}
}

# ── Deployment: образ hasura/graphql-engine ──────────────────────────────

test_deny_deployment_hasura_unpinned_image if {
	count(manifest.deny) > 0 with input as {
		"apiVersion": "apps/v1",
		"kind": "Deployment",
		"metadata": {"name": "db-h", "namespace": "dev"},
		"spec": {
			"selector": {"matchLabels": {"app": "db-h"}},
			"template": {"spec": {"containers": [{
				"name": "graphql-engine",
				"image": "hasura/graphql-engine:latest",
				"resources": {"requests": {"cpu": "100m", "memory": "64Mi"}},
			}]}},
		},
	}
}

test_allow_deployment_hasura_canonical_image if {
	count(manifest.deny) == 0 with input as {
		"apiVersion": "apps/v1",
		"kind": "Deployment",
		"metadata": {"name": "db-h", "namespace": "dev"},
		"spec": {
			"strategy": {
				"type": "RollingUpdate",
				"rollingUpdate": {"maxUnavailable": 0, "maxSurge": 1},
			},
			"selector": {"matchLabels": {"app": "db-h"}},
			"template": {"spec": {
				"containers": [{
					"name": "graphql-engine",
					"image": "hasura/graphql-engine:v2.49.0.ubuntu.amd64",
					"resources": {"requests": {"cpu": "100m", "memory": "64Mi"}},
				}],
				"topologySpreadConstraints": [{
					"maxSkew": 1,
					"topologyKey": "kubernetes.io/hostname",
					"whenUnsatisfiable": "ScheduleAnyway",
					"labelSelector": {"matchLabels": {"app": "db-h"}},
				}],
			}},
		},
	}
}

test_allow_deployment_hasura_canonical_image_with_digest if {
	count(manifest.deny) == 0 with input as {
		"apiVersion": "apps/v1",
		"kind": "Deployment",
		"metadata": {"name": "db-h", "namespace": "dev"},
		"spec": {
			"strategy": {
				"type": "RollingUpdate",
				"rollingUpdate": {"maxUnavailable": 0, "maxSurge": 1},
			},
			"selector": {"matchLabels": {"app": "db-h"}},
			"template": {"spec": {
				"containers": [{
					"name": "graphql-engine",
					"image": "docker.io/hasura/graphql-engine:v2.49.0.ubuntu.amd64@sha256:0000",
					"resources": {"requests": {"cpu": "100m", "memory": "64Mi"}},
				}],
				"topologySpreadConstraints": [{
					"maxSkew": 1,
					"topologyKey": "kubernetes.io/hostname",
					"whenUnsatisfiable": "ScheduleAnyway",
					"labelSelector": {"matchLabels": {"app": "db-h"}},
				}],
			}},
		},
	}
}

# ── Deployment: rollout strategy ─────────────────────────────────────────

test_deny_deployment_missing_rollout_strategy if {
	some msg in manifest.deny with input as {
		"apiVersion": "apps/v1",
		"kind": "Deployment",
		"metadata": {"name": "api", "namespace": "dev"},
		"spec": {
			"selector": {"matchLabels": {"app": "api"}},
			"template": {"spec": {
				"containers": [{
					"name": "main",
					"image": "registry.example.com/api:1.0",
					"resources": {"requests": {"cpu": "100m", "memory": "64Mi"}},
				}],
				"topologySpreadConstraints": [{
					"maxSkew": 1,
					"topologyKey": "kubernetes.io/hostname",
					"whenUnsatisfiable": "ScheduleAnyway",
					"labelSelector": {"matchLabels": {"app": "api"}},
				}],
			}},
		},
	}
	contains(msg, "spec.strategy")
}

test_deny_deployment_wrong_rollout_strategy if {
	some msg in manifest.deny with input as {
		"apiVersion": "apps/v1",
		"kind": "Deployment",
		"metadata": {"name": "api", "namespace": "dev"},
		"spec": {
			"strategy": {
				"type": "RollingUpdate",
				"rollingUpdate": {"maxUnavailable": 1, "maxSurge": 1},
			},
			"selector": {"matchLabels": {"app": "api"}},
			"template": {"spec": {
				"containers": [{
					"name": "main",
					"image": "registry.example.com/api:1.0",
					"resources": {"requests": {"cpu": "100m", "memory": "64Mi"}},
				}],
				"topologySpreadConstraints": [{
					"maxSkew": 1,
					"topologyKey": "kubernetes.io/hostname",
					"whenUnsatisfiable": "ScheduleAnyway",
					"labelSelector": {"matchLabels": {"app": "api"}},
				}],
			}},
		},
	}
	contains(msg, "maxUnavailable=0")
}

# ── Deployment: topologySpreadConstraints ────────────────────────────────

test_deny_deployment_missing_topology_spread if {
	count(manifest.deny) > 0 with input as {
		"apiVersion": "apps/v1",
		"kind": "Deployment",
		"metadata": {"name": "api", "namespace": "dev"},
		"spec": {
			"selector": {"matchLabels": {"app": "api"}},
			"template": {"spec": {"containers": [{
				"name": "main",
				"image": "registry.example.com/api:1.0",
				"resources": {"requests": {"cpu": "100m", "memory": "64Mi"}},
			}]}},
		},
	}
}

test_deny_deployment_topology_spread_wrong_app_label if {
	count(manifest.deny) > 0 with input as {
		"apiVersion": "apps/v1",
		"kind": "Deployment",
		"metadata": {"name": "api", "namespace": "dev"},
		"spec": {
			"selector": {"matchLabels": {"app": "api"}},
			"template": {"spec": {
				"containers": [{
					"name": "main",
					"image": "registry.example.com/api:1.0",
					"resources": {"requests": {"cpu": "100m", "memory": "64Mi"}},
				}],
				"topologySpreadConstraints": [{
					"maxSkew": 1,
					"topologyKey": "kubernetes.io/hostname",
					"whenUnsatisfiable": "ScheduleAnyway",
					"labelSelector": {"matchLabels": {"app": "wrong"}},
				}],
			}},
		},
	}
}

test_allow_deployment_canonical_topology_spread if {
	count(manifest.deny) == 0 with input as {
		"apiVersion": "apps/v1",
		"kind": "Deployment",
		"metadata": {"name": "api", "namespace": "dev"},
		"spec": {
			"strategy": {
				"type": "RollingUpdate",
				"rollingUpdate": {"maxUnavailable": 0, "maxSurge": 1},
			},
			"selector": {"matchLabels": {"app": "api"}},
			"template": {"spec": {
				"containers": [{
					"name": "main",
					"image": "registry.example.com/api:1.0",
					"resources": {"requests": {"cpu": "100m", "memory": "64Mi"}},
				}],
				"topologySpreadConstraints": [{
					"maxSkew": 1,
					"topologyKey": "kubernetes.io/hostname",
					"whenUnsatisfiable": "ScheduleAnyway",
					"labelSelector": {"matchLabels": {"app": "api"}},
				}],
			}},
		},
	}
}

# Без app-мітки топологічна перевірка не запускається — JS-парність
# (k8sEnvSegmentFromRelPath без appLabel skipує перевірку).
test_allow_deployment_without_app_label_skips_topology if {
	count(manifest.deny) == 0 with input as {
		"apiVersion": "apps/v1",
		"kind": "Deployment",
		"metadata": {"name": "api", "namespace": "dev"},
		"spec": {
			"strategy": {
				"type": "RollingUpdate",
				"rollingUpdate": {"maxUnavailable": 0, "maxSurge": 1},
			},
			"template": {"spec": {"containers": [{
				"name": "main",
				"image": "registry.example.com/api:1.0",
				"resources": {"requests": {"cpu": "100m", "memory": "64Mi"}},
			}]}},
		},
	}
}
