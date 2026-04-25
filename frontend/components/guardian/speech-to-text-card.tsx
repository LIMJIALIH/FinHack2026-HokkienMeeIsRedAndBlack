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
  fraud_score?: {
    risk_score?: number | null
  } | null
  transfer_restructure?: {
    is_transfer_intent: boolean
    restructured_text?: string | null
    amount?: string | null
    recipient?: string | null
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

type TranscriptionReadyPayload = {
  text: string
  finbertScore?: number | null
  finbertAssessment?: string | null
}

const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
const TARGET_SAMPLE_RATE = 16000

function getAuthToken(): string {
  return localStorage.getItem("auth_token")?.trim() ?? ""
}

export function SpeechToTextCard({
  onTranscriptionReady,
}: {
  onTranscriptionReady?: (payload: TranscriptionReadyPayload) => void
}) {
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [isCheckingFinbert, setIsCheckingFinbert] = useState(false)
  const [transcript, setTranscript] = useState("")
  const [error, setError] = useState("")
  const [geminiAssessment, setGeminiAssessment] = useState<FinBertCheckResponse | null>(null)
  const [finbertScore, setFinbertScore] = useState<number | null>(null)

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
    setGeminiAssessment(null)
    setFinbertScore(null)

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

  const transcribeAudio = async (audioBlob: Blob) => {
    setIsTranscribing(true)
    setError("")

    try {
      const wavBlob = await convertToMonoPcmWav(audioBlob, TARGET_SAMPLE_RATE)
      const audioFile = new File([wavBlob], "recording.wav", { type: "audio/wav" })
      const formData = new FormData()
      formData.append("file", audioFile)
      formData.append("language_code", "en-US")

      const response = await fetch(`${apiBaseUrl}/api/v1/speech/transcribe`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getAuthToken()}` },
        body: formData,
      })

      if (!response.ok) {
        const detail = await response.text()
        throw new Error(detail || `HTTP ${response.status}`)
      }

      const data: SpeechToTextResponse = await response.json()
      const isValidTransfer = data.transfer_validation?.is_valid_complete_transfer === true

      if (!isValidTransfer) {
        setTranscript(data.text)
        setError("Please provide clearer transfer instructions, for example: Send RM 20 to Ali for lunch.")
        setGeminiAssessment(null)
        playInvalidStatementTone()
        return
      }

      setTranscript(data.text)
      setGeminiAssessment(null)
      setFinbertScore(data.fraud_score?.risk_score ?? null)
    } catch (err) {
      setError(`Transcription failed: ${formatError(err)}`)
    } finally {
      setIsTranscribing(false)
    }
  }

  const checkWithFinBert = async () => {
    const textToCheck = transcript.trim()
    if (!textToCheck || textToCheck.toLowerCase() === "invalid statement") {
      setError("No valid text available for FinBert checking.")
      return
    }

    setIsCheckingFinbert(true)
    setError("")

    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/speech/check-finbert`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken()}` },
        body: JSON.stringify({
          text: textToCheck,
          receiver_id: "unknown_receiver",
          currency: "MYR",
        }),
      })
      if (!response.ok) {
        const detail = await response.text()
        throw new Error(detail || `HTTP ${response.status}`)
      }

      const data: FinBertCheckResponse = await response.json()
      setGeminiAssessment(data)
      onTranscriptionReady?.({
        text: textToCheck,
        finbertScore: data.risk_score ?? finbertScore,
        finbertAssessment: [
          data.gemini_assessment,
          finbertScore !== null ? `stt_risk_score=${finbertScore}` : "",
          data.risk_score !== null && data.risk_score !== undefined ? `recomputed_risk_score=${data.risk_score}` : "",
          data.risk_level ? `recomputed_risk_level=${data.risk_level}` : "",
          data.overall_pattern_risk !== null && data.overall_pattern_risk !== undefined
            ? `pattern_risk=${data.overall_pattern_risk}`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
      })
    } catch (err) {
      setError(`FinBert check failed: ${formatError(err)}`)
      setGeminiAssessment(null)
    } finally {
      setIsCheckingFinbert(false)
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
          <h2 className="text-base font-semibold text-foreground">Speech To Text (Gemini 3.1 Flash-Lite)</h2>
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

        <Button
          onClick={checkWithFinBert}
          disabled={isRecording || isTranscribing || isCheckingFinbert || !transcript.trim()}
          variant="secondary"
        >
          {isCheckingFinbert ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Checking...
            </>
          ) : (
            "Check with FinBert"
          )}
        </Button>
      </div>

      <div className="mt-4">
        <Textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder="Transcript will appear here"
          rows={6}
        />
      </div>

      {geminiAssessment && (
        <div className="mt-3 rounded-md border p-3 text-sm">
          <p className="mb-2 font-medium">Gemini Assessment</p>
          <p>
            <span className="font-medium">Fraud/Spam Final:</span>{" "}
            {geminiAssessment.fraud_spam_final === null || geminiAssessment.fraud_spam_final === undefined
              ? "N/A"
              : geminiAssessment.fraud_spam_final
                ? "Yes"
                : "No"}
          </p>
          <p>
            <span className="font-medium">Confidence:</span>{" "}
            {geminiAssessment.confidence ?? "N/A"}
          </p>
          <p>
            <span className="font-medium">Summary:</span>{" "}
            {geminiAssessment.gemini_assessment}
          </p>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
    </Card>
  )
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
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
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
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
