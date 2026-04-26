"use client"

import { CheckCircle2, ShieldAlert, ShieldCheck, TriangleAlert, XCircle } from "lucide-react"
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
  warning_id?: string | null
  warning_delay_seconds?: number | null
  amount?: number
  currency?: string
  recipient_name?: string
}

type ScamInterventionCardProps = {
  card: TransferReviewCard
  assistantText: string
  purpose: string
  onPurposeChange: (value: string) => void
  onCancel: () => void
  onProceed: () => void
}

type RiskLevel = "safe" | "caution" | "danger"

function getRiskLevel(card: TransferReviewCard): RiskLevel {
  if (card.decision_preview === "INTERVENTION_REQUIRED") return "danger"
  if (card.decision_preview === "WARNING") return "caution"
  const score = card.risk_score ?? 0
  if (score >= 70) return "danger"
  if (score >= 40) return "caution"
  return "safe"
}

const RISK_CONFIG: Record<
  RiskLevel,
  {
    headerBg: string
    headerText: string
    badgeLabel: string
    badgeColor: string
    badgeBg: string
    borderColor: string
    icon: React.ReactNode
    meterColor: string
    safetyLabel: string
    showPurpose: boolean
  }
> = {
  safe: {
    headerBg: "var(--status-approved-bg)",
    headerText: "var(--status-approved)",
    badgeLabel: "Safe",
    badgeColor: "var(--status-approved)",
    badgeBg: "var(--status-approved-bg)",
    borderColor: "var(--status-approved)",
    icon: <CheckCircle2 className="h-5 w-5" />,
    meterColor: "var(--status-approved)",
    safetyLabel: "This transfer looks safe",
    showPurpose: false,
  },
  caution: {
    headerBg: "var(--status-warned-bg)",
    headerText: "var(--status-warned)",
    badgeLabel: "Review needed",
    badgeColor: "var(--status-warned)",
    badgeBg: "var(--status-warned-bg)",
    borderColor: "var(--status-warned)",
    icon: <TriangleAlert className="h-5 w-5" />,
    meterColor: "var(--status-warned)",
    safetyLabel: "Please review before sending",
    showPurpose: true,
  },
  danger: {
    headerBg: "var(--status-blocked-bg)",
    headerText: "var(--status-blocked)",
    badgeLabel: "High risk",
    badgeColor: "var(--status-blocked)",
    badgeBg: "var(--status-blocked-bg)",
    borderColor: "var(--status-blocked)",
    icon: <ShieldAlert className="h-5 w-5" />,
    meterColor: "var(--status-blocked)",
    safetyLabel: "We are concerned about this transfer",
    showPurpose: true,
  },
}

function humanizeReason(code: string): string {
  const map: Record<string, string> = {
    FINBERT_NEGATIVE_HIGH: "Suspicious message detected",
    EMOTION_PRESSURE_HIGH: "Pressure or urgency in message",
    AMOUNT_ANOMALY_CRITICAL: "Unusually large amount",
    AMOUNT_ANOMALY_MEDIUM: "Larger than your typical transfer",
    RECIPIENT_NEW: "First time sending to this person",
    GRAPH_NO_PRIOR_TRANSFER: "No previous transfers to this person",
    GRAPH_HIGH_REPEAT_TRANSFER_PATTERN: "Unusually frequent transfers",
    GRAPH_RECIPIENT_FLAGGED_HISTORY: "Recipient has been flagged before",
    GRAPH_HIGH_RISK_HISTORY: "Past transfers to this person were flagged",
    GRAPH_CHECK_UNAVAILABLE_FAILSAFE_WARNING: "Safety check temporarily unavailable",
    GRAPH_CHECK_NOT_CONFIGURED_FAILSAFE_WARNING: "Safety check unavailable",
    LLM_REVIEW_REQUIRED: "AI review required",
  }
  return map[code] ?? code.replace(/_/g, " ").toLowerCase()
}

export function ScamInterventionCard({
  card,
  assistantText,
  purpose,
  onPurposeChange,
  onCancel,
  onProceed,
}: ScamInterventionCardProps) {
  const risk = getRiskLevel(card)
  const cfg = RISK_CONFIG[risk]
  const reasons = card.reason_codes.length ? card.reason_codes : []
  const amount = card.amount ?? 0
  const recipientName = card.recipient_name ?? card.subtitle

  return (
    <div className="mt-5 overflow-hidden rounded-xl border bg-card" style={{ borderColor: `${cfg.borderColor}40` }}>
      <div className="flex items-center gap-3 px-4 py-3" style={{ background: cfg.headerBg, color: cfg.headerText }}>
        {cfg.icon}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{cfg.safetyLabel}</p>
          <p className="mt-0.5 text-xs opacity-80">{card.title}</p>
        </div>
        <span className="shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider" style={{ color: cfg.badgeColor, background: cfg.badgeBg, border: `1px solid ${cfg.badgeColor}30` }}>
          {cfg.badgeLabel}
        </span>
      </div>

      <div className="px-4 py-4 sm:px-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Sending to</p>
            <p className="text-base font-semibold text-foreground">{recipientName}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Amount</p>
            <p className="font-mono text-xl font-bold text-foreground">RM {amount.toFixed(2)}</p>
          </div>
        </div>

        {assistantText && (
          <div className="mt-4 rounded-lg border border-border bg-secondary/50 px-3 py-2.5">
            <p className="text-sm leading-relaxed text-foreground">{assistantText}</p>
          </div>
        )}

        {card.warning_delay_seconds !== null && card.warning_delay_seconds !== undefined && card.warning_delay_seconds > 0 && (
          <div className="mt-4 rounded-lg border border-amber-300/50 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Wait {card.warning_delay_seconds} seconds, then confirm again to send.
          </div>
        )}

        <div className="mt-4">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-muted-foreground">Safety check</span>
            <span className="font-semibold" style={{ color: cfg.meterColor }}>
              {risk === "safe" ? "Passed" : risk === "caution" ? "Review" : "Concern"}
            </span>
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-border">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.max(100 - (card.risk_score ?? 0), 8)}%`,
                background: cfg.meterColor,
              }}
            />
          </div>
        </div>

        {reasons.length > 0 && risk !== "safe" && (
          <div className="mt-4">
            <p className="text-xs font-medium text-muted-foreground">{risk === "danger" ? "Why we are concerned" : "Things to note"}</p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {reasons.slice(0, 3).map((code) => (
                <li key={code} className="flex items-start gap-2 text-xs">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: cfg.meterColor }} />
                  <span className="leading-relaxed text-foreground">{humanizeReason(code)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {cfg.showPurpose && (
          <label className="mt-4 block">
            <span className="text-sm font-medium text-foreground">{card.purpose_question ?? "What is this transfer for?"}</span>
            <Textarea
              value={purpose}
              onChange={(event) => onPurposeChange(event.target.value)}
              placeholder="e.g. lunch, rent, family support"
              className="mt-2 min-h-20 resize-none text-sm"
            />
          </label>
        )}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          <Button variant="ghost" size="sm" onClick={onCancel} className="text-muted-foreground hover:text-foreground">
            <XCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Reject
          </Button>
          <Button size="sm" onClick={onProceed} className="text-black" style={{ background: cfg.badgeColor }}>
            <ShieldCheck className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Accept & Send
          </Button>
        </div>
      </div>
    </div>
  )
}
