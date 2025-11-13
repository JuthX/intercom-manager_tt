variable "namespace" {
  description = "Namespace to deploy the monitoring stack into"
  type        = string
  default     = "observability"
}

variable "prometheus_chart_version" {
  description = "helm chart version for kube-prometheus-stack"
  type        = string
  default     = "65.4.1"
}

variable "grafana_admin_password" {
  description = "Initial Grafana admin password"
  type        = string
  sensitive   = true
}

variable "pagerduty_service_name" {
  description = "PagerDuty service name to bind alerts to"
  type        = string
  default     = "intercom-manager"
}

variable "pagerduty_integration_key" {
  description = "PagerDuty Events API v2 integration key"
  type        = string
  sensitive   = true
}

variable "slack_webhook_url" {
  description = "Slack webhook for alert routing"
  type        = string
  sensitive   = true
}

variable "create_dashboards" {
  description = "Whether to provision default Grafana dashboards"
  type        = bool
  default     = true
}
