import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

import { PluginRegistry } from "./core/registry.js";
import type { SurfaceName } from "./core/types.js";

// Native plugins (all 25 modules)
import tagsPlugin from "./plugins/info/tags.js";
import registryPlugin from "./plugins/info/registry.js";
import networkPlugin from "./plugins/info/network.js";
import memoryPlugin from "./plugins/info/memory.js";
import reviewPlugin from "./plugins/review/review.js";
import wrappersPlugin from "./plugins/info/wrappers.js";
import overviewPlugin from "./plugins/info/overview.js";
import context7Plugin from "./plugins/external/context7.js";
import githubPlugin from "./plugins/external/github.js";
import gitPlugin from "./plugins/git/git.js";
import filesPlugin from "./plugins/files/files.js";
import logsPlugin from "./plugins/ops/logs.js";
import healthPlugin from "./plugins/ops/health.js";
import deployPlugin from "./plugins/ops/deploy.js";
import cronPlugin from "./plugins/ops/cron.js";
import ollamaCorePlugin from "./plugins/ollama/core.js";
import ollamaHelpersPlugin from "./plugins/ollama/helpers.js";
import mantisPlugin from "./plugins/mantis/mantis.js";
import ticketsPlugin from "./plugins/ticketing/tickets.js";
import patchesPlugin from "./plugins/ticketing/patches.js";
import trainingPlugin from "./plugins/review/training.js";
import ocPlugin from "./plugins/oc/oc.js";
import taskConfigPlugin from "./plugins/oc/task-config.js";
import plansPlugin from "./plugins/plans/plans.js";
import plansOpsPlugin from "./plugins/plans/plans-ops.js";
import guidePlugin from "./plugins/guide/guide.js";

// --- Plugin Registry ---

const pluginRegistry = new PluginRegistry();

const ALL_PLUGINS = [
  tagsPlugin, registryPlugin, networkPlugin,       // info
  memoryPlugin, reviewPlugin, wrappersPlugin, overviewPlugin,
  context7Plugin, githubPlugin,                     // external
  gitPlugin, filesPlugin, logsPlugin,               // git/files/ops
  healthPlugin, deployPlugin, cronPlugin,           // ops
  ollamaCorePlugin, ollamaHelpersPlugin,            // ollama
  mantisPlugin,                                     // mantis
  ticketsPlugin, patchesPlugin,                     // ticketing
  trainingPlugin,                                   // review
  ocPlugin, taskConfigPlugin,                       // oc
  plansPlugin, plansOpsPlugin,                      // plans
  guidePlugin,                                      // guide
];
for (const plugin of ALL_PLUGINS) {
  pluginRegistry.register(plugin);
}

/**
 * Transition guards restrict which status transitions are allowed on a surface.
 * Key format: "ticket" or "patch". Value: map of current_status → allowed new statuses.
 * If undefined (MiniMart/Express), all valid transitions are permitted.
 * If set (Electronics), only listed transitions are allowed — others are rejected.
 */
export type TransitionGuards = Record<string, Record<string, string[]>>;

export interface ServerConfig {
  name?: string;
  allowedTools?: Set<string>;
  transitionGuards?: TransitionGuards;
}

// Built-in introspection tool — implemented inline to avoid circular deps with tool modules
const GET_TOOL_INFO_DEF: Tool = {
  name: "get_tool_info",
  description:
    "Return the live tool description and input schema for a named tool on this surface. " +
    "Use this to verify that a description change or deployment actually took effect. " +
    "Returns tool definition as registered in memory, plus whether it is available on the current surface.",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Name of the tool to inspect, e.g. 'deploy_status'",
      },
    },
    required: ["name"],
  },
};

function handleGetToolInfo(
  args: Record<string, unknown>,
  allowed: Set<string> | undefined,
  surfaceName: string | undefined,
): CallToolResult {
  const toolName = args.name;
  if (typeof toolName !== "string" || !toolName) {
    return { content: [{ type: "text", text: "Missing required parameter: name" }], isError: true };
  }
  const allDefs = getRegisteredToolDefinitions();
  const def = allDefs.find((t) => t.name === toolName) ?? (toolName === "get_tool_info" ? GET_TOOL_INFO_DEF : undefined);
  if (!def) {
    return {
      content: [{ type: "text", text: `Tool not found in registry: "${toolName}"` }],
      isError: true,
    };
  }
  const available = !allowed || allowed.has(toolName);
  const resolvedDescription = surfaceName
    ? pluginRegistry.getDescription(def.name, surfaceName as SurfaceName) ?? def.description
    : def.description;
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        name: def.name,
        description: resolvedDescription,
        inputSchema: def.inputSchema,
        available_on_surface: available,
        surface: surfaceName ?? "minimart",
      }, null, 2),
    }],
  };
}

export function getRegisteredToolDefinitions(): Tool[] {
  return pluginRegistry.getAllDefinitions();
}

export function getRegisteredToolNames(): string[] {
  return [...getRegisteredToolDefinitions(), GET_TOOL_INFO_DEF].map((t) => t.name);
}

function getAllToolDefinitions(allowed?: Set<string>, surface?: SurfaceName): Tool[] {
  const all = [...getRegisteredToolDefinitions(), GET_TOOL_INFO_DEF];
  const filtered = !allowed ? all : all.filter((t) => allowed.has(t.name));
  if (!surface) return filtered;
  return filtered.map((t) => {
    const desc = pluginRegistry.getDescription(t.name, surface);
    if (!desc || desc === t.description) return t;
    return { ...t, description: desc };
  });
}

/** Expose registry for surface snapshot verification and future native plugins. */
export function getPluginRegistry(): PluginRegistry {
  return pluginRegistry;
}

async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  allowed?: Set<string>,
  surfaceName?: string,
): Promise<CallToolResult> {
  // Built-in introspection — check allowlist first, then handle inline
  if (name === "get_tool_info") {
    if (allowed && !allowed.has(name)) {
      return {
        content: [{ type: "text", text: `Tool not available on this server: ${name}` }],
        isError: true,
      };
    }
    return handleGetToolInfo(args, allowed, surfaceName);
  }

  // Fail closed: if allowlist is set and tool isn't in it, reject immediately
  if (allowed && !allowed.has(name)) {
    const surface = surfaceName ?? "unknown";
    console.error(`[guard] ${surface} blocked: ${name} (not in allowlist)`);
    return {
      content: [{ type: "text", text: `Tool not available on this server: ${name}` }],
      isError: true,
    };
  }

  // Single-path dispatch: all tools are in the plugin registry
  const registryResult = await pluginRegistry.dispatch(name, args, surfaceName as SurfaceName);
  if (registryResult !== undefined) return registryResult;

  return {
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
    isError: true,
  };
}

/**
 * Validate that every name in the allowlist exists in the full tool registry.
 * Throws on startup if any name doesn't match (catches typos and renames).
 */
export function validateAllowlist(allowed: Set<string>): void {
  const allNames = new Set(getRegisteredToolNames());
  const bad = [...allowed].filter((name) => !allNames.has(name));
  if (bad.length > 0) {
    throw new Error(`Allowlist contains unknown tool names: ${bad.join(", ")}`);
  }
}

let activeTransitionGuards: TransitionGuards | undefined;

/**
 * Get the active transition guards for this server instance.
 * Returns undefined if no guards are set (MiniMart/Express — all transitions allowed).
 */
export function getTransitionGuards(): TransitionGuards | undefined {
  return activeTransitionGuards;
}

export function createServer(config?: ServerConfig): Server {
  const serverName = config?.name ?? "minimart";
  const allowed = config?.allowedTools;
  activeTransitionGuards = config?.transitionGuards;

  const server = new Server(
    { name: serverName, version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: getAllToolDefinitions(allowed, serverName as SurfaceName) };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return await dispatchTool(name, (args ?? {}) as Record<string, unknown>, allowed, serverName);
  });

  return server;
}
