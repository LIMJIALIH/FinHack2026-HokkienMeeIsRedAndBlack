"use client"

import { useState, useEffect } from "react"
import { TopNav } from "@/components/guardian/top-nav"
import { WalletView } from "@/components/guardian/wallet-view"
import { DashboardView } from "@/components/guardian/dashboard-view"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

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

// Demo data shown only in Admin / unauthenticated mode
const DEMO_BALANCE = 250
const DEMO_TRANSACTIONS: Transaction[] = [
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
  // Admin mode is the default unauthenticated/demo view
  const [view,         setView]         = useState<View>("dashboard")
  const [isAdmin,      setIsAdmin]      = useState(true)
  const [userName,     setUserName]     = useState("")
  const [isLoggedIn,   setIsLoggedIn]   = useState(false)

  // Wallet state — overridden by real API data when logged in
  const [balance,         setBalance]         = useState<number>(DEMO_BALANCE)
  const [userBaseBalance, setUserBaseBalance] = useState<number>(0)
  const [transactions,    setTransactions]    = useState<Transaction[]>(DEMO_TRANSACTIONS)
  const [protectedAmount, setProtectedAmount] = useState<number>(45200)
  const [threatsBlocked,  setThreatsBlocked]  = useState<number>(12)
  const [lastBlocked,     setLastBlocked]     = useState<{ amount: number; recipient: string } | null>(null)

  useEffect(() => {
    const token = localStorage.getItem("auth_token")
    const name  = localStorage.getItem("user_name") ?? ""
    setUserName(name)

    if (token && name) {
      // Logged-in user → User View with real data from DynamoDB
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
    // If not logged in: keep admin/demo defaults set above
  }, [])

  function handleToggleRole() {
    setIsAdmin((prev) => {
      const next = !prev
      // Switching roles resets to the canonical view for that role
      setView(next ? "dashboard" : "wallet")
      // When switching to User view for a logged-in user, restore their balance
      if (!next && isLoggedIn) {
        setBalance(userBaseBalance)
        setTransactions([])
        setLastBlocked(null)
      }
      // When switching to Admin view, load demo data
      if (next) {
        setBalance(DEMO_BALANCE)
        setTransactions(DEMO_TRANSACTIONS)
        setLastBlocked(null)
      }
      return next
    })
  }

  const handleSafeTransfer = () => {
    const newTx: Transaction = {
      id:        `tx-${Date.now()}`,
      recipient: "Ali",
      amount:    15,
      purpose:   "Lunch",
      date:      "Just now",
      type:      "sent",
      status:    "completed",
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
      id:        `tx-${Date.now()}`,
      recipient: "Investment Agent",
      amount:    1000,
      purpose:   "Investment Deposit",
      date:      "Just now",
      type:      "sent",
      status:    "completed",
    }
    setTransactions((prev) => [newTx, ...prev])
    setBalance((prev) => prev - 1000)
  }

  const handleReset = () => {
    if (isLoggedIn && !isAdmin) {
      setBalance(userBaseBalance)
      setTransactions([])
    } else {
      setBalance(DEMO_BALANCE)
      setTransactions(DEMO_TRANSACTIONS)
    }
    setLastBlocked(null)
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
            userName={userName}
          />
        ) : (
          <DashboardView protectedAmount={protectedAmount} threatsBlocked={threatsBlocked} />
        )}
      </div>
    </main>
  )
}
