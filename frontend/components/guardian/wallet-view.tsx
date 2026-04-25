"use client"

import { useState } from "react"
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Mic,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ScamInterventionModal } from "@/components/guardian/scam-modal"
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
const VOICE_USER_ID = process.env.NEXT_PUBLIC_VOICE_USER_ID ?? "marcus"

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
    if (activeThreadId) {
      try {
        const response = await fetch(`${API_BASE_URL}/voice/decision`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ thread_id: activeThreadId, decision: "reject", purpose: transferPurpose }),
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
    if (activeThreadId) {
      try {
        const response = await fetch(`${API_BASE_URL}/voice/decision`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ thread_id: activeThreadId, decision: "approve", purpose: transferPurpose }),
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
        if (payload.card.decision_preview === "APPROVED") {
          const approveResponse = await fetch(`${API_BASE_URL}/voice/decision`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ thread_id: payload.thread_id, decision: "approve" }),
          })
          if (!approveResponse.ok) {
            throw new Error("Failed to finalize approved transfer.")
          }
          triggerSafe()
          setTransferPrompt("")
          setReviewCard(null)
          setLatestAgentText("")
          setTransferPurpose("")
          setAgentStep(null)
          setActiveThreadId(null)
          return
        }
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

      {/* Modal overlays */}
      <ScamInterventionModal
        open={flow === "scam-detected"}
        card={reviewCard}
        assistantText={latestAgentText}
        purpose={transferPurpose}
        onPurposeChange={setTransferPurpose}
        onCancel={handleCancel}
        onProceed={handleProceed}
      />

      {flow === "success-safe" && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground shadow-lg"
        >
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
            Transfer of RM 15.00 to Ali completed
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
  errorMessage,
  agentStep,
  latestAgentText,
}: {
  flow: FlowState
  transferPrompt: string
  setTransferPrompt: (value: string) => void
  onAnalyze: () => void
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
          <h2 className="text-base font-semibold text-foreground">Transfer Simulation</h2>
          <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
            Voice-first Preview
          </span>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Type a transfer request. The Deep Agent will inspect contacts, user nodes, and transfer edges before deciding.
        </p>
      </div>

      <div className="relative mt-6 rounded-xl border border-primary/20 bg-background/80 p-4 md:p-5">
        <div className="flex flex-col items-center gap-3 text-center">
          <Button
            type="button"
            disabled
            variant="outline"
            className="h-28 w-28 rounded-full border-2 border-primary/30 bg-primary/10 text-primary shadow-md"
            aria-label="Voice transfer input coming soon"
          >
            <Mic className="h-10 w-10" aria-hidden="true" />
          </Button>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">Voice Transfer Input</p>
            <p className="text-xs text-muted-foreground">
              Latest request is shown here only; chat history is intentionally not accumulated.
            </p>
          </div>
        </div>

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
            placeholder='Type transfer request, e.g. "Send RM 15 to Ali for lunch"'
            className="h-10 md:flex-1"
            aria-label="Transfer instruction input"
          />
          <Button type="submit" disabled={isBusy || !transferPrompt.trim()} className="h-10 px-5">
            {isBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <ShieldAlert className="h-4 w-4" aria-hidden="true" />
            )}
            Analyze
          </Button>
        </form>
      </div>

      {isBusy && (
        <div
          role="status"
          aria-live="polite"
          className="mt-5 flex items-center gap-3 rounded-md border border-border bg-secondary px-3 py-2.5"
        >
          <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
          <p className="text-sm text-foreground">{agentStep ?? "Analysing transfer request"}</p>
        </div>
      )}
      {!isBusy && latestAgentText && (
        <div className="mt-5 rounded-md border border-border bg-secondary px-3 py-2.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Latest agent message</p>
          <p className="mt-1 text-sm leading-relaxed text-foreground">{latestAgentText}</p>
        </div>
      )}
      {errorMessage && (
        <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errorMessage}
        </div>
      )}
    </Card>
  )
}

function RecentTransactions({ transactions }: { transactions: Transaction[] }) {
  return (
    <Card className="p-5 md:p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">Recent Transactions</h2>
        <span className="text-xs text-muted-foreground">{transactions.length} entries</span>
      </div>

      <ul className="mt-4 divide-y divide-border">
        {transactions.length === 0 && (
          <li className="py-6 text-center text-sm text-muted-foreground">No transactions yet</li>
        )}
        {transactions.map((tx) => {
          const sent = tx.type === "sent"
          return (
            <li key={tx.id} className="flex items-center justify-between gap-4 py-3.5">
              <div className="flex min-w-0 items-center gap-3">
                <div
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                    sent ? "bg-secondary text-foreground" : "bg-primary/10 text-primary",
                  )}
                  aria-hidden="true"
                >
                  {sent ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownLeft className="h-4 w-4" />}
                </div>
                <div className="min-w-0 leading-tight">
                  <p className="truncate text-sm font-medium text-foreground">{tx.recipient}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {tx.purpose} · {tx.date}
                  </p>
                </div>
              </div>
              <div className="text-right leading-tight">
                <p
                  className={cn(
                    "font-mono text-sm font-semibold",
                    sent ? "text-foreground" : "text-primary",
                  )}
                >
                  {sent ? "−" : "+"} RM {tx.amount.toFixed(2)}
                </p>
                <p className="text-xs text-muted-foreground capitalize">{tx.status}</p>
              </div>
            </li>
          )
        })}
      </ul>
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
