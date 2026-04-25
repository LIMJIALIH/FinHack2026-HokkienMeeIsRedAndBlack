"use client"

import { Globe, User, UserX, Wallet } from "lucide-react"

type NodeKind = "user" | "neutral" | "flagged" | "mule"

type GraphNode = {
  id: string
  label: string
  sublabel?: string
  x: number
  y: number
  kind: NodeKind
  icon: "user" | "wallet" | "ip" | "mule"
}

type GraphEdge = {
  from: string
  to: string
  label?: string
  flagged?: boolean
}

const NODES: GraphNode[] = [
  { id: "user", label: "Ahmad Bin Ali", sublabel: "Sender · ****6721", x: 90, y: 200, kind: "user", icon: "user" },
  {
    id: "target",
    label: "Investment Agent",
    sublabel: "Target · ****9024",
    x: 360,
    y: 90,
    kind: "flagged",
    icon: "wallet",
  },
  {
    id: "ip",
    label: "Shared IP",
    sublabel: "203.82.x.x",
    x: 360,
    y: 310,
    kind: "flagged",
    icon: "ip",
  },
  {
    id: "mule",
    label: "Mule Cluster #442",
    sublabel: "Known laundering",
    x: 620,
    y: 200,
    kind: "mule",
    icon: "mule",
  },
]

const EDGES: GraphEdge[] = [
  { from: "user", to: "target", label: "RM 1,000 · attempted" },
  { from: "target", to: "ip", label: "logged-in IP", flagged: true },
  { from: "ip", to: "mule", label: "shared with", flagged: true },
  { from: "target", to: "mule", label: "1-hop link", flagged: true },
]

const VIEWBOX = { w: 720, h: 400 }

export function FraudGraph() {
  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${VIEWBOX.w} ${VIEWBOX.h}`}
        className="h-auto w-full"
        role="img"
        aria-label="Node-link diagram of the blocked fraud ring connecting the sender, target account, shared IP, and known mule cluster"
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

        {/* Edges */}
        <g>
          {EDGES.map((edge) => {
            const a = NODES.find((n) => n.id === edge.from)!
            const b = NODES.find((n) => n.id === edge.to)!
            const stroke = edge.flagged ? "oklch(0.58 0.22 25)" : "oklch(0.5 0.02 250)"
            const dash = edge.flagged ? "0" : "4 4"
            const midX = (a.x + b.x) / 2
            const midY = (a.y + b.y) / 2
            return (
              <g key={`${edge.from}-${edge.to}`}>
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
                {edge.label && (
                  <g transform={`translate(${midX} ${midY})`}>
                    <rect
                      x={-((edge.label.length * 5.6) / 2) - 8}
                      y={-10}
                      width={edge.label.length * 5.6 + 16}
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
                      {edge.label}
                    </text>
                  </g>
                )}
              </g>
            )
          })}
        </g>

        {/* Nodes */}
        <g>
          {NODES.map((node) => (
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
        <circle
          r={42}
          fill={palette.haloFill}
          opacity={0.5}
        >
          <animate
            attributeName="r"
            values="40;48;40"
            dur="2.4s"
            repeatCount="indefinite"
          />
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
        <div
          className="flex h-6 w-6 items-center justify-center"
          style={{ color: palette.icon }}
        >
          <NodeIcon kind={node.icon} />
        </div>
      </foreignObject>

      <text
        y={50}
        textAnchor="middle"
        fontSize="12"
        fontWeight="600"
        fill="oklch(0.18 0.02 250)"
      >
        {node.label}
      </text>
      {node.sublabel && (
        <text
          y={66}
          textAnchor="middle"
          fontSize="10.5"
          fill="oklch(0.5 0.02 250)"
        >
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
