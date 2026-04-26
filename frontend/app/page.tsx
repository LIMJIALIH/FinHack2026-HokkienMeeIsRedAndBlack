"use client"

import { useEffect, useState } from "react"
import { TopNav } from "@/components/guardian/top-nav"
import { WalletView } from "@/components/guardian/wallet-view"
import { DashboardView } from "@/components/guardian/dashboard-view"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

export type View = "wallet" | "dashboard"

export type TransactionStatus =
  | "approved"
  | "pending_hitl"
  | "warned"
  | "blocked"
  | "reversed"
  | "completed"
  | "settlement_failed"
  | "unknown"

export type Transaction = {
  id: string
  recipient: string
  recipient_graph_id?: string
  amount: number
  currency: string
  purpose: string
  date: string
  type: "sent" | "received"
  status: TransactionStatus
  wallet_settled?: boolean
  sender_balance_after?: number | null
  recipient_balance_after?: number | null
  channel: string
  risk_score: number
  reason_codes: string[]
  decision: string
}

type AgentTransferSummary = {
  amount: number
  currency: string
  recipient_name: string
  purpose?: string
  risk_score?: number
  reason_codes?: string[]
  decision_preview?: "APPROVED" | "WARNING" | "INTERVENTION_REQUIRED"
}

const INITIAL_BALANCE = 250
const INITIAL_TRANSACTIONS: Transaction[] = []

export default function Page() {
  const [view, setView] = useState<View>("dashboard")
  const [isAdmin, setIsAdmin] = useState(true)
  const [userName, setUserName] = useState("")
  const [isLoggedIn, setIsLoggedIn] = useState(false)

  const [balance, setBalance] = useState<number>(INITIAL_BALANCE)
  const [userBaseBalance, setUserBaseBalance] = useState<number>(0)
  const [transactions, setTransactions] = useState<Transaction[]>(INITIAL_TRANSACTIONS)
  const [protectedAmount, setProtectedAmount] = useState<number>(45200)
  const [threatsBlocked, setThreatsBlocked] = useState<number>(12)
  const [lastBlocked, setLastBlocked] = useState<{ amount: number; recipient: string } | null>(null)

  useEffect(() => {
    const token = localStorage.getItem("auth_token")
    const name = localStorage.getItem("user_name") ?? ""
    setUserName(name)

    if (token && name) {
      setIsLoggedIn(true)
      setIsAdmin(false)
      setView("wallet")
      setBalance(0)
      setTransactions([])

      fetch(`${API_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((json) => {
          if (json?.balance !== undefined) {
            const bal = Number(json.balance)
            setBalance(bal)
            setUserBaseBalance(bal)
          }
          if (json?.id) {
            localStorage.setItem("user_id", String(json.id))
          }
        })
        .catch(() => {})

      fetch(`${API_URL}/wallet/transactions`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((json) => {
          if (Array.isArray(json?.transactions)) {
            setTransactions(json.transactions as Transaction[])
          }
        })
        .catch(() => {})
    }
  }, [])

  const refreshWalletFromBackend = async (): Promise<void> => {
    const token = localStorage.getItem("auth_token")
    if (!token) return
    const headers = { Authorization: `Bearer ${token}` }
    const [accountResponse, transactionsResponse] = await Promise.all([
      fetch(`${API_URL}/auth/me`, { headers }),
      fetch(`${API_URL}/wallet/transactions`, { headers }),
    ])
    if (accountResponse.ok) {
      const data = (await accountResponse.json()) as { balance?: number }
      if (data.balance !== undefined) {
        const bal = Number(data.balance)
        setBalance(bal)
        setUserBaseBalance(bal)
      }
    }
    if (transactionsResponse.ok) {
      const data = (await transactionsResponse.json()) as { transactions?: Transaction[] }
      if (Array.isArray(data.transactions)) {
        setTransactions(data.transactions)
      }
    }
  }

  function handleToggleRole() {
    setIsAdmin((prev) => {
      const next = !prev
      setView(next ? "dashboard" : "wallet")
      if (!next && isLoggedIn) {
        setBalance(userBaseBalance)
        setTransactions([])
        setLastBlocked(null)
      }
      if (next) {
        setBalance(INITIAL_BALANCE)
        setTransactions(INITIAL_TRANSACTIONS)
        setLastBlocked(null)
      }
      return next
    })
  }

  const handleSafeTransfer = (transfer: AgentTransferSummary) => {
    const newTx: Transaction = {
      id: `tx-${Date.now()}`,
      recipient: transfer.recipient_name,
      amount: transfer.amount,
      currency: transfer.currency || "MYR",
      purpose: transfer.purpose || "Transfer",
      date: "Just now",
      type: "sent",
      status: "approved",
      channel: "voice_agent",
      risk_score: transfer.risk_score ?? 0,
      reason_codes: transfer.reason_codes ?? [],
      decision: "APPROVED",
    }
    setTransactions((prev) => [newTx, ...prev])
    void refreshWalletFromBackend()
  }

  const handleScamCanceled = (transfer: AgentTransferSummary) => {
    setProtectedAmount((prev) => prev + transfer.amount)
    setThreatsBlocked((prev) => prev + 1)
    setLastBlocked({ amount: transfer.amount, recipient: transfer.recipient_name })
    const blockedTx: Transaction = {
      id: `tx-${Date.now()}`,
      recipient: transfer.recipient_name,
      amount: transfer.amount,
      currency: transfer.currency || "MYR",
      purpose: transfer.purpose || "Transfer",
      date: "Just now",
      type: "sent",
      status: "reversed",
      channel: "voice_agent",
      risk_score: transfer.risk_score ?? 0,
      reason_codes: transfer.reason_codes ?? [],
      decision: "INTERVENTION_REQUIRED",
    }
    setTransactions((prev) => [blockedTx, ...prev])
  }

  const handleScamProceed = (transfer: AgentTransferSummary) => {
    const newTx: Transaction = {
      id: `tx-${Date.now()}`,
      recipient: transfer.recipient_name,
      amount: transfer.amount,
      currency: transfer.currency || "MYR",
      purpose: transfer.purpose || "Transfer",
      date: "Just now",
      type: "sent",
      status: "warned",
      channel: "voice_agent",
      risk_score: transfer.risk_score ?? 0,
      reason_codes: transfer.reason_codes ?? [],
      decision: transfer.decision_preview ?? "WARNING",
    }
    setTransactions((prev) => [newTx, ...prev])
    void refreshWalletFromBackend()
  }

  const handleReset = () => {
    if (isLoggedIn && !isAdmin) {
      setBalance(userBaseBalance)
      setTransactions([])
    } else {
      setBalance(INITIAL_BALANCE)
      setTransactions(INITIAL_TRANSACTIONS)
    }
    setLastBlocked(null)
  }

  const handleReload = async (amount: number): Promise<void> => {
    const token = localStorage.getItem("auth_token")
    if (!token) throw new Error("Not authenticated")
    const r = await fetch(`${API_URL}/wallet/reload`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ amount }),
    })
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      throw new Error((err as { detail?: string }).detail ?? "Reload failed")
    }
    const data = (await r.json()) as { new_balance: number }
    const newBal = Number(data.new_balance)
    setBalance(newBal)
    setUserBaseBalance(newBal)
    void refreshWalletFromBackend()
  }

  return (
    <main className="min-h-screen bg-background">
      <TopNav
        view={view}
        onViewChange={setView}
        isAdmin={isAdmin}
        onToggleRole={handleToggleRole}
        userName={userName}
      />
      <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-10">
        {view === "wallet" ? (
          <WalletView
            balance={balance}
            transactions={transactions}
            lastBlocked={lastBlocked}
            onClearBlocked={() => setLastBlocked(null)}
            onSafeTransfer={handleSafeTransfer}
            onScamCanceled={handleScamCanceled}
            onScamProceed={handleScamProceed}
            onReset={handleReset}
            onReload={isLoggedIn ? handleReload : undefined}
            userName={userName}
          />
        ) : (
          <DashboardView protectedAmount={protectedAmount} threatsBlocked={threatsBlocked} />
        )}
      </div>
    </main>
  )
}
