"use client"

import { Activity, FileText, Gauge, ShieldCheck, Zap } from "lucide-react"
import { Card } from "@/components/ui/card"
import { FraudGraph } from "@/components/guardian/fraud-graph"

type DashboardViewProps = {
  protectedAmount: number
  threatsBlocked: number
}

export function DashboardView({ protectedAmount, threatsBlocked }: DashboardViewProps) {

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Regulatory Operations</p>
          <h1 className="mt-1 text-balance text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
            Fraud Intervention Dashboard
          </h1>
          <p className="mt-1.5 max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
            Live view of Scam-Breaker activity across the TNG eWallet network for Bank Negara Malaysia
            compliance officers.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 self-start rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground md:self-auto">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
          Live · refreshed seconds ago
        </div>
      </header>

      <section aria-label="Key metrics" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
          label="Protected Today"
          value={`RM ${protectedAmount.toLocaleString("en-MY", { minimumFractionDigits: 2 })}`}
          delta="+RM 1,000 last hour"
          tone="primary"
        />
        <MetricCard
          icon={<Activity className="h-4 w-4" aria-hidden="true" />}
          label="Threats Blocked"
          value={threatsBlocked.toString()}
          delta="3 high-severity"
          tone="default"
        />
        <MetricCard
          icon={<Gauge className="h-4 w-4" aria-hidden="true" />}
          label="Sync Decision Latency"
          value="92 ms"
          delta="p95 within 100 ms SLO"
          tone="default"
        />
        <MetricCard
          icon={<Zap className="h-4 w-4" aria-hidden="true" />}
          label="Mule Clusters Tracked"
          value="38"
          delta="2 new since 04:00"
          tone="default"
        />
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="p-5 md:p-6 lg:col-span-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">Blocked Fraud Ring</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Live node-edge relationship graph from Neptune `db-neptune-2`.
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <LegendDot color="primary" label="Trusted" />
              <LegendDot color="muted" label="Neutral" />
              <LegendDot color="destructive" label="Flagged" />
            </div>
          </div>
          <div className="mt-5 overflow-hidden rounded-lg border border-border bg-secondary/40 p-3">
            <FraudGraph />
          </div>
        </Card>

        <Card className="p-5 md:p-6 lg:col-span-2">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" aria-hidden="true" />
            <h2 className="text-base font-semibold text-foreground">Suspicious Transaction Report</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Auto-generated - STR-2026-0488</p>

          <dl className="mt-4 grid grid-cols-3 gap-x-3 gap-y-2.5 text-sm">
            <STRRow label="Reporting FI" value="Touch 'n Go Digital Sdn Bhd" />
            <STRRow label="Customer" value="Ahmad Bin Ali - ****6721" />
            <STRRow label="Amount" value="RM 1,000.00" mono />
            <STRRow label="Counterparty" value="Investment Agent - ****9024" />
            <STRRow label="Channel" value="P2P Wallet Transfer" />
            <STRRow label="Decision" value="Blocked at authorisation" highlight />
            <STRRow label="BERT Signal" value="Urgency 0.95 - Phishing 0.88" mono />
            <STRRow label="Graph Signal" value="Mule cluster #442 - 1-hop match" />
            <STRRow label="Timestamp" value="2026-04-25 10:14:08 MYT" />
          </dl>

          <div className="mt-4 rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5">
            <p className="text-xs leading-relaxed text-foreground">
              Filed automatically to BNM eFRS. Customer notified via Guardian Voice with explainable
              reasoning. No further action required from compliance team.
            </p>
          </div>
        </Card>
      </section>

      <ArchitectureNote />
    </div>
  )
}

function MetricCard({
  icon,
  label,
  value,
  delta,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: string
  delta: string
  tone: "primary" | "default"
}) {
  const isPrimary = tone === "primary"
  return (
    <Card className={`p-5 ${isPrimary ? "border-primary/40 bg-primary/5" : ""}`}>
      <div className="flex items-center gap-2">
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-md ${
            isPrimary ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
          }`}
          aria-hidden="true"
        >
          {icon}
        </span>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
      </div>
      <p className="mt-3 font-mono text-2xl font-semibold tracking-tight text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{delta}</p>
    </Card>
  )
}

function LegendDot({ color, label }: { color: "primary" | "muted" | "destructive"; label: string }) {
  const cls =
    color === "primary"
      ? "bg-primary"
      : color === "destructive"
        ? "bg-destructive"
        : "bg-muted-foreground/40"
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <span className={`h-2 w-2 rounded-full ${cls}`} aria-hidden="true" />
      {label}
    </span>
  )
}

function STRRow({
  label,
  value,
  mono,
  highlight,
}: {
  label: string
  value: string
  mono?: boolean
  highlight?: boolean
}) {
  return (
    <>
      <dt className="col-span-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd
        className={`col-span-2 text-sm leading-snug ${mono ? "font-mono" : ""} ${
          highlight ? "font-semibold text-destructive" : "text-foreground"
        }`}
      >
        {value}
      </dd>
    </>
  )
}

function ArchitectureNote() {
  return (
    <Card className="p-5 md:p-6">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="rounded-md bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            System Note
          </span>
          <h2 className="text-base font-semibold text-foreground">Two-Speed Graph Strategy</h2>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Guardian Voice runs two graph workloads in parallel so it can block in real time without
          missing slow-burn laundering networks.
        </p>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
        <ArchPanel
          tag="Synchronous"
          tagTone="primary"
          title="1-hop checks - <= 100 ms"
          body="At authorisation we run a single-hop Neptune query: is the recipient directly linked to a known mule, a flagged IP, or a fresh shell account? If yes, the transfer is blocked before funds leave the wallet."
          metrics={[
            { k: "Path", v: "Realtime" },
            { k: "p95 latency", v: "92 ms" },
            { k: "Coverage", v: "100% transfers" },
          ]}
        />
        <ArchPanel
          tag="Asynchronous"
          tagTone="muted"
          title="Deep batch sweeps"
          body="Hourly batch jobs traverse multi-hop subgraphs to surface AML laundering rings, smurfing fan-outs, and dormant mule reactivation. Findings refresh the synchronous flag set used for the next 1-hop check."
          metrics={[
            { k: "Path", v: "Batch" },
            { k: "Cadence", v: "60 min" },
            { k: "Depth", v: "up to 6 hops" },
          ]}
        />
      </div>
    </Card>
  )
}

function ArchPanel({
  tag,
  tagTone,
  title,
  body,
  metrics,
}: {
  tag: string
  tagTone: "primary" | "muted"
  title: string
  body: string
  metrics: { k: string; v: string }[]
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <span
        className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
          tagTone === "primary" ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"
        }`}
      >
        {tag}
      </span>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
      <ul className="mt-1 grid grid-cols-3 gap-2 border-t border-border pt-3">
        {metrics.map((m) => (
          <li key={m.k}>
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{m.k}</p>
            <p className="mt-0.5 font-mono text-sm font-semibold text-foreground">{m.v}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}
