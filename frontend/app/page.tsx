"use client"

import { useState } from "react"
import { TopNav } from "@/components/guardian/top-nav"
import { WalletView } from "@/components/guardian/wallet-view"
import { DashboardView } from "@/components/guardian/dashboard-view"
import { SpeechToTextCard } from "@/components/guardian/speech-to-text-card"

export type View = "wallet" | "dashboard"

export type Transaction = {
  id: string
  recipient: string
  amount: number
  purpose: string
  date: string
  type: "sent" | "received"
  status: "completed" | "blocked"
}

const INITIAL_BALANCE = 250
const INITIAL_TRANSACTIONS: Transaction[] = [
  {
    id: "tx-001",
    recipient: "Siti Nurhaliza",
    amount: 25,
    purpose: "Coffee",
    date: "Yesterday, 14:22",
    type: "sent",
    status: "completed",
  },
  {
    id: "tx-002",
    recipient: "Salary — DBKL",
    amount: 180,
    purpose: "Reimbursement",
    date: "2 days ago, 09:14",
    type: "received",
    status: "completed",
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
      purpose: "Lunch",
      date: "Just now",
      type: "sent",
      status: "completed",
    }
    setTransactions((prev) => [newTx, ...prev])
    setBalance((prev) => prev - 15)
  }

  const handleScamCanceled = () => {
    setProtectedAmount((prev) => prev + 1000)
    setThreatsBlocked((prev) => prev + 1)
    setLastBlocked({ amount: 1000, recipient: "Investment Agent" })
  }

  const handleScamProceed = () => {
    const newTx: Transaction = {
      id: `tx-${Date.now()}`,
      recipient: "Investment Agent",
      amount: 1000,
      purpose: "Investment Deposit",
      date: "Just now",
      type: "sent",
      status: "completed",
    }
    setTransactions((prev) => [newTx, ...prev])
    setBalance((prev) => prev - 1000)
  }

  const handleReset = () => {
    setBalance(INITIAL_BALANCE)
    setTransactions(INITIAL_TRANSACTIONS)
    setLastBlocked(null)
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
            onReset={handleReset}
          />
        ) : (
          <DashboardView protectedAmount={protectedAmount} threatsBlocked={threatsBlocked} />
        )}

        <div className="mt-6">
          <SpeechToTextCard />
        </div>
      </div>
    </main>
  )
}
