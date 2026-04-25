"use client"

import { Activity, Gauge, ShieldCheck, Zap } from "lucide-react"
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

      <section>
        <Card className="p-5 md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">Blocked Fraud Ring</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Live node-edge relationship graph from Neptune `db-neptune-2`. Click any node or edge to inspect.
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <LegendDot color="primary" label="Trusted" />
              <LegendDot color="muted" label="Neutral" />
              <LegendDot color="destructive" label="Flagged" />
            </div>
          </div>
          <div className="mt-5 rounded-xl border border-border overflow-hidden">
            <FraudGraph />
          </div>
        </Card>
      </section>

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


