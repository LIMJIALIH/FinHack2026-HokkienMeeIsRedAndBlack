"use client"

import { useEffect } from "react"
import { AlertTriangle, MessageCircle, Network, ShieldCheck, X } from "lucide-react"
import { Button } from "@/components/ui/button"

type ScamInterventionModalProps = {
  open: boolean
  onCancel: () => void
  onProceed: () => void
}

export function ScamInterventionModal({ open, onCancel, onProceed }: ScamInterventionModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="scam-modal-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-4 backdrop-blur-sm sm:items-center"
    >
      <div className="relative w-full max-w-2xl overflow-hidden rounded-xl border border-destructive/30 bg-card shadow-2xl">
        {/* Alert header */}
        <div className="flex items-start justify-between gap-3 bg-destructive px-5 py-4 text-destructive-foreground sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-destructive-foreground/15">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="leading-tight">
              <p id="scam-modal-title" className="text-sm font-semibold uppercase tracking-wide">
                Scam-Breaker Intervention
              </p>
              <p className="text-xs text-destructive-foreground/85">High-risk transfer paused for your safety</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            aria-label="Close"
            className="rounded-md p-1 text-destructive-foreground/80 transition-colors hover:bg-destructive-foreground/10 hover:text-destructive-foreground"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-5 sm:px-6 sm:py-6">
          {/* Conversational dialogue */}
          <div className="flex gap-3">
            <div
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
            >
              <MessageCircle className="h-4 w-4" />
            </div>
            <div className="flex-1 rounded-2xl rounded-tl-sm border border-border bg-secondary px-4 py-3">
              <p className="text-xs font-medium text-muted-foreground">Guardian Voice · just now</p>
              <p className="mt-1.5 text-sm leading-relaxed text-foreground">
                Hi Ahmad, before sending <span className="font-semibold">RM 1,000.00</span> to{" "}
                <span className="font-semibold">Investment Agent</span> — quick check:{" "}
                did someone on Telegram or WhatsApp promise you a guaranteed{" "}
                <span className="font-semibold">high-return investment</span> or ask you to deposit funds today?
              </p>
              <p className="mt-2 text-sm leading-relaxed text-foreground">
                That pattern matches a fraud ring we&apos;re actively tracking. I&apos;ve paused the transfer
                so we can decide together.
              </p>
            </div>
          </div>

          {/* Explainable AI block */}
          <div className="mt-5 rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
              <p className="text-sm font-semibold text-foreground">Why we flagged this</p>
              <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
                Explainable AI
              </span>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  BERT Intent Scores
                </p>
                <ul className="mt-2 flex flex-col gap-2.5">
                  <ScoreRow label="Urgency (Investment)" score={0.95} />
                  <ScoreRow label="Phishing Risk" score={0.88} />
                </ul>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Neptune Graph Flags
                </p>
                <ul className="mt-2 flex flex-col gap-2">
                  <FlagRow>Target account shares IP with known mule cluster #442</FlagRow>
                  <FlagRow>{"Recipient created < 14 days ago"}</FlagRow>
                  <FlagRow>Inbound velocity 6× peer baseline</FlagRow>
                </ul>
              </div>
            </div>

            <div className="mt-4 flex items-start gap-2 rounded-md border border-border bg-secondary px-3 py-2.5">
              <Network className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <p className="text-xs leading-relaxed text-muted-foreground">
                Decision computed in 92 ms via synchronous 1-hop graph check on Amazon Neptune. Deeper
                laundering patterns are confirmed asynchronously.
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            <Button
              variant="ghost"
              onClick={onProceed}
              className="text-muted-foreground hover:text-foreground"
            >
              Continue Anyway
            </Button>
            <Button
              onClick={onCancel}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <ShieldCheck className="mr-2 h-4 w-4" aria-hidden="true" />
              Cancel Transfer & Stay Safe
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ScoreRow({ label, score }: { label: string; score: number }) {
  const pct = Math.round(score * 100)
  const high = score >= 0.85
  return (
    <li>
      <div className="flex items-center justify-between text-xs">
        <span className="text-foreground">{label}</span>
        <span className={`font-mono font-semibold ${high ? "text-destructive" : "text-foreground"}`}>
          {score.toFixed(2)}
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={`h-full rounded-full ${high ? "bg-destructive" : "bg-primary"}`}
          style={{ width: `${pct}%` }}
          aria-hidden="true"
        />
      </div>
    </li>
  )
}

function FlagRow({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-xs text-foreground">
      <span
        aria-hidden="true"
        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-destructive"
      />
      <span className="leading-relaxed">{children}</span>
    </li>
  )
}
