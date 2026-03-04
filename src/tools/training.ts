import fs from "node:fs/promises";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { TICKET_ARCHIVE, PATCH_ARCHIVE } from "../lib/paths.js";
import type { TicketEntry, PatchEntry } from "../types.js";

// ─── Archive line shapes (mirrors archive.ts) ────────────────────────

interface ArchiveLine {
  id: string;
  type: "ticket" | "patch";
  entry: TicketEntry | PatchEntry;
  archived_at: string;
}

// ─── Training record shapes ──────────────────────────────────────────

interface TrainingRecord {
  id: string;
  type: "ticket" | "patch";
  service: string;
  input: {
    summary: string;
    severity_or_priority: string;
    category?: string;
    symptom?: string;
    likely_cause?: string;
    where_to_look?: string[];
    what_to_change?: string;
    why?: string;
    where_to_change?: string[];
  };
  output: {
    evidence?: string;
    patch_notes?: string;
    applied_notes?: string;
    proposed_diff?: string;
    outcome: string;
    verification?: {
      verified_by: string;
      deployed: boolean;
      health_check: string;
      commit?: string;
    };
  };
  handoff?: {
    assigned_to?: string;
    claimed_by?: string;
    handoff_note?: string;
    handoff_count?: number;
  };
  tags: string[];
  failure_class: string | null;
  created: string;
  archived_at: string;
}

// ─── Tool Definition ─────────────────────────────────────────────────

export const tools: Tool[] = [
  {
    name: "export_training_data",
    description:
      "Export archived tickets and patches as structured JSONL training records. " +
      "Skips entries missing both evidence/patch_notes AND applied_notes. " +
      "Filters by service and/or date. Returns JSONL (one JSON object per line).",
    inputSchema: {
      type: "object",
      properties: {
        service: {
          type: "string",
          description: "Filter by service name (optional)",
        },
        since: {
          type: "string",
          description: "Only include records archived on or after this date (YYYY-MM-DD, optional)",
        },
        type: {
          type: "string",
          enum: ["ticket", "patch", "all"],
          description: "Filter by record type (default: all)",
        },
      },
    },
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────

async function readArchiveLines(filePath: string): Promise<ArchiveLine[]> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch {
    return [];
  }

  const lines: ArchiveLine[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      lines.push(JSON.parse(trimmed) as ArchiveLine);
    } catch {
      // skip malformed
    }
  }
  return lines;
}

function isTicketEntry(entry: TicketEntry | PatchEntry): entry is TicketEntry {
  return "severity" in entry;
}

function hasUsefulOutput(entry: TicketEntry | PatchEntry): boolean {
  if (isTicketEntry(entry)) {
    return !!(entry.evidence || entry.patch_notes);
  }
  // PatchEntry
  const pe = entry as PatchEntry;
  return !!(pe.applied_notes || pe.proposed_diff);
}

function toTrainingRecord(line: ArchiveLine): TrainingRecord {
  const e = line.entry;

  const record: TrainingRecord = {
    id: line.id,
    type: line.type,
    service: e.service,
    input: {
      summary: e.summary,
      severity_or_priority: isTicketEntry(e) ? e.severity : (e as PatchEntry).priority,
    },
    output: {
      outcome: e.outcome,
    },
    tags: e.tags,
    failure_class: e.failure_class,
    created: e.created,
    archived_at: line.archived_at,
  };

  // Input fields
  if (isTicketEntry(e)) {
    if (e.symptom) record.input.symptom = e.symptom;
    if (e.likely_cause) record.input.likely_cause = e.likely_cause;
    if (e.where_to_look?.length) record.input.where_to_look = e.where_to_look;
  } else {
    const pe = e as PatchEntry;
    if (pe.category) record.input.category = pe.category;
    if (pe.what_to_change) record.input.what_to_change = pe.what_to_change;
    if (pe.why) record.input.why = pe.why;
    if (pe.where_to_change?.length) record.input.where_to_change = pe.where_to_change;
  }

  // Output fields
  if (isTicketEntry(e)) {
    if (e.evidence) record.output.evidence = e.evidence;
    if (e.patch_notes) record.output.patch_notes = e.patch_notes;
  } else {
    const pe = e as PatchEntry;
    if (pe.applied_notes) record.output.applied_notes = pe.applied_notes;
    if (pe.proposed_diff) record.output.proposed_diff = pe.proposed_diff;
  }

  if (e.verification) {
    record.output.verification = {
      verified_by: e.verification.verified_by,
      deployed: e.verification.deployed,
      health_check: e.verification.health_check,
      commit: e.verification.commit,
    };
  }

  // Handoff metadata (only if any fields present)
  if (e.assigned_to || e.claimed_by || e.handoff_note || e.handoff_count) {
    record.handoff = {};
    if (e.assigned_to) record.handoff.assigned_to = e.assigned_to;
    if (e.claimed_by) record.handoff.claimed_by = e.claimed_by;
    if (e.handoff_note) record.handoff.handoff_note = e.handoff_note;
    if (e.handoff_count) record.handoff.handoff_count = e.handoff_count;
  }

  return record;
}

// ─── Handler ─────────────────────────────────────────────────────────

async function exportTrainingData(args: Record<string, unknown>): Promise<CallToolResult> {
  const serviceFilter = args.service as string | undefined;
  const sinceFilter = args.since as string | undefined;
  const typeFilter = (args.type as string) ?? "all";

  const allLines: ArchiveLine[] = [];

  if (typeFilter === "all" || typeFilter === "ticket") {
    allLines.push(...await readArchiveLines(TICKET_ARCHIVE));
  }
  if (typeFilter === "all" || typeFilter === "patch") {
    allLines.push(...await readArchiveLines(PATCH_ARCHIVE));
  }

  let skipped = 0;
  const records: TrainingRecord[] = [];

  for (const line of allLines) {
    // Service filter
    if (serviceFilter && line.entry.service !== serviceFilter) continue;

    // Date filter (compare archived_at against since)
    if (sinceFilter && line.archived_at < sinceFilter) continue;

    // Quality gate: skip entries without useful output
    if (!hasUsefulOutput(line.entry)) {
      skipped++;
      continue;
    }

    records.push(toTrainingRecord(line));
  }

  // Return as JSONL
  const jsonl = records.map((r) => JSON.stringify(r)).join("\n");

  const summary = `Exported ${records.length} training records (${skipped} skipped — missing evidence/notes)`;
  const output = records.length > 0 ? `${summary}\n\n${jsonl}` : summary;

  return {
    content: [{ type: "text", text: output }],
  };
}

// ─── Dispatch ────────────────────────────────────────────────────────

export async function handleCall(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  switch (name) {
    case "export_training_data": return exportTrainingData(args);
    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
}
