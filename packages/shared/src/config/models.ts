/**
 * Centralized model definitions for the entire application.
 * Update model IDs here when new versions are released.
 */

import type { AuthType } from '@craft-agent/core/types';

export interface ModelDefinition {
  id: string;
  name: string;
  shortName: string;
  description: string;
  /** Known context window size in tokens (used as fallback before SDK reports usage) */
  contextWindow?: number;
}

// ============================================
// USER-SELECTABLE MODELS (shown in UI)
// ============================================

export const MODELS: ModelDefinition[] = [
  { id: 'claude-opus-4-5-20251101', name: 'Opus 4.5', shortName: 'Opus', description: 'Most capable', contextWindow: 200000 },
  { id: 'claude-sonnet-4-5-20250929', name: 'Sonnet 4.5', shortName: 'Sonnet', description: 'Balanced', contextWindow: 200000 },
  { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5', shortName: 'Haiku', description: 'Fast & efficient', contextWindow: 200000 },
];

export const CODEX_MODELS: ModelDefinition[] = [
  { id: 'gpt-5.2-codex', name: 'GPT-5.2 Codex', shortName: '5.2 Codex', description: 'Most advanced agentic coding' },
  { id: 'gpt-5.2', name: 'GPT-5.2', shortName: '5.2', description: 'Best general agentic model' },
  { id: 'gpt-5.1-codex-max', name: 'GPT-5.1 Codex Max', shortName: '5.1 Max', description: 'Long-horizon coding tasks' },
  { id: 'gpt-5.1-codex-mini', name: 'GPT-5.1 Codex Mini', shortName: '5.1 Mini', description: 'Cost-effective coding model' },
];

// ============================================
// PURPOSE-SPECIFIC DEFAULTS
// ============================================

/** Default model for main chat (user-facing) */
export const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';

/** Model for agent definition extraction (always high quality) */
export const EXTRACTION_MODEL = 'claude-opus-4-5-20251101';

/** Model for API response summarization (cost efficient) */
export const SUMMARIZATION_MODEL = 'claude-haiku-4-5-20251001';

/** Model for instruction updates (high quality for accurate document editing) */
export const INSTRUCTION_UPDATE_MODEL = 'claude-opus-4-5-20251101';

/** Codex defaults for Codex subscription */
export const DEFAULT_CODEX_MODEL = 'gpt-5.2-codex';
export const EXTRACTION_CODEX_MODEL = 'gpt-5.2-codex';
export const SUMMARIZATION_CODEX_MODEL = 'gpt-5.1-codex-mini';
export const INSTRUCTION_UPDATE_CODEX_MODEL = 'gpt-5.2-codex';

// ============================================
// HELPER FUNCTIONS
// ============================================

export function getSelectableModels(authType?: AuthType | null): ModelDefinition[] {
  if (authType === 'codex_oauth') return CODEX_MODELS;
  return MODELS;
}

/** Get display name for a model ID (full name with version) */
export function getModelDisplayName(modelId: string): string {
  const model = MODELS.find(m => m.id === modelId) || CODEX_MODELS.find(m => m.id === modelId);
  if (model) return model.name;
  // Fallback: strip prefix and date suffix
  return modelId.replace('claude-', '').replace(/-\d{8}$/, '');
}

/** Get short display name for a model ID (without version number) */
export function getModelShortName(modelId: string): string {
  const model = MODELS.find(m => m.id === modelId) || CODEX_MODELS.find(m => m.id === modelId);
  if (model) return model.shortName;
  // For provider-prefixed IDs (e.g. "openai/gpt-5"), show just the model part
  if (modelId.includes('/')) {
    return modelId.split('/').pop() || modelId;
  }
  // Fallback: strip claude- prefix and date suffix
  return modelId.replace('claude-', '').replace(/-[\d.-]+$/, '');
}

/** Get known context window size for a model ID (fallback when SDK hasn't reported usage yet) */
export function getModelContextWindow(modelId: string): number | undefined {
  return MODELS.find(m => m.id === modelId)?.contextWindow
    ?? CODEX_MODELS.find(m => m.id === modelId)?.contextWindow;
}

/** Check if model is an Opus model (for cache TTL decisions) */
export function isOpusModel(modelId: string): boolean {
  return modelId.includes('opus');
}

/**
 * Check if a model ID refers to a Claude model.
 * Handles both direct Anthropic IDs (e.g. "claude-sonnet-4-5-20250929")
 * and provider-prefixed IDs (e.g. "anthropic/claude-sonnet-4" via OpenRouter).
 */
export function isClaudeModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return lower.startsWith('claude-') || lower.includes('/claude');
}

export function isCodexModel(modelId: string): boolean {
  return CODEX_MODELS.some(m => m.id === modelId);
}
