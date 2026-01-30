import type { Codex as CodexType } from '@openai/codex-sdk';
import type { AgentEvent } from '@craft-agent/core/types';
import type { Workspace } from '../config/storage.ts';
import type { AuthType } from '@craft-agent/core/types';
import type { LoadedSource } from '../sources/types.ts';
import type { McpServerConfig } from '../sources/server-builder.ts';
import type { ThinkingLevel } from './thinking-levels.ts';
import { normalizeThinkingLevelForCodex } from './thinking-levels.ts';
import type { PermissionMode } from './mode-manager.ts';
import type { FileAttachment } from '../utils/files.ts';
import { debug } from '../utils/debug.ts';
import type { AuthRequest } from './session-scoped-tools.ts';
import type { ValidationIssue } from '../config/validators.ts';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export interface CodexAgentSession {
  id: string;
  workspaceRootPath: string;
  sdkSessionId?: string;
  createdAt: number;
  lastUsedAt?: number;
  workingDirectory?: string;
  sdkCwd?: string;
  model?: string;
  permissionMode?: string;
}

export interface CodexAgentConfig {
  workspace: Workspace;
  session?: CodexAgentSession;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  isHeadless?: boolean;
  proxyUrl?: string;
  authType?: AuthType;
  onSdkSessionIdUpdate?: (sdkSessionId: string) => void;
  onSdkSessionIdCleared?: () => void;
  getRecoveryMessages?: () => Array<{ type: 'user' | 'assistant'; content: string }>;
  debugMode?: { enabled: boolean; logFilePath?: string };
}

type CodexThread = {
  id?: string | null;
  run: (input: string, options?: Record<string, unknown>) => Promise<unknown>;
  runStreamed?: (input: string, options?: Record<string, unknown>) => Promise<{ events: AsyncIterable<unknown> }> | AsyncIterable<unknown>;
};

function resolveCodexExecutable(): string | undefined {
  const envPath = process.env.CODEX_PATH || process.env.CODEX_CLI_PATH;
  if (envPath && existsSync(envPath)) {
    return envPath;
  }

  try {
    const command = process.platform === 'win32' ? 'where codex' : 'command -v codex';
    const output = execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n')[0]
      ?.trim();
    if (output && existsSync(output)) {
      return output;
    }
  } catch {
    // Ignore lookup errors; we'll fall back to common paths or PATH resolution.
  }

  const candidates = [
    join('/opt/homebrew/bin', 'codex'),
    join('/usr/local/bin', 'codex'),
    join(homedir(), '.local/bin', 'codex'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

export class CodexAgent {
  private config: CodexAgentConfig;
  private codex: CodexType | null = null;
  private codexPromise: Promise<CodexType> | null = null;
  private codexInit: { codexPathOverride: string; env: Record<string, string> };
  private thread: CodexThread | null = null;
  private abortController: AbortController | null = null;
  private model: string | undefined;
  private thinkingLevel: ThinkingLevel = 'think';
  private ultrathinkOverride = false;
  private sourceMcpServers: Record<string, McpServerConfig> = {};
  private intendedActiveSlugs: Set<string> = new Set();
  private allSources: LoadedSource[] = [];
  private workingDirectory?: string;
  private toolParents: Map<string, string> = new Map();

  // Callbacks (aligned with CraftAgent)
  public onPermissionRequest: ((request: { requestId: string; toolName: string; command: string; description: string; type?: 'bash' }) => void) | null = null;
  public onDebug: ((message: string) => void) | null = null;
  public onPermissionModeChange: ((mode: PermissionMode) => void) | null = null;
  public onPlanSubmitted: ((planPath: string) => void) | null = null;
  public onAuthRequest: ((request: AuthRequest) => void) | null = null;
  public onSourceChange: ((slug: string, source: LoadedSource | null) => void) | null = null;
  public onSourcesListChange: ((sources: LoadedSource[]) => void) | null = null;
  public onConfigValidationError: ((file: string, errors: ValidationIssue[]) => void) | null = null;
  public onSourceActivationRequest: ((sourceSlug: string) => Promise<boolean>) | null = null;

  constructor(config: CodexAgentConfig) {
    this.config = config;
    const codexPathOverride = resolveCodexExecutable() ?? 'codex';
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }
    if (config.proxyUrl) {
      env.HTTP_PROXY = config.proxyUrl;
      env.HTTPS_PROXY = config.proxyUrl;
      env.ALL_PROXY = config.proxyUrl;
    }
    if (config.authType === 'codex_oauth') {
      // Remove any inherited API keys/base URLs so Codex CLI uses ~/.codex/auth.json
      delete env.OPENAI_API_KEY;
      delete env.CODEX_API_KEY;
      delete env.OPENAI_BASE_URL;
      delete env.OPENAI_API_BASE;
      delete env.ANTHROPIC_API_KEY;
      delete env.CLAUDE_CODE_OAUTH_TOKEN;
    }
    this.codexInit = { codexPathOverride, env };
    this.model = config.model;
    this.thinkingLevel = config.thinkingLevel ?? 'think';
    this.workingDirectory = config.session?.workingDirectory;
  }

  getSessionId(): string | null {
    return this.thread?.id ?? null;
  }

  getModel(): string | undefined {
    return this.model;
  }

  setModel(model: string): void {
    this.model = model;
    if (this.thread?.id && this.codex) {
      this.thread = this.codex.resumeThread(this.thread.id, this.buildThreadOptions());
    } else {
      this.thread = null;
    }
  }

  setThinkingLevel(level: ThinkingLevel): void {
    this.thinkingLevel = level;
    if (this.thread?.id && this.codex) {
      this.thread = this.codex.resumeThread(this.thread.id, this.buildThreadOptions());
    } else {
      this.thread = null;
    }
  }

  setUltrathinkOverride(enabled: boolean): void {
    this.ultrathinkOverride = enabled;
    if (this.thread?.id && this.codex) {
      this.thread = this.codex.resumeThread(this.thread.id, this.buildThreadOptions());
    }
  }

  updateWorkingDirectory(path: string): void {
    this.workingDirectory = path;
  }

  setAllSources(sources: LoadedSource[]): void {
    this.allSources = sources;
    this.onSourcesListChange?.(sources);
  }

  setSourceServers(
    mcpServers: Record<string, McpServerConfig>,
    _apiServers: Record<string, unknown>,
    intendedSlugs: string[]
  ): void {
    this.sourceMcpServers = mcpServers;
    this.intendedActiveSlugs = new Set(intendedSlugs);
    if (Object.keys(_apiServers).length > 0) {
      this.onDebug?.('[CodexAgent] API sources are not supported yet; ignoring in-process API servers.');
    }
  }

  markSourceUnseen(_slug: string): void {
    // No-op: Codex SDK does not expose source visibility tracking yet.
  }

  respondToPermission(_requestId: string, _allowed: boolean, _alwaysAllow: boolean = false): void {
    // No-op: Permission gating is handled by the SDK/tooling layer.
  }

  forceAbort(): void {
    this.abortController?.abort();
  }

  dispose(): void {
    this.forceAbort();
  }

  private buildThreadOptions(): Record<string, unknown> {
    const options: Record<string, unknown> = {};

    if (this.model) {
      options.model = this.model;
    }

    if (this.workingDirectory) {
      options.workingDirectory = this.workingDirectory;
    }

    // Codex CLI requires either a trusted directory or an explicit opt-out.
    // We default to skipping the git repo check to avoid hard failures in app workspaces.
    options.skipGitRepoCheck = true;

    if (this.ultrathinkOverride || this.thinkingLevel) {
      const level = this.ultrathinkOverride ? 'xhigh' : this.thinkingLevel;
      options.modelReasoningEffort = normalizeThinkingLevelForCodex(
        level as ThinkingLevel,
        this.model
      );
    }

    return options;
  }

  private async ensureCodex(): Promise<CodexType> {
    if (this.codex) return this.codex;
    if (!this.codexPromise) {
      this.codexPromise = (async () => {
        const mod = await import('@openai/codex-sdk');
        const instance = new mod.Codex(this.codexInit);
        this.codex = instance;
        return instance;
      })().catch((error) => {
        this.codexPromise = null;
        throw error;
      });
    }
    return this.codexPromise;
  }

  private async ensureThread(): Promise<CodexThread> {
    if (this.thread) return this.thread;
    const codex = await this.ensureCodex();
    const threadOptions = this.buildThreadOptions();
    const existingId = this.config.session?.sdkSessionId;
    const thread = existingId
      ? (codex as unknown as { resumeThread: (id: string, options?: Record<string, unknown>) => CodexThread })
          .resumeThread(existingId, threadOptions)
      : (codex as unknown as { startThread: (options?: Record<string, unknown>) => CodexThread })
          .startThread(threadOptions);
    this.thread = thread;
    if (thread.id) {
      this.config.onSdkSessionIdUpdate?.(thread.id);
    }
    return thread;
  }

  private buildRunOptions(): Record<string, unknown> {
    const options: Record<string, unknown> = {};

    // Best-effort MCP server support (Codex SDK supports MCP/tool calls)
    if (Object.keys(this.sourceMcpServers).length > 0) {
      options.mcpServers = this.sourceMcpServers;
    }

    return options;
  }

  private extractTextDelta(event: unknown): string | null {
    if (!event || typeof event !== 'object') return null;
    const data = event as Record<string, unknown>;
    const params = data.params as Record<string, unknown> | undefined;
    const delta = (data.delta ?? params?.delta) as Record<string, unknown> | undefined;
    const item = (data.item ?? params?.item) as Record<string, unknown> | undefined;
    const text = (
      delta?.text ??
      params?.text ??
      data.text ??
      data.output_text ??
      data.outputText ??
      item?.text ??
      (item?.content as string | undefined)
    ) as string | undefined;
    return typeof text === 'string' && text.length > 0 ? text : null;
  }

  private extractTextComplete(event: unknown): string | null {
    if (!event || typeof event !== 'object') return null;
    const data = event as Record<string, unknown>;
    const params = data.params as Record<string, unknown> | undefined;
    const item = (data.item ?? params?.item) as Record<string, unknown> | undefined;
    const text = (
      params?.text ??
      data.text ??
      data.output_text ??
      data.outputText ??
      item?.text ??
      (item?.content as string | undefined)
    ) as string | undefined;
    return typeof text === 'string' && text.length > 0 ? text : null;
  }

  private extractToolInfo(event: unknown): { toolName: string; toolUseId: string; input?: Record<string, unknown> } | null {
    if (!event || typeof event !== 'object') return null;
    const data = event as Record<string, unknown>;
    const params = data.params as Record<string, unknown> | undefined;
    const item = (data.item ?? params?.item) as Record<string, unknown> | undefined;
    const toolName = (
      data.tool_name ??
      data.toolName ??
      (data.tool as Record<string, unknown> | undefined)?.name ??
      item?.name ??
      data.name
    ) as string | undefined;
    const toolUseId = (
      data.tool_call_id ??
      data.toolUseId ??
      data.id ??
      (data.tool as Record<string, unknown> | undefined)?.id ??
      item?.id ??
      params?.itemId
    ) as string | undefined;
    const input = (
      data.input ??
      data.arguments ??
      (data.tool as Record<string, unknown> | undefined)?.input ??
      item?.input
    ) as Record<string, unknown> | undefined;

    if (!toolName || !toolUseId) return null;
    return { toolName, toolUseId, input };
  }

  private extractParentToolUseId(event: unknown): string | null {
    if (!event || typeof event !== 'object') return null;
    const data = event as Record<string, unknown>;
    const params = data.params as Record<string, unknown> | undefined;
    const item = (data.item ?? params?.item) as Record<string, unknown> | undefined;
    const parent =
      (data.parent_tool_use_id ??
        data.parentToolUseId ??
        data.parent_id ??
        params?.parent_item_id ??
        params?.parentItemId ??
        item?.parent_id ??
        item?.parentId) as string | undefined;
    return parent || null;
  }

  private extractIntentDisplayName(
    input?: Record<string, unknown>,
    event?: Record<string, unknown>,
    item?: Record<string, unknown>
  ): { intent?: string; displayName?: string } {
    const intent =
      (input?._intent ?? event?.intent ?? item?.intent ?? event?.tool_intent) as string | undefined;
    const displayName =
      (input?._displayName ?? event?.displayName ?? item?._displayName ?? item?.displayName) as string | undefined;
    return {
      intent: typeof intent === 'string' ? intent : undefined,
      displayName: typeof displayName === 'string' ? displayName : undefined,
    };
  }

  private extractEventType(event: unknown): string | null {
    if (!event || typeof event !== 'object') return null;
    const data = event as Record<string, unknown>;
    const type = (data.type ?? data.event ?? data.method) as string | undefined;
    return typeof type === 'string' ? type : null;
  }

  private isItemEvent(type: string): boolean {
    return type.includes('item.') || type.includes('item/') || type.includes('item_');
  }

  private getItemType(event: unknown): string | null {
    if (!event || typeof event !== 'object') return null;
    const data = event as Record<string, unknown>;
    const params = data.params as Record<string, unknown> | undefined;
    const item = (data.item ?? params?.item) as Record<string, unknown> | undefined;
    const itemType = (item?.type ?? data.item_type ?? data.itemType) as string | undefined;
    return typeof itemType === 'string' ? itemType : null;
  }

  private normalizeToolResult(event: unknown): { toolUseId: string; result: string; isError: boolean } | null {
    if (!event || typeof event !== 'object') return null;
    const data = event as Record<string, unknown>;
    const params = data.params as Record<string, unknown> | undefined;
    const item = (data.item ?? params?.item) as Record<string, unknown> | undefined;
    const stderr = (data.stderr ?? params?.stderr ?? item?.stderr ?? item?.error) as string | undefined;
    const exitCode = (data.exit_code ?? data.exitCode ?? params?.exit_code ?? params?.exitCode ?? item?.exit_code ?? item?.exitCode) as number | undefined;
    const result = (
      data.result ??
      data.output ??
      params?.output ??
      params?.delta ??
      item?.output ??
      item?.result ??
      item?.aggregatedOutput
    ) as string | undefined;
    const toolUseId = (data.tool_call_id ?? data.toolUseId ?? data.id ?? item?.id ?? params?.itemId) as string | undefined;
    const isError = Boolean(data.is_error ?? data.isError ?? item?.status === 'failed' ?? item?.error ?? (typeof exitCode === 'number' && exitCode !== 0));
    if (!toolUseId || result === undefined) return null;
    const resultWithMeta = stderr
      ? `${String(result)}\n\n[stderr]\n${stderr}`
      : String(result);
    return { toolUseId, result: resultWithMeta, isError };
  }

  private mapCommandItemToTool(item: Record<string, unknown>): { toolName: string; toolUseId: string; input?: Record<string, unknown> } | null {
    const command = item.command ?? item.cmd ?? item.shell ?? item.input;
    const id = item.id as string | undefined;
    if (!id) return null;
    return {
      toolName: 'bash',
      toolUseId: id,
      input: { command },
    };
  }

  private mapMcpItemToTool(item: Record<string, unknown>): { toolName: string; toolUseId: string; input?: Record<string, unknown> } | null {
    const toolName = (item.tool_name ?? item.toolName ?? item.tool ?? item.name) as string | undefined;
    const id = item.id as string | undefined;
    const input = (item.input ?? item.arguments) as Record<string, unknown> | undefined;
    if (!toolName || !id) return null;
    return { toolName: this.normalizeMcpToolName(toolName, item), toolUseId: id, input };
  }

  private normalizeMcpToolName(toolName: string, item?: Record<string, unknown>): string {
    // Preserve already-normalized MCP tool names
    if (toolName.startsWith('mcp__')) return toolName;

    const sourceHint = (item?.source ?? item?.provider ?? item?.mcp ?? item?.server ?? item?.client) as string | undefined;

    // Normalize "mcp.source.tool" or "source.tool"
    const dotParts = toolName.split('.');
    if (dotParts.length === 3 && dotParts[0] === 'mcp') {
      return `mcp__${dotParts[1]}__${dotParts[2]}`;
    }
    if (dotParts.length === 2) {
      return `mcp__${dotParts[0]}__${dotParts[1]}`;
    }

    // Normalize "source:tool"
    const colonParts = toolName.split(':');
    if (colonParts.length === 2) {
      return `mcp__${colonParts[0]}__${colonParts[1]}`;
    }

    // Normalize "source/tool"
    const slashParts = toolName.split('/');
    if (slashParts.length === 2) {
      return `mcp__${slashParts[0]}__${slashParts[1]}`;
    }

    // Fall back to source hint if present
    if (sourceHint) {
      return `mcp__${sourceHint}__${toolName}`;
    }

    return toolName;
  }

  async *chat(message: string, attachments?: FileAttachment[]): AsyncIterable<AgentEvent> {
    this.onDebug?.('[CodexAgent] Starting chat');
    debug('[CodexAgent] Message:', message);

    if (attachments && attachments.length > 0) {
      yield { type: 'info', message: 'Codex SDK currently ignores file attachments.' };
    }

    const thread = await this.ensureThread();
    this.abortController = new AbortController();

    const options = this.buildRunOptions();
    (options as Record<string, unknown>).signal = this.abortController.signal;

    let finalText = '';
    if (thread.runStreamed) {
      const streamed = await thread.runStreamed(message, options);
      const events = (streamed as { events?: AsyncIterable<unknown> }).events ?? (streamed as AsyncIterable<unknown>);
      for await (const event of events) {
        const type = this.extractEventType(event) ?? '';
        if (type === 'thread.started') {
          const threadId = (event as Record<string, unknown>).thread_id;
          if (typeof threadId === 'string' && threadId.length > 0) {
            this.config.onSdkSessionIdUpdate?.(threadId);
          }
        }
        const textDelta = this.extractTextDelta(event);
        const textComplete = this.extractTextComplete(event);
        const toolInfo = this.extractToolInfo(event);
        const itemType = this.getItemType(event);
        const normalizedItemType = itemType
          ?.replaceAll('_', '')
          ?.replaceAll('-', '')
          ?.toLowerCase();
        const parentToolUseId = this.extractParentToolUseId(event) ?? undefined;

        if (textDelta && (type.includes('delta') || normalizedItemType === 'agentmessage')) {
          finalText += textDelta;
          yield { type: 'text_delta', text: textDelta };
          continue;
        }

        if (type === 'item/commandExecution/outputDelta') {
          const toolResult = this.normalizeToolResult(event);
          if (toolResult) {
            yield { type: 'tool_result', toolUseId: toolResult.toolUseId, result: toolResult.result, isError: toolResult.isError };
          }
          continue;
        }

        if (type === 'item/fileChange/outputDelta') {
          const toolResult = this.normalizeToolResult(event);
          if (toolResult) {
            yield { type: 'tool_result', toolUseId: toolResult.toolUseId, result: toolResult.result, isError: toolResult.isError };
          }
          continue;
        }

        if (this.isItemEvent(type) && normalizedItemType === 'commandexecution') {
          const item = ((event as Record<string, unknown>).item ?? (event as Record<string, unknown>).params?.item) as Record<string, unknown> | undefined;
          if (item) {
            const mapped = this.mapCommandItemToTool(item);
            if (mapped) {
              const fields = this.extractIntentDisplayName(mapped.input, event as Record<string, unknown>, item);
              if (parentToolUseId) {
                this.toolParents.set(mapped.toolUseId, parentToolUseId);
              }
              yield {
                type: 'tool_start',
                toolName: mapped.toolName,
                toolUseId: mapped.toolUseId,
                input: mapped.input ?? {},
                intent: fields.intent,
                displayName: fields.displayName,
                parentToolUseId,
              };
            }
          }
          continue;
        }

        if (this.isItemEvent(type) && normalizedItemType === 'mcptoolcall') {
          const item = ((event as Record<string, unknown>).item ?? (event as Record<string, unknown>).params?.item) as Record<string, unknown> | undefined;
          if (item) {
            const mapped = this.mapMcpItemToTool(item);
            if (mapped) {
              const fields = this.extractIntentDisplayName(mapped.input, event as Record<string, unknown>, item);
              if (parentToolUseId) {
                this.toolParents.set(mapped.toolUseId, parentToolUseId);
              }
              yield {
                type: 'tool_start',
                toolName: mapped.toolName,
                toolUseId: mapped.toolUseId,
                input: mapped.input ?? {},
                intent: fields.intent,
                displayName: fields.displayName,
                parentToolUseId,
              };
            }
          }
          continue;
        }

        if (toolInfo && type.includes('tool')) {
          const fields = this.extractIntentDisplayName(toolInfo.input, event as Record<string, unknown>);
          if (parentToolUseId) {
            this.toolParents.set(toolInfo.toolUseId, parentToolUseId);
          }
          yield {
            type: 'tool_start',
            toolName: toolInfo.toolName,
            toolUseId: toolInfo.toolUseId,
            input: toolInfo.input ?? {},
            intent: fields.intent,
            displayName: fields.displayName,
            parentToolUseId,
          };
          continue;
        }

        const toolResult = this.normalizeToolResult(event);
        if (toolResult && (type.includes('completed') || type === 'item/completed')) {
          if (parentToolUseId && !this.toolParents.has(toolResult.toolUseId)) {
            this.toolParents.set(toolResult.toolUseId, parentToolUseId);
            yield { type: 'parent_update', toolUseId: toolResult.toolUseId, parentToolUseId };
          }
          yield { type: 'tool_result', toolUseId: toolResult.toolUseId, result: toolResult.result, isError: toolResult.isError };
          continue;
        }

        if (textComplete && (type.includes('completed') || normalizedItemType === 'agentmessage')) {
          finalText = textComplete;
          yield { type: 'text_complete', text: textComplete };
        }
      }
    } else {
      const runResult = await thread.run(message, options);
      const resultText = this.extractTextComplete(runResult);

      const events = (runResult as { events?: AsyncIterable<unknown> | Iterable<unknown> }).events;
      if (events) {
        if ((events as AsyncIterable<unknown>)[Symbol.asyncIterator]) {
          for await (const event of events as AsyncIterable<unknown>) {
            const type = this.extractEventType(event) ?? '';
            const textDelta = this.extractTextDelta(event);
            const textComplete = this.extractTextComplete(event);
            const toolInfo = this.extractToolInfo(event);
            const parentToolUseId = this.extractParentToolUseId(event) ?? undefined;

            if (textDelta) {
              finalText += textDelta;
              yield { type: 'text_delta', text: textDelta };
              continue;
            }

            if (toolInfo && type.includes('tool')) {
              const fields = this.extractIntentDisplayName(toolInfo.input, event as Record<string, unknown>);
              if (parentToolUseId) {
                this.toolParents.set(toolInfo.toolUseId, parentToolUseId);
              }
              yield {
                type: 'tool_start',
                toolName: toolInfo.toolName,
                toolUseId: toolInfo.toolUseId,
                input: toolInfo.input ?? {},
                intent: fields.intent,
                displayName: fields.displayName,
                parentToolUseId,
              };
              continue;
            }

            const toolResult = this.normalizeToolResult(event);
            if (toolResult && type.includes('completed')) {
              if (parentToolUseId && !this.toolParents.has(toolResult.toolUseId)) {
                this.toolParents.set(toolResult.toolUseId, parentToolUseId);
                yield { type: 'parent_update', toolUseId: toolResult.toolUseId, parentToolUseId };
              }
              yield { type: 'tool_result', toolUseId: toolResult.toolUseId, result: toolResult.result, isError: toolResult.isError };
              continue;
            }

            if (textComplete) {
              finalText = textComplete;
              yield { type: 'text_complete', text: textComplete };
            }
          }
        } else {
          for (const event of events as Iterable<unknown>) {
            const textDelta = this.extractTextDelta(event);
            if (textDelta) {
              finalText += textDelta;
              yield { type: 'text_delta', text: textDelta };
            }
          }
        }
      }

      if (finalText.length === 0 && resultText) {
        finalText = resultText;
      }
    }

    // Fallback if no explicit completion event was observed
    if (finalText.length === 0 && resultText) {
      finalText = resultText;
    }

    if (finalText.length > 0) {
      yield { type: 'text_complete', text: finalText };
    }

    yield { type: 'complete' };
  }
}
