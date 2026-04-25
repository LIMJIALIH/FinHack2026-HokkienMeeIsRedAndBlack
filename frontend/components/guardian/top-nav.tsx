"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Shield, Wallet, BarChart3, LogIn, LogOut, ShieldCheck, User } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import type { View } from "@/app/page"

type TopNavProps = {
  view: View
  onViewChange: (view: View) => void
  isAdmin: boolean
  onToggleRole: () => void
  userName?: string
}

export function TopNav({ view, onViewChange, isAdmin, onToggleRole, userName }: TopNavProps) {
  const router = useRouter()
  const [name, setName] = useState(userName ?? "")

  useEffect(() => {
    if (!userName) {
      setName(localStorage.getItem("user_name") ?? "")
    }
  }, [userName])

  function signOut() {
    localStorage.removeItem("auth_token")
    localStorage.removeItem("user_name")
    localStorage.removeItem("user_email")
    localStorage.removeItem("user_phone")
    localStorage.removeItem("kyc_status")
    router.push("/login")
  }

  function handleSwitchToUser() {
    onToggleRole()
    // When switching to user, check if authenticated
    if (!name) {
      router.push("/login")
    }
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card/80 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 md:px-8">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Shield className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-foreground">TNG Guardian Voice</p>
            <p className="text-xs text-muted-foreground">AI Scam Intervention · Prototype</p>
          </div>
        </div>

        {/* Centre nav — one tab per role */}
        <nav
          aria-label="Primary"
          className="flex items-center gap-1 rounded-full border border-border bg-secondary p-1"
        >
          {isAdmin ? (
            <NavButton
              active={view === "dashboard"}
              onClick={() => onViewChange("dashboard")}
              icon={<BarChart3 className="h-4 w-4" aria-hidden="true" />}
              label="Regulatory Dashboard"
            />
          ) : (
            <NavButton
              active={view === "wallet"}
              onClick={() => onViewChange("wallet")}
              icon={<Wallet className="h-4 w-4" aria-hidden="true" />}
              label="Customer Wallet"
            />
          )}
        </nav>

        {/* Right area: current mode indicator + switch button + auth */}
        <div className="flex items-center gap-2">
          {/* Current mode label */}
          <span
            className={cn(
              "hidden sm:inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
              isAdmin
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-secondary text-muted-foreground",
            )}
          >
            {isAdmin
              ? <><ShieldCheck className="h-3.5 w-3.5" />Admin View</>
              : <><User className="h-3.5 w-3.5" />User View</>}
          </span>

          {/* Switch button */}
          <button
            type="button"
            onClick={handleSwitchToUser}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            {isAdmin
              ? <><User className="h-3.5 w-3.5" /><span className="hidden sm:inline">Switch to User</span></>
              : <><ShieldCheck className="h-3.5 w-3.5" /><span className="hidden sm:inline">Switch to Admin</span></>}
          </button>

          {/* Divider */}
          <span className="hidden h-4 w-px bg-border sm:inline-block" aria-hidden="true" />

          {/* Sign in / out - Only show in user view */}
          {!isAdmin && (
            <>
              {name ? (
                <>
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    {name.split(" ")[0]}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={signOut}
                    className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                    aria-label="Sign out"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Sign Out</span>
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => router.push("/login")}
                  className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  <LogIn className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Sign In</span>
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </header>
  )
}

function NavButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors md:text-sm",
        active
          ? "bg-card text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}
