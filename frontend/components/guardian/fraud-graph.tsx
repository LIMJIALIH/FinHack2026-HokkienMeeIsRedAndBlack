"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Move, RotateCcw, User, UserX, ZoomIn, ZoomOut } from "lucide-react"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

export type NodeKind = "trusted" | "neutral" | "flagged"

export type GraphNode = {
  id: string
  label: string
  sublabel: string
  x: number
  y: number
  kind: NodeKind
  graphId: string
  userId: string
  riskTier: string
  status: string
  connections: number
  inbound: number
  outbound: number
  totalAmount: number
  flaggedConnections: number
  counterparties: GraphCounterparty[]
}

export type GraphEdge = {
  id: string
  from: string
  to: string
  label: string
  amount: number
  status: string
  flagged: boolean
}

export type GraphCounterparty = {
  id: string
  label: string
  amount: number
  status: string
  direction: "inbound" | "outbound"
}

type ApiNode = {
  id: string
  user_id: string
  name: string
  risk_tier_current: string
  status: string
}

type ApiEdge = {
  from: string
  to: string
  amount: number
  status: string
}

type GraphData = {
  nodes: ApiNode[]
  edges: ApiEdge[]
  source: string
  fetched_at: string
}

const VIEWBOX = { w: 820, h: 520 }
const MIN_SCALE = 0.55
const MAX_SCALE = 2.8

function kindFor(tier: string, status: string): NodeKind {
  if (tier === "high" || status === "blocked") return "flagged"
  if (tier === "low" || status === "approved") return "trusted"
  return "neutral"
}

function sublabelFor(tier: string, status: string): string {
  if (status) return status
  if (tier) return tier
  return "unrated"
}

function buildGraph(apiNodes: ApiNode[], apiEdges: ApiEdge[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const n = apiNodes.length
  if (n === 0) return { nodes: [], edges: [] }

  const connected = new Set<string>()
  apiEdges.forEach((e) => {
    connected.add(e.from)
    connected.add(e.to)
  })

  const connectedNodes = apiNodes.filter((node) => connected.has(node.user_id || node.id))
  const isolatedNodes = apiNodes.filter((node) => !connected.has(node.user_id || node.id))

  const cx = VIEWBOX.w / 2
  const cy = VIEWBOX.h / 2 - 20
  const radius = Math.min(cx, cy) - 80

  const positions: Record<string, { x: number; y: number }> = {}

  connectedNodes.forEach((node, i) => {
    const nodeId = node.user_id || node.id
    const angle = (2 * Math.PI * i) / Math.max(1, connectedNodes.length) - Math.PI / 2
    positions[nodeId] = {
      x: Math.round(cx + radius * Math.cos(angle)),
      y: Math.round(cy + radius * Math.sin(angle)),
    }
  })

  isolatedNodes.forEach((node, i) => {
    const nodeId = node.user_id || node.id
    const spread = isolatedNodes.length > 1 ? (i - (isolatedNodes.length - 1) / 2) * 120 : 0
    positions[nodeId] = { x: Math.round(cx + spread), y: Math.round(cy + 10) }
  })

  const nodes: GraphNode[] = apiNodes.map((node) => {
    const nodeId = node.user_id || node.id
    return {
      id: nodeId,
      label: node.name || "User",
      sublabel: sublabelFor(node.risk_tier_current, node.status),
      kind: kindFor(node.risk_tier_current, node.status),
      graphId: node.id,
      userId: node.user_id || node.id,
      riskTier: node.risk_tier_current || "unrated",
      status: node.status || "unknown",
      connections: 0,
      inbound: 0,
      outbound: 0,
      totalAmount: 0,
      flaggedConnections: 0,
      counterparties: [],
      ...positions[nodeId],
    }
  })

  const nodeIds = new Set(nodes.map((node) => node.id))
  const nodeLabels = new Map(nodes.map((node) => [node.id, node.label]))
  const edges: GraphEdge[] = apiEdges
    .filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to))
    .map((e, i) => ({
      id: `${e.from}-${e.to}-${Number(e.amount).toFixed(2)}-${e.status || "unknown"}-${i}`,
      from: e.from,
      to: e.to,
      label: `MYR ${Number(e.amount).toFixed(2)} - ${e.status}`,
      amount: Number(e.amount) || 0,
      status: e.status || "unknown",
      flagged: e.status === "warned" || e.status === "blocked" || e.status === "reversed",
    }))

  const stats = new Map<string, Pick<GraphNode, "connections" | "inbound" | "outbound" | "totalAmount" | "flaggedConnections" | "counterparties">>()
  nodes.forEach((node) => {
    stats.set(node.id, {
      connections: 0,
      inbound: 0,
      outbound: 0,
      totalAmount: 0,
      flaggedConnections: 0,
      counterparties: [],
    })
  })

  edges.forEach((edge) => {
    const from = stats.get(edge.from)
    const to = stats.get(edge.to)
    if (!from || !to) return

    from.connections += 1
    from.outbound += 1
    from.totalAmount += edge.amount
    if (edge.flagged) from.flaggedConnections += 1
    from.counterparties.push({
      id: edge.to,
      label: nodeLabels.get(edge.to) ?? edge.to,
      amount: edge.amount,
      status: edge.status,
      direction: "outbound",
    })

    to.connections += 1
    to.inbound += 1
    to.totalAmount += edge.amount
    if (edge.flagged) to.flaggedConnections += 1
    to.counterparties.push({
      id: edge.from,
      label: nodeLabels.get(edge.from) ?? edge.from,
      amount: edge.amount,
      status: edge.status,
      direction: "inbound",
    })
  })

  nodes.forEach((node) => {
    Object.assign(node, stats.get(node.id))
  })

  return { nodes, edges }
}

type FraudGraphProps = {
  selectedNodeId?: string | null
  onNodeSelect?: (node: GraphNode) => void
}

type ViewTransform = {
  x: number
  y: number
  scale: number
}

export function FraudGraph({ selectedNodeId, onNodeSelect }: FraudGraphProps) {
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [edges, setEdges] = useState<GraphEdge[]>([])
  const [source, setSource] = useState("")
  const [fetchedAt, setFetchedAt] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [transform, setTransform] = useState<ViewTransform>({ x: 0, y: 0, scale: 1 })
  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)

  useEffect(() => {
    fetch(`${API_URL}/graph/users`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<GraphData>
      })
      .then((data) => {
        const { nodes: gn, edges: ge } = buildGraph(data.nodes ?? [], data.edges ?? [])
        setNodes(gn)
        setEdges(ge)
        setSource(data.source ?? "db-neptune-2")
        const d = new Date(data.fetched_at)
        setFetchedAt(
          Number.isNaN(d.getTime())
            ? data.fetched_at
            : d.toLocaleString("en-MY", { dateStyle: "short", timeStyle: "short" }),
        )
        setLoading(false)
      })
      .catch((e) => {
        setError(String(e.message ?? e))
        setLoading(false)
      })
  }, [])

  const pointInViewBox = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current
    if (!svg) return { x: VIEWBOX.w / 2, y: VIEWBOX.h / 2 }
    const rect = svg.getBoundingClientRect()
    return {
      x: ((clientX - rect.left) / rect.width) * VIEWBOX.w,
      y: ((clientY - rect.top) / rect.height) * VIEWBOX.h,
    }
  }, [])

  const zoomAt = useCallback((nextScale: number, anchor = { x: VIEWBOX.w / 2, y: VIEWBOX.h / 2 }) => {
    setTransform((prev) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale))
      const ratio = scale / prev.scale
      return {
        scale,
        x: anchor.x - (anchor.x - prev.x) * ratio,
        y: anchor.y - (anchor.y - prev.y) * ratio,
      }
    })
  }, [])

  const handleWheel = useCallback((event: WheelEvent) => {
    event.preventDefault()
    const factor = event.deltaY > 0 ? 0.9 : 1.1
    zoomAt(transform.scale * factor, pointInViewBox(event.clientX, event.clientY))
  }, [pointInViewBox, transform.scale, zoomAt])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    svg.addEventListener("wheel", handleWheel, { passive: false })
    return () => svg.removeEventListener("wheel", handleWheel)
  }, [handleWheel])

  const handlePointerDown = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: transform.x,
      originY: transform.y,
    }
  }, [transform.x, transform.y])

  const handlePointerMove = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    const svg = svgRef.current
    if (!drag || drag.pointerId !== event.pointerId || !svg) return
    const rect = svg.getBoundingClientRect()
    const dx = ((event.clientX - drag.startX) / rect.width) * VIEWBOX.w
    const dy = ((event.clientY - drag.startY) / rect.height) * VIEWBOX.h
    setTransform((prev) => ({ ...prev, x: drag.originX + dx, y: drag.originY + dy }))
  }, [])

  const handlePointerUp = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null
    }
  }, [])

  const resetView = useCallback(() => {
    setTransform({ x: 0, y: 0, scale: 1 })
  }, [])

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          Failed to load Neptune graph: {error}
        </div>
      )}

      <div className="relative rounded-lg border border-dashed border-border bg-background p-2">
        {loading ? (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">Loading graph...</div>
        ) : nodes.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">No live Neptune graph data found.</div>
        ) : (
          <>
            <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-md border border-border bg-card/95 p-1 shadow-sm backdrop-blur">
              <button type="button" onClick={() => zoomAt(transform.scale * 1.18)} className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label="Zoom in">
                <ZoomIn className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => zoomAt(transform.scale / 1.18)} className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label="Zoom out">
                <ZoomOut className="h-4 w-4" />
              </button>
              <button type="button" onClick={resetView} className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label="Reset view">
                <RotateCcw className="h-4 w-4" />
              </button>
            </div>
            <div className="absolute left-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-md border border-border bg-card/95 px-2 py-1 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur">
              <Move className="h-3.5 w-3.5" aria-hidden="true" />
              {Math.round(transform.scale * 100)}%
            </div>
            <svg
              ref={svgRef}
              viewBox={`0 0 ${VIEWBOX.w} ${VIEWBOX.h}`}
              className="h-[420px] w-full touch-none cursor-grab active:cursor-grabbing"
              role="img"
              aria-label="Live fraud network graph from Neptune"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              <defs>
                <marker id="arr-flag" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="oklch(0.58 0.22 25)" />
                </marker>
                <marker id="arr-ok" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="oklch(0.5 0.02 250)" />
                </marker>
              </defs>

              <g transform={`matrix(${transform.scale} 0 0 ${transform.scale} ${transform.x} ${transform.y})`}>
                {edges.map((edge) => {
                  const a = nodes.find((node) => node.id === edge.from)
                  const b = nodes.find((node) => node.id === edge.to)
                  if (!a || !b) return null
                  const stroke = edge.flagged ? "oklch(0.58 0.22 25)" : "oklch(0.6 0.02 250)"
                  const midX = (a.x + b.x) / 2
                  const midY = (a.y + b.y) / 2
                  return (
                    <g key={edge.id}>
                      <line
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        stroke={stroke}
                        strokeWidth={edge.flagged ? 2 : 1.5}
                        strokeDasharray={edge.flagged ? "0" : "5 4"}
                        markerEnd={edge.flagged ? "url(#arr-flag)" : "url(#arr-ok)"}
                        opacity={edge.flagged ? 0.9 : 0.65}
                      />
                      <g transform={`translate(${midX} ${midY})`}>
                        <rect x={-((edge.label.length * 5.2) / 2) - 6} y={-9} width={edge.label.length * 5.2 + 12} height={18} rx={9} fill="white" stroke="oklch(0.88 0.01 250)" />
                        <text textAnchor="middle" dominantBaseline="middle" fontSize="10" fontFamily="var(--font-mono, monospace)" fill={edge.flagged ? "oklch(0.55 0.22 25)" : "oklch(0.4 0.02 250)"}>
                          {edge.label}
                        </text>
                      </g>
                    </g>
                  )
                })}

                {nodes.map((node) => (
                  <NodeBubble
                    key={node.id}
                    node={node}
                    selected={selectedNodeId === node.id}
                    onSelect={() => onNodeSelect?.(node)}
                  />
                ))}
              </g>
            </svg>
          </>
        )}
      </div>

      {!loading && <p className="text-[11px] text-muted-foreground">Source: {source} | Last fetched: {fetchedAt || "-"}</p>}
    </div>
  )
}

function NodeBubble({ node, selected, onSelect }: { node: GraphNode; selected: boolean; onSelect: () => void }) {
  const pal = palette(node.kind)
  const isFlagged = node.kind === "flagged"

  return (
    <g
      transform={`translate(${node.x} ${node.y})`}
      role="button"
      tabIndex={0}
      className="cursor-pointer outline-none"
      onClick={onSelect}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onSelect()
        }
      }}
    >
      {isFlagged && (
        <circle r={44} fill={pal.halo} opacity={0.45}>
          <animate attributeName="r" values="40;50;40" dur="2.4s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.5;0.1;0.5" dur="2.4s" repeatCount="indefinite" />
        </circle>
      )}
      {selected && <circle r={38} fill="none" stroke="oklch(0.52 0.21 255)" strokeWidth={3} strokeDasharray="4 4" />}
      <circle r={30} fill={pal.bg} stroke={pal.border} strokeWidth={2.5} />
      <foreignObject x={-10} y={-10} width={20} height={20}>
        <div className="flex h-5 w-5 items-center justify-center" style={{ color: pal.icon }}>
          {isFlagged ? <UserX className="h-4 w-4" aria-hidden="true" /> : <User className="h-4 w-4" aria-hidden="true" />}
        </div>
      </foreignObject>
      <text y={46} textAnchor="middle" fontSize="12" fontWeight="600" fill="oklch(0.18 0.02 250)">
        {node.label}
      </text>
      <text y={60} textAnchor="middle" fontSize="10" fill="oklch(0.5 0.02 250)">
        {node.sublabel}
      </text>
    </g>
  )
}

function palette(kind: NodeKind) {
  if (kind === "trusted") {
    return { bg: "oklch(0.97 0.04 255)", border: "oklch(0.52 0.21 255)", icon: "oklch(0.52 0.21 255)", halo: "oklch(0.52 0.21 255)" }
  }
  if (kind === "flagged") {
    return { bg: "oklch(0.97 0.05 25)", border: "oklch(0.55 0.22 25)", icon: "oklch(0.55 0.22 25)", halo: "oklch(0.55 0.22 25)" }
  }
  return { bg: "oklch(0.96 0.01 250)", border: "oklch(0.78 0.01 250)", icon: "oklch(0.45 0.02 250)", halo: "oklch(0.78 0.01 250)" }
}
