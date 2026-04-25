"use client"

import { useState } from "react"
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  PlusCircle,
  RotateCcw,
  Send,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ScamInterventionModal } from "@/components/guardian/scam-modal"
import type { Transaction } from "@/app/page"
import { cn } from "@/lib/utils"

const RELOAD_OPTIONS = [10, 20, 30, 50, 100, 200]

type WalletViewProps = {
  balance: number
  transactions: Transaction[]
  lastBlocked: { amount: number; recipient: string } | null
  onClearBlocked: () => void
  onSafeTransfer: () => void
  onScamCanceled: () => void
  onScamProceed: () => void
  onReset: () => void
  onReload?: (amount: number) => Promise<void>
  userName?: string
}

type FlowState = "idle" | "processing-safe" | "scam-detected" | "processing-scam" | "success-safe"

export function WalletView({
  balance,
  transactions,
  lastBlocked,
  onClearBlocked,
  onSafeTransfer,
  onScamCanceled,
  onScamProceed,
  onReset,
  onReload,
  userName,
}: WalletViewProps) {
  const [flow, setFlow] = useState<FlowState>("idle")
  const [showBalance, setShowBalance] = useState(true)
  const [showReload, setShowReload] = useState(false)

  const triggerSafe = () => {
    setFlow("processing-safe")
    setTimeout(() => {
      onSafeTransfer()
      setFlow("success-safe")
      setTimeout(() => setFlow("idle"), 1600)
    }, 700)
  }

  const triggerScam = () => {
    setFlow("processing-scam")
    setTimeout(() => setFlow("scam-detected"), 800)
  }

  const handleCancel = () => {
    onScamCanceled()
    setFlow("idle")
  }

  const handleProceed = () => {
    onScamProceed()
    setFlow("idle")
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Left column: balance + actions */}
      <div className="flex flex-col gap-6 lg:col-span-2">
        <BalanceCard balance={balance} showBalance={showBalance} onToggle={() => setShowBalance((s) => !s)} userName={userName} />

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
          onSafe={triggerSafe}
          onScam={triggerScam}
          onReset={() => {
            onReset()
            setFlow("idle")
          }}
        />

        <RecentTransactions transactions={transactions} />
      </div>

      {/* Right column: AI guardian status */}
      <div className="flex flex-col gap-6">
        <GuardianStatusCard />
        <QuickActionsCard onReload={onReload ? () => setShowReload(true) : undefined} />
      </div>

      {/* Reload modal */}
      {showReload && onReload && (
        <ReloadModal onClose={() => setShowReload(false)} onReload={onReload} />
      )}

      {/* Modal overlays */}
      <ScamInterventionModal
        open={flow === "scam-detected"}
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
  userName,
}: {
  balance: number
  showBalance: boolean
  onToggle: () => void
  userName?: string
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
            <p className="mt-3 text-sm text-primary-foreground/80">{userName || "Ahmad Bin Ali"} · ****6721</p>
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
  onSafe,
  onScam,
  onReset,
}: {
  flow: FlowState
  onSafe: () => void
  onScam: () => void
  onReset: () => void
}) {
  const isProcessingSafe = flow === "processing-safe"
  const isProcessingScam = flow === "processing-scam"
  const isBusy = isProcessingSafe || isProcessingScam

  return (
    <Card className="p-5 md:p-6">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-foreground">Transfer Simulation</h2>
          <span className="text-xs font-medium text-muted-foreground">Demo Controls</span>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Trigger a sample transfer to see the wallet flow and the AI Scam-Breaker engine in action.
        </p>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
        <Button
          onClick={onSafe}
          disabled={isBusy}
          className="h-auto justify-start gap-3 bg-primary py-3 text-left text-primary-foreground hover:bg-primary/90"
        >
          {isProcessingSafe ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          <span className="flex flex-col">
            <span className="text-sm font-semibold">Simulate Safe Transfer</span>
            <span className="text-xs font-normal opacity-80">RM 15 to Ali · Lunch</span>
          </span>
        </Button>

        <Button
          onClick={onScam}
          disabled={isBusy}
          variant="outline"
          className="h-auto justify-start gap-3 border-destructive/40 py-3 text-left text-destructive hover:bg-destructive/5 hover:text-destructive"
        >
          {isProcessingScam ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
          ) : (
            <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          <span className="flex flex-col">
            <span className="text-sm font-semibold">Simulate Scam Transfer</span>
            <span className="text-xs font-normal opacity-80">RM 1,000 to Investment Agent</span>
          </span>
        </Button>

        <Button
          onClick={onReset}
          disabled={isBusy}
          variant="ghost"
          className="h-auto justify-start gap-3 py-3 text-left text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="flex flex-col">
            <span className="text-sm font-semibold">Reset Wallet</span>
            <span className="text-xs font-normal opacity-80">Restore initial state</span>
          </span>
        </Button>
      </div>

      {isBusy && (
        <div
          role="status"
          aria-live="polite"
          className="mt-5 flex items-center gap-3 rounded-md border border-border bg-secondary px-3 py-2.5"
        >
          <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
          <p className="text-sm text-foreground">
            {isProcessingSafe
              ? "Authorising transfer · running 1-hop graph check (~100 ms)…"
              : "Authorising transfer · BERT intent + Neptune mule lookup running…"}
          </p>
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

function QuickActionsCard({ onReload }: { onReload?: () => void }) {
  const actions: { label: string; onClick?: () => void }[] = [
    { label: "Reload", onClick: onReload },
    { label: "Send" },
    { label: "Pay Bills" },
    { label: "Scan QR" },
  ]
  return (
    <Card className="p-5 md:p-6">
      <h2 className="text-base font-semibold text-foreground">Quick Actions</h2>
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={a.onClick}
            disabled={a.label !== "Reload" ? false : !a.onClick}
            className={cn(
              "rounded-md border border-border bg-secondary px-3 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent",
              a.label === "Reload" && a.onClick && "border-primary/40 bg-primary/5 text-primary hover:bg-primary/10",
            )}
          >
            {a.label}
          </button>
        ))}
      </div>
    </Card>
  )
}

function ReloadModal({
  onClose,
  onReload,
}: {
  onClose: () => void
  onReload: (amount: number) => Promise<void>
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<number | null>(null)

  const handleSelect = async (amount: number) => {
    setLoading(true)
    setError(null)
    try {
      await onReload(amount)
      setSuccess(amount)
      setTimeout(onClose, 1400)
    } catch (e) {
      setError((e as Error).message ?? "Reload failed")
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PlusCircle className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 className="text-base font-semibold text-foreground">Reload Wallet</h2>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Select an amount to top up your eWallet.</p>

        {/* Amount grid */}
        <div className="mt-5 grid grid-cols-3 gap-2.5">
          {RELOAD_OPTIONS.map((amt) => (
            <button
              key={amt}
              type="button"
              onClick={() => handleSelect(amt)}
              disabled={loading || success !== null}
              className="rounded-lg border border-border bg-secondary px-3 py-3 text-sm font-semibold text-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary disabled:opacity-50"
            >
              RM {amt}
            </button>
          ))}
        </div>

        {/* States */}
        {loading && !success && (
          <div className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            Processing reload…
          </div>
        )}
        {success !== null && (
          <div className="mt-4 flex items-center justify-center gap-2 text-sm font-medium text-primary">
            <CheckCircle2 className="h-4 w-4" />
            RM {success}.00 added to your wallet!
          </div>
        )}
        {error && (
          <p className="mt-4 text-center text-sm text-destructive">{error}</p>
        )}
      </div>
    </div>
  )
}
