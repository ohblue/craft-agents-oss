# Repository Guidelines

## Project Structure & Module Organization
- `apps/electron/` hosts the primary desktop Electron app (main, preload, renderer).
- `apps/viewer/` contains the lightweight viewer app.
- `packages/core/` holds shared types.
- `packages/shared/` contains core business logic (agents, auth, MCP, sessions, sources).
- `packages/ui/` provides shared React UI components.
- Tests live alongside code in `__tests__/` folders or in `packages/shared/tests/` (e.g., `packages/shared/src/auth/__tests__/state.test.ts`).

## Build, Test, and Development Commands
- `bun install` installs dependencies.
- `bun run electron:dev` starts the Electron app with hot reload.
- `bun run electron:start` builds and runs the Electron app.
- `bun run typecheck:all` runs TypeScript checks for core + shared.
- `bun test` runs the Bun test suite.
- `bun run lint:electron` runs ESLint for the Electron renderer.
- `bun run viewer:dev` / `viewer:build` / `viewer:preview` manages the viewer app.

## Coding Style & Naming Conventions
- TypeScript is the default language; modules are ESM (`"type": "module"`).
- Use 2-space indentation and match the surrounding file style.
- Follow existing naming patterns; prefer descriptive names over abbreviations.
- Electron renderer code is linted via `apps/electron/eslint.config.mjs` (React hooks + custom Craft rules).

## Testing Guidelines
- Use Bun’s test runner via `bun test`.
- Name tests with `*.test.ts` and place them in `__tests__/` folders or `packages/shared/tests/`.
- Add coverage for new logic in `packages/shared/` and UI behavior in `packages/ui/` where relevant.

## Commit & Pull Request Guidelines
- Commit messages are short and descriptive (e.g., `Fix link formatting in README.md`).
- Branch naming follows `feature/*`, `fix/*`, `refactor/*`, `docs/*` (see `CONTRIBUTING.md`).
- PRs should include: clear summary, testing steps, and screenshots for UI changes.

## Configuration & Security Notes
- Copy `.env.example` to `.env` for OAuth credentials when needed.
- Local app config and encrypted credentials live in `~/.craft-agent/`.
- Sensitive environment variables are filtered when spawning local MCP servers.
