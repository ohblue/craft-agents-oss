import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { debug } from '../utils/debug.ts';

export interface CodexAuthTokens {
  id_token?: string | null;
  access_token?: string | null;
  refresh_token?: string | null;
  account_id?: string | null;
}

export interface CodexAuthFile {
  OPENAI_API_KEY?: string | null;
  tokens?: CodexAuthTokens | null;
  last_refresh?: string | null;
}

export interface CodexAuthStatus {
  hasToken: boolean;
  accessToken: string | null;
  refreshToken: string | null;
  accountId: string | null;
  lastRefresh: string | null;
}

const CODEX_AUTH_PATH = join(homedir(), '.codex', 'auth.json');

export function readCodexAuthFile(): CodexAuthFile | null {
  try {
    if (!existsSync(CODEX_AUTH_PATH)) {
      return null;
    }
    const raw = readFileSync(CODEX_AUTH_PATH, 'utf-8');
    return JSON.parse(raw) as CodexAuthFile;
  } catch (error) {
    debug(`[codex-auth] Failed to read ${CODEX_AUTH_PATH}:`, error);
    return null;
  }
}

export function getCodexAuthStatus(): CodexAuthStatus {
  const file = readCodexAuthFile();
  const tokens = file?.tokens ?? null;

  const accessToken = tokens?.access_token ?? null;
  const refreshToken = tokens?.refresh_token ?? null;
  const accountId = tokens?.account_id ?? null;
  const lastRefresh = file?.last_refresh ?? null;

  return {
    hasToken: !!accessToken,
    accessToken,
    refreshToken,
    accountId,
    lastRefresh,
  };
}

export function getCodexAccessToken(): string | null {
  return getCodexAuthStatus().accessToken;
}

export function getCodexAuthFilePath(): string {
  return CODEX_AUTH_PATH;
}
