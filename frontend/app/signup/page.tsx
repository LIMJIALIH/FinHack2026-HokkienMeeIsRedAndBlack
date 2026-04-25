"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import {
  Shield,
  User,
  Mail,
  Phone,
  Lock,
  Eye,
  EyeOff,
  ChevronRight,
  Loader2,
  CheckCircle2,
  Camera,
  AlertCircle,
  CreditCard,
  Globe,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

// ── Schema ──────────────────────────────────────────────────────────────────
const schema = z
  .object({
    full_name:          z.string().min(2, "Full name must be at least 2 characters"),
    gmail:              z.string().email("Please enter a valid email address"),
    phone:              z.string().min(8, "Please enter a valid phone number"),
    ic_number:          z.string().min(6, "Please enter your IC or passport number"),
    preferred_language: z.string().default("en"),
    password:           z.string().min(8, "Password must be at least 8 characters"),
    confirm_password:   z.string(),
  })
  .refine((d) => d.password === d.confirm_password, {
    message: "Passwords don't match",
    path: ["confirm_password"],
  })

type FormData = z.infer<typeof schema>
type Step     = "register" | "kyc" | "complete"
type KYCState = "idle" | "loading" | "scanning-doc" | "scanning-face" | "verifying" | "done" | "error"

const KYC_LABELS: Record<KYCState, string> = {
  idle:            "Ready to verify",
  loading:         "Connecting to face detection service…",
  "scanning-doc":  "Positioning your face…",
  "scanning-face": "Performing liveness detection…",
  verifying:       "Verifying with Alibaba Cloud…",
  done:            "Face verified!",
  error:           "Verification failed",
}

const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "ms", label: "Bahasa Melayu" },
  { value: "zh", label: "中文 (Chinese)" },
  { value: "ta", label: "தமிழ் (Tamil)" },
]

// ── Component ────────────────────────────────────────────────────────────────
export default function SignupPage() {
  const router = useRouter()

  const [step,        setStep]        = useState<Step>("register")
  const [kycState,    setKycState]    = useState<KYCState>("idle")
  const [kycProgress, setKycProgress] = useState(0)
  const [showPwd,     setShowPwd]     = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [authData,    setAuthData]    = useState<{
    token: string; userId: string; fullName: string
    kyc: { certifyId: string; transactionId: string; pageUrl: string | null; simulation: boolean }
  } | null>(null)

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      full_name: "", gmail: "", phone: "", ic_number: "",
      preferred_language: "en", password: "", confirm_password: "",
    },
  })

  // ── Step 1: registration ─────────────────────────────────────────────────
  async function onSubmit(data: FormData) {
    setError(null)
    try {
      const res  = await fetch(`${API_URL}/auth/signup`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          full_name:          data.full_name,
          gmail:              data.gmail,
          phone:              data.phone,
          ic_number:          data.ic_number,
          preferred_language: data.preferred_language,
          password:           data.password,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.detail ?? "Signup failed")

      localStorage.setItem("auth_token",  json.token)
      localStorage.setItem("user_name",   data.full_name)
      localStorage.setItem("user_email",  data.gmail)
      localStorage.setItem("user_phone",  data.phone)
      localStorage.setItem("kyc_status",  "in_progress")

      setAuthData({
        token:   json.token,
        userId:  json.user_id,
        fullName: data.full_name,
        kyc:     json.kyc,
      })
      setStep("kyc")
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong")
    }
  }

  // ── Step 2: eKYC ─────────────────────────────────────────────────────────
  async function startKYC() {
    if (!authData) return
    setError(null)

    // Real mode: redirect to Alibaba's hosted verification page
    if (!authData.kyc.simulation && authData.kyc.pageUrl) {
      localStorage.setItem("kyc_certify_id",    authData.kyc.certifyId)
      localStorage.setItem("kyc_transaction_id", authData.kyc.transactionId ?? "")
      window.location.href = authData.kyc.pageUrl
      return
    }

    // Simulation mode: animate progress inline, then confirm with backend
    try {
      setKycState("loading")
      await delay(800)

      setKycState("scanning-doc")
      await animateProgress(0, 40, 2400)

      setKycState("scanning-face")
      await animateProgress(40, 75, 2000)

      setKycState("verifying")
      await animateProgress(75, 95, 1200)

      const res  = await fetch(`${API_URL}/kyc/complete`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authData.token}` },
        body:    JSON.stringify({
          certify_id:     authData.kyc.certifyId,
          transaction_id: authData.kyc.transactionId,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.detail ?? "Verification failed")

      await animateProgress(95, 100, 400)
      setKycState("done")
      localStorage.setItem("kyc_status", "verified")
      await delay(900)
      setStep("complete")
    } catch (e: unknown) {
      setKycState("error")
      setError(e instanceof Error ? e.message : "Verification failed")
    }
  }

  // ── Face detection (local fallback) ───────────────────────────────────────
  async function verifyFaceLocal() {
    if (!authData) return
    setError(null)

    try {
      // Get face from webcam
      setKycState("loading")
      const canvas = await captureFromWebcam()
      if (!canvas) {
        throw new Error("Failed to capture image from camera")
      }

      setKycState("scanning-face")
      await animateProgress(0, 50, 1000)

      // Convert canvas to blob
      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((b) => {
          if (b) resolve(b)
        })
      })

      // Send to backend for local face detection
      const formData = new FormData()
      formData.append("file", blob, "face.jpg")

      setKycState("verifying")
      await animateProgress(50, 90, 1500)

      const res = await fetch(`${API_URL}/kyc/verify-face`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authData.token}` },
        body: formData,
      })

      const json = await res.json()
      if (!res.ok) throw new Error(json.detail ?? "Face verification failed")

      await animateProgress(90, 100, 400)
      setKycState("done")
      localStorage.setItem("kyc_status", "verified")
      await delay(900)
      setStep("complete")
    } catch (e: unknown) {
      setKycState("error")
      setError(e instanceof Error ? e.message : "Face verification failed")
    }
  }

  async function captureFromWebcam(): Promise<HTMLCanvasElement | null> {
    return new Promise((resolve) => {
      const video = document.createElement("video")
      const canvas = document.createElement("canvas")

      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: "user" } })
        .then((stream) => {
          video.srcObject = stream
          video.onloadedmetadata = () => {
            video.play()
            setTimeout(() => {
              canvas.width = video.videoWidth
              canvas.height = video.videoHeight
              const ctx = canvas.getContext("2d")
              if (ctx) {
                ctx.drawImage(video, 0, 0)
                stream.getTracks().forEach((track) => track.stop())
                resolve(canvas)
              } else {
                resolve(null)
              }
            }, 500)
          }
        })
        .catch(() => resolve(null))
    })
  }

  async function animateProgress(from: number, to: number, ms: number) {
    const steps    = 24
    const stepMs   = ms / steps
    const stepSize = (to - from) / steps
    for (let i = 0; i <= steps; i++) {
      setKycProgress(from + stepSize * i)
      await delay(stepMs)
    }
  }

  function delay(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)) }

  // ── Render ────────────────────────────────────────────────────────────────
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
            <p className="text-xs text-muted-foreground">Secure Account Setup</p>
          </div>
        </div>
      </header>

      {/* Step bar */}
      <div className="border-b border-border bg-card/40">
        <div className="mx-auto max-w-lg px-4 py-4">
          <div className="flex items-center gap-2">
            <StepDot n={1} label="Account Info"    active={step === "register"} done={step !== "register"} />
            <div className="h-px flex-1 bg-border" />
            <StepDot n={2} label="ID Verification" active={step === "kyc"}      done={step === "complete"} />
            <div className="h-px flex-1 bg-border" />
            <StepDot n={3} label="Complete"         active={step === "complete"} done={false} />
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-md">

          {/* ── Step 1 ── */}
          {step === "register" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-xl">Create your account</CardTitle>
                <CardDescription>Set up your TNG Guardian Voice e-wallet</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <Field label="Full Name" error={form.formState.errors.full_name?.message}>
                    <IconInput icon={<User className="h-4 w-4" />}>
                      <Input placeholder="Full name as per IC" {...form.register("full_name")} />
                    </IconInput>
                  </Field>

                  <Field label="Email Address" error={form.formState.errors.gmail?.message}>
                    <IconInput icon={<Mail className="h-4 w-4" />}>
                      <Input type="email" placeholder="your@email.com" {...form.register("gmail")} />
                    </IconInput>
                  </Field>

                  <Field label="Phone Number" error={form.formState.errors.phone?.message}>
                    <IconInput icon={<Phone className="h-4 w-4" />}>
                      <Input type="tel" placeholder="+60 12-345 6789" {...form.register("phone")} />
                    </IconInput>
                  </Field>

                  <Field label="IC / Passport Number" hint="MyKad or passport" error={form.formState.errors.ic_number?.message}>
                    <IconInput icon={<CreditCard className="h-4 w-4" />}>
                      <Input placeholder="e.g. 901231-14-5678" {...form.register("ic_number")} />
                    </IconInput>
                  </Field>

                  <Field label="Preferred Language" error={form.formState.errors.preferred_language?.message}>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                        <Globe className="h-4 w-4" />
                      </span>
                      <select
                        {...form.register("preferred_language")}
                        className="flex h-10 w-full rounded-md border border-input bg-background pl-10 pr-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 text-foreground"
                      >
                        {LANGUAGE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                  </Field>

                  <Field label="Password" error={form.formState.errors.password?.message}>
                    <IconInput icon={<Lock className="h-4 w-4" />} trailing={
                      <button type="button" onClick={() => setShowPwd(!showPwd)} className="text-muted-foreground hover:text-foreground">
                        {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    }>
                      <Input type={showPwd ? "text" : "password"} placeholder="Min. 8 characters" {...form.register("password")} />
                    </IconInput>
                  </Field>

                  <Field label="Confirm Password" error={form.formState.errors.confirm_password?.message}>
                    <IconInput icon={<Lock className="h-4 w-4" />} trailing={
                      <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="text-muted-foreground hover:text-foreground">
                        {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    }>
                      <Input type={showConfirm ? "text" : "password"} placeholder="Repeat password" {...form.register("confirm_password")} />
                    </IconInput>
                  </Field>

                  {error && <ErrorBox>{error}</ErrorBox>}

                  <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                    {form.formState.isSubmitting
                      ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating account…</>
                      : <>Continue to ID Verification <ChevronRight className="ml-2 h-4 w-4" /></>}
                  </Button>

                  <p className="text-center text-sm text-muted-foreground">
                    Already have an account?{" "}
                    <Link href="/login" className="text-foreground underline underline-offset-4 hover:opacity-80">
                      Sign in
                    </Link>
                  </p>
                </form>
              </CardContent>
            </Card>
          )}

          {/* ── Step 2: KYC ── */}
          {step === "kyc" && (
            <Card>
              <CardHeader>
                <div className="mb-1">
                  <Badge variant="outline" className="text-xs">
                    {authData?.kyc.simulation ? "Simulation Mode" : "Alibaba Cloud FACE_LIVENESS_PRO"}
                  </Badge>
                </div>
                <CardTitle className="text-xl">Face Liveness Verification</CardTitle>
                <CardDescription>
                  {authData?.kyc.simulation
                    ? "Running in simulation mode — no real credentials configured."
                    : "Powered by Alibaba Cloud FACE_LIVENESS_PRO. No document required — camera only."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">

                {kycState === "idle" && (
                  <>
                    <div className="rounded-lg border border-border bg-secondary/50 p-4 space-y-3">
                      <p className="text-sm font-medium">Verification Methods</p>
                      <div className="space-y-2">
                        <Row icon={<Camera className="h-4 w-4" />} text="Alibaba Cloud — Enterprise-grade or local detection" />
                      </div>
                    </div>

                    <div className="rounded-lg border border-border p-4 space-y-3">
                      <p className="text-sm font-medium">Verification steps</p>
                      <ol className="space-y-2">
                        {["Position your face — look directly at camera", "Liveness check — follow on-screen prompts", "AI verification — confirmed by selected service"].map((s, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-medium">{i + 1}</span>
                            {s}
                          </li>
                        ))}
                      </ol>
                    </div>

                    {error && <ErrorBox>{error}</ErrorBox>}

                    <div className="space-y-2">
                      <Button onClick={startKYC} className="w-full">
                        <Camera className="mr-2 h-4 w-4" />
                        Alibaba Cloud Verification
                      </Button>
                      <Button onClick={verifyFaceLocal} variant="outline" className="w-full">
                        <Camera className="mr-2 h-4 w-4" />
                        Local Face Detection
                      </Button>
                    </div>
                  </>
                )}

                {kycState !== "idle" && kycState !== "error" && (
                  <div className="space-y-6">
                    <div className="flex flex-col items-center gap-3 py-2">
                      {kycState === "done"
                        ? <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100"><CheckCircle2 className="h-8 w-8 text-green-600" /></div>
                        : (
                          <div className="relative flex h-16 w-16 items-center justify-center">
                            <div className="absolute inset-0 rounded-full border-4 border-primary/20" />
                            <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-primary animate-spin" />
                            {kycState === "scanning-doc"  && <Camera className="h-6 w-6 text-primary" />}
                            {kycState === "scanning-face" && <Camera className="h-6 w-6 text-primary" />}
                            {(kycState === "loading" || kycState === "verifying") && <Loader2 className="h-6 w-6 text-primary animate-spin" />}
                          </div>
                        )}
                      <p className="text-sm font-medium text-center">{KYC_LABELS[kycState]}</p>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Progress</span>
                        <span>{Math.round(kycProgress)}%</span>
                      </div>
                      <Progress value={kycProgress} className="h-2" />
                    </div>

                    <div className="space-y-1">
                      {(["Face positioning", "Liveness detection", "Server verification"] as const).map((label, i) => {
                        const thresholds = [40, 75, 100]
                        const done   = kycProgress >= thresholds[i]
                        const active = !done && kycProgress >= (thresholds[i - 1] ?? 0)
                        return (
                          <div key={label} className={`flex items-center gap-2 rounded px-2 py-1 text-xs transition-colors ${done ? "bg-green-50 text-green-700" : active ? "bg-primary/5 text-primary" : "text-muted-foreground"}`}>
                            {done   ? <CheckCircle2 className="h-3.5 w-3.5" />
                             : active ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                             : <div className="h-3.5 w-3.5 rounded-full border border-border" />}
                            {label}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {kycState === "error" && (
                  <div className="space-y-4">
                    <ErrorBox>{error ?? "Verification failed. Please try again."}</ErrorBox>
                    <Button variant="outline" className="w-full" onClick={() => { setKycState("idle"); setKycProgress(0); setError(null) }}>
                      Try Again
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* ── Step 3: Complete ── */}
          {step === "complete" && (
            <Card>
              <CardContent className="py-10">
                <div className="flex flex-col items-center gap-5 text-center">
                  <div className="flex h-20 w-20 items-center justify-center rounded-full bg-green-100">
                    <CheckCircle2 className="h-10 w-10 text-green-600" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold">Account Created!</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Welcome, <strong>{authData?.fullName}</strong>. Your identity has been verified.
                    </p>
                  </div>

                  <div className="w-full rounded-lg border border-border bg-secondary/50 p-4 text-left space-y-3">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Account Status</p>
                    <StatusRow label="Face Liveness Verification" badge="Verified"     color="green" />
                    <StatusRow label="Guardian AI"                badge="Active"       color="blue" />
                    <StatusRow label="eKYC Provider"             badge="Alibaba Cloud" color="slate" />
                  </div>

                  <Button onClick={() => router.push("/")} className="w-full">
                    Go to My Wallet <ChevronRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

        </div>
      </div>
    </div>
  )
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function StepDot({ n, label, active, done }: { n: number; label: string; active: boolean; done: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition-colors ${
        done   ? "bg-primary text-primary-foreground" :
        active ? "bg-primary text-primary-foreground ring-2 ring-primary/25" :
                 "border border-border bg-secondary text-muted-foreground"
      }`}>
        {done ? <CheckCircle2 className="h-4 w-4" /> : n}
      </div>
      <span className={`text-xs ${active || done ? "font-medium text-foreground" : "text-muted-foreground"}`}>{label}</span>
    </div>
  )
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label} <span className="text-destructive">*</span>{hint && <span className="ml-1 text-xs font-normal text-muted-foreground">({hint})</span>}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

function IconInput({ icon, trailing, children }: { icon: React.ReactNode; trailing?: React.ReactNode; children: React.ReactElement }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">{icon}</span>
      {children && (
        <children.type
          {...children.props}
          className={`pl-10 ${trailing ? "pr-10" : ""} ${children.props.className ?? ""}`.trim()}
        />
      )}
      {trailing && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2">{trailing}</span>
      )}
    </div>
  )
}

function Row({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <span className="shrink-0">{icon}</span>
      {text}
    </div>
  )
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <p className="text-sm text-destructive">{children}</p>
    </div>
  )
}

function StatusRow({ label, badge, color }: { label: string; badge: string; color: "green" | "blue" | "slate" }) {
  const cls = {
    green: "bg-green-100 text-green-700 border-green-200",
    blue:  "bg-blue-100 text-blue-700 border-blue-200",
    slate: "bg-secondary text-muted-foreground border-border",
  }[color]
  return (
    <div className="flex items-center justify-between text-sm">
      <span>{label}</span>
      <Badge className={cls}>{badge}</Badge>
    </div>
  )
}
