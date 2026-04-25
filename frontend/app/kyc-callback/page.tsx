"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { CheckCircle2, XCircle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Suspense } from "react"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

function KYCCallbackInner() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<"processing" | "success" | "error">("processing")
  const [errMsg, setErrMsg] = useState("")

  useEffect(() => {
    const token = localStorage.getItem("auth_token")
    if (!token) {
      setStatus("error")
      setErrMsg("Session expired. Please sign up again.")
      return
    }

    // Alibaba callback URL carries: ?response={"resultCode":"1001","extInfo":{"certifyId":"<TransactionId>"}}
    let transactionId: string | null = null
    let resultCode: string | null = null
    const responseParam = searchParams.get("response")
    if (responseParam) {
      try {
        const parsed = JSON.parse(responseParam)
        resultCode = String(parsed?.resultCode ?? "")
        // 1001 = face liveness passed; anything else = not verified
        if (resultCode && resultCode !== "1001") {
          setStatus("error")
          setErrMsg("Face verification was not completed. Please try again.")
          return
        }
        // extInfo.certifyId is Alibaba's TransactionId echoed back in the callback
        transactionId = parsed?.extInfo?.certifyId ?? null
      } catch {
        // ignore parse errors — fall through to stored IDs
      }
    }

    // MerchantBizId = our UUID stored during signup initiation
    const certifyId = localStorage.getItem("kyc_certify_id")
    if (!transactionId) {
      transactionId = localStorage.getItem("kyc_transaction_id")
    }

    if (!certifyId) {
      setStatus("error")
      setErrMsg("Verification session not found. Please sign up again.")
      return
    }

    const body: Record<string, string> = { certify_id: certifyId }
    if (transactionId) body.transaction_id = transactionId
    if (resultCode)    body.result_code    = resultCode

    fetch(`${API_URL}/kyc/complete`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body:    JSON.stringify(body),
    })
      .then(async (r) => {
        const json = await r.json()
        if (!r.ok) throw new Error(json.detail ?? "Verification failed")
        localStorage.setItem("kyc_status", "verified")
        localStorage.removeItem("kyc_certify_id")
        localStorage.removeItem("kyc_transaction_id")
        setStatus("success")
        setTimeout(() => router.push("/"), 2000)
      })
      .catch((e: unknown) => {
        setStatus("error")
        setErrMsg(e instanceof Error ? e.message : "Verification failed")
      })
  }, [router, searchParams])

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="py-10">
          <div className="flex flex-col items-center gap-4 text-center">
            {status === "processing" && (
              <>
                <Loader2 className="h-12 w-12 text-primary animate-spin" />
                <div>
                  <h2 className="font-semibold">Processing your verification…</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Please wait a moment.</p>
                </div>
              </>
            )}

            {status === "success" && (
              <>
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                  <CheckCircle2 className="h-8 w-8 text-green-600" />
                </div>
                <div>
                  <h2 className="font-semibold">Identity Verified!</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Redirecting to your wallet…</p>
                </div>
              </>
            )}

            {status === "error" && (
              <>
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
                  <XCircle className="h-8 w-8 text-red-600" />
                </div>
                <div>
                  <h2 className="font-semibold">Verification Failed</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{errMsg}</p>
                </div>
                <Button variant="outline" onClick={() => router.push("/signup")}>
                  Try Again
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default function KYCCallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    }>
      <KYCCallbackInner />
    </Suspense>
  )
}
