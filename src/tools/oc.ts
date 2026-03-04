import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { OcIndex } from "../types.js";
import { OC_INDEX } from "../lib/paths.js";
import { readIndex, writeIndex, allocateOcId } from "../lib/index-manager.js";

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
];

// ─── Handlers ───────────────────────────────────────────────────────

async function createOcTask(args: Record<string, unknown>): Promise<CallToolResult> {
  const taskType = args.task_type as string;
  const summary = args.summary as string;
  const createdBy = args.created_by as string;
  const service = args.service as string | undefined;

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

// ─── Dispatch ───────────────────────────────────────────────────────

export async function handleCall(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  switch (name) {
    case "create_oc_task": return createOcTask(args);
    case "list_oc_tasks": return listOcTasks(args);
    case "view_oc_task": return viewOcTask(args);
    case "update_oc_task": return updateOcTask(args);
    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
}
