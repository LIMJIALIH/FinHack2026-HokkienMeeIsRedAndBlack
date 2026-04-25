"use client"

import { useMemo, useRef, useState } from "react"
import { Loader2, Mic, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"

type SpeechToTextResponse = {
  text: string
  job_name: string
  language_code: string
}

const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/wav"]

export function SpeechToTextCard() {
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [transcript, setTranscript] = useState("")
  const [error, setError] = useState("")

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const mediaStreamRef = useRef<MediaStream | null>(null)

  const apiBaseUrl = useMemo(
    () => process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000",
    [],
  )

  const startRecording = async () => {
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("MediaRecorder is not supported in this browser.")
      return
    }

    setError("")
    setTranscript("")

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
        await transcribeAudio(audioBlob, mediaRecorder.mimeType)
        cleanupMedia()
      }

      mediaRecorder.start()
      setIsRecording(true)
    } catch (err) {
      setError(`Unable to access microphone: ${formatError(err)}`)
      cleanupMedia()
    }
  }

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current
    if (!recorder) {
      return
    }
    if (recorder.state !== "inactive") {
      recorder.stop()
    } else {
      cleanupMedia()
    }
    setIsRecording(false)
  }

  const transcribeAudio = async (audioBlob: Blob, mimeType: string) => {
    setIsTranscribing(true)
    setError("")

    try {
      const ext = extensionFromMimeType(mimeType)
      const audioFile = new File([audioBlob], `recording.${ext}`, { type: audioBlob.type || mimeType })
      const formData = new FormData()
      formData.append("file", audioFile)
      formData.append("language_code", "en-US")

      const response = await fetch(`${apiBaseUrl}/api/v1/speech/transcribe`, {
        method: "POST",
        body: formData,
      })

      if (!response.ok) {
        const detail = await response.text()
        throw new Error(detail || `HTTP ${response.status}`)
      }

      const data: SpeechToTextResponse = await response.json()
      setTranscript(data.text)
    } catch (err) {
      setError(`Transcription failed: ${formatError(err)}`)
    } finally {
      setIsTranscribing(false)
    }
  }

  const cleanupMedia = () => {
    mediaRecorderRef.current = null
    chunksRef.current = []
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }
  }

  return (
    <Card className="p-5 md:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Speech To Text (Amazon Transcribe)</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Record voice from the microphone and convert it into text.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!isRecording ? (
          <Button onClick={startRecording} disabled={isTranscribing}>
            <Mic className="mr-2 h-4 w-4" />
            Start Recording
          </Button>
        ) : (
          <Button onClick={stopRecording} variant="destructive">
            <Square className="mr-2 h-4 w-4" />
            Stop Recording
          </Button>
        )}

        {isTranscribing && (
          <span className="inline-flex items-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Transcribing...
          </span>
        )}
      </div>

      <div className="mt-4">
        <Textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder="Transcript will appear here"
          rows={6}
        />
      </div>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
    </Card>
  )
}

function extensionFromMimeType(mimeType: string) {
  if (mimeType.includes("wav")) return "wav"
  if (mimeType.includes("mp4")) return "mp4"
  return "webm"
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
