# Codex Subscription Support (Implementation Summary)

## Goal
Add Codex subscription login support alongside existing Claude Pro/Max OAuth and API key flows. Codex auth should reuse the local login performed by the Codex CLI / VSCode plugin, reading `~/.codex/auth.json`. When selected, the app should run the Codex Agent SDK (not the Anthropic SDK). MCP/tool calls must be supported.

## Key Decisions
- **Auth source**: reuse `~/.codex/auth.json`; no token refresh or storage in Craft credentials.
- **Login flow**: if not logged in, allow opening a terminal that runs `codex login`.
- **Runner**: use `@openai/codex-sdk` with a new `CodexAgent` class; keep existing `CraftAgent` for Claude.
- **No Codex API key login** at this time.

## Auth File Format (Observed)
```
{
  "OPENAI_API_KEY": null,
  "tokens": {
    "id_token": "...",
    "access_token": "...",
    "refresh_token": "...",
    "account_id": "..."
  },
  "last_refresh": "2026-01-28T06:22:00.802674Z"
}
```

## User Flow
1. Onboarding: user chooses **Codex Subscription**.
2. Credentials step:
   - Button to open terminal and run `codex login`.
   - Button to check login status (reads `~/.codex/auth.json`).
3. If login exists, config saved with `authType = codex_oauth`.
4. Sessions use **CodexAgent** when `authType` is `codex_oauth`.

## Files Added
- `packages/shared/src/auth/codex-auth.ts`
- `packages/shared/src/agent/codex-agent.ts`
- `docs/codex-subscription.md` (this file)

## Files Updated (High-Level)
- Auth types and state:
  - `packages/core/src/types/workspace.ts`
  - `packages/shared/src/auth/types.ts`
  - `packages/shared/src/auth/state.ts`
  - `packages/shared/src/config/validators.ts`
  - `packages/shared/src/agent/diagnostics.ts`
  - `packages/shared/src/auth/__tests__/state.test.ts`
- UI & onboarding:
  - `apps/electron/src/renderer/components/onboarding/APISetupStep.tsx`
  - `apps/electron/src/renderer/components/onboarding/CredentialsStep.tsx`
  - `apps/electron/src/renderer/components/onboarding/OnboardingWizard.tsx`
  - `apps/electron/src/renderer/hooks/useOnboarding.ts`
  - `apps/electron/src/renderer/App.tsx`
  - `apps/electron/src/renderer/pages/settings/AppSettingsPage.tsx`
- IPC & preload:
  - `apps/electron/src/shared/types.ts`
  - `apps/electron/src/preload/index.ts`
  - `apps/electron/src/main/onboarding.ts`
- Session routing:
  - `apps/electron/src/main/sessions.ts`
- Dependencies:
  - `packages/shared/package.json` (`@openai/codex-sdk`)

## Codex Auth (Shared)
`packages/shared/src/auth/codex-auth.ts` provides:
- `getCodexAuthStatus()` -> { hasToken, accessToken, refreshToken, accountId, lastRefresh }
- `getCodexAuthFilePath()` -> `~/.codex/auth.json`

## IPC Endpoints
Added to `IPC_CHANNELS`:
- `ONBOARDING_CHECK_CODEX_AUTH`
- `ONBOARDING_OPEN_CODEX_LOGIN_TERMINAL`

Added to `ElectronAPI`:
- `checkCodexAuth()`
- `openCodexLoginTerminal()`

## Terminal Login Behavior
Implemented in `apps/electron/src/main/onboarding.ts`:
- macOS: `osascript` -> Terminal.app `do script "codex login"`
- Windows: `cmd.exe /k codex login`
- Linux: tries `x-terminal-emulator`, `gnome-terminal`, `konsole`, `xterm` (best-effort)

## CodexAgent Summary
`packages/shared/src/agent/codex-agent.ts`:
- Uses `@openai/codex-sdk`.
- Streams events when SDK supports `runStreamed()`.
- Maps Codex events to app `AgentEvent` types:
  - `text_delta`, `text_complete`, `tool_start`, `tool_result`, `parent_update`, `complete`.
- MCP tool name normalization:
  - `mcp.source.tool`, `source.tool`, `source:tool`, `source/tool` -> `mcp__source__tool`
- Tool result enhancements:
  - `stderr` appended to output; `exit_code != 0` => `isError: true`.

## Session Routing
In `apps/electron/src/main/sessions.ts`:
- `reinitializeAuth()` clears Anthropic env vars when `codex_oauth` is selected.
- `getOrCreateAgent()` uses `CodexAgent` when `authType === codex_oauth`.

## Tests
- `bun test` passed (618 tests, 0 failures).

## Known Limitations
- Codex runner currently ignores in-process API sources (non-MCP). It logs a debug message.
- Attachments are not fully supported by CodexAgent yet (best-effort warning only).

## How To Verify Locally
1. Run `codex login` in a terminal.
2. Launch app, choose **Codex Subscription** during onboarding.
3. Click **Check login status** to complete setup.
4. Start a chat and confirm:
   - messages respond via Codex SDK
   - MCP tools are invoked (if configured)
