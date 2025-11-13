variable "observability_namespace" {
  description = "Namespace for observability stack"
  type        = string
  default     = "observability"
}

variable "grafana_admin_password" {
  description = "Grafana admin password"
  type        = string
  sensitive   = true
}

variable "pagerduty_service_name" {
  description = "PagerDuty service name"
  type        = string
  default     = "intercom-manager"
}

variable "pagerduty_integration_key" {
  description = "PagerDuty integration key"
  type        = string
  sensitive   = true
}

variable "slack_webhook_url" {
  description = "Slack webhook URL"
  type        = string
  sensitive   = true
}
