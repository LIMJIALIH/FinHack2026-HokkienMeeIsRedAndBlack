"use client"

import { Globe, User, UserX, Wallet } from "lucide-react"

export type NodeKind = "user" | "neutral" | "flagged" | "mule"

export type GraphNode = {
  id: string
  label: string
  sublabel?: string
  x: number
  y: number
  kind: NodeKind
  icon: "user" | "wallet" | "ip" | "mule"
}

export type GraphEdge = {
  id?: string
  from: string
  to: string
  label?: string
  flagged?: boolean
}

const VIEWBOX = { w: 720, h: 400 }

export function FraudGraph({ nodes, edges }: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  if (nodes.length === 0) {
    return (
      <div className="flex h-52 items-center justify-center rounded-md border border-dashed border-border bg-background text-sm text-muted-foreground">
        No live Neptune graph data found.
      </div>
    )
  }

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${VIEWBOX.w} ${VIEWBOX.h}`}
        className="h-auto w-full"
        role="img"
        aria-label="Node-link diagram of live Neptune relationships for regulatory monitoring"
      >
        <defs>
          <marker
            id="arrow-flag"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="oklch(0.58 0.22 25)" />
          </marker>
          <marker
            id="arrow-neutral"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="oklch(0.5 0.02 250)" />
          </marker>
        </defs>

        <g>
          {edges.map((edge) => {
            const a = nodes.find((n) => n.id === edge.from)
            const b = nodes.find((n) => n.id === edge.to)
            if (!a || !b) return null

            const stroke = edge.flagged ? "oklch(0.58 0.22 25)" : "oklch(0.5 0.02 250)"
            const dash = edge.flagged ? "0" : "4 4"
            const midX = (a.x + b.x) / 2
            const midY = (a.y + b.y) / 2
            const edgeLabel = edge.label ?? ""

            return (
              <g key={edge.id ?? `${edge.from}-${edge.to}-${edgeLabel}`}>
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={stroke}
                  strokeWidth={edge.flagged ? 2 : 1.5}
                  strokeDasharray={dash}
                  markerEnd={edge.flagged ? "url(#arrow-flag)" : "url(#arrow-neutral)"}
                  opacity={edge.flagged ? 0.95 : 0.7}
                />
                {edgeLabel && (
                  <g transform={`translate(${midX} ${midY})`}>
                    <rect
                      x={-((edgeLabel.length * 5.6) / 2) - 8}
                      y={-10}
                      width={edgeLabel.length * 5.6 + 16}
                      height={20}
                      rx={10}
                      fill="oklch(1 0 0)"
                      stroke="oklch(0.9 0.01 250)"
                    />
                    <text
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize="11"
                      fontFamily="var(--font-mono)"
                      fill={edge.flagged ? "oklch(0.58 0.22 25)" : "oklch(0.4 0.02 250)"}
                    >
                      {edgeLabel}
                    </text>
                  </g>
                )}
              </g>
            )
          })}
        </g>

        <g>
          {nodes.map((node) => (
            <NodeBubble key={node.id} node={node} />
          ))}
        </g>
      </svg>
    </div>
  )
}

function NodeBubble({ node }: { node: GraphNode }) {
  const palette = paletteFor(node.kind)
  const isFlagged = node.kind === "flagged" || node.kind === "mule"

  return (
    <g transform={`translate(${node.x} ${node.y})`}>
      {isFlagged && (
        <circle r={42} fill={palette.haloFill} opacity={0.5}>
          <animate attributeName="r" values="40;48;40" dur="2.4s" repeatCount="indefinite" />
          <animate
            attributeName="opacity"
            values="0.55;0.15;0.55"
            dur="2.4s"
            repeatCount="indefinite"
          />
        </circle>
      )}
      <circle r={32} fill={palette.bg} stroke={palette.border} strokeWidth={2} />

      <foreignObject x={-12} y={-12} width={24} height={24}>
        <div className="flex h-6 w-6 items-center justify-center" style={{ color: palette.icon }}>
          <NodeIcon kind={node.icon} />
        </div>
      </foreignObject>

      <text y={50} textAnchor="middle" fontSize="12" fontWeight="600" fill="oklch(0.18 0.02 250)">
        {node.label}
      </text>
      {node.sublabel && (
        <text y={66} textAnchor="middle" fontSize="10.5" fill="oklch(0.5 0.02 250)">
          {node.sublabel}
        </text>
      )}
    </g>
  )
}

function NodeIcon({ kind }: { kind: GraphNode["icon"] }) {
  if (kind === "user") return <User className="h-5 w-5" aria-hidden="true" />
  if (kind === "wallet") return <Wallet className="h-5 w-5" aria-hidden="true" />
  if (kind === "ip") return <Globe className="h-5 w-5" aria-hidden="true" />
  return <UserX className="h-5 w-5" aria-hidden="true" />
}

function paletteFor(kind: NodeKind) {
  if (kind === "user")
    return {
      bg: "oklch(0.97 0.04 255)",
      border: "oklch(0.52 0.21 255)",
      icon: "oklch(0.52 0.21 255)",
      haloFill: "oklch(0.52 0.21 255)",
    }
  if (kind === "flagged")
    return {
      bg: "oklch(0.97 0.04 25)",
      border: "oklch(0.58 0.22 25)",
      icon: "oklch(0.58 0.22 25)",
      haloFill: "oklch(0.58 0.22 25)",
    }
  if (kind === "mule")
    return {
      bg: "oklch(0.96 0.06 25)",
      border: "oklch(0.45 0.22 25)",
      icon: "oklch(0.45 0.22 25)",
      haloFill: "oklch(0.45 0.22 25)",
    }
  return {
    bg: "oklch(0.96 0.01 250)",
    border: "oklch(0.85 0.01 250)",
    icon: "oklch(0.4 0.02 250)",
    haloFill: "oklch(0.85 0.01 250)",
  }
}
