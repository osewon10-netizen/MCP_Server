import fs from "node:fs/promises";
import path from "node:path";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { OcIndex, OcTaskEntry } from "../types.js";
import { OC_INDEX, OC_ARCHIVE_DIR } from "../lib/paths.js";
import { readIndex, writeIndex, allocateOcId } from "../lib/index-manager.js";
import { VALID_TASK_TYPES } from "../lib/task-registry.js";

// ─── Tool Definitions ───────────────────────────────────────────────

export const tools: Tool[] = [
  {
    name: "create_oc_task",
    description: "Create a new OC (Ollama Churns) task. Returns the allocated ID and entry.",
    inputSchema: {
      type: "object",
      properties: {
        task_type: { type: "string", description: "Task type (e.g. code_review, log_digest, archive_normalize, gap_detect)" },
        summary: { type: "string", description: "Brief description of the task" },
        created_by: { type: "string", description: "Who created it (e.g. mini, cron)" },
        service: { type: "string", description: "Target service, if applicable" },
      },
      required: ["task_type", "summary", "created_by"],
    },
  },
  {
    name: "list_oc_tasks",
    description: "List OC tasks, optionally filtered by status or task_type.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Filter by status (open, completed)" },
        task_type: { type: "string", description: "Filter by task_type" },
      },
    },
  },
  {
    name: "view_oc_task",
    description: "View a single OC task by ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "OC task ID (e.g. OC-001)" },
      },
      required: ["id"],
    },
  },
  {
    name: "update_oc_task",
    description: "Update fields on an OC task. Auto-sets completed_at when status changes to completed.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "OC task ID (e.g. OC-001)" },
        status: { type: "string", enum: ["open", "completed"], description: "New status" },
        result_path: { type: "string", description: "Relative path to results file" },
        notes: { type: "string", description: "Completion notes or error info" },
      },
      required: ["id"],
    },
  },
  {
    name: "archive_oc_task",
    description: "Move a completed OC task from the live index to the monthly JSONL archive. Task must have status 'completed'.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "OC task ID (e.g. OC-001)" },
      },
      required: ["id"],
    },
  },
  {
    name: "list_oc_archive",
    description: "Search archived OC tasks. Reads monthly JSONL files (most recent first). Filter by month, task_type, or service.",
    inputSchema: {
      type: "object",
      properties: {
        month: { type: "string", description: "Month filter in YYYY-MM format (e.g. 2026-03). Omit to search all months." },
        task_type: { type: "string", description: "Filter by task_type" },
        service: { type: "string", description: "Filter by service" },
        limit: { type: "number", description: "Max results (default 50)" },
      },
    },
  },
];

// ─── Handlers ───────────────────────────────────────────────────────

async function createOcTask(args: Record<string, unknown>): Promise<CallToolResult> {
  const taskType = args.task_type as string;
  const summary = args.summary as string;
  const createdBy = args.created_by as string;
  const service = args.service as string | undefined;

  if (!VALID_TASK_TYPES.has(taskType)) {
    const valid = [...VALID_TASK_TYPES].join(", ");
    return {
      content: [{ type: "text", text: `Unknown task_type: ${taskType}. Valid: ${valid}` }],
      isError: true,
    };
  }

  const index = await readIndex<OcIndex>(OC_INDEX);
  const { id, nextId } = allocateOcId(index);

  const today = new Date().toISOString().slice(0, 10);
  index.tasks[id] = {
    summary,
    task_type: taskType,
    service,
    status: "open",
    created: today,
    created_by: createdBy,
  };
  index.next_id = nextId;

  await writeIndex(OC_INDEX, index);

  return {
    content: [{ type: "text", text: JSON.stringify({ id, entry: index.tasks[id] }, null, 2) }],
  };
}

async function listOcTasks(args: Record<string, unknown>): Promise<CallToolResult> {
  const statusFilter = args.status as string | undefined;
  const typeFilter = args.task_type as string | undefined;

  const index = await readIndex<OcIndex>(OC_INDEX);
  const results = Object.entries(index.tasks)
    .filter(([, e]) => !statusFilter || e.status === statusFilter)
    .filter(([, e]) => !typeFilter || e.task_type === typeFilter)
    .map(([id, e]) => ({
      id,
      summary: e.summary,
      task_type: e.task_type,
      service: e.service,
      status: e.status,
      created: e.created,
    }));

  return {
    content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
  };
}

async function viewOcTask(args: Record<string, unknown>): Promise<CallToolResult> {
  const id = args.id as string;

  const index = await readIndex<OcIndex>(OC_INDEX);
  const entry = index.tasks[id];
  if (!entry) {
    return { content: [{ type: "text", text: `OC task not found: ${id}` }], isError: true };
  }

  return {
    content: [{ type: "text", text: JSON.stringify({ id, entry }, null, 2) }],
  };
}

async function updateOcTask(args: Record<string, unknown>): Promise<CallToolResult> {
  const id = args.id as string;
  const status = args.status as "open" | "completed" | undefined;
  const resultPath = args.result_path as string | undefined;
  const notes = args.notes as string | undefined;

  const index = await readIndex<OcIndex>(OC_INDEX);
  const entry = index.tasks[id];
  if (!entry) {
    return { content: [{ type: "text", text: `OC task not found: ${id}` }], isError: true };
  }

  const updated: string[] = [];

  if (status !== undefined) {
    entry.status = status;
    updated.push("status");
    if (status === "completed" && !entry.completed_at) {
      entry.completed_at = new Date().toISOString();
      updated.push("completed_at");
    }
  }
  if (resultPath !== undefined) {
    entry.result_path = resultPath;
    updated.push("result_path");
  }
  if (notes !== undefined) {
    entry.notes = notes;
    updated.push("notes");
  }

  if (updated.length === 0) {
    return { content: [{ type: "text", text: "No fields to update" }], isError: true };
  }

  await writeIndex(OC_INDEX, index);

  return {
    content: [{ type: "text", text: JSON.stringify({ success: true, id, updated_fields: updated }, null, 2) }],
  };
}

// ─── Archive helpers ─────────────────────────────────────────────────

interface OcArchiveLine {
  id: string;
  entry: OcTaskEntry;
  archived_at: string;
}

async function archiveOcTask(args: Record<string, unknown>): Promise<CallToolResult> {
  const id = args.id as string;

  const index = await readIndex<OcIndex>(OC_INDEX);
  const entry = index.tasks[id];
  if (!entry) {
    return { content: [{ type: "text", text: `OC task not found: ${id}` }], isError: true };
  }
  if (entry.status !== "completed") {
    return {
      content: [{ type: "text", text: `Task ${id} must be completed before archiving (current: ${entry.status})` }],
      isError: true,
    };
  }

  // Append to monthly JSONL
  const month = new Date().toISOString().slice(0, 7); // "2026-03"
  await fs.mkdir(OC_ARCHIVE_DIR, { recursive: true });
  const archivePath = path.join(OC_ARCHIVE_DIR, `${month}.jsonl`);
  const line: OcArchiveLine = { id, entry, archived_at: new Date().toISOString() };
  await fs.appendFile(archivePath, JSON.stringify(line) + "\n", "utf-8");

  // Remove from live index
  delete index.tasks[id];
  await writeIndex(OC_INDEX, index);

  return {
    content: [{ type: "text", text: JSON.stringify({ success: true, id, archived_to: `archive/${month}.jsonl` }, null, 2) }],
  };
}

async function listOcArchive(args: Record<string, unknown>): Promise<CallToolResult> {
  const monthFilter = args.month as string | undefined;
  const typeFilter = args.task_type as string | undefined;
  const serviceFilter = args.service as string | undefined;
  const limit = (args.limit as number) ?? 50;

  let files: string[];
  if (monthFilter) {
    files = [`${monthFilter}.jsonl`];
  } else {
    try {
      const entries = await fs.readdir(OC_ARCHIVE_DIR);
      files = entries.filter((f) => f.endsWith(".jsonl")).sort().reverse();
    } catch {
      return { content: [{ type: "text", text: "[]" }] };
    }
  }

  const results: Array<{
    id: string;
    summary: string;
    task_type: string;
    service?: string;
    completed_at?: string;
    archived_at: string;
  }> = [];

  for (const file of files) {
    const filePath = path.join(OC_ARCHIVE_DIR, file);
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf-8");
    } catch {
      continue;
    }

    for (const rawLine of raw.split("\n")) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;
      let record: OcArchiveLine;
      try {
        record = JSON.parse(trimmed) as OcArchiveLine;
      } catch {
        continue; // skip malformed lines
      }

      if (typeFilter && record.entry.task_type !== typeFilter) continue;
      if (serviceFilter && record.entry.service !== serviceFilter) continue;

      results.push({
        id: record.id,
        summary: record.entry.summary,
        task_type: record.entry.task_type,
        service: record.entry.service,
        completed_at: record.entry.completed_at,
        archived_at: record.archived_at,
      });
      if (results.length >= limit) break;
    }
    if (results.length >= limit) break;
  }

  return {
    content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
  };
}

// ─── Dispatch ───────────────────────────────────────────────────────

export async function handleCall(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  switch (name) {
    case "create_oc_task": return createOcTask(args);
    case "list_oc_tasks": return listOcTasks(args);
    case "view_oc_task": return viewOcTask(args);
    case "update_oc_task": return updateOcTask(args);
    case "archive_oc_task": return archiveOcTask(args);
    case "list_oc_archive": return listOcArchive(args);
    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
}
