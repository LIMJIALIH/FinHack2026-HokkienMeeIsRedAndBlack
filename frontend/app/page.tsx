"use client"

import { useEffect, useState } from "react"
import { TopNav } from "@/components/guardian/top-nav"
import { WalletView } from "@/components/guardian/wallet-view"
import { DashboardView } from "@/components/guardian/dashboard-view"
import { SpeechToTextCard } from "@/components/guardian/speech-to-text-card"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

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

type FinbertSignal = {
  score?: number | null
  assessment?: string | null
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

  const [externalPrompt, setExternalPrompt] = useState<string | null>(null)
  const [externalFinbertData, setExternalFinbertData] = useState<FinbertSignal | null>(null)

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
        })
        .catch(() => {})
    }
  }, [])

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
            externalPrompt={externalPrompt}
            externalFinbertData={externalFinbertData}
          />
        ) : (
          <DashboardView protectedAmount={protectedAmount} threatsBlocked={threatsBlocked} />
        )}

        <div className="mt-6">
          <SpeechToTextCard
            onTranscriptionReady={({ text, finbertScore, finbertAssessment }) => {
              setView("wallet")
              setIsAdmin(false)
              setExternalPrompt(text)
              setExternalFinbertData({
                score: finbertScore ?? null,
                assessment: finbertAssessment ?? null,
              })
            }}
          />
        </div>
      </div>
    </main>
  )
}
