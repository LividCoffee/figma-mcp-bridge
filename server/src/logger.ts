import { mkdir, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export interface ToolCallLog {
  timestamp: string;
  toolName: string;
  durationMs: number;
  tokensUsed: number;
  role: string;
  success: boolean;
  error?: string;
}

interface LoggerState {
  logDir: string;
  logFile: string;
  initialized: boolean;
}

const state: LoggerState = {
  logDir: "",
  logFile: "",
  initialized: false,
};

/**
 * Initialize the logger by creating the logs directory and log file.
 */
export async function initLogger(): Promise<void> {
  if (state.initialized) return;

  const logsDir = path.resolve(process.cwd(), "logs");
  await mkdir(logsDir, { recursive: true });

  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];
  const logFileName = `figma-bridge-${dateStr}.log`;
  state.logFile = path.join(logsDir, logFileName);
  state.logDir = logsDir;
  state.initialized = true;

  // Clean up old log files (keep only last 7 days)
  cleanupOldLogs(logsDir).catch(() => {});
}

/**
 * Log a tool call with its token usage.
 */
export async function logToolCall(log: ToolCallLog): Promise<void> {
  if (!state.initialized) {
    await initLogger();
  }

  const line = formatLogLine(log);
  try {
    await appendFile(state.logFile, line + "\n");
  } catch (err) {
    // Fallback to console if file write fails
    console.error(`[LOG ERROR] Failed to write log: ${err}`);
    console.error(line);
  }
}

/**
 * Format a log line in a structured format for easy parsing.
 */
function formatLogLine(log: ToolCallLog): string {
  const { timestamp, toolName, durationMs, tokensUsed, role, success, error } = log;
  
  // JSON format for easy parsing
  return JSON.stringify({
    ts: timestamp,
    tool: toolName,
    duration_ms: durationMs,
    tokens: tokensUsed,
    role,
    success,
    error,
  });
}

/**
 * Clean up old log files (keep only last 7 days).
 */
async function cleanupOldLogs(logsDir: string): Promise<void> {
  try {
    const files = await readdirFiles(logsDir);
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;

    for (const file of files) {
      if (!file.startsWith("figma-bridge-") || !file.endsWith(".log")) {
        continue;
      }

      const filePath = path.join(logsDir, file);
      const stats = await statFile(filePath);
      const age = now - stats.mtimeMs;

      if (age > sevenDays) {
        await unlinkFile(filePath);
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

// Type-safe wrappers for fs operations
async function readdirFiles(dir: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  return readdir(dir);
}

async function statFile(filePath: string): Promise<{ mtimeMs: number }> {
  const { stat } = await import("node:fs/promises");
  return stat(filePath);
}

async function unlinkFile(filePath: string): Promise<void> {
  const { unlink } = await import("node:fs/promises");
  return unlink(filePath);
}
