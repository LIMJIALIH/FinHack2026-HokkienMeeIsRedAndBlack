"use client"

import { Shield, Wallet, BarChart3 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { View } from "@/app/page"

type TopNavProps = {
  view: View
  onViewChange: (view: View) => void
}

export function TopNav({ view, onViewChange }: TopNavProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card/80 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 md:px-8">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Shield className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-foreground">TNG Guardian Voice</p>
            <p className="text-xs text-muted-foreground">AI Scam Intervention · Prototype</p>
          </div>
        </div>

        <nav
          aria-label="Primary"
          className="flex items-center gap-1 rounded-full border border-border bg-secondary p-1"
        >
          <NavButton
            active={view === "wallet"}
            onClick={() => onViewChange("wallet")}
            icon={<Wallet className="h-4 w-4" aria-hidden="true" />}
            label="Customer Wallet"
          />
          <NavButton
            active={view === "dashboard"}
            onClick={() => onViewChange("dashboard")}
            icon={<BarChart3 className="h-4 w-4" aria-hidden="true" />}
            label="Regulatory Dashboard"
          />
        </nav>
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
