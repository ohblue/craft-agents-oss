/**
 * CredentialsStep - Onboarding step wrapper for API key or OAuth flow
 *
 * Thin wrapper that composes ApiKeyInput or OAuthConnect controls
 * with StepFormLayout for the onboarding wizard context.
 */

import { ExternalLink, Terminal } from "lucide-react"
import type { ApiSetupMethod } from "./APISetupStep"
import { StepFormLayout, BackButton, ContinueButton } from "./primitives"
import { Button } from "@/components/ui/button"
import {
  ApiKeyInput,
  type ApiKeyStatus,
  type ApiKeySubmitData,
  OAuthConnect,
  type OAuthStatus,
} from "../apisetup"

export type CredentialStatus = ApiKeyStatus | OAuthStatus

interface CredentialsStepProps {
  apiSetupMethod: ApiSetupMethod
  status: CredentialStatus
  errorMessage?: string
  onSubmit: (data: ApiKeySubmitData) => void
  onStartOAuth?: () => void
  onCheckCodexAuth?: () => void
  onOpenCodexLogin?: () => void
  onBack: () => void
  // Two-step OAuth flow
  isWaitingForCode?: boolean
  onSubmitAuthCode?: (code: string) => void
  onCancelOAuth?: () => void
}

export function CredentialsStep({
  apiSetupMethod,
  status,
  errorMessage,
  onSubmit,
  onStartOAuth,
  onCheckCodexAuth,
  onOpenCodexLogin,
  onBack,
  isWaitingForCode,
  onSubmitAuthCode,
  onCancelOAuth,
}: CredentialsStepProps) {
  const isClaudeOAuth = apiSetupMethod === 'claude_oauth'
  const isCodexOAuth = apiSetupMethod === 'codex_oauth'

  // --- OAuth flow ---
  if (isClaudeOAuth) {
    // Waiting for authorization code entry
    if (isWaitingForCode) {
      return (
        <StepFormLayout
          title="Enter Authorization Code"
          description="Copy the code from the browser page and paste it below."
          actions={
            <>
              <BackButton onClick={onCancelOAuth} disabled={status === 'validating'}>Cancel</BackButton>
              <ContinueButton
                type="submit"
                form="auth-code-form"
                disabled={false}
                loading={status === 'validating'}
                loadingText="Connecting..."
              />
            </>
          }
        >
          <OAuthConnect
            status={status as OAuthStatus}
            errorMessage={errorMessage}
            isWaitingForCode={true}
            onStartOAuth={onStartOAuth!}
            onSubmitAuthCode={onSubmitAuthCode}
            onCancelOAuth={onCancelOAuth}
          />
        </StepFormLayout>
      )
    }

    return (
      <StepFormLayout
        title="Connect Claude Account"
        description="Use your Claude subscription to power multi-agent workflows."
        actions={
          <>
            <BackButton onClick={onBack} disabled={status === 'validating'} />
            <ContinueButton
              onClick={onStartOAuth}
              className="gap-2"
              loading={status === 'validating'}
              loadingText="Connecting..."
            >
              <ExternalLink className="size-4" />
              Sign in with Claude
            </ContinueButton>
          </>
        }
      >
        <OAuthConnect
          status={status as OAuthStatus}
          errorMessage={errorMessage}
          isWaitingForCode={false}
          onStartOAuth={onStartOAuth!}
          onSubmitAuthCode={onSubmitAuthCode}
          onCancelOAuth={onCancelOAuth}
        />
      </StepFormLayout>
    )
  }

  // --- Codex login flow ---
  if (isCodexOAuth) {
    return (
      <StepFormLayout
        title="Connect Codex Account"
        description="请先在终端执行 codex login，完成后点击下方检查登录状态。"
        actions={
          <>
            <BackButton onClick={onBack} disabled={status === 'validating'} />
            <ContinueButton
              onClick={onCheckCodexAuth!}
              className="gap-2"
              loading={status === 'validating'}
              loadingText="Checking..."
            >
              检查登录状态
            </ContinueButton>
          </>
        }
      >
        <div className="space-y-3">
          <Button
            type="button"
            variant="outline"
            className="w-full justify-center gap-2"
            onClick={onOpenCodexLogin!}
            disabled={status === 'validating'}
          >
            <Terminal className="size-4" />
            打开终端执行 codex login
          </Button>
          {errorMessage && (
            <div className="text-xs text-destructive">{errorMessage}</div>
          )}
        </div>
      </StepFormLayout>
    )
  }

  // --- API Key flow ---
  return (
    <StepFormLayout
      title="API Configuration"
      description="Enter your API key. Optionally configure a custom endpoint for OpenRouter, Ollama, or compatible APIs."
      actions={
        <>
          <BackButton onClick={onBack} disabled={status === 'validating'} />
          <ContinueButton
            type="submit"
            form="api-key-form"
            disabled={false}
            loading={status === 'validating'}
            loadingText="Validating..."
          />
        </>
      }
    >
      <ApiKeyInput
        status={status as ApiKeyStatus}
        errorMessage={errorMessage}
        onSubmit={onSubmit}
      />
    </StepFormLayout>
  )
}
