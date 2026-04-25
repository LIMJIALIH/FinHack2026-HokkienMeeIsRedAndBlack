"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Shield, CheckCircle2, AlertCircle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

export default function KYCCompletePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading")
  const [message, setMessage] = useState<string>("")

  useEffect(() => {
    async function completeKYC() {
      try {
        const certifyId = searchParams.get("certifyId")
        const transactionId = searchParams.get("transactionId")
        const token = localStorage.getItem("auth_token")

        if (!token) {
          setStatus("error")
          setMessage("Session expired. Please sign in again.")
          return
        }

        if (!certifyId) {
          setStatus("error")
          setMessage("Missing verification ID. Please contact support.")
          return
        }

        // Call backend to complete KYC
        const res = await fetch(`${API_URL}/kyc/complete`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            certify_id: certifyId,
            transaction_id: transactionId,
          }),
        })

        const json = await res.json()

        if (!res.ok) {
          setStatus("error")
          setMessage(json.detail ?? "Verification failed")
          return
        }

        localStorage.setItem("kyc_status", "verified")
        setStatus("success")
        setMessage("Identity verified successfully!")

        // Redirect to dashboard after 2 seconds
        setTimeout(() => {
          router.push("/")
        }, 2000)
      } catch (e: unknown) {
        setStatus("error")
        setMessage(e instanceof Error ? e.message : "Verification failed")
      }
    }

    completeKYC()
  }, [searchParams, router])

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-card/80 backdrop-blur px-4 py-3">
        <div className="mx-auto max-w-7xl flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Shield className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-foreground">TNG Guardian Voice</p>
            <p className="text-xs text-muted-foreground">Identity Verification</p>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <Card>
            <CardHeader className="text-center">
              <CardTitle className="text-xl">Verification Result</CardTitle>
              <CardDescription>Processing your identity verification</CardDescription>
            </CardHeader>

            <CardContent className="space-y-6">
              {/* Status icon */}
              <div className="flex justify-center">
                {status === "loading" && (
                  <div className="flex h-16 w-16 items-center justify-center">
                    <Loader2 className="h-8 w-8 text-primary animate-spin" />
                  </div>
                )}
                {status === "success" && (
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                    <CheckCircle2 className="h-8 w-8 text-green-600" />
                  </div>
                )}
                {status === "error" && (
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
                    <AlertCircle className="h-8 w-8 text-red-600" />
                  </div>
                )}
              </div>

              {/* Message */}
              <div className="text-center">
                <p
                  className={`text-sm font-medium ${
                    status === "success"
                      ? "text-green-600"
                      : status === "error"
                      ? "text-red-600"
                      : "text-muted-foreground"
                  }`}
                >
                  {message}
                </p>
              </div>

              {/* Actions */}
              {status === "error" && (
                <div className="space-y-2">
                  <Button onClick={() => router.push("/signup")} className="w-full">
                    Try Again
                  </Button>
                  <Button onClick={() => router.push("/")} variant="outline" className="w-full">
                    Back to Home
                  </Button>
                </div>
              )}

              {status === "loading" && (
                <p className="text-center text-xs text-muted-foreground">
                  Please wait while we verify your identity...
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
