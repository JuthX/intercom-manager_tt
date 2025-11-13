module "observability" {
  source                   = "./modules/observability"
  namespace                = var.observability_namespace
  grafana_admin_password   = var.grafana_admin_password
  pagerduty_service_name   = var.pagerduty_service_name
  pagerduty_integration_key = var.pagerduty_integration_key
  slack_webhook_url        = var.slack_webhook_url
}
