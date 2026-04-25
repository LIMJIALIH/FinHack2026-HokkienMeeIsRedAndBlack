"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Shield, Mail, Lock, Eye, EyeOff, Loader2, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

const schema = z.object({
  gmail:    z.string().email("Please enter a valid email"),
  password: z.string().min(1, "Password is required"),
})

type FormData = z.infer<typeof schema>

export default function LoginPage() {
  const router      = useRouter()
  const [showPwd,   setShowPwd]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  const form = useForm<FormData>({
    resolver:      zodResolver(schema),
    defaultValues: { gmail: "", password: "" },
  })

  async function onSubmit(data: FormData) {
    setError(null)
    try {
      const res  = await fetch(`${API_URL}/auth/login`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ gmail: data.gmail, password: data.password }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.detail ?? "Login failed")

      localStorage.setItem("auth_token", json.token)
      localStorage.setItem("user_id", json.user.id)
      localStorage.setItem("user_name",  json.user.full_name)
      localStorage.setItem("user_email", json.user.gmail)
      localStorage.setItem("kyc_status", json.user.kyc_status)

      if (json.user.kyc_status !== "verified") {
        router.push("/signup")
      } else {
        router.push("/")
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong")
    }
  }

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
            <p className="text-xs text-muted-foreground">Secure Sign In</p>
          </div>
        </div>
      </header>

      <div className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <Card>
            <CardHeader className="space-y-1">
              <CardTitle className="text-xl">Welcome back</CardTitle>
              <CardDescription>Sign in to your TNG Guardian Voice account</CardDescription>
            </CardHeader>

            <CardContent>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                {/* Email */}
                <div className="space-y-2">
                  <Label htmlFor="gmail">Email Address</Label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input id="gmail" type="email" className="pl-10" placeholder="your@gmail.com" {...form.register("gmail")} />
                  </div>
                  {form.formState.errors.gmail && (
                    <p className="text-xs text-destructive">{form.formState.errors.gmail.message}</p>
                  )}
                </div>

                {/* Password */}
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="password"
                      type={showPwd ? "text" : "password"}
                      className="pl-10 pr-10"
                      placeholder="Your password"
                      {...form.register("password")}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd(!showPwd)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {form.formState.errors.password && (
                    <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
                  )}
                </div>

                {/* Error */}
                {error && (
                  <div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    <p className="text-sm text-destructive">{error}</p>
                  </div>
                )}

                <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting
                    ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Signing in…</>
                    : "Sign In"}
                </Button>

                <p className="text-center text-sm text-muted-foreground">
                  Don&apos;t have an account?{" "}
                  <Link href="/signup" className="text-foreground underline underline-offset-4 hover:opacity-80">
                    Create one
                  </Link>
                </p>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
