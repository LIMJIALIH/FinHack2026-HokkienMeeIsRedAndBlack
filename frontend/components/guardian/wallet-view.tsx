"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  Clock,
  Eye,
  EyeOff,
  Loader2,
  Mic,
  Square,
  PlusCircle,
  Radio,
  RotateCcw,
  ShieldAlert,
  ShieldBan,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ScamInterventionCard } from "@/components/guardian/scam-modal"
import type { Transaction } from "@/app/page"
import { cn } from "@/lib/utils"

const RELOAD_OPTIONS = [10, 20, 30, 50, 100, 200]

type ExternalFinbertData = {
  score?: number | null
  assessment?: string | null
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

type SpeechToTextResponse = {
  text: string
  job_name: string
  language_code: string
  fraud_score?: {
    risk_score?: number | null
  } | null
  transfer_validation?: {
    is_valid_complete_transfer: boolean
    missing_fields: string[]
    reason: string
  } | null
}

type FinBertCheckResponse = {
  gemini_assessment: string
  fraud_spam_final?: boolean | null
  confidence?: string | null
  risk_score?: number | null
  risk_level?: string | null
  overall_pattern_risk?: number | null
}

type WalletViewProps = {
  balance: number
  transactions: Transaction[]
  lastBlocked: { amount: number; recipient: string } | null
  onClearBlocked: () => void
  onSafeTransfer: (transfer: AgentTransferSummary) => void
  onScamCanceled: (transfer: AgentTransferSummary) => void
  onScamProceed: (transfer: AgentTransferSummary) => void
  onReset: () => void
  onReload?: (amount: number) => Promise<void>
  userName?: string
}

type FlowState = "idle" | "processing-safe" | "scam-detected" | "processing-scam" | "success-safe"

type TransferReviewCard = {
  card_type: "transfer_review"
  title: string
  subtitle: string
  amount?: number
  currency?: string
  recipient_name?: string
  decision_preview: "APPROVED" | "WARNING" | "INTERVENTION_REQUIRED"
  risk_score: number
  reason_codes: string[]
  evidence_refs: string[]
  warning_id: string | null
  warning_delay_seconds: number | null
  purpose_question: string
}

type VoiceTurnResponse = {
  thread_id: string
  mode: "hitl_required" | "final"
  assistant_text: string
  card: TransferReviewCard | null
  transfer?: AgentTransferSummary | null
  backend_status: string | null
  steps: string[]
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
const TARGET_SAMPLE_RATE = 16000

function getAuthContext(): { token: string; userId?: string } | null {
  const token = localStorage.getItem("auth_token")?.trim() ?? ""
  if (!token) return null
  const userId = localStorage.getItem("user_id")?.trim() ?? ""
  return userId ? { token, userId } : { token }
}

async function readVoiceStream(
  body: ReadableStream<Uint8Array>,
  onStep: (summary: string) => void,
): Promise<VoiceTurnResponse> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let finalPayload: VoiceTurnResponse | null = null

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split("\n\n")
    buffer = events.pop() ?? ""

    for (const eventText of events) {
      const dataLine = eventText.split("\n").find((line) => line.startsWith("data: "))
      if (!dataLine) continue
      const event = JSON.parse(dataLine.slice(6)) as {
        event: "step" | "final" | "error"
        summary?: string
        message?: string
        payload?: VoiceTurnResponse
      }
      if (event.event === "step" && event.summary) {
        onStep(event.summary)
      }
      if (event.event === "error") {
        throw new Error(event.message ?? "Voice agent stream failed.")
      }
      if (event.event === "final" && event.payload) {
        finalPayload = event.payload
      }
    }
  }

  if (!finalPayload) {
    throw new Error("Voice agent did not return a final response.")
  }
  return finalPayload
}

export function WalletView({
  balance,
  transactions,
  lastBlocked,
  onClearBlocked,
  onSafeTransfer,
  onScamCanceled,
  onScamProceed,
  onReset,
  onReload,
  userName,
}: WalletViewProps) {
  const [flow, setFlow] = useState<FlowState>("idle")
  const [showBalance, setShowBalance] = useState(true)
  const [showReload, setShowReload] = useState(false)
  const [transferPrompt, setTransferPrompt] = useState("")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [reviewCard, setReviewCard] = useState<TransferReviewCard | null>(null)
  const [latestAgentText, setLatestAgentText] = useState("")
  const [agentStep, setAgentStep] = useState<string | null>(null)
  const [transferPurpose, setTransferPurpose] = useState("")
  const [pendingFinbert, setPendingFinbert] = useState<ExternalFinbertData | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [isCheckingFinbert, setIsCheckingFinbert] = useState(false)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const mediaStreamRef = useRef<MediaStream | null>(null)

  const triggerSafe = useCallback((transfer: AgentTransferSummary) => {
    onSafeTransfer(transfer)
    setFlow("success-safe")
    setTimeout(() => setFlow("idle"), 1600)
  }, [onSafeTransfer])

  const handleCancel = useCallback(async () => {
    setErrorMessage(null)
    setFlow("processing-scam")
    if (!activeThreadId) {
      setErrorMessage("Missing transfer thread.")
      setFlow("scam-detected")
      return
    }
    try {
      const auth = getAuthContext()
      if (!auth) throw new Error("Please sign in again.")
      const response = await fetch(`${API_BASE_URL}/voice/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` },
        body: JSON.stringify({
          thread_id: activeThreadId,
          warning_id: reviewCard?.warning_id,
          decision: "reject",
          purpose: transferPurpose,
        }),
      })
      if (!response.ok) {
        throw new Error("Unable to reject transfer decision.")
      }
      const payload: VoiceTurnResponse = await response.json()
      setLatestAgentText(payload.assistant_text)
      if (payload.mode === "hitl_required" && payload.card) {
        setReviewCard(payload.card)
        setFlow("scam-detected")
        return
      }
      if (payload.backend_status !== "REJECTED_BY_USER") {
        throw new Error("Transfer rejection was not confirmed by backend.")
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to connect to backend.")
      setFlow("scam-detected")
      return
    }
    onScamCanceled({
      amount: reviewCard?.amount ?? 0,
      currency: reviewCard?.currency ?? "MYR",
      recipient_name: reviewCard?.recipient_name ?? reviewCard?.subtitle ?? "Unknown recipient",
      purpose: transferPurpose,
      risk_score: reviewCard?.risk_score,
      reason_codes: reviewCard?.reason_codes ?? [],
      decision_preview: reviewCard?.decision_preview,
    })
    setReviewCard(null)
    setTransferPurpose("")
    setActiveThreadId(null)
    setPendingFinbert(null)
    setFlow("idle")
  }, [activeThreadId, onScamCanceled, reviewCard, transferPurpose])

  const handleProceed = useCallback(async () => {
    setErrorMessage(null)
    setFlow("processing-scam")
    if (!activeThreadId) {
      setErrorMessage("Missing transfer thread.")
      setFlow("scam-detected")
      return
    }
    try {
      const auth = getAuthContext()
      if (!auth) throw new Error("Please sign in again.")
      const response = await fetch(`${API_BASE_URL}/voice/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` },
        body: JSON.stringify({
          thread_id: activeThreadId,
          warning_id: reviewCard?.warning_id,
          decision: "approve",
          purpose: transferPurpose,
        }),
      })
      if (!response.ok) {
        throw new Error("Unable to approve transfer decision.")
      }
      const payload: VoiceTurnResponse = await response.json()
      setLatestAgentText(payload.assistant_text)
      if (payload.mode === "hitl_required" && payload.card) {
        setReviewCard(payload.card)
        setFlow("scam-detected")
        return
      }
      if (payload.backend_status !== "APPROVED" || !payload.transfer) {
        throw new Error("Transfer was not approved by backend.")
      }
      onScamProceed({
        amount: payload.transfer.amount,
        currency: payload.transfer.currency ?? reviewCard?.currency ?? "MYR",
        recipient_name: payload.transfer.recipient_name ?? reviewCard?.recipient_name ?? reviewCard?.subtitle ?? "Unknown recipient",
        purpose: payload.transfer.purpose ?? transferPurpose,
        risk_score: payload.transfer.risk_score ?? reviewCard?.risk_score,
        reason_codes: payload.transfer.reason_codes ?? reviewCard?.reason_codes ?? [],
        decision_preview: payload.transfer.decision_preview ?? reviewCard?.decision_preview,
      })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to connect to backend.")
      setFlow("scam-detected")
      return
    }
    setReviewCard(null)
    setTransferPurpose("")
    setActiveThreadId(null)
    setPendingFinbert(null)
    setFlow("idle")
  }, [activeThreadId, onScamProceed, reviewCard, transferPurpose])

  const cleanupMedia = useCallback(() => {
    mediaRecorderRef.current = null
    chunksRef.current = []
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }
  }, [])

  const checkWithFinBert = useCallback(async (text: string, score: number | null) => {
    setIsCheckingFinbert(true)
    try {
      const auth = getAuthContext()
      if (!auth) throw new Error("Please sign in again.")
      const response = await fetch(`${API_BASE_URL}/api/v1/speech/check-finbert`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` },
        body: JSON.stringify({
          text,
          receiver_id: "unknown_receiver",
          currency: "MYR",
        }),
      })

      if (!response.ok) {
        const detail = await response.text()
        throw new Error(detail || `HTTP ${response.status}`)
      }

      const data: FinBertCheckResponse = await response.json()
      const recomputedScore = data.risk_score ?? null
      const scoreForAgent = recomputedScore ?? score
      const assessmentForAgent = [
        data.gemini_assessment,
        score !== null ? `stt_risk_score=${score}` : "",
        recomputedScore !== null ? `recomputed_risk_score=${recomputedScore}` : "",
        data.risk_level ? `recomputed_risk_level=${data.risk_level}` : "",
        data.overall_pattern_risk !== null && data.overall_pattern_risk !== undefined
          ? `pattern_risk=${data.overall_pattern_risk}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
      return {
        score: scoreForAgent,
        assessment: assessmentForAgent,
      } satisfies ExternalFinbertData
    } finally {
      setIsCheckingFinbert(false)
    }
  }, [])

  const transcribeAudio = async (audioBlob: Blob) => {
    setIsTranscribing(true)
    setErrorMessage(null)

    try {
      const wavBlob = await convertToMonoPcmWav(audioBlob, TARGET_SAMPLE_RATE)
      const audioFile = new File([wavBlob], "recording.wav", { type: "audio/wav" })
      const formData = new FormData()
      formData.append("file", audioFile)
      formData.append("language_code", "en-US")
      const auth = getAuthContext()
      if (!auth) throw new Error("Please sign in again.")

      const response = await fetch(`${API_BASE_URL}/api/v1/speech/transcribe`, {
        method: "POST",
        headers: { Authorization: `Bearer ${auth.token}` },
        body: formData,
      })
      if (!response.ok) {
        const detail = await response.text()
        throw new Error(detail || `HTTP ${response.status}`)
      }

      const data: SpeechToTextResponse = await response.json()
      const isValidTransfer = data.transfer_validation?.is_valid_complete_transfer === true

      if (!isValidTransfer) {
        setTransferPrompt(data.text.trim())
        setPendingFinbert(null)
        setErrorMessage("Please provide clearer transfer instructions, for example: Send RM 20 to Ali for lunch.")
        playInvalidStatementTone()
        return
      }

      const prompt = data.text.trim()
      if (!prompt) {
        setErrorMessage("Transcription returned empty text.")
        return
      }

      setTransferPrompt(prompt)
      const finbert = await checkWithFinBert(prompt, data.fraud_score?.risk_score ?? null)
      setPendingFinbert(finbert)
      await submitTransferToAgent(prompt, finbert)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Transcription failed.")
    } finally {
      setIsTranscribing(false)
    }
  }

  const startRecording = useCallback(async () => {
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setErrorMessage("MediaRecorder is not supported in this browser.")
      return
    }

    setErrorMessage(null)
    setPendingFinbert(null)

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream

      const mimeType = MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate))
      const mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      chunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType || "audio/webm" })
        await transcribeAudio(audioBlob)
        cleanupMedia()
      }

      mediaRecorder.start()
      setIsRecording(true)
    } catch (error) {
      setErrorMessage(error instanceof Error ? `Unable to access microphone: ${error.message}` : "Unable to access microphone.")
      cleanupMedia()
    }
  }, [cleanupMedia, transcribeAudio])

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current
    if (!recorder) return
    if (recorder.state !== "inactive") {
      recorder.stop()
    } else {
      cleanupMedia()
    }
    setIsRecording(false)
  }, [cleanupMedia])

  const submitTransferToAgent = useCallback(
    async (overridePrompt?: string, overrideFinbert?: ExternalFinbertData | null) => {
      const prompt = (overridePrompt ?? transferPrompt).trim()
      if (!prompt) return

      const finbert = overrideFinbert ?? pendingFinbert

      setErrorMessage(null)
      setLatestAgentText("")
      setAgentStep("Analyzing transfer request")
      setFlow("processing-safe")

      try {
        const auth = getAuthContext()
        if (!auth) throw new Error("Please sign in again.")

        const response = await fetch(`${API_BASE_URL}/voice/turn/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` },
          body: JSON.stringify({
            user_text: prompt,
            thread_id: activeThreadId,
            finbert_score: finbert?.score ?? null,
            finbert_assessment: finbert?.assessment ?? null,
            ...(auth.userId ? { user_id: auth.userId } : {}),
          }),
        })
        if (!response.ok) {
          throw new Error("Voice agent request failed.")
        }
        if (!response.body) {
          throw new Error("Voice agent stream was empty.")
        }

        const payload = await readVoiceStream(response.body, (summary) => setAgentStep(summary))
        setActiveThreadId(payload.thread_id)
        setLatestAgentText(payload.assistant_text)

        if (payload.mode === "hitl_required" && payload.card) {
          setReviewCard(payload.card)
          setFlow("scam-detected")
          return
        }

        if (payload.mode === "final") {
          setLatestAgentText(payload.assistant_text)
          if (payload.backend_status === "APPROVED" && payload.transfer) {
            triggerSafe(payload.transfer)
            setTransferPrompt("")
            setReviewCard(null)
            setTransferPurpose("")
            setActiveThreadId(null)
            setPendingFinbert(null)
            return
          }
          setFlow("idle")
          setReviewCard(null)
          return
        }

        throw new Error("Unexpected response from voice agent.")
      } catch (error) {
        setFlow("idle")
        setErrorMessage(error instanceof Error ? error.message : "Unable to connect to backend.")
      } finally {
        setAgentStep(null)
      }
    },
    [activeThreadId, pendingFinbert, transferPrompt, triggerSafe],
  )

  useEffect(() => () => cleanupMedia(), [cleanupMedia])

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="flex flex-col gap-6 lg:col-span-2">
        <BalanceCard balance={balance} showBalance={showBalance} onToggle={() => setShowBalance((s) => !s)} userName={userName} />

        {lastBlocked && (
          <Card className="flex items-start justify-between gap-4 border-primary/30 bg-primary/5 p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="leading-relaxed">
                <p className="text-sm font-semibold text-foreground">RM {lastBlocked.amount.toFixed(2)} protected</p>
                <p className="text-xs text-muted-foreground">
                  Transfer to {lastBlocked.recipient} was blocked by Scam-Breaker. Funds remain in your wallet.
                </p>
              </div>
            </div>
            <button
              onClick={onClearBlocked}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground"
              aria-label="Dismiss notification"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </Card>
        )}

        <SimulationPanel
          flow={flow}
          isRecording={isRecording}
          isTranscribing={isTranscribing}
          isCheckingFinbert={isCheckingFinbert}
          transferPrompt={transferPrompt}
          setTransferPrompt={(value) => {
            setTransferPrompt(value)
            setPendingFinbert(null)
          }}
          onAnalyze={() => void submitTransferToAgent()}
          onStartRecording={() => void startRecording()}
          onStopRecording={() => stopRecording()}
          reviewCard={reviewCard}
          transferPurpose={transferPurpose}
          setTransferPurpose={setTransferPurpose}
          onCancelReview={() => void handleCancel()}
          onProceedReview={() => void handleProceed()}
          errorMessage={errorMessage}
          agentStep={agentStep}
          latestAgentText={latestAgentText}
        />

        <RecentTransactions transactions={transactions} />
      </div>

      <div className="flex flex-col gap-6">
        <GuardianStatusCard />
        <QuickActionsCard onReload={onReload ? () => setShowReload(true) : undefined} onReset={onReset} />
      </div>

      {showReload && onReload && (
        <ReloadModal onClose={() => setShowReload(false)} onReload={onReload} />
      )}

      {flow === "success-safe" && transactions.length > 0 && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground shadow-lg"
        >
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" style={{ color: "var(--status-approved)" }} aria-hidden="true" />
            Transfer of RM {transactions[0].amount.toFixed(2)} to {transactions[0].recipient} completed
          </span>
        </div>
      )}
    </div>
  )
}

function BalanceCard({
  balance,
  showBalance,
  onToggle,
  userName,
}: {
  balance: number
  showBalance: boolean
  onToggle: () => void
  userName?: string
}) {
  return (
    <Card className="overflow-hidden border-0 bg-primary p-0 text-primary-foreground shadow-sm">
      <div className="relative p-6 md:p-8">
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-primary-foreground/70">Available Balance</p>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-xs font-medium text-primary-foreground/80">RM</span>
              <span className="font-mono text-4xl font-semibold tracking-tight md:text-5xl">
                {showBalance ? balance.toFixed(2) : "....."}
              </span>
              <button
                onClick={onToggle}
                aria-label={showBalance ? "Hide balance" : "Show balance"}
                className="ml-1 rounded-md p-1 text-primary-foreground/70 transition-colors hover:bg-primary-foreground/10 hover:text-primary-foreground"
              >
                {showBalance ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="mt-3 text-sm text-primary-foreground/80">{userName || "Ahmad Bin Ali"} - ****6721</p>
          </div>
          <div className="flex flex-col items-end gap-2 text-right">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-foreground/15 px-2.5 py-1 text-xs font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" aria-hidden="true" />
              Guardian Active
            </span>
            <span className="text-xs text-primary-foreground/70">eWallet - MYR</span>
          </div>
        </div>
      </div>
    </Card>
  )
}

function SimulationPanel({
  flow,
  isRecording,
  isTranscribing,
  isCheckingFinbert,
  transferPrompt,
  setTransferPrompt,
  onAnalyze,
  onStartRecording,
  onStopRecording,
  reviewCard,
  transferPurpose,
  setTransferPurpose,
  onCancelReview,
  onProceedReview,
  errorMessage,
  agentStep,
  latestAgentText,
}: {
  flow: FlowState
  isRecording: boolean
  isTranscribing: boolean
  isCheckingFinbert: boolean
  transferPrompt: string
  setTransferPrompt: (value: string) => void
  onAnalyze: () => void
  onStartRecording: () => void
  onStopRecording: () => void
  reviewCard: TransferReviewCard | null
  transferPurpose: string
  setTransferPurpose: (value: string) => void
  onCancelReview: () => void
  onProceedReview: () => void
  errorMessage: string | null
  agentStep: string | null
  latestAgentText: string
}) {
  const isProcessingSafe = flow === "processing-safe"
  const isProcessingScam = flow === "processing-scam"
  const isBusy = isProcessingSafe || isProcessingScam
  const isVoiceBusy = isTranscribing || isCheckingFinbert || isProcessingSafe || isProcessingScam

  return (
    <Card className="relative overflow-hidden border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card p-5 md:p-6">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-foreground">Send Money</h2>
          <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
            AI-Protected
          </span>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Tell us who you want to pay and how much - we'll check everything is safe before sending.
        </p>
      </div>

      <div className="relative mt-6 rounded-xl border border-primary/20 bg-background/80 p-4 md:p-5">
        <div className="flex flex-col items-center gap-3 text-center">
          {!isRecording ? (
            <Button
              type="button"
              onClick={onStartRecording}
              disabled={isVoiceBusy}
              variant="outline"
              className="h-28 w-28 rounded-full border-2 border-primary/30 bg-primary/10 text-primary shadow-md"
            >
              {isTranscribing || isCheckingFinbert ? (
                <Loader2 className="h-10 w-10 animate-spin" aria-hidden="true" />
              ) : (
                <Mic className="h-10 w-10" aria-hidden="true" />
              )}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={onStopRecording}
              variant="destructive"
              className="h-28 w-28 rounded-full shadow-md"
            >
              <Square className="h-10 w-10" aria-hidden="true" />
            </Button>
          )}
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">Voice Input</p>
            <p className="text-xs text-muted-foreground">Tap to speak. Voice is primary; manual text is optional below.</p>
          </div>
        </div>

        {latestAgentText && !reviewCard && (
          <div className="mt-5 rounded-md border border-border bg-secondary px-3 py-2.5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Guardian</p>
            <p className="mt-1 text-sm leading-relaxed text-foreground">{latestAgentText}</p>
          </div>
        )}
        {reviewCard && (
          <ScamInterventionCard
            card={reviewCard}
            assistantText={latestAgentText}
            purpose={transferPurpose}
            onPurposeChange={setTransferPurpose}
            onCancel={onCancelReview}
            onProceed={onProceedReview}
          />
        )}

        <form
          className="mt-5 flex flex-col gap-2.5 md:flex-row"
          onSubmit={(event) => {
            event.preventDefault()
            if (!isBusy && !isRecording && !isTranscribing && !isCheckingFinbert) onAnalyze()
          }}
        >
          <Input
            value={transferPrompt}
            onChange={(event) => setTransferPrompt(event.target.value)}
            disabled={isBusy || isTranscribing || isCheckingFinbert}
            placeholder='e.g. "Send RM 15 to Ali for lunch"'
            className="h-10 md:flex-1"
            aria-label="Transfer request"
          />
          <Button
            type="submit"
            disabled={isBusy || isRecording || isTranscribing || isCheckingFinbert || !transferPrompt.trim()}
            className="h-10 px-5"
          >
            {isBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ShieldAlert className="h-4 w-4" aria-hidden="true" />}
            {isBusy ? (agentStep ?? "Checking...") : "Send"}
          </Button>
        </form>

        {(isBusy || isRecording || isTranscribing || isCheckingFinbert) && (
          <div role="status" aria-live="polite" className="mt-2.5 flex items-center gap-2 px-1">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
            <p className="text-xs text-muted-foreground">
              {isRecording
                ? "Recording..."
                : isTranscribing
                  ? "Transcribing speech..."
                  : isCheckingFinbert
                    ? "Running FinBert safety check..."
                    : (agentStep ?? "Checking your request...")}
            </p>
          </div>
        )}
      </div>

      {errorMessage && (
        <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errorMessage}
        </div>
      )}
    </Card>
  )
}

type StatusConfig = {
  label: string
  color: string
  bg: string
  icon: React.ReactNode
  pulse?: boolean
}

function statusConfig(status: string): StatusConfig {
  switch (status) {
    case "approved":
    case "completed":
      return { label: "Approved", color: "var(--status-approved)", bg: "var(--status-approved-bg)", icon: <ShieldCheck className="h-3 w-3" /> }
    case "pending_hitl":
      return { label: "Pending review", color: "var(--status-pending)", bg: "var(--status-pending-bg)", icon: <Clock className="h-3 w-3" />, pulse: true }
    case "warned":
      return { label: "Warned", color: "var(--status-warned)", bg: "var(--status-warned-bg)", icon: <TriangleAlert className="h-3 w-3" /> }
    case "blocked":
      return { label: "Blocked", color: "var(--status-blocked)", bg: "var(--status-blocked-bg)", icon: <ShieldBan className="h-3 w-3" /> }
    case "reversed":
      return { label: "Reversed", color: "var(--status-reversed)", bg: "var(--status-reversed-bg)", icon: <RotateCcw className="h-3 w-3" /> }
    default:
      return { label: status, color: "var(--muted-foreground)", bg: "var(--muted)", icon: <Radio className="h-3 w-3" /> }
  }
}

function riskDotColor(score: number): string | null {
  if (score >= 70) return "var(--status-blocked)"
  if (score >= 40) return "var(--status-warned)"
  return null
}

function RecentTransactions({ transactions }: { transactions: Transaction[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between px-5 pt-5 md:px-6 md:pt-6">
        <h2 className="text-base font-semibold text-foreground">Recent Transactions</h2>
        <span className="rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ color: "var(--muted-foreground)", background: "var(--muted)" }}>
          {transactions.length}
        </span>
      </div>

      <div className="mt-3 flex flex-col gap-1.5 px-3 pb-4 md:px-4 md:pb-5">
        {transactions.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full" style={{ background: "var(--muted)" }}>
              <ArrowUpRight className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">No transactions yet</p>
          </div>
        )}

        {transactions.map((tx) => {
          const sent = tx.type === "sent"
          const sc = statusConfig(tx.status)
          const riskDot = riskDotColor(tx.risk_score)
          const isExpanded = expandedId === tx.id

          return (
            <div key={tx.id} className="group rounded-xl border border-border bg-card transition-shadow hover:shadow-sm">
              <button
                type="button"
                onClick={() => setExpandedId((prev) => (prev === tx.id ? null : tx.id))}
                className="flex w-full items-center gap-3 px-3.5 py-3 text-left active:bg-accent/50 md:px-4"
                aria-expanded={isExpanded}
              >
                <div
                  className={cn("relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full", sent ? "bg-secondary text-foreground" : "text-primary")}
                  style={!sent ? { background: "var(--status-approved-bg)" } : undefined}
                >
                  {sent ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownLeft className="h-4 w-4" />}
                  {riskDot && (
                    <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-card" style={{ background: riskDot }} />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-foreground">{tx.recipient}</p>
                    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", sc.pulse && "animate-[status-pulse_2s_ease-in-out_infinite]")} style={{ color: sc.color, background: sc.bg }}>
                      {sc.icon}
                      {sc.label}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{tx.purpose} - {tx.date}</p>
                </div>

                <div className="flex items-center gap-2">
                  <p className={cn("whitespace-nowrap font-mono text-sm font-semibold", sent ? "text-foreground" : "")} style={!sent ? { color: "var(--status-approved)" } : undefined}>
                    {sent ? "-" : "+"} RM {tx.amount.toFixed(2)}
                  </p>
                  <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200", isExpanded && "rotate-180")} />
                </div>
              </button>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function GuardianStatusCard() {
  return (
    <Card className="p-5 md:p-6">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 className="text-base font-semibold text-foreground">AI Guardian Status</h2>
      </div>
      <ul className="mt-4 flex flex-col gap-3">
        <li className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2.5">
          <span className="text-sm text-foreground">BERT Intent Model</span>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
            Online
          </span>
        </li>
        <li className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2.5">
          <span className="text-sm text-foreground">Neptune Graph (1-hop)</span>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
            100 ms p95
          </span>
        </li>
      </ul>
    </Card>
  )
}

function QuickActionsCard({ onReload, onReset }: { onReload?: () => void; onReset: () => void }) {
  const actions: { label: string; onClick?: () => void; style?: string }[] = [
    { label: "Reload", onClick: onReload, style: "border-primary/40 bg-primary/5 text-primary hover:bg-primary/10" },
    { label: "Reset", onClick: onReset },
    { label: "Send" },
    { label: "Pay Bills" },
  ]
  return (
    <Card className="p-5 md:p-6">
      <h2 className="text-base font-semibold text-foreground">Quick Actions</h2>
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={a.onClick}
            disabled={a.label === "Reload" && !a.onClick}
            className={cn(
              "rounded-md border border-border bg-secondary px-3 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent",
              a.style,
            )}
          >
            {a.label}
          </button>
        ))}
      </div>
    </Card>
  )
}

function ReloadModal({
  onClose,
  onReload,
}: {
  onClose: () => void
  onReload: (amount: number) => Promise<void>
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<number | null>(null)

  const handleSelect = async (amount: number) => {
    setLoading(true)
    setError(null)
    try {
      await onReload(amount)
      setSuccess(amount)
      setTimeout(onClose, 1400)
    } catch (e) {
      setError((e as Error).message ?? "Reload failed")
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PlusCircle className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 className="text-base font-semibold text-foreground">Reload Wallet</h2>
          </div>
          <button onClick={onClose} disabled={loading} className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-2.5">
          {RELOAD_OPTIONS.map((amt) => (
            <button
              key={amt}
              type="button"
              onClick={() => void handleSelect(amt)}
              disabled={loading || success !== null}
              className="rounded-lg border border-border bg-secondary px-3 py-3 text-sm font-semibold text-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary disabled:opacity-50"
            >
              RM {amt}
            </button>
          ))}
        </div>

        {loading && !success && (
          <div className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            Processing reload...
          </div>
        )}
        {success !== null && (
          <div className="mt-4 flex items-center justify-center gap-2 text-sm font-medium text-primary">
            <CheckCircle2 className="h-4 w-4" />
            RM {success}.00 added to your wallet
          </div>
        )}
        {error && <p className="mt-4 text-center text-sm text-destructive">{error}</p>}
      </div>
    </div>
  )
}

async function convertToMonoPcmWav(input: Blob, targetSampleRate: number): Promise<Blob> {
  const arrayBuffer = await input.arrayBuffer()
  const audioContext = new AudioContext()

  try {
    const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0))
    const mono = mixToMono(decoded)
    const resampled = resampleLinear(mono, decoded.sampleRate, targetSampleRate)
    const wav = encodePcm16Wav(resampled, targetSampleRate)
    return new Blob([wav], { type: "audio/wav" })
  } finally {
    await audioContext.close()
  }
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) {
    return buffer.getChannelData(0)
  }

  const length = buffer.length
  const output = new Float32Array(length)
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const input = buffer.getChannelData(channel)
    for (let i = 0; i < length; i += 1) {
      output[i] += input[i]
    }
  }

  const gain = 1 / buffer.numberOfChannels
  for (let i = 0; i < length; i += 1) {
    output[i] *= gain
  }
  return output
}

function resampleLinear(input: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  if (sourceRate === targetRate) {
    return input
  }

  const ratio = sourceRate / targetRate
  const outputLength = Math.max(1, Math.round(input.length / ratio))
  const output = new Float32Array(outputLength)

  for (let i = 0; i < outputLength; i += 1) {
    const sourcePos = i * ratio
    const left = Math.floor(sourcePos)
    const right = Math.min(left + 1, input.length - 1)
    const frac = sourcePos - left
    output[i] = input[left] * (1 - frac) + input[right] * frac
  }

  return output
}

function encodePcm16Wav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bytesPerSample = 2
  const blockAlign = bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = samples.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  writeAscii(view, 0, "RIFF")
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(view, 8, "WAVE")
  writeAscii(view, 12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, "data")
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    offset += bytesPerSample
  }

  return buffer
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i))
  }
}

function playInvalidStatementTone() {
  const audioContext = new AudioContext()
  const now = audioContext.currentTime

  const firstOscillator = audioContext.createOscillator()
  const firstGain = audioContext.createGain()
  firstOscillator.type = "sine"
  firstOscillator.frequency.value = 880
  firstGain.gain.setValueAtTime(0.0001, now)
  firstGain.gain.exponentialRampToValueAtTime(0.2, now + 0.01)
  firstGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18)
  firstOscillator.connect(firstGain).connect(audioContext.destination)
  firstOscillator.start(now)
  firstOscillator.stop(now + 0.2)

  const secondOscillator = audioContext.createOscillator()
  const secondGain = audioContext.createGain()
  secondOscillator.type = "sine"
  secondOscillator.frequency.value = 660
  secondGain.gain.setValueAtTime(0.0001, now + 0.22)
  secondGain.gain.exponentialRampToValueAtTime(0.2, now + 0.23)
  secondGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4)
  secondOscillator.connect(secondGain).connect(audioContext.destination)
  secondOscillator.start(now + 0.22)
  secondOscillator.stop(now + 0.42)

  window.setTimeout(() => {
    void audioContext.close()
  }, 500)
}
