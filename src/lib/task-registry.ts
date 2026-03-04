/**
 * OC (Ollama Churns) task type registry.
 * Maps task_type strings → execution config used by the task runner.
 */

export interface TaskTypeConfig {
  task_type: string;
  description: string;
  cadence: "15min" | "hourly" | "daily" | "nightly" | "weekly";
  model: string;
  prompt_file: string;          // filename in prompts/ dir
  required_tools: string[];     // tools the runner calls to gather input
  output_path: string;          // template: {service}, {date} interpolated by runner
  requires_service: boolean;
  per_service: boolean;
}

export const TASK_REGISTRY: Record<string, TaskTypeConfig> = {
  code_review: {
    task_type: "code_review",
    description: "Review recent code changes for bugs, security issues, and dead code",
    cadence: "nightly",
    model: "qwen3:4b",
    prompt_file: "code_review.md",
    required_tools: ["git_diff", "git_log"],
    output_path: "results/code-review/{service}.md",
    requires_service: true,
    per_service: true,
  },
  log_digest: {
    task_type: "log_digest",
    description: "Summarize recent PM2 logs for anomalies and patterns",
    cadence: "hourly",
    model: "qwen3:4b",
    prompt_file: "log_digest.md",
    required_tools: ["service_logs"],
    output_path: "results/log-digests/{service}.md",
    requires_service: true,
    per_service: true,
  },
  archive_normalize: {
    task_type: "archive_normalize",
    description: "Normalize archived tickets/patches into clean training records",
    cadence: "daily",
    model: "qwen3:4b",
    prompt_file: "archive_normalize.md",
    required_tools: ["export_training_data"],
    output_path: "results/archive-normalized/{date}.jsonl",
    requires_service: false,
    per_service: false,
  },
  gap_detect: {
    task_type: "gap_detect",
    description: "Scan hobby_bot logs for missing data collection intervals",
    cadence: "daily",
    model: "qwen3:4b",
    prompt_file: "gap_detect.md",
    required_tools: ["service_logs", "search_logs"],
    output_path: "results/gap-report.md",
    requires_service: false,
    per_service: false,
  },
  ticket_enrich: {
    task_type: "ticket_enrich",
    description: "Suggest tags, failure_class, and severity for new OC tasks",
    cadence: "15min",
    model: "qwen3:4b",
    prompt_file: "ticket_enrich.md",
    required_tools: ["list_oc_tasks", "lookup_tags", "validate_failure_class"],
    output_path: "results/ticket-enrichments/{date}.md",
    requires_service: false,
    per_service: false,
  },
  stale_ticket: {
    task_type: "stale_ticket",
    description: "Flag tickets and patches open more than 3 days",
    cadence: "daily",
    model: "qwen3:4b",
    prompt_file: "stale_ticket.md",
    required_tools: ["list_tickets", "list_patches"],
    output_path: "results/stale-tickets.md",
    requires_service: false,
    per_service: false,
  },
  backup_audit: {
    task_type: "backup_audit",
    description: "Audit backup freshness and sizes across all services",
    cadence: "daily",
    model: "qwen3:4b",
    prompt_file: "backup_audit.md",
    required_tools: ["backup_status"],
    output_path: "results/backup-audit.md",
    requires_service: false,
    per_service: false,
  },
  env_check: {
    task_type: "env_check",
    description: "Find environment variable references in code that may need config entries",
    cadence: "weekly",
    model: "qwen3:4b",
    prompt_file: "env_check.md",
    required_tools: ["git_log", "git_diff"],
    output_path: "results/env-check/{service}.md",
    requires_service: true,
    per_service: true,
  },
  dep_audit: {
    task_type: "dep_audit",
    description: "Check for outdated or vulnerable dependencies",
    cadence: "weekly",
    model: "qwen3:4b",
    prompt_file: "dep_audit.md",
    required_tools: ["git_log"],
    output_path: "results/dep-audit/{service}.md",
    requires_service: true,
    per_service: true,
  },
  schema_drift: {
    task_type: "schema_drift",
    description: "Compare DB schemas vs code expectations for drift",
    cadence: "weekly",
    model: "qwen3:4b",
    prompt_file: "schema_drift.md",
    required_tools: ["git_log", "git_diff"],
    output_path: "results/schema-drift/{service}.md",
    requires_service: true,
    per_service: true,
  },
  doc_staleness: {
    task_type: "doc_staleness",
    description: "Compare documentation against actual project structure",
    cadence: "weekly",
    model: "qwen3:4b",
    prompt_file: "doc_staleness.md",
    required_tools: ["git_log", "get_checklist"],
    output_path: "results/doc-staleness/{service}.md",
    requires_service: true,
    per_service: true,
  },
  health_trend: {
    task_type: "health_trend",
    description: "Analyze PM2 and network metrics for degradation trends",
    cadence: "daily",
    model: "qwen3:4b",
    prompt_file: "health_trend.md",
    required_tools: ["pm2_status", "disk_usage", "backup_status"],
    output_path: "results/health-trend.md",
    requires_service: false,
    per_service: false,
  },
};

export const VALID_TASK_TYPES = new Set(Object.keys(TASK_REGISTRY));
