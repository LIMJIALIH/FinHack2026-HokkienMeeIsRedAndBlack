"use client"

import { useState } from "react"
import { Activity, ArrowDownLeft, ArrowUpRight, Gauge, Network, ShieldAlert, ShieldCheck, UserRound, Zap } from "lucide-react"
import { Card } from "@/components/ui/card"
import { FraudGraph, type GraphNode, type NodeKind } from "@/components/guardian/fraud-graph"

type DashboardViewProps = {
  protectedAmount: number
  threatsBlocked: number
}

export function DashboardView({ protectedAmount, threatsBlocked }: DashboardViewProps) {
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)

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
          Live - refreshed seconds ago
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
            <FraudGraph selectedNodeId={selectedNode?.id} onNodeSelect={setSelectedNode} />
          </div>
        </Card>

        <NodeInfoPanel node={selectedNode} />
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

function NodeInfoPanel({ node }: { node: GraphNode | null }) {
  const tone = node ? nodeTone(node.kind) : nodeTone("neutral")

  return (
    <Card className="p-5 md:p-6 lg:col-span-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <UserRound className="h-4 w-4 text-primary" aria-hidden="true" />
          <h2 className="text-base font-semibold text-foreground">Node Intelligence</h2>
        </div>
        {node && (
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${tone.badge}`}>
            {node.kind}
          </span>
        )}
      </div>

      {!node ? (
        <div className="mt-5 flex min-h-[310px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-secondary/40 px-5 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-md bg-card text-muted-foreground shadow-sm">
            <Network className="h-5 w-5" aria-hidden="true" />
          </div>
          <p className="mt-3 text-sm font-medium text-foreground">No node selected</p>
          <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
            Relationship, risk, and transfer details will populate here from the live Neptune graph.
          </p>
        </div>
      ) : (
        <div className="mt-5">
          <div className={`rounded-lg border px-4 py-3 ${tone.panel}`}>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Selected node</p>
            <h3 className="mt-1 truncate text-xl font-semibold tracking-tight text-foreground">{node.label}</h3>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{node.userId}</p>
          </div>

          <dl className="mt-4 grid grid-cols-3 gap-x-3 gap-y-2.5 text-sm">
            <NodeInfoRow label="Graph ID" value={node.graphId} mono />
            <NodeInfoRow label="Risk Tier" value={node.riskTier} highlight={node.kind === "flagged"} />
            <NodeInfoRow label="Status" value={node.status} highlight={node.status === "blocked"} />
            <NodeInfoRow label="Connections" value={node.connections.toString()} mono />
            <NodeInfoRow label="Inbound" value={node.inbound.toString()} mono />
            <NodeInfoRow label="Outbound" value={node.outbound.toString()} mono />
            <NodeInfoRow label="Flagged Links" value={node.flaggedConnections.toString()} mono highlight={node.flaggedConnections > 0} />
            <NodeInfoRow
              label="Total Value"
              value={`RM ${node.totalAmount.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              mono
            />
          </dl>

          <div className="mt-5">
            <div className="flex items-center gap-2">
              <ShieldAlert className={`h-4 w-4 ${node.flaggedConnections > 0 ? "text-destructive" : "text-muted-foreground"}`} aria-hidden="true" />
              <h3 className="text-sm font-semibold text-foreground">Counterparties</h3>
            </div>
            <div className="mt-2 flex flex-col gap-2">
              {node.counterparties.length === 0 ? (
                <div className="rounded-md border border-border bg-secondary/40 px-3 py-3 text-xs text-muted-foreground">
                  No direct transfer edges in the current 1-hop view.
                </div>
              ) : (
                node.counterparties.map((counterparty, index) => {
                  const flagged = counterparty.status === "warned" || counterparty.status === "blocked" || counterparty.status === "reversed"
                  return (
                    <div key={`${counterparty.id}-${counterparty.direction}-${index}`} className="rounded-md border border-border bg-card px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
                              counterparty.direction === "outbound" ? "bg-secondary text-foreground" : "bg-primary/10 text-primary"
                            }`}
                          >
                            {counterparty.direction === "outbound" ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownLeft className="h-3.5 w-3.5" />}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">{counterparty.label}</p>
                            <p className="font-mono text-[11px] text-muted-foreground">{counterparty.id}</p>
                          </div>
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${flagged ? "bg-destructive/10 text-destructive" : "bg-secondary text-muted-foreground"}`}>
                          {counterparty.status}
                        </span>
                      </div>
                      <p className="mt-2 font-mono text-xs font-semibold text-foreground">
                        RM {counterparty.amount.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

function NodeInfoRow({
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
        className={`col-span-2 break-words text-sm leading-snug ${mono ? "font-mono" : ""} ${
          highlight ? "font-semibold text-destructive" : "text-foreground"
        }`}
      >
        {value}
      </dd>
    </>
  )
}

function nodeTone(kind: NodeKind) {
  if (kind === "trusted") {
    return {
      badge: "bg-primary/10 text-primary",
      panel: "border-primary/30 bg-primary/5",
    }
  }
  if (kind === "flagged") {
    return {
      badge: "bg-destructive/10 text-destructive",
      panel: "border-destructive/30 bg-destructive/5",
    }
  }
  return {
    badge: "bg-secondary text-muted-foreground",
    panel: "border-border bg-secondary/40",
  }
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
