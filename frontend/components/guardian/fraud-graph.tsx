"use client"

import React, { useEffect, useState, useRef } from "react"
import { X, ArrowRight } from "lucide-react"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

// ── Types ──────────────────────────────────────────────────────────────────
export type NodeKind = "trusted" | "neutral" | "flagged"

type ApiNode = {
  id: string
  user_id: string
  name: string
  balance: number
  kyc_status: string
  risk_tier_current: string
  status: string
  risk_score_latest: number
  gmail: string
  created_at: string
}

type ApiEdge = {
  id: string
  from: string
  to: string
  amount: number
  currency: string
  status: string
  tx_time: string
  message_text: string
  tx_note: string
  channel: string
  finbert_score: number | null
  emotion_score: number | null
  risk_score_latest: number | null
  risk_reason_codes: string | null
  updated_at: string
}

type GraphData = {
  nodes: ApiNode[]
  edges: ApiEdge[]
  source: string
  fetched_at: string
}

type GNode = {
  id: string
  label: string
  sublabel: string
  kind: NodeKind
  raw: ApiNode
}

type GEdge = {
  key: string
  from: string
  to: string
  label: string
  flagged: boolean
  raw: ApiEdge
}

type Phys = { id: string; x: number; y: number; vx: number; vy: number }
type Pos  = Record<string, { x: number; y: number }>

type Selected =
  | { type: "node"; data: GNode }
  | { type: "edge"; data: GEdge; fromNode?: GNode; toNode?: GNode }

// ── Constants ────────────────────────────────────────────────────────────
const VB = { w: 1100, h: 560 }
const NR = 22  // node radius

// ── Helpers ──────────────────────────────────────────────────────────────
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)) }

function kindFor(tier: string, status: string): NodeKind {
  if (tier === "high" || status === "blocked") return "flagged"
  if (tier === "low" || status === "approved") return "trusted"
  return "neutral"
}

function buildGraph(apiNodes: ApiNode[], apiEdges: ApiEdge[]): { nodes: GNode[]; edges: GEdge[] } {
  if (!apiNodes.length) return { nodes: [], edges: [] }
  const nodeIds = new Set(apiNodes.map(n => n.id))
  return {
    nodes: apiNodes.map(n => ({
      id: n.id,
      label: n.name || "User",
      sublabel: n.status || n.risk_tier_current || "unrated",
      kind: kindFor(n.risk_tier_current, n.status),
      raw: n,
    })),
    edges: apiEdges
      .filter(e => nodeIds.has(e.from) && nodeIds.has(e.to))
      .map((e, i) => ({
        key: `e${i}`,
        from: e.from, to: e.to,
        label: `MYR ${Number(e.amount).toFixed(2)}`,
        flagged: e.status === "warned" || e.status === "blocked",
        raw: e,
      })),
  }
}

// ── Physics: grid-based initial positions ─────────────────────────────────
function initPhys(nodes: GNode[]): Phys[] {
  const n = nodes.length
  if (!n) return []
  // Spread nodes evenly in a grid over the viewBox
  const cols = Math.ceil(Math.sqrt(n * VB.w / VB.h))
  const rows = Math.ceil(n / cols)
  const cw = (VB.w - 160) / cols
  const ch = (VB.h - 120) / rows
  return nodes.map((node, i) => ({
    id: node.id,
    x: 80 + cw * (i % cols + 0.5) + (Math.random() - 0.5) * cw * 0.4,
    y: 60 + ch * (Math.floor(i / cols) + 0.5) + (Math.random() - 0.5) * ch * 0.4,
    vx: 0, vy: 0,
  }))
}

// ── Physics tick ──────────────────────────────────────────────────────────
function physicsTick(
  phys: Phys[],
  edges: GEdge[],
  alpha: number,
  pinnedId: string | null,
): Phys[] {
  const repel  = 14000 * alpha   // strong node-node repulsion
  const ks     = 0.018 * alpha   // spring constant (weak)
  const rlen   = 190             // spring rest length (px)
  const grav   = 0.003 * alpha   // gentle pull toward center
  const damp   = 0.82
  const MAX_V  = 14
  const cx = VB.w / 2, cy = VB.h / 2

  const n = phys.map(p => ({ ...p }))
  const idx: Record<string, number> = {}
  n.forEach((p, i) => { idx[p.id] = i })

  // Repulsion (all node pairs)
  for (let i = 0; i < n.length; i++) {
    for (let j = i + 1; j < n.length; j++) {
      const dx = n[j].x - n[i].x, dy = n[j].y - n[i].y
      const d2 = dx * dx + dy * dy || 1
      const d  = Math.sqrt(d2)
      const f  = Math.min(repel / d2, 60)  // cap to prevent explosions
      const fx = (dx / d) * f, fy = (dy / d) * f
      if (n[i].id !== pinnedId) { n[i].vx -= fx; n[i].vy -= fy }
      if (n[j].id !== pinnedId) { n[j].vx += fx; n[j].vy += fy }
    }
  }

  // Spring attraction along edges
  for (const e of edges) {
    const ai = idx[e.from], bi = idx[e.to]
    if (ai == null || bi == null) continue
    const dx = n[bi].x - n[ai].x, dy = n[bi].y - n[ai].y
    const d  = Math.sqrt(dx * dx + dy * dy) || 1
    // Cap stretch to prevent long-range springs from pulling too hard
    const stretch = clamp(d - rlen, -120, 120)
    const s = stretch * ks
    const fx = (dx / d) * s, fy = (dy / d) * s
    if (n[ai].id !== pinnedId) { n[ai].vx += fx; n[ai].vy += fy }
    if (n[bi].id !== pinnedId) { n[bi].vx -= fx; n[bi].vy -= fy }
  }

  // Gravity + integrate
  for (const p of n) {
    if (p.id === pinnedId) { p.vx = 0; p.vy = 0; continue }
    p.vx += (cx - p.x) * grav
    p.vy += (cy - p.y) * grav
    p.vx = clamp(p.vx * damp, -MAX_V, MAX_V)
    p.vy = clamp(p.vy * damp, -MAX_V, MAX_V)
    p.x  = clamp(p.x + p.vx, NR + 20, VB.w - NR - 20)
    p.y  = clamp(p.y + p.vy, NR + 20, VB.h - NR - 20)
  }

  return n
}

// ── Edge geometry (quadratic bezier) ─────────────────────────────────────
function edgeGeom(ax: number, ay: number, bx: number, by: number, curve = 36) {
  const dx = bx - ax, dy = by - ay
  const d  = Math.sqrt(dx * dx + dy * dy) || 1
  const ux = dx / d, uy = dy / d
  const sx = ax + ux * (NR + 2), sy = ay + uy * (NR + 2)
  const ex = bx - ux * (NR + 6), ey = by - uy * (NR + 6)
  const qx = (sx + ex) / 2 + (-uy) * curve
  const qy = (sy + ey) / 2 + (ux) * curve
  const mx = 0.25 * sx + 0.5 * qx + 0.25 * ex
  const my = 0.25 * sy + 0.5 * qy + 0.25 * ey
  return { path: `M ${sx} ${sy} Q ${qx} ${qy} ${ex} ${ey}`, mx, my }
}

// ── Color palette (light mode) ────────────────────────────────────────────
const PAL = {
  trusted: { fill: "#eff6ff", stroke: "#3b82f6", dot: "#2563eb", label: "#1e40af", sub: "#60a5fa", edge: "#93c5fd" },
  flagged: { fill: "#fff1f2", stroke: "#f43f5e", dot: "#e11d48", label: "#9f1239", sub: "#fb7185", edge: "#fda4af" },
  neutral: { fill: "#f8fafc", stroke: "#94a3b8", dot: "#64748b", label: "#334155", sub: "#94a3b8", edge: "#cbd5e1" },
}

// ── Component ─────────────────────────────────────────────────────────────
export function FraudGraph() {
  const [nodes, setNodes] = useState<GNode[]>([])
  const [edges, setEdges] = useState<GEdge[]>([])
  const [source, setSource] = useState("")
  const [fetchedAt, setFetchedAt] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState<Selected | null>(null)
  const [pos, setPos] = useState<Pos>({})

  const physRef   = useRef<Phys[]>([])
  const edgesRef  = useRef<GEdge[]>([])
  const alphaRef  = useRef(1)
  const rafRef    = useRef<number | undefined>(undefined)
  const loopOn    = useRef(false)
  const dragId    = useRef<string | null>(null)
  const svgRef    = useRef<SVGSVGElement>(null)

  // Keep edges accessible in the RAF loop
  useEffect(() => { edgesRef.current = edges }, [edges])

  // Fetch Neptune data
  useEffect(() => {
    fetch(`${API_URL}/graph/users`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<GraphData> })
      .then(data => {
        const { nodes: gn, edges: ge } = buildGraph(data.nodes ?? [], data.edges ?? [])
        setNodes(gn); setEdges(ge)
        edgesRef.current = ge
        setSource(data.source ?? "db-neptune-2")
        const d = new Date(data.fetched_at)
        setFetchedAt(isNaN(d.getTime()) ? data.fetched_at : d.toLocaleString("en-MY", { dateStyle: "short", timeStyle: "short" }))
        setLoading(false)
      })
      .catch(e => { setError(String(e.message ?? e)); setLoading(false) })
  }, [])

  // Start the physics simulation loop
  const startLoop = useRef<() => void>(() => {})

  useEffect(() => {
    startLoop.current = function run() {
      if (loopOn.current) return
      loopOn.current = true

      function frame() {
        const isDragging = dragId.current !== null

        if (alphaRef.current > 0.006 || isDragging) {
          if (alphaRef.current > 0.006) {
            alphaRef.current *= 0.988
          }
          physRef.current = physicsTick(
            physRef.current, edgesRef.current, alphaRef.current, dragId.current
          )
          // Always update display when dragging; throttle otherwise
          const p: Pos = {}
          physRef.current.forEach(n => { p[n.id] = { x: n.x, y: n.y } })
          setPos(p)
        }

        if (alphaRef.current > 0.006 || dragId.current) {
          rafRef.current = requestAnimationFrame(frame)
        } else {
          loopOn.current = false
          rafRef.current = undefined
        }
      }

      rafRef.current = requestAnimationFrame(frame)
    }
  })

  // Init physics when nodes load
  useEffect(() => {
    if (!nodes.length) return
    const initial = initPhys(nodes)
    physRef.current = initial
    alphaRef.current = 1
    loopOn.current = false
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    const p0: Pos = {}
    initial.forEach(n => { p0[n.id] = { x: n.x, y: n.y } })
    setPos(p0)
    startLoop.current()
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [nodes])

  // Convert screen coords to SVG coords
  function toSVG(clientX: number, clientY: number): { x: number; y: number } {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const r = svg.getBoundingClientRect()
    return {
      x: clamp((clientX - r.left) * VB.w / r.width,  NR + 10, VB.w - NR - 10),
      y: clamp((clientY - r.top)  * VB.h / r.height, NR + 10, VB.h - NR - 10),
    }
  }

  // Node drag handlers
  function onNodePointerDown(e: React.PointerEvent, nodeId: string) {
    e.stopPropagation()
    e.preventDefault()
    dragId.current = nodeId
    alphaRef.current = Math.max(alphaRef.current, 0.25)
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    startLoop.current()
  }

  // SVG-level pointer move & up
  function onSVGPointerMove(e: React.PointerEvent) {
    if (!dragId.current) return
    const { x, y } = toSVG(e.clientX, e.clientY)
    physRef.current = physRef.current.map(p =>
      p.id === dragId.current ? { ...p, x, y, vx: 0, vy: 0 } : p
    )
  }

  function onSVGPointerUp() {
    if (dragId.current) {
      dragId.current = null
      // Give a small kick of alpha so the graph settles after release
      alphaRef.current = Math.max(alphaRef.current, 0.15)
      startLoop.current()
    }
  }

  const isDraggingAny = false  // used for cursor style

  return (
    <div className="flex flex-col gap-0">
      {error && (
        <div className="mx-4 mt-4 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          Neptune graph unavailable: {error}
        </div>
      )}

      <div className="flex gap-0">
        {/* ── Graph canvas ── */}
        <div className="flex-1 min-w-0 bg-white">
          {loading ? (
            <div className="flex h-72 items-center justify-center gap-2 text-sm text-slate-400">
              <span className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
              Connecting to Neptune…
            </div>
          ) : !nodes.length ? (
            <div className="flex h-72 items-center justify-center text-sm text-slate-400">
              No graph data available.
            </div>
          ) : (
            <svg
              ref={svgRef}
              viewBox={`0 0 ${VB.w} ${VB.h}`}
              className="w-full h-auto select-none"
              style={{ touchAction: "none", cursor: isDraggingAny ? "grabbing" : "default" }}
              onPointerMove={onSVGPointerMove}
              onPointerUp={onSVGPointerUp}
              onPointerLeave={onSVGPointerUp}
              onClick={e => { if (e.target === e.currentTarget) setSel(null) }}
            >
              <defs>
                <pattern id="fg-dots" width="28" height="28" patternUnits="userSpaceOnUse">
                  <circle cx="0.6" cy="0.6" r="0.6" fill="#dde3ec" />
                </pattern>
                <marker id="fg-a"   viewBox="0 0 8 8" refX="7" refY="4" markerWidth="4" markerHeight="4" orient="auto">
                  <path d="M 0 1.5 L 6.5 4 L 0 6.5 z" fill="#94a3b8" />
                </marker>
                <marker id="fg-af"  viewBox="0 0 8 8" refX="7" refY="4" markerWidth="4" markerHeight="4" orient="auto">
                  <path d="M 0 1.5 L 6.5 4 L 0 6.5 z" fill="#f43f5e" />
                </marker>
                <marker id="fg-as"  viewBox="0 0 8 8" refX="7" refY="4" markerWidth="4" markerHeight="4" orient="auto">
                  <path d="M 0 1.5 L 6.5 4 L 0 6.5 z" fill="#f59e0b" />
                </marker>
              </defs>

              <rect width={VB.w} height={VB.h} fill="white" />
              <rect width={VB.w} height={VB.h} fill="url(#fg-dots)" />

              {/* ── Edges ── */}
              {edges.map(edge => {
                const a = pos[edge.from], b = pos[edge.to]
                if (!a || !b) return null
                const isSel = sel?.type === "edge" && sel.data.key === edge.key
                const { path, mx, my } = edgeGeom(a.x, a.y, b.x, b.y)
                const pal = PAL[nodes.find(n => n.id === edge.from)?.kind ?? "neutral"]
                const stroke = isSel ? "#f59e0b" : edge.flagged ? "#f43f5e" : pal.edge
                const arr    = isSel ? "url(#fg-as)" : edge.flagged ? "url(#fg-af)" : "url(#fg-a)"
                const lw     = edge.label.length * 4.8 + 12

                return (
                  <g key={edge.key} style={{ cursor: "pointer" }}
                     onClick={e => {
                       e.stopPropagation()
                       if (dragId.current) return
                       setSel({ type: "edge", data: edge,
                         fromNode: nodes.find(n => n.id === edge.from),
                         toNode:   nodes.find(n => n.id === edge.to) })
                     }}>
                    <path d={path} fill="none" stroke="transparent" strokeWidth={16} />
                    <path d={path} fill="none" stroke={stroke}
                          strokeWidth={isSel ? 2.5 : edge.flagged ? 1.8 : 1.2}
                          strokeDasharray={!edge.flagged && !isSel ? "5 4" : undefined}
                          markerEnd={arr}
                          opacity={isSel ? 1 : edge.flagged ? 0.75 : 0.45} />
                    <g transform={`translate(${mx} ${my})`} style={{ pointerEvents: "none" }}>
                      <rect x={-(lw / 2)} y={-8} width={lw} height={14} rx={7}
                            fill="white"
                            stroke={isSel ? "#f59e0b" : edge.flagged ? "#fecdd3" : "#e2e8f0"} />
                      <text textAnchor="middle" dominantBaseline="middle" fontSize="8"
                            fontFamily="ui-monospace,monospace"
                            fill={isSel ? "#d97706" : edge.flagged ? "#f43f5e" : "#94a3b8"}>
                        {edge.label}
                      </text>
                    </g>
                  </g>
                )
              })}

              {/* ── Nodes ── */}
              {nodes.map(node => {
                const p = pos[node.id]
                if (!p) return null
                const isSel = sel?.type === "node" && sel.data.id === node.id
                const pal   = PAL[node.kind]

                return (
                  <g key={node.id}
                     transform={`translate(${Math.round(p.x)} ${Math.round(p.y)})`}
                     style={{ cursor: "grab" }}
                     onPointerDown={e => onNodePointerDown(e, node.id)}
                     onClick={e => {
                       e.stopPropagation()
                       if (!dragId.current) setSel({ type: "node", data: node })
                     }}>

                    {/* Pulse halo (flagged) */}
                    {node.kind === "flagged" && (
                      <circle r={NR + 9} fill={pal.stroke} opacity={0.09}>
                        <animate attributeName="r" values={`${NR+6};${NR+16};${NR+6}`} dur="2.6s" repeatCount="indefinite" />
                        <animate attributeName="opacity" values="0.12;0.03;0.12" dur="2.6s" repeatCount="indefinite" />
                      </circle>
                    )}

                    {/* Selection ring */}
                    {isSel && (
                      <circle r={NR + 11} fill="none" stroke="#f59e0b"
                              strokeWidth={1.5} strokeDasharray="5 3" opacity={0.9}>
                        <animateTransform attributeName="transform" type="rotate"
                                          from="0 0 0" to="360 0 0" dur="6s" repeatCount="indefinite" />
                      </circle>
                    )}

                    {/* Node disc */}
                    <circle r={NR} fill={pal.fill}
                            stroke={isSel ? "#f59e0b" : pal.stroke}
                            strokeWidth={isSel ? 2.5 : 2} />

                    {/* Inner ring accent */}
                    <circle r={NR * 0.60} fill="none" stroke={pal.stroke} strokeWidth={0.8} opacity={0.25} />

                    {/* Center dot */}
                    <circle r={NR * 0.28} fill={isSel ? "#f59e0b" : pal.dot} />

                    {/* Labels */}
                    <text y={NR + 15} textAnchor="middle" fontSize="11" fontWeight="600"
                          fontFamily="system-ui,sans-serif"
                          fill={isSel ? "#92400e" : pal.label}
                          style={{ pointerEvents: "none" }}>
                      {node.label}
                    </text>
                    <text y={NR + 26} textAnchor="middle" fontSize="8.5"
                          fontFamily="system-ui,sans-serif"
                          fill={pal.sub} opacity={0.85}
                          style={{ pointerEvents: "none" }}>
                      {node.sublabel}
                    </text>
                  </g>
                )
              })}
            </svg>
          )}
        </div>

        {/* ── Detail panel ── */}
        {sel && (
          <div className="w-64 shrink-0 border-l border-border bg-white self-stretch overflow-y-auto">
            <DetailPanel sel={sel} onClose={() => setSel(null)} />
          </div>
        )}
      </div>

      {!loading && (
        <p className="px-4 py-2 text-[11px] text-muted-foreground border-t border-border/50">
          {source} · {fetchedAt || "—"} · Drag nodes · click to inspect
        </p>
      )}
    </div>
  )
}

// ── Detail Panel ──────────────────────────────────────────────────────────
function DetailPanel({ sel, onClose }: { sel: Selected; onClose: () => void }) {
  if (sel.type === "node") {
    const { data: n } = sel
    const r = n.raw
    const accent = n.kind === "flagged" ? "text-rose-600 border-rose-200 bg-rose-50"
                 : n.kind === "trusted"  ? "text-blue-600 border-blue-200 bg-blue-50"
                 :                         "text-slate-600 border-slate-200 bg-slate-50"
    const dot = n.kind === "flagged" ? "bg-rose-500"
              : n.kind === "trusted"  ? "bg-blue-500"
              :                         "bg-slate-400"
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
            <span className="text-sm font-semibold text-foreground truncate">{n.label}</span>
          </div>
          <button onClick={onClose} className="shrink-0 ml-2 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex-1 px-4 py-3 flex flex-col gap-0.5">
          <Field label="User ID"    value={r.user_id || r.id} mono />
          <Field label="Email"      value={r.gmail || "—"} />
          <Field label="Balance"    value={`MYR ${Number(r.balance ?? 0).toFixed(2)}`} mono accent />
          <Field label="KYC"        value={r.kyc_status || "—"} />
          <Field label="Risk Tier"  value={r.risk_tier_current || "unrated"} accent={r.risk_tier_current === "high"} />
          <Field label="Risk Score" value={r.risk_score_latest != null ? String(r.risk_score_latest) : "—"} mono />
          <Field label="Status"     value={r.status || "—"} />
          {r.created_at && <Field label="Created" value={safeDate(r.created_at)} />}
        </div>
        <div className={`mx-4 mb-4 rounded-lg border px-3 py-2 text-[11px] font-medium ${accent}`}>
          {n.kind === "flagged" ? "High-risk — active monitoring"
           : n.kind === "trusted" ? "Verified low-risk account"
           : "Neutral — standard monitoring"}
        </div>
      </div>
    )
  }

  const { data: e, fromNode, toNode } = sel
  const r = e.raw
  const flagCls = e.flagged
    ? "text-rose-600 border-rose-200 bg-rose-50"
    : "text-slate-600 border-slate-200 bg-slate-50"
  const amt = `${r.currency || "MYR"} ${Number(r.amount ?? 0).toFixed(2)}`

  function fmtScore(v: number | null | undefined): string {
    if (v == null) return "—"
    return Number(v).toFixed(4)
  }

  function fmtCodes(v: string | null | undefined): string {
    if (!v) return "—"
    try {
      const parsed = JSON.parse(v)
      return Array.isArray(parsed) ? parsed.join(", ") : String(v)
    } catch { return String(v) }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${e.flagged ? "bg-rose-500" : "bg-slate-400"}`} />
          <span className="text-sm font-semibold text-foreground">Transfer</span>
        </div>
        <button onClick={onClose} className="shrink-0 ml-2 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 px-4 py-3 flex flex-col gap-0.5 overflow-y-auto">
        {/* From → To */}
        <div className="flex items-center gap-1.5 bg-secondary rounded-lg px-2.5 py-2 mb-2 text-xs">
          <span className="font-medium text-foreground truncate">{fromNode?.label ?? r.from}</span>
          <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="font-medium text-foreground truncate">{toNode?.label ?? r.to}</span>
        </div>

        {/* Core transaction */}
        <SectionLabel>Transaction</SectionLabel>
        <Field label="Edge ID"  value={r.id || "—"} mono />
        <Field label="Amount"   value={amt} mono accent />
        <Field label="Status"   value={r.status || "—"} accent={r.status === "blocked" || r.status === "warned"} />
        <Field label="Channel"  value={r.channel || "—"} />
        <Field label="Tx Time"  value={r.tx_time ? safeDate(r.tx_time, true) : "—"} />
        <Field label="Updated"  value={r.updated_at ? safeDate(r.updated_at, true) : "—"} />
        {r.message_text && <Field label="Message" value={r.message_text} />}
        {r.tx_note      && <Field label="Note"    value={r.tx_note} />}

        {/* AI signals */}
        <SectionLabel>AI Signals</SectionLabel>
        <Field label="FinBERT"     value={fmtScore(r.finbert_score)} mono accent={r.finbert_score != null && r.finbert_score > 0.7} />
        <Field label="Emotion"     value={fmtScore(r.emotion_score)} mono accent={r.emotion_score != null && r.emotion_score > 0.7} />
        <Field label="Risk Score"  value={fmtScore(r.risk_score_latest)} mono accent={r.risk_score_latest != null && r.risk_score_latest > 0.6} />
        <Field label="Risk Codes"  value={fmtCodes(r.risk_reason_codes)} />

        {/* IDs */}
        <SectionLabel>Identifiers</SectionLabel>
        <Field label="From" value={r.from} mono />
        <Field label="To"   value={r.to}   mono />
      </div>

      <div className={`mx-4 mb-4 rounded-lg border px-3 py-2 text-[11px] font-medium ${flagCls}`}>
        {e.flagged ? "Flagged transfer — under review" : "Standard transfer"}
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2.5 mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
      {children}
    </p>
  )
}

function Field({ label, value, mono, accent }: {
  label: string; value: string; mono?: boolean; accent?: boolean
}) {
  return (
    <div className="flex justify-between gap-2 py-1 border-b border-border/40 last:border-0">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className={`text-xs text-right break-all leading-snug ${mono ? "font-mono" : ""} ${accent ? "text-primary font-medium" : "text-foreground"}`}>
        {value}
      </span>
    </div>
  )
}

function safeDate(s: string, withTime = false): string {
  try {
    const d = new Date(s)
    if (isNaN(d.getTime())) return s
    return d.toLocaleString("en-MY", withTime ? { dateStyle: "short", timeStyle: "short" } : { dateStyle: "short" })
  } catch { return s }
}
