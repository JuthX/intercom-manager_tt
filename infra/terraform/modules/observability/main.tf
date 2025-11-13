terraform {
  required_providers {
    helm = {
      source  = "hashicorp/helm"
      version = ">= 2.12.1"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = ">= 2.24.0"
    }
    grafana = {
      source  = "grafana/grafana"
      version = ">= 2.7.0"
    }
    pagerduty = {
      source  = "PagerDuty/pagerduty"
      version = ">= 2.12.0"
    }
  }
}

resource "kubernetes_namespace" "observability" {
  metadata {
    name = var.namespace
  }
}

resource "helm_release" "kube_prometheus_stack" {
  name       = "kps"
  namespace  = kubernetes_namespace.observability.metadata[0].name
  repository = "https://prometheus-community.github.io/helm-charts"
  chart      = "kube-prometheus-stack"
  version    = var.prometheus_chart_version

  set {
    name  = "grafana.adminPassword"
    value = var.grafana_admin_password
  }

  set {
    name  = "prometheus.prometheusSpec.podMonitorSelectorNilUsesHelmValues"
    value = "false"
  }

  set {
    name  = "grafana.sidecar.datasources.defaultDatasourceEnabled"
    value = "true"
  }
}

resource "grafana_folder" "intercom" {
  count = var.create_dashboards ? 1 : 0
  title = "Intercom Manager"
}

resource "grafana_dashboard" "media_bridge" {
  count   = var.create_dashboards ? 1 : 0
  folder  = grafana_folder.intercom[0].id
  config_json = jsonencode({
    title = "Media Bridge Health"
    panels = [{
      type  = "stat"
      title = "Media bridges online"
      targets = [{
        expr = "sum(intercom_media_bridge_health)"
      }]
    }, {
      type  = "graph"
      title = "QoS MOS"
      targets = [{
        expr = "intercom_webrtc_mos_mean"
      }]
    }]
    timezone = "browser"
    refresh  = "30s"
  })
}

resource "grafana_notification_policy" "root" {
  group_by = ["severity"]

  contact_point {
    name = "slack"
  }
}

resource "grafana_contact_point" "slack" {
  name = "slack"
  slack {
    url     = var.slack_webhook_url
    message = "{{ include \"default.message\" . }}"
  }
}

resource "pagerduty_service" "intercom" {
  name                    = var.pagerduty_service_name
  escalation_policy       = data.pagerduty_escalation_policy.default.id
  acknowledgement_timeout = 600
  auto_resolve_timeout    = 14400
}

data "pagerduty_escalation_policy" "default" {
  name = "Default"
}

resource "pagerduty_service_integration" "events_v2" {
  name    = "prometheus"
  service = pagerduty_service.intercom.id
  type    = "events_api_v2_inbound_integration"
  integration_key = var.pagerduty_integration_key
}

output "grafana_folder_id" {
  value       = try(grafana_folder.intercom[0].id, null)
  description = "Folder that contains the default dashboards"
}

output "prometheus_namespace" {
  value       = kubernetes_namespace.observability.metadata[0].name
  description = "Namespace hosting monitoring components"
}

output "pagerduty_service_id" {
  value       = pagerduty_service.intercom.id
  description = "PagerDuty service bound to alerts"
}
