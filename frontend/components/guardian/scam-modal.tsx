"use client"

import { MessageCircle, Network, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

type TransferReviewCard = {
  title: string
  subtitle: string
  decision_preview: "APPROVED" | "WARNING" | "INTERVENTION_REQUIRED"
  risk_score: number
  reason_codes: string[]
  evidence_refs: string[]
  purpose_question: string
}

type ScamInterventionCardProps = {
  card: TransferReviewCard
  assistantText: string
  purpose: string
  onPurposeChange: (value: string) => void
  onCancel: () => void
  onProceed: () => void
}

export function ScamInterventionCard({
  card,
  assistantText,
  purpose,
  onPurposeChange,
  onCancel,
  onProceed,
}: ScamInterventionCardProps) {
  const riskScore = card.risk_score ?? 0
  const reasonCodes = card.reason_codes.length ? card.reason_codes : ["LLM_REVIEW_REQUIRED"]
  const evidence = card.evidence_refs.length
    ? card.evidence_refs.slice(0, 3).join(" | ")
    : "Dynamic Deep Agent review over user nodes and transfer edges."

  return (
    <div className="mt-5 rounded-xl border border-destructive/30 bg-card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 rounded-lg bg-destructive px-3 py-2.5 text-destructive-foreground">
        <div className="leading-tight">
          <p className="text-xs font-semibold uppercase tracking-wide">{card.title ?? "Review transfer risk"}</p>
          <p className="text-xs text-destructive-foreground/85">
            {card.subtitle ?? "High-risk transfer paused for your safety"}
          </p>
        </div>
        <span className="rounded-md bg-destructive-foreground/15 px-2 py-0.5 text-xs font-medium">
          {card.decision_preview}
        </span>
      </div>

      <div className="mt-3 flex gap-3">
        <div
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
        >
          <MessageCircle className="h-4 w-4" />
        </div>
        <div className="flex-1 rounded-lg rounded-tl-sm border border-border bg-secondary px-3 py-2.5">
          <p className="text-xs font-medium text-muted-foreground">Guardian Voice - just now</p>
          <p className="mt-1 text-sm leading-relaxed text-foreground">
            {assistantText || "I found risk signals in this transfer. Please review before continuing."}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Deep Agent Risk</p>
          <ul className="mt-2 flex flex-col gap-2.5">
            <ScoreRow label="Overall risk" score={riskScore / 100} />
            <ScoreRow label={card.decision_preview ?? "WARNING"} score={Math.max(riskScore, 40) / 100} />
          </ul>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Evidence Signals</p>
          <ul className="mt-2 flex flex-col gap-2">
            {reasonCodes.slice(0, 4).map((reason) => (
              <FlagRow key={reason}>{reason.replaceAll("_", " ").toLowerCase()}</FlagRow>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-md border border-border bg-secondary px-3 py-2.5">
        <Network className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="text-xs leading-relaxed text-muted-foreground">{evidence}</p>
      </div>

      <label className="mt-4 block">
        <span className="text-sm font-medium text-foreground">{card.purpose_question ?? "What is this transaction for?"}</span>
        <Textarea
          value={purpose}
          onChange={(event) => onPurposeChange(event.target.value)}
          placeholder="Example: lunch, rent, family support, marketplace purchase"
          className="mt-2 min-h-24 resize-none"
        />
      </label>

      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
        <Button variant="ghost" onClick={onProceed} className="text-muted-foreground hover:text-foreground">
          Continue Anyway
        </Button>
        <Button onClick={onCancel} className="bg-primary text-primary-foreground hover:bg-primary/90">
          <ShieldCheck className="mr-2 h-4 w-4" aria-hidden="true" />
          Cancel Transfer
        </Button>
      </div>
    </div>
  )
}

function ScoreRow({ label, score }: { label: string; score: number }) {
  const pct = Math.round(score * 100)
  const high = score >= 0.7
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
      <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />
      <span className="leading-relaxed">{children}</span>
    </li>
  )
}
