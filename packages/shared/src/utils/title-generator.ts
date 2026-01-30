/**
 * Session title generator utility.
 * Uses Claude Agent SDK query() for all auth types (API Key, Claude OAuth).
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { getDefaultOptions } from '../agent/options.ts';
import { SUMMARIZATION_MODEL, SUMMARIZATION_CODEX_MODEL } from '../config/models.ts';
import { getAuthType, getProxyEnabled, getProxyUrl, resolveModelId } from '../config/storage.ts';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

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

async function generateTitleWithCodex(prompt: string): Promise<string | null> {
  try {
    const mod = await import('@openai/codex-sdk');
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }

    // Ensure Codex CLI uses ~/.codex/auth.json instead of inherited API keys
    delete env.OPENAI_API_KEY;
    delete env.CODEX_API_KEY;
    delete env.OPENAI_BASE_URL;
    delete env.OPENAI_API_BASE;
    delete env.ANTHROPIC_API_KEY;
    delete env.CLAUDE_CODE_OAUTH_TOKEN;

    const proxyEnabled = getProxyEnabled();
    const proxyUrl = getProxyUrl();
    if (proxyEnabled && proxyUrl) {
      env.HTTP_PROXY = proxyUrl;
      env.HTTPS_PROXY = proxyUrl;
      env.ALL_PROXY = proxyUrl;
    }

    const codexPathOverride = resolveCodexExecutable() ?? 'codex';
    const codex = new mod.Codex({ codexPathOverride, env });
    const thread = codex.startThread({
      model: SUMMARIZATION_CODEX_MODEL,
      modelReasoningEffort: 'low',
      skipGitRepoCheck: true,
      approvalPolicy: 'never',
    });

    const result = await thread.run(prompt);
    const trimmed = (result?.finalResponse ?? '').trim();
    if (trimmed && trimmed.length > 0 && trimmed.length < 100) {
      return trimmed;
    }
    return null;
  } catch (error) {
    console.error('[title-generator] Failed to generate title with Codex:', error);
    return null;
  }
}

/**
 * Generate a task-focused title (2-5 words) from the user's first message.
 * Extracts what the user is trying to accomplish, framing conversations as tasks.
 * Uses SDK query() which handles all auth types via getDefaultOptions().
 *
 * @param userMessage - The user's first message
 * @returns Generated task title, or null if generation fails
 */
export async function generateSessionTitle(
  userMessage: string
): Promise<string | null> {
  try {
    const userSnippet = userMessage.slice(0, 500);

    const prompt = [
      'What is the user trying to do? Reply with ONLY a short task description (2-5 words).',
      'Start with a verb. Use plain text only - no markdown.',
      'Examples: "Fix authentication bug", "Add dark mode", "Refactor API layer", "Explain codebase structure"',
      '',
      'User: ' + userSnippet,
      '',
      'Task:',
    ].join('\n');

    const authType = getAuthType();
    if (authType === 'codex_oauth') {
      return await generateTitleWithCodex(prompt);
    }

    const defaultOptions = getDefaultOptions();
    const options = {
      ...defaultOptions,
      model: resolveModelId(SUMMARIZATION_MODEL),
      maxTurns: 1,
    };

    let title = '';

    for await (const message of query({ prompt, options })) {
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'text') {
            title += block.text;
          }
        }
      }
    }

    const trimmed = title.trim();

    // Validate: reasonable length, not empty
    if (trimmed && trimmed.length > 0 && trimmed.length < 100) {
      return trimmed;
    }

    return null;
  } catch (error) {
    console.error('[title-generator] Failed to generate title:', error);
    return null;
  }
}

/**
 * Regenerate a session title based on recent messages.
 * Uses the most recent user messages to capture what the session has evolved into,
 * rather than just the initial topic.
 *
 * @param recentUserMessages - The last few user messages (most recent context)
 * @param lastAssistantResponse - The most recent assistant response
 * @returns Generated title reflecting current session focus, or null if generation fails
 */
export async function regenerateSessionTitle(
  recentUserMessages: string[],
  lastAssistantResponse: string
): Promise<string | null> {
  try {
    // Combine recent user messages, taking up to 300 chars from each
    const userContext = recentUserMessages
      .map((msg) => msg.slice(0, 300))
      .join('\n\n');
    const assistantSnippet = lastAssistantResponse.slice(0, 500);

    const prompt = [
      'Based on these recent messages, what is the current focus of this conversation?',
      'Reply with ONLY a short task description (2-5 words).',
      'Start with a verb. Use plain text only - no markdown.',
      'Examples: "Fix authentication bug", "Add dark mode", "Refactor API layer", "Explain codebase structure"',
      '',
      'Recent user messages:',
      userContext,
      '',
      'Latest assistant response:',
      assistantSnippet,
      '',
      'Current focus:',
    ].join('\n');

    const authType = getAuthType();
    if (authType === 'codex_oauth') {
      return await generateTitleWithCodex(prompt);
    }

    const defaultOptions = getDefaultOptions();
    const options = {
      ...defaultOptions,
      model: resolveModelId(SUMMARIZATION_MODEL),
      maxTurns: 1,
    };

    let title = '';

    for await (const message of query({ prompt, options })) {
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'text') {
            title += block.text;
          }
        }
      }
    }

    const trimmed = title.trim();

    if (trimmed && trimmed.length > 0 && trimmed.length < 100) {
      return trimmed;
    }

    return null;
  } catch (error) {
    console.error('[title-generator] Failed to regenerate title:', error);
    return null;
  }
}
