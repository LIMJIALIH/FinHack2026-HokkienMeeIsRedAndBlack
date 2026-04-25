"use client"

import { useState } from "react"
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  Clock,
  Eye,
  EyeOff,
  Loader2,
  Mic,
  Radio,
  RotateCcw,
  ShieldAlert,
  ShieldBan,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  X,
  XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ScamInterventionCard } from "@/components/guardian/scam-modal"
import type { Transaction } from "@/app/page"
import { cn } from "@/lib/utils"

type WalletViewProps = {
  balance: number
  transactions: Transaction[]
  lastBlocked: { amount: number; recipient: string } | null
  onClearBlocked: () => void
  onSafeTransfer: () => void
  onScamCanceled: () => void
  onScamProceed: () => void
}

type FlowState = "idle" | "processing-safe" | "scam-detected" | "processing-scam" | "success-safe"

type TransferReviewCard = {
  card_type: "transfer_review"
  title: string
  subtitle: string
  decision_preview: "APPROVED" | "WARNING" | "INTERVENTION_REQUIRED"
  risk_score: number
  reason_codes: string[]
  evidence_refs: string[]
  warning_id: string | null
  warning_delay_seconds: number | null
  purpose_question: string
}

type VoiceTurnResponse = {
  thread_id: string
  mode: "hitl_required" | "final"
  assistant_text: string
  card: TransferReviewCard | null
  backend_status: string | null
  steps: string[]
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"
const VOICE_USER_ID = process.env.NEXT_PUBLIC_VOICE_USER_ID ?? "Eric Wong"

async function readVoiceStream(
  body: ReadableStream<Uint8Array>,
  onStep: (summary: string) => void,
): Promise<VoiceTurnResponse> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let finalPayload: VoiceTurnResponse | null = null

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split("\n\n")
    buffer = events.pop() ?? ""

    for (const eventText of events) {
      const dataLine = eventText.split("\n").find((line) => line.startsWith("data: "))
      if (!dataLine) continue
      const event = JSON.parse(dataLine.slice(6)) as {
        event: "step" | "final" | "error"
        summary?: string
        message?: string
        payload?: VoiceTurnResponse
      }
      if (event.event === "step" && event.summary) {
        onStep(event.summary)
      }
      if (event.event === "error") {
        throw new Error(event.message ?? "Voice agent stream failed.")
      }
      if (event.event === "final" && event.payload) {
        finalPayload = event.payload
      }
    }
  }

  if (!finalPayload) {
    throw new Error("Voice agent did not return a final response.")
  }
  return finalPayload
}

export function WalletView({
  balance,
  transactions,
  lastBlocked,
  onClearBlocked,
  onSafeTransfer,
  onScamCanceled,
  onScamProceed,
}: WalletViewProps) {
  const [flow, setFlow] = useState<FlowState>("idle")
  const [showBalance, setShowBalance] = useState(true)
  const [transferPrompt, setTransferPrompt] = useState("")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [reviewCard, setReviewCard] = useState<TransferReviewCard | null>(null)
  const [latestAgentText, setLatestAgentText] = useState("")
  const [agentStep, setAgentStep] = useState<string | null>(null)
  const [transferPurpose, setTransferPurpose] = useState("")

  const triggerSafe = () => {
    onSafeTransfer()
    setFlow("success-safe")
    setTimeout(() => setFlow("idle"), 1600)
  }

  const handleCancel = async () => {
    setErrorMessage(null)
    setFlow("processing-scam")
    if (activeThreadId) {
      try {
        const response = await fetch(`${API_BASE_URL}/voice/decision`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            thread_id: activeThreadId,
            warning_id: reviewCard?.warning_id,
            decision: "reject",
            purpose: transferPurpose,
          }),
        })
        if (!response.ok) {
          throw new Error("Unable to reject transfer decision.")
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Unable to connect to backend.")
      }
    }
    onScamCanceled()
    setReviewCard(null)
    setLatestAgentText("")
    setTransferPurpose("")
    setActiveThreadId(null)
    setFlow("idle")
  }

  const handleProceed = async () => {
    setErrorMessage(null)
    setFlow("processing-scam")
    if (activeThreadId) {
      try {
        const response = await fetch(`${API_BASE_URL}/voice/decision`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            thread_id: activeThreadId,
            warning_id: reviewCard?.warning_id,
            decision: "approve",
            purpose: transferPurpose,
          }),
        })
        if (!response.ok) {
          throw new Error("Unable to approve transfer decision.")
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Unable to connect to backend.")
      }
    }
    onScamProceed()
    setReviewCard(null)
    setLatestAgentText("")
    setTransferPurpose("")
    setActiveThreadId(null)
    setFlow("idle")
  }

  const submitTransferToAgent = async () => {
    const prompt = transferPrompt.trim()
    if (!prompt) return

    setErrorMessage(null)
    setLatestAgentText("")
    setAgentStep("Analysing transfer request")
    setFlow("processing-safe")

    try {
      const response = await fetch(`${API_BASE_URL}/voice/turn/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_text: prompt,
          thread_id: activeThreadId,
          user_id: VOICE_USER_ID,
        }),
      })
      if (!response.ok) {
        throw new Error("Voice agent request failed.")
      }
      if (!response.body) {
        throw new Error("Voice agent stream was empty.")
      }
      const payload = await readVoiceStream(response.body, (summary) => setAgentStep(summary))
      setActiveThreadId(payload.thread_id)
      setLatestAgentText(payload.assistant_text)

      if (payload.mode === "hitl_required" && payload.card) {
        setReviewCard(payload.card)
        setFlow("scam-detected")
        return
      }

      if (payload.mode === "final") {
        triggerSafe()
        setTransferPrompt("")
        setReviewCard(null)
        setLatestAgentText(payload.assistant_text)
        setTransferPurpose("")
        setAgentStep(null)
        setActiveThreadId(null)
        return
      }

      throw new Error("Unexpected response from voice agent.")
    } catch (error) {
      setFlow("idle")
      setErrorMessage(error instanceof Error ? error.message : "Unable to connect to backend.")
    } finally {
      setAgentStep(null)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Left column: balance + actions */}
      <div className="flex flex-col gap-6 lg:col-span-2">
        <BalanceCard balance={balance} showBalance={showBalance} onToggle={() => setShowBalance((s) => !s)} />

        {lastBlocked && (
          <Card className="flex items-start justify-between gap-4 border-primary/30 bg-primary/5 p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="leading-relaxed">
                <p className="text-sm font-semibold text-foreground">
                  RM {lastBlocked.amount.toFixed(2)} protected
                </p>
                <p className="text-xs text-muted-foreground">
                  Transfer to {lastBlocked.recipient} was blocked by Scam-Breaker. Funds remain in your wallet.
                </p>
              </div>
            </div>
            <button
              onClick={onClearBlocked}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground"
              aria-label="Dismiss notification"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </Card>
        )}

        <SimulationPanel
          flow={flow}
          transferPrompt={transferPrompt}
          setTransferPrompt={setTransferPrompt}
          onAnalyze={submitTransferToAgent}
          reviewCard={reviewCard}
          transferPurpose={transferPurpose}
          setTransferPurpose={setTransferPurpose}
          onCancelReview={handleCancel}
          onProceedReview={handleProceed}
          errorMessage={errorMessage}
          agentStep={agentStep}
          latestAgentText={latestAgentText}
        />

        <RecentTransactions transactions={transactions} />
      </div>

      {/* Right column: AI guardian status */}
      <div className="flex flex-col gap-6">
        <GuardianStatusCard />
        <QuickActionsCard />
      </div>

      {flow === "success-safe" && transactions.length > 0 && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground shadow-lg"
          style={{ animation: "var(--animate-toast-slide)" }}
        >
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" style={{ color: "var(--status-approved)" }} aria-hidden="true" />
            Transfer of RM {transactions[0].amount.toFixed(2)} to {transactions[0].recipient} completed
          </span>
        </div>
      )}
    </div>
  )
}

function BalanceCard({
  balance,
  showBalance,
  onToggle,
}: {
  balance: number
  showBalance: boolean
  onToggle: () => void
}) {
  return (
    <Card className="overflow-hidden border-0 bg-primary p-0 text-primary-foreground shadow-sm">
      <div className="relative p-6 md:p-8">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary-foreground/10 blur-2xl"
        />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-primary-foreground/70">Available Balance</p>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-xs font-medium text-primary-foreground/80">RM</span>
              <span className="font-mono text-4xl font-semibold tracking-tight md:text-5xl">
                {showBalance ? balance.toFixed(2) : "•••••"}
              </span>
              <button
                onClick={onToggle}
                aria-label={showBalance ? "Hide balance" : "Show balance"}
                className="ml-1 rounded-md p-1 text-primary-foreground/70 transition-colors hover:bg-primary-foreground/10 hover:text-primary-foreground"
              >
                {showBalance ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="mt-3 text-sm text-primary-foreground/80">Ahmad Bin Ali · ****6721</p>
          </div>
          <div className="flex flex-col items-end gap-2 text-right">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-foreground/15 px-2.5 py-1 text-xs font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" aria-hidden="true" />
              Guardian Active
            </span>
            <span className="text-xs text-primary-foreground/70">eWallet · MYR</span>
          </div>
        </div>
      </div>
    </Card>
  )
}

function SimulationPanel({
  flow,
  transferPrompt,
  setTransferPrompt,
  onAnalyze,
  reviewCard,
  transferPurpose,
  setTransferPurpose,
  onCancelReview,
  onProceedReview,
  errorMessage,
  agentStep,
  latestAgentText,
}: {
  flow: FlowState
  transferPrompt: string
  setTransferPrompt: (value: string) => void
  onAnalyze: () => void
  reviewCard: TransferReviewCard | null
  transferPurpose: string
  setTransferPurpose: (value: string) => void
  onCancelReview: () => void
  onProceedReview: () => void
  errorMessage: string | null
  agentStep: string | null
  latestAgentText: string
}) {
  const isProcessingSafe = flow === "processing-safe"
  const isProcessingScam = flow === "processing-scam"
  const isBusy = isProcessingSafe || isProcessingScam

  return (
    <Card className="relative overflow-hidden border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card p-5 md:p-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-14 -top-14 h-44 w-44 rounded-full bg-primary/10 blur-2xl"
      />
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-foreground">Send Money</h2>
          <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
            AI-Protected
          </span>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Tell us who you want to pay and how much — we'll check everything is safe before sending.
        </p>
      </div>

      <div className="relative mt-6 rounded-xl border border-primary/20 bg-background/80 p-4 md:p-5">
        <div className="flex flex-col items-center gap-3 text-center">
          <Button
            type="button"
            disabled
            variant="outline"
            className="h-28 w-28 rounded-full border-2 border-primary/30 bg-primary/10 text-primary shadow-md"
            aria-label="Voice input coming soon"
          >
            <Mic className="h-10 w-10" aria-hidden="true" />
          </Button>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">Voice Input</p>
            <p className="text-xs text-muted-foreground">
              Voice transfer coming soon — type your request below for now.
            </p>
          </div>
        </div>

        {latestAgentText && (
          <div className="mt-5 rounded-md border border-border bg-secondary px-3 py-2.5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Guardian</p>
            <p className="mt-1 text-sm leading-relaxed text-foreground">{latestAgentText}</p>
          </div>
        )}
        {reviewCard && (
          <ScamInterventionCard
            card={reviewCard}
            assistantText={latestAgentText}
            purpose={transferPurpose}
            onPurposeChange={setTransferPurpose}
            onCancel={onCancelReview}
            onProceed={onProceedReview}
          />
        )}

        <form
          className="mt-5 flex flex-col gap-2.5 md:flex-row"
          onSubmit={(event) => {
            event.preventDefault()
            if (!isBusy) onAnalyze()
          }}
        >
          <Input
            value={transferPrompt}
            onChange={(event) => setTransferPrompt(event.target.value)}
            disabled={isBusy}
            placeholder='e.g. "Send RM 15 to Ali for lunch"'
            className="h-10 md:flex-1"
            aria-label="Transfer request"
          />
          <Button type="submit" disabled={isBusy || !transferPrompt.trim()} className="h-10 px-5">
            {isBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <ShieldAlert className="h-4 w-4" aria-hidden="true" />
            )}
            {isBusy ? (agentStep ?? "Checking...") : "Send"}
          </Button>
        </form>

        {/* Inline step indicator below input */}
        {isBusy && (
          <div
            role="status"
            aria-live="polite"
            className="mt-2.5 flex items-center gap-2 px-1"
            style={{ animation: "var(--animate-fade-in)" }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full bg-primary"
              style={{ animation: "var(--animate-status-pulse)" }}
              aria-hidden="true"
            />
            <p className="text-xs text-muted-foreground">{agentStep ?? "Checking your request..."}</p>
          </div>
        )}
      </div>

      {errorMessage && (
        <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errorMessage}
        </div>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/*  Status config                                                      */
/* ------------------------------------------------------------------ */

type StatusConfig = {
  label: string
  color: string
  bg: string
  icon: React.ReactNode
  pulse?: boolean
}

function statusConfig(status: string): StatusConfig {
  switch (status) {
    case "approved":
    case "completed":
      return {
        label: "Approved",
        color: "var(--status-approved)",
        bg: "var(--status-approved-bg)",
        icon: <ShieldCheck className="h-3 w-3" />,
      }
    case "pending_hitl":
      return {
        label: "Pending review",
        color: "var(--status-pending)",
        bg: "var(--status-pending-bg)",
        icon: <Clock className="h-3 w-3" />,
        pulse: true,
      }
    case "warned":
      return {
        label: "Warned",
        color: "var(--status-warned)",
        bg: "var(--status-warned-bg)",
        icon: <TriangleAlert className="h-3 w-3" />,
      }
    case "blocked":
      return {
        label: "Blocked",
        color: "var(--status-blocked)",
        bg: "var(--status-blocked-bg)",
        icon: <ShieldBan className="h-3 w-3" />,
      }
    case "reversed":
      return {
        label: "Reversed",
        color: "var(--status-reversed)",
        bg: "var(--status-reversed-bg)",
        icon: <RotateCcw className="h-3 w-3" />,
      }
    default:
      return {
        label: status,
        color: "var(--muted-foreground)",
        bg: "var(--muted)",
        icon: <Radio className="h-3 w-3" />,
      }
  }
}

function riskDotColor(score: number): string | null {
  if (score >= 70) return "var(--status-blocked)"
  if (score >= 30) return "var(--status-warned)"
  return null
}

/* ------------------------------------------------------------------ */
/*  RecentTransactions                                                 */
/* ------------------------------------------------------------------ */

function RecentTransactions({ transactions }: { transactions: Transaction[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const toggle = (id: string) =>
    setExpandedId((prev) => (prev === id ? null : id))

  return (
    <Card className="overflow-hidden p-0">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-5 md:px-6 md:pt-6">
        <h2 className="text-base font-semibold text-foreground">Recent Transactions</h2>
        <span
          className="rounded-full px-2.5 py-0.5 text-xs font-medium"
          style={{ color: "var(--muted-foreground)", background: "var(--muted)" }}
        >
          {transactions.length}
        </span>
      </div>

      {/* List */}
      <div className="mt-3 flex flex-col gap-1.5 px-3 pb-4 md:px-4 md:pb-5">
        {transactions.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-full"
              style={{ background: "var(--muted)" }}
            >
              <ArrowUpRight className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">No transactions yet</p>
            <p className="text-xs text-muted-foreground">Send your first transfer to get started</p>
          </div>
        )}

        {transactions.map((tx, idx) => {
          const sent = tx.type === "sent"
          const sc = statusConfig(tx.status)
          const riskDot = riskDotColor(tx.risk_score)
          const isExpanded = expandedId === tx.id
          const isNew = idx === 0 && tx.date === "Just now"

          return (
            <div
              key={tx.id}
              className="group rounded-xl border border-border bg-card transition-shadow hover:shadow-sm"
              style={isNew ? { animation: "var(--animate-slide-in-up)" } : undefined}
            >
              {/* Main row — tappable */}
              <button
                type="button"
                onClick={() => toggle(tx.id)}
                className="flex w-full items-center gap-3 px-3.5 py-3 text-left active:bg-accent/50 md:px-4"
                aria-expanded={isExpanded}
                aria-controls={`tx-detail-${tx.id}`}
              >
                {/* Direction icon */}
                <div
                  className={cn(
                    "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                    sent ? "bg-secondary text-foreground" : "text-primary",
                  )}
                  style={!sent ? { background: "var(--status-approved-bg)" } : undefined}
                  aria-hidden="true"
                >
                  {sent ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownLeft className="h-4 w-4" />}
                  {/* Risk dot */}
                  {riskDot && (
                    <span
                      className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-card"
                      style={{ background: riskDot }}
                      aria-label={`Risk score ${tx.risk_score}`}
                    />
                  )}
                </div>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-foreground">{tx.recipient}</p>
                    {/* Status badge */}
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        sc.pulse && "animate-[status-pulse_2s_ease-in-out_infinite]",
                      )}
                      style={{ color: sc.color, background: sc.bg }}
                    >
                      {sc.icon}
                      {sc.label}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {tx.purpose} · {tx.date}
                  </p>
                </div>

                {/* Amount + chevron */}
                <div className="flex items-center gap-2">
                  <p
                    className={cn(
                      "whitespace-nowrap font-mono text-sm font-semibold",
                      sent ? "text-foreground" : "",
                    )}
                    style={!sent ? { color: "var(--status-approved)" } : undefined}
                  >
                    {sent ? "−" : "+"} RM {tx.amount.toFixed(2)}
                  </p>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                      isExpanded && "rotate-180",
                    )}
                    aria-hidden="true"
                  />
                </div>
              </button>

              {/* Expandable detail */}
              {isExpanded && (
                <div
                  id={`tx-detail-${tx.id}`}
                  className="border-t border-border bg-secondary/40 px-4 py-3"
                  style={{ animation: "var(--animate-fade-in)" }}
                >
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
                    {/* Risk score */}
                    <div>
                      <p className="font-medium uppercase tracking-wide text-muted-foreground">Risk Score</p>
                      <div className="mt-1 flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${Math.min(tx.risk_score, 100)}%`,
                              background: tx.risk_score >= 70
                                ? "var(--status-blocked)"
                                : tx.risk_score >= 30
                                  ? "var(--status-warned)"
                                  : "var(--status-approved)",
                            }}
                          />
                        </div>
                        <span
                          className="font-mono font-semibold"
                          style={{
                            color: tx.risk_score >= 70
                              ? "var(--status-blocked)"
                              : tx.risk_score >= 30
                                ? "var(--status-warned)"
                                : "var(--status-approved)",
                          }}
                        >
                          {tx.risk_score}
                        </span>
                      </div>
                    </div>

                    {/* Channel */}
                    <div>
                      <p className="font-medium uppercase tracking-wide text-muted-foreground">Channel</p>
                      <p className="mt-1 text-foreground">{tx.channel.replace(/_/g, " ")}</p>
                    </div>

                    {/* Decision */}
                    <div>
                      <p className="font-medium uppercase tracking-wide text-muted-foreground">Decision</p>
                      <p className="mt-1 text-foreground">{tx.decision}</p>
                    </div>

                    {/* Currency */}
                    <div>
                      <p className="font-medium uppercase tracking-wide text-muted-foreground">Currency</p>
                      <p className="mt-1 text-foreground">{tx.currency}</p>
                    </div>
                  </div>

                  {/* Reason codes */}
                  {tx.reason_codes.length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Risk Signals</p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {tx.reason_codes.map((code) => (
                          <span
                            key={code}
                            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[10px] font-medium"
                            style={{ color: "var(--status-blocked)" }}
                          >
                            <span
                              className="h-1 w-1 rounded-full"
                              style={{ background: "var(--status-blocked)" }}
                              aria-hidden="true"
                            />
                            {code.replace(/_/g, " ").toLowerCase()}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function GuardianStatusCard() {
  const items = [
    { label: "BERT Intent Model", status: "Online", tone: "ok" as const },
    { label: "Neptune Graph (1-hop)", status: "100 ms p95", tone: "ok" as const },
    { label: "Async Mule Sweep", status: "Last run 04:12", tone: "ok" as const },
  ]
  return (
    <Card className="p-5 md:p-6">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 className="text-base font-semibold text-foreground">AI Guardian Status</h2>
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
        Real-time models monitoring every outbound transfer.
      </p>
      <ul className="mt-4 flex flex-col gap-3">
        {items.map((it) => (
          <li
            key={it.label}
            className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2.5"
          >
            <span className="text-sm text-foreground">{it.label}</span>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
              {it.status}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function QuickActionsCard() {
  const actions = ["Reload", "Send", "Pay Bills", "Scan QR"]
  return (
    <Card className="p-5 md:p-6">
      <h2 className="text-base font-semibold text-foreground">Quick Actions</h2>
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        {actions.map((a) => (
          <button
            key={a}
            type="button"
            className="rounded-md border border-border bg-secondary px-3 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {a}
          </button>
        ))}
      </div>
    </Card>
  )
}
