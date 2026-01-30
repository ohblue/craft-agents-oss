/**
 * Thinking Level Configuration
 *
 * Three-tier thinking system for extended reasoning:
 * - OFF: No extended thinking (0 tokens)
 * - Think: Standard reasoning (moderate token budget)
 * - Max Think: Deep reasoning (maximum token budget)
 *
 * Session-level setting with workspace defaults.
 * Ultrathink override can boost to Max Think for a single message.
 */

export type ThinkingLevel = 'off' | 'think' | 'max' | 'low' | 'medium' | 'high' | 'xhigh';

export interface ThinkingLevelDefinition {
  id: ThinkingLevel;
  name: string;
  description: string;
}

/**
 * Available thinking levels with display metadata.
 * Used in UI dropdowns and for validation.
 *
 * Labels are user-facing and should be consistent across all UI surfaces
 * (model dropdown, workspace settings, etc.)
 */
export const THINKING_LEVELS: readonly ThinkingLevelDefinition[] = [
  { id: 'off', name: 'No Thinking', description: 'Fastest responses, no reasoning' },
  { id: 'think', name: 'Thinking', description: 'Balanced speed and reasoning' },
  { id: 'max', name: 'Max Thinking', description: 'Deepest reasoning for complex tasks' },
  { id: 'low', name: 'Low', description: 'Light reasoning' },
  { id: 'medium', name: 'Medium', description: 'Balanced reasoning depth' },
  { id: 'high', name: 'High', description: 'Deeper reasoning' },
  { id: 'xhigh', name: 'Ultra High', description: 'Deepest reasoning depth' },
] as const;

export const CLAUDE_THINKING_LEVELS: readonly ThinkingLevelDefinition[] = [
  { id: 'off', name: 'No Thinking', description: 'Fastest responses, no reasoning' },
  { id: 'think', name: 'Thinking', description: 'Balanced speed and reasoning' },
  { id: 'max', name: 'Max Thinking', description: 'Deepest reasoning for complex tasks' },
] as const;

export const CODEX_THINKING_LEVELS: readonly ThinkingLevelDefinition[] = [
  { id: 'low', name: 'Low', description: 'Light reasoning' },
  { id: 'medium', name: 'Medium', description: 'Balanced reasoning depth' },
  { id: 'high', name: 'High', description: 'Deeper reasoning' },
  { id: 'xhigh', name: 'Ultra High', description: 'Deepest reasoning depth' },
] as const;

export const CODEX_MINI_THINKING_LEVELS: readonly ThinkingLevelDefinition[] = [
  { id: 'medium', name: 'Medium', description: 'Balanced reasoning depth' },
  { id: 'high', name: 'High', description: 'Deeper reasoning' },
] as const;

/** Default thinking level for new sessions when workspace has no default */
export const DEFAULT_THINKING_LEVEL: ThinkingLevel = 'think';

/**
 * Token budgets per model family.
 *
 * Haiku max is 8k per Anthropic docs.
 * Sonnet/Opus can use up to 128k, but Anthropic recommends ≤32k for real-time use
 * (above 32k, batch processing is suggested to avoid timeouts).
 * Also, budget_tokens must be < max_tokens, so 64k leaves no room for response.
 *
 * "Think" level matches Claude Code's `think` trigger word budget.
 * "Max Think" is the recommended max for real-time streaming.
 */
const TOKEN_BUDGETS = {
  haiku: {
    off: 0,
    think: 4_000,
    max: 8_000,
  },
  default: {
    off: 0,
    think: 10_000,
    max: 32_000,
  },
} as const;

/**
 * Get the thinking token budget for a given level and model.
 *
 * @param level - The thinking level (off, think, max)
 * @param modelId - The model ID (e.g., 'claude-haiku-4-5-20251001')
 * @returns Number of thinking tokens to allocate
 */
export function getThinkingTokens(level: ThinkingLevel, modelId: string): number {
  const isHaiku = modelId.toLowerCase().includes('haiku');
  const budgets = isHaiku ? TOKEN_BUDGETS.haiku : TOKEN_BUDGETS.default;
  const normalized = normalizeThinkingLevelForClaude(level);
  return budgets[normalized];
}

/**
 * Get display name for a thinking level.
 */
export function getThinkingLevelName(level: ThinkingLevel): string {
  const def = THINKING_LEVELS.find((l) => l.id === level);
  return def?.name ?? level;
}

/**
 * Validate that a value is a valid ThinkingLevel.
 */
export function isValidThinkingLevel(value: unknown): value is ThinkingLevel {
  return value === 'off'
    || value === 'think'
    || value === 'max'
    || value === 'low'
    || value === 'medium'
    || value === 'high'
    || value === 'xhigh';
}

export function normalizeThinkingLevelForClaude(level: ThinkingLevel): 'off' | 'think' | 'max' {
  if (level === 'off' || level === 'think' || level === 'max') {
    return level;
  }
  if (level === 'low') return 'off';
  if (level === 'medium') return 'think';
  return 'max';
}

export function normalizeThinkingLevelForCodex(
  level: ThinkingLevel,
  modelId?: string
): 'low' | 'medium' | 'high' | 'xhigh' {
  const isMini = !!modelId && modelId.includes('codex-mini');
  let normalized: 'low' | 'medium' | 'high' | 'xhigh' = 'medium';

  if (level === 'low' || level === 'medium' || level === 'high' || level === 'xhigh') {
    normalized = level;
  } else if (level === 'off') {
    normalized = 'low';
  } else if (level === 'think') {
    normalized = 'medium';
  } else {
    normalized = 'high';
  }

  if (isMini) {
    if (normalized === 'low') return 'medium';
    if (normalized === 'xhigh') return 'high';
  }

  return normalized;
}

export function getThinkingLevelsForModel(authType?: string | null, modelId?: string | null): readonly ThinkingLevelDefinition[] {
  if (authType === 'codex_oauth') {
    if (modelId?.includes('codex-mini')) return CODEX_MINI_THINKING_LEVELS;
    return CODEX_THINKING_LEVELS;
  }
  return CLAUDE_THINKING_LEVELS;
}
