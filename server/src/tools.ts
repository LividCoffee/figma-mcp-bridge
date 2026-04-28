import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Node } from "./node.js";
import { toolInputSchemas } from "./schema.js";
import type { BridgeResponse } from "./types.js";
import { Follower } from "./follower.js";
import { logToolCall, initLogger } from "./logger.js";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export type ExportFormat = "PNG" | "SVG" | "JPG" | "PDF";

export interface ScreenshotSender {
  sendWithParams(
    requestType: string,
    nodeIds?: string[],
    params?: Record<string, unknown>
  ): Promise<BridgeResponse>;
}

interface ScreenshotExport {
  nodeId: string;
  nodeName: string;
  format: ExportFormat;
  base64: string;
  width: number;
  height: number;
}

interface SaveScreenshotItemInput {
  nodeId: string;
  outputPath: string;
  format?: ExportFormat;
  scale?: number;
}

interface SaveScreenshotItemResult {
  index: number;
  nodeId: string;
  nodeName?: string;
  outputPath: string;
  format?: ExportFormat;
  width?: number;
  height?: number;
  bytesWritten?: number;
  success: boolean;
  error?: string;
}

export async function registerTools(
  server: McpServer,
  node: Node,
  port: number
): Promise<void> {
  // Initialize logger
  await initLogger();

  const log = createToolLogger("list_files", node.roleName);
  server.tool(
    "list_files",
    "List all currently connected Figma files. Returns fileKey and fileName for each. Use the fileKey to target a specific file in other tools.",
    async (): Promise<ToolResult> => {
      const startTime = Date.now();
      try {
        let files = node.listConnectedFiles();
        if (files === undefined) {
          // Follower: fetch via RPC from leader
          const follower = new Follower(`http://localhost:${port}`);
          files = await follower.listConnectedFiles();
        }
        await log(startTime, 0, true);
        return {
          content: [{ type: "text", text: JSON.stringify(files) }],
        };
      } catch (err) {
        await log(startTime, 0, false, err instanceof Error ? err.message : String(err));
        return {
          content: [
            {
              type: "text",
              text: err instanceof Error ? err.message : String(err),
            },
          ],
          isError: true,
        };
      }
    }
  );

  const logGetDocument = createToolLogger("get_document", node.roleName);
  server.tool(
    "get_document",
    "Get the current Figma page document tree. When multiple files are connected, specify fileKey.",
    toolInputSchemas.get_document.shape,
    async ({ fileKey }): Promise<ToolResult> => {
      const startTime = Date.now();
      const result = await renderResponse(() =>
        node.send("get_document", undefined, fileKey)
      );
      await logGetDocument(startTime, estimateTokens(result), result.isError !== true);
      return result;
    }
  );

  const logGetSelection = createToolLogger("get_selection", node.roleName);
  server.tool(
    "get_selection",
    "Get the currently selected nodes in Figma. When multiple files are connected, specify fileKey.",
    toolInputSchemas.get_selection.shape,
    async ({ fileKey }): Promise<ToolResult> => {
      const startTime = Date.now();
      const result = await renderResponse(() =>
        node.send("get_selection", undefined, fileKey)
      );
      await logGetSelection(startTime, estimateTokens(result), result.isError !== true);
      return result;
    }
  );

  const logGetNode = createToolLogger("get_node", node.roleName);
  server.tool(
    "get_node",
    "Get a specific Figma node by ID. Must use colon format, e.g. '4029:12345', never use hyphens. When multiple files are connected, specify fileKey.",
    toolInputSchemas.get_node.shape,
    async ({ nodeId, fileKey }): Promise<ToolResult> => {
      const startTime = Date.now();
      const result = await renderResponse(() => node.send("get_node", [nodeId], fileKey));
      await logGetNode(startTime, estimateTokens(result), result.isError !== true);
      return result;
    }
  );

  const logGetStyles = createToolLogger("get_styles", node.roleName);
  server.tool(
    "get_styles",
    "Get all local styles in the document. When multiple files are connected, specify fileKey.",
    toolInputSchemas.get_styles.shape,
    async ({ fileKey }): Promise<ToolResult> => {
      const startTime = Date.now();
      const result = await renderResponse(() => node.send("get_styles", undefined, fileKey));
      await logGetStyles(startTime, estimateTokens(result), result.isError !== true);
      return result;
    }
  );

  const logGetMetadata = createToolLogger("get_metadata", node.roleName);
  server.tool(
    "get_metadata",
    "Get metadata about the current Figma document including file name, pages, and current page info. When multiple files are connected, specify fileKey.",
    toolInputSchemas.get_metadata.shape,
    async ({ fileKey }): Promise<ToolResult> => {
      const startTime = Date.now();
      const result = await renderResponse(() =>
        node.send("get_metadata", undefined, fileKey)
      );
      await logGetMetadata(startTime, estimateTokens(result), result.isError !== true);
      return result;
    }
  );

  const logGetDesignContext = createToolLogger("get_design_context", node.roleName);
  server.tool(
    "get_design_context",
    "Get the design context for the current selection or page. Returns a summarized tree structure optimized for understanding the current design context. When multiple files are connected, specify fileKey.",
    toolInputSchemas.get_design_context.shape,
    async ({ depth, fileKey }): Promise<ToolResult> => {
      const startTime = Date.now();
      const params: Record<string, unknown> = {};
      if (depth !== undefined && depth > 0) {
        params.depth = depth;
      }
      const result = await renderResponse(() =>
        node.sendWithParams("get_design_context", undefined, params, fileKey)
      );
      await logGetDesignContext(startTime, estimateTokens(result), result.isError !== true);
      return result;
    }
  );

  const logGetVariableDefs = createToolLogger("get_variable_defs", node.roleName);
  server.tool(
    "get_variable_defs",
    "Get all local variable definitions including variable collections, modes, and variable values. Variables are Figma's system for design tokens (colors, numbers, strings, booleans). When multiple files are connected, specify fileKey.",
    toolInputSchemas.get_variable_defs.shape,
    async ({ fileKey }): Promise<ToolResult> => {
      const startTime = Date.now();
      const result = await renderResponse(() =>
        node.send("get_variable_defs", undefined, fileKey)
      );
      await logGetVariableDefs(startTime, estimateTokens(result), result.isError !== true);
      return result;
    }
  );

  const logGetScreenshot = createToolLogger("get_screenshot", node.roleName);
  server.tool(
    "get_screenshot",
    "Export a screenshot of the selected nodes or specific nodes by ID. Returns base64-encoded image data. When multiple files are connected, specify fileKey.",
    toolInputSchemas.get_screenshot.shape,
    async ({ nodeIds, format, scale, fileKey }): Promise<ToolResult> => {
      const startTime = Date.now();
      const params: Record<string, unknown> = {};
      if (format) params.format = format;
      if (scale !== undefined && scale > 0) params.scale = scale;
      const result = await renderResponse(() =>
        node.sendWithParams("get_screenshot", nodeIds, params, fileKey)
      );
      await logGetScreenshot(startTime, estimateTokens(result), result.isError !== true);
      return result;
    }
  );

  const logSaveScreenshots = createToolLogger("save_screenshots", node.roleName);
  server.tool(
    "save_screenshots",
    "Export screenshots for multiple nodes and save them directly to the local filesystem. Returns metadata only (no base64). When multiple files are connected, specify fileKey.",
    toolInputSchemas.save_screenshots.shape,
    async ({ items, format, scale, fileKey }): Promise<ToolResult> => {
      try {
        const startTime = Date.now();
        // Create a sender bound to the specific fileKey
        const sender: ScreenshotSender = {
          sendWithParams: (requestType, nodeIds, params) =>
            node.sendWithParams(requestType, nodeIds, params, fileKey),
        };
        const result = await executeSaveScreenshots(
          sender,
          items,
          format,
          scale
        );
        const outputText = JSON.stringify(result);
        await logSaveScreenshots(startTime, estimateTokens({ content: [{ type: "text" as const, text: outputText }] }), !result.hasErrors);
        return {
          content: [{ type: "text", text: outputText }],
        };
      } catch (err) {
        const startTime = Date.now();
        await logSaveScreenshots(startTime, 0, false, err instanceof Error ? err.message : String(err));
        return {
          content: [
            {
              type: "text",
              text: err instanceof Error ? err.message : String(err),
            },
          ],
          isError: true,
        };
      }
    }
  );
}

export async function executeSaveScreenshots(
  sender: ScreenshotSender,
  items: SaveScreenshotItemInput[],
  format?: ExportFormat,
  scale?: number
): Promise<{
  total: number;
  succeeded: number;
  failed: number;
  hasErrors: boolean;
  results: SaveScreenshotItemResult[];
}> {
  const results: SaveScreenshotItemResult[] = [];

  for (const [index, item] of items.entries()) {
    const result = await saveScreenshotItemToFile(
      sender,
      item,
      index,
      process.cwd(),
      format,
      scale
    );
    results.push(result);
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.length - succeeded;

  return {
    total: results.length,
    succeeded,
    failed,
    hasErrors: failed > 0,
    results,
  };
}

async function renderResponse(
  fn: () => Promise<BridgeResponse>
): Promise<ToolResult> {
  try {
    const resp = await fn();
    if (resp.error) {
      return {
        content: [{ type: "text", text: resp.error }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(resp.data) }],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: err instanceof Error ? err.message : String(err),
        },
      ],
      isError: true,
    };
  }
}

function resolveAndValidateOutputPath(
  outputPath: string,
  workspaceRoot: string
): string {
  const resolvedRoot = path.resolve(workspaceRoot);
  const resolvedPath = path.resolve(resolvedRoot, outputPath);
  const relativePath = path.relative(resolvedRoot, resolvedPath);
  const escapesRoot =
    relativePath.startsWith("..") || path.isAbsolute(relativePath);
  if (escapesRoot) {
    throw new Error(
      `outputPath must be inside the MCP server working directory: ${resolvedRoot}`
    );
  }
  return resolvedPath;
}

function inferFormatFromPath(outputPath: string): ExportFormat | null {
  const ext = path.extname(outputPath).toLowerCase();
  switch (ext) {
    case ".png":
      return "PNG";
    case ".svg":
      return "SVG";
    case ".jpg":
    case ".jpeg":
      return "JPG";
    case ".pdf":
      return "PDF";
    default:
      return null;
  }
}

function resolveExportFormat(
  format: ExportFormat | undefined,
  inferredFormat: ExportFormat | null
): ExportFormat {
  if (format && inferredFormat && format !== inferredFormat) {
    throw new Error(
      `format ${format} conflicts with outputPath extension (${inferredFormat})`
    );
  }
  return format ?? inferredFormat ?? "PNG";
}

function getSingleScreenshotExport(data: unknown): ScreenshotExport {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid screenshot response from plugin");
  }

  const exports = (data as { exports?: unknown }).exports;
  if (!Array.isArray(exports) || exports.length === 0) {
    throw new Error("No screenshot export returned by plugin");
  }

  const first = exports[0];
  if (
    !first ||
    typeof first !== "object" ||
    typeof (first as { nodeId?: unknown }).nodeId !== "string" ||
    typeof (first as { nodeName?: unknown }).nodeName !== "string" ||
    typeof (first as { base64?: unknown }).base64 !== "string" ||
    typeof (first as { width?: unknown }).width !== "number" ||
    typeof (first as { height?: unknown }).height !== "number"
  ) {
    throw new Error("Malformed screenshot export payload");
  }

  const screenshot = first as ScreenshotExport;
  return screenshot;
}

async function saveScreenshotItemToFile(
  sender: ScreenshotSender,
  item: SaveScreenshotItemInput,
  index: number,
  workspaceRoot: string,
  defaultFormat?: ExportFormat,
  defaultScale?: number
): Promise<SaveScreenshotItemResult> {
  let resolvedOutputPath = item.outputPath;

  try {
    resolvedOutputPath = resolveAndValidateOutputPath(
      item.outputPath,
      workspaceRoot
    );
    const inferredFormat = inferFormatFromPath(resolvedOutputPath);
    const resolvedFormat = resolveExportFormat(
      item.format ?? defaultFormat,
      inferredFormat
    );
    const resolvedScale = resolveScale(item.scale, defaultScale);

    const params: Record<string, unknown> = { format: resolvedFormat };
    if (resolvedScale !== undefined) {
      params.scale = resolvedScale;
    }

    const resp = await sender.sendWithParams(
      "get_screenshot",
      [item.nodeId],
      params
    );
    if (resp.error) {
      throw new Error(resp.error);
    }

    const screenshotExport = getSingleScreenshotExport(resp.data);
    const bytesWritten = await writeBase64ToFile(
      screenshotExport.base64,
      resolvedOutputPath
    );

    return {
      index,
      nodeId: screenshotExport.nodeId,
      nodeName: screenshotExport.nodeName,
      outputPath: resolvedOutputPath,
      format: resolvedFormat,
      width: screenshotExport.width,
      height: screenshotExport.height,
      bytesWritten,
      success: true,
    };
  } catch (err) {
    return {
      index,
      nodeId: item.nodeId,
      outputPath: resolvedOutputPath,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function writeBase64ToFile(
  base64: string,
  outputPath: string
): Promise<number> {
  const bytes = Buffer.from(base64, "base64");
  await mkdir(path.dirname(outputPath), { recursive: true });
  try {
    await writeFile(outputPath, bytes, { flag: "wx" });
  } catch (err) {
    if (isNodeError(err) && err.code === "EEXIST") {
      throw new Error(`File already exists at outputPath: ${outputPath}`);
    }
    throw err;
  }
  return bytes.length;
}

function resolveScale(
  itemScale?: number,
  defaultScale?: number
): number | undefined {
  const resolvedScale = itemScale ?? defaultScale;
  if (resolvedScale === undefined || resolvedScale <= 0) {
    return undefined;
  }
  return resolvedScale;
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error;
}

/**
 * Create a wrapper function that logs tool calls with token usage.
 */
function createToolLogger(
  toolName: string,
  roleName: string
): (startTime: number, tokensUsed: number, success: boolean, error?: string) => Promise<void> {
  return async (startTime: number, tokensUsed: number, success: boolean, error?: string) => {
    const durationMs = Date.now() - startTime;
    await logToolCall({
      timestamp: new Date().toISOString(),
      toolName,
      durationMs,
      tokensUsed,
      role: roleName,
      success,
      error,
    });
  };
}

/**
 * Estimate token count from a ToolResult based on text content length.
 * Rough approximation: ~4 characters per token.
 */
function estimateTokens(result: ToolResult): number {
  let textLength = 0;
  for (const part of result.content) {
    textLength += part.text.length;
  }
  // Rough estimate: ~4 characters per token for JSON content
  return Math.max(1, Math.ceil(textLength / 4));
}
