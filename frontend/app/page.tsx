"use client"

import { useState } from "react"
import { TopNav } from "@/components/guardian/top-nav"
import { WalletView } from "@/components/guardian/wallet-view"
import { DashboardView } from "@/components/guardian/dashboard-view"

export type View = "wallet" | "dashboard"

export type TransactionStatus =
  | "approved"
  | "pending_hitl"
  | "warned"
  | "blocked"
  | "reversed"
  | "completed"

export type Transaction = {
  id: string
  recipient: string
  amount: number
  currency: string
  purpose: string
  date: string
  type: "sent" | "received"
  status: TransactionStatus
  channel: string
  risk_score: number
  reason_codes: string[]
  decision: string
}

const INITIAL_BALANCE = 250
const INITIAL_TRANSACTIONS: Transaction[] = [
  {
    id: "tx-001",
    recipient: "Siti Nurhaliza",
    amount: 25,
    currency: "MYR",
    purpose: "Coffee",
    date: "Yesterday, 14:22",
    type: "sent",
    status: "approved",
    channel: "wallet_app",
    risk_score: 5,
    reason_codes: [],
    decision: "APPROVED",
  },
  {
    id: "tx-002",
    recipient: "Salary — DBKL",
    amount: 180,
    currency: "MYR",
    purpose: "Reimbursement",
    date: "2 days ago, 09:14",
    type: "received",
    status: "approved",
    channel: "payroll",
    risk_score: 0,
    reason_codes: [],
    decision: "APPROVED",
  },
  {
    id: "tx-003",
    recipient: "KL Property Agent",
    amount: 3500,
    currency: "MYR",
    purpose: "Deposit transfer",
    date: "3 days ago, 11:07",
    type: "sent",
    status: "warned",
    channel: "voice_agent",
    risk_score: 52,
    reason_codes: ["AMOUNT_ANOMALY_MEDIUM", "GRAPH_NO_PRIOR_TRANSFER"],
    decision: "WARNING",
  },
  {
    id: "tx-004",
    recipient: "Investment Guru MY",
    amount: 5000,
    currency: "MYR",
    purpose: "Guaranteed returns program",
    date: "5 days ago, 16:43",
    type: "sent",
    status: "blocked",
    channel: "voice_agent",
    risk_score: 88,
    reason_codes: ["FINBERT_NEGATIVE_HIGH", "GRAPH_HIGH_RISK_HISTORY", "AMOUNT_ANOMALY_MEDIUM"],
    decision: "INTERVENTION_REQUIRED",
  },
  {
    id: "tx-005",
    recipient: "Grab Driver",
    amount: 12,
    currency: "MYR",
    purpose: "Ride fare",
    date: "6 days ago, 08:30",
    type: "sent",
    status: "approved",
    channel: "wallet_app",
    risk_score: 0,
    reason_codes: [],
    decision: "APPROVED",
  },
]

export default function Page() {
  const [view, setView] = useState<View>("wallet")
  const [balance, setBalance] = useState<number>(INITIAL_BALANCE)
  const [transactions, setTransactions] = useState<Transaction[]>(INITIAL_TRANSACTIONS)
  const [protectedAmount, setProtectedAmount] = useState<number>(45200)
  const [threatsBlocked, setThreatsBlocked] = useState<number>(12)
  const [lastBlocked, setLastBlocked] = useState<{ amount: number; recipient: string } | null>(null)

  const handleSafeTransfer = () => {
    const newTx: Transaction = {
      id: `tx-${Date.now()}`,
      recipient: "Ali",
      amount: 15,
      currency: "MYR",
      purpose: "Lunch",
      date: "Just now",
      type: "sent",
      status: "approved",
      channel: "voice_agent",
      risk_score: 8,
      reason_codes: [],
      decision: "APPROVED",
    }
    setTransactions((prev) => [newTx, ...prev])
    setBalance((prev) => prev - 15)
  }

  const handleScamCanceled = () => {
    setProtectedAmount((prev) => prev + 1000)
    setThreatsBlocked((prev) => prev + 1)
    setLastBlocked({ amount: 1000, recipient: "Investment Agent" })
    const blockedTx: Transaction = {
      id: `tx-${Date.now()}`,
      recipient: "Investment Agent",
      amount: 1000,
      currency: "MYR",
      purpose: "Investment Deposit",
      date: "Just now",
      type: "sent",
      status: "reversed",
      channel: "voice_agent",
      risk_score: 82,
      reason_codes: ["FINBERT_NEGATIVE_HIGH", "GRAPH_HIGH_RISK_HISTORY"],
      decision: "INTERVENTION_REQUIRED",
    }
    setTransactions((prev) => [blockedTx, ...prev])
  }

  const handleScamProceed = () => {
    const newTx: Transaction = {
      id: `tx-${Date.now()}`,
      recipient: "Investment Agent",
      amount: 1000,
      currency: "MYR",
      purpose: "Investment Deposit",
      date: "Just now",
      type: "sent",
      status: "warned",
      channel: "voice_agent",
      risk_score: 82,
      reason_codes: ["FINBERT_NEGATIVE_HIGH", "GRAPH_HIGH_RISK_HISTORY"],
      decision: "WARNING",
    }
    setTransactions((prev) => [newTx, ...prev])
    setBalance((prev) => prev - 1000)
  }

  return (
    <main className="min-h-screen bg-background">
      <TopNav view={view} onViewChange={setView} />
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
          />
        ) : (
          <DashboardView protectedAmount={protectedAmount} threatsBlocked={threatsBlocked} />
        )}
      </div>
    </main>
  )
}
