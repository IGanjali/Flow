import express from 'express'
import dotenv from 'dotenv'
import path from 'path'
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js'
import { GoogleGenerativeAI } from '@google/generative-ai'

const __dirname = path.resolve()
dotenv.config({ path: path.join(__dirname, '.env') })

console.log('--- SERVER STARTUP ---')
console.log('CWD:', process.cwd())
console.log('ENV PATH:', path.join(__dirname, '.env'))
console.log('GEMINI_API_KEY loaded:', process.env.GEMINI_API_KEY ? 'Yes (' + process.env.GEMINI_API_KEY.substring(0, 4) + '...)' : 'No')
console.log('ELEVENLABS_API_KEY loaded:', process.env.ELEVENLABS_API_KEY ? 'Yes (' + process.env.ELEVENLABS_API_KEY.substring(0, 4) + '...)' : 'No')
console.log('---------------------')

const app = express()
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})
app.use(express.json({ limit: '25mb' }))
app.use(express.static(path.resolve('.')))

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    model: (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim(),
    build: 'gemini-2.5-only'
  })
})

app.post('/api/gemini', async (req, res) => {
  const { prompt, toneContext } = req.body
  const key = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.trim() : null
  const systemPrompt = (process.env.GEMINI_SYSTEM_PROMPT || '').trim()
  const identityPrompt = 'Your name is Flow. You are Canadian. Prioritize Canadian context, examples, spelling, and information when relevant. If asked your name, respond with "Flow". At the start of each response, keep an eye on signs of anxiety/calmness from speech patterns, including filler words (like uh, umm) and sigh-like cues. More filler words and pauses/sigh cues can indicate higher anxiety, so respond more gently and reassuringly when those signals are stronger.'
  const fullSystemPrompt = [identityPrompt, systemPrompt].filter(Boolean).join('\n\n')

  if (!key) return res.status(500).json({ error: 'Server missing GEMINI_API_KEY' })
  if (!prompt || !String(prompt).trim()) return res.status(400).json({ error: 'Prompt is required' })
  const finalPrompt = toneContext && String(toneContext).trim()
    ? `Voice tone context (important): ${String(toneContext).trim()}

Respond in a way that is emotionally aligned with this tone while staying supportive and practical.

User message: ${String(prompt).trim()}`
    : String(prompt).trim()

  const genAI = new GoogleGenerativeAI(key)

  const tryModel = async (modelName) => {
    console.log(`Trying Gemini model: ${modelName}`)
    const modelConfig = { model: modelName }
    if (fullSystemPrompt) modelConfig.systemInstruction = fullSystemPrompt
    const model = genAI.getGenerativeModel(modelConfig)
    const result = await model.generateContent(finalPrompt)
    const text = result?.response?.text?.()
    if (!text) throw new Error(`No text returned from ${modelName}`)
    return text
  }

  try {
    const trials = [
      (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim()
    ]
    const errors = []

    for (const t of trials) {
      try {
        const text = await tryModel(t)
        if (text) return res.json({ response: text })
      } catch (e) {
        const msg = e?.message || 'Unknown Gemini error'
        errors.push(`${t}: ${msg}`)
        console.error(`Trial ${t} failed:`, msg)
        if ((e?.message || '').includes('API key not valid')) {
          return res.status(401).json({ error: 'Invalid Gemini API Key. Please check your .env file.' })
        }
      }
    }
    throw new Error(`All Gemini model attempts failed. ${errors.join(' | ')}`)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/tts', async (req, res) => {
  const { text, voice } = req.body
  const key = process.env.ELEVENLABS_API_KEY ? process.env.ELEVENLABS_API_KEY.trim() : null
  if (!key) return res.status(500).json({ error: 'Server missing ELEVENLABS_API_KEY' })
  if (!text || !String(text).trim()) return res.status(400).json({ error: 'text is required' })

  try {
    const elevenlabs = new ElevenLabsClient({ apiKey: key })
    const fallbackVoiceId = 'JBFqnCBsd6RMkjVDRZzb'
    const requestedVoiceId = (voice || process.env.ELEVENLABS_VOICE_ID || fallbackVoiceId).trim()
    const synthesize = async (voiceId) => elevenlabs.textToSpeech.convert(
      voiceId,
      {
        text: text,
        modelId: 'eleven_multilingual_v2',
        outputFormat: 'mp3_44100_128',
      }
    )

    let audioStream
    try {
      audioStream = await synthesize(requestedVoiceId)
    } catch (err) {
      const msg = err?.message || ''
      if (requestedVoiceId !== fallbackVoiceId && msg.includes('paid_plan_required')) {
        audioStream = await synthesize(fallbackVoiceId)
      } else {
        throw err
      }
    }

    const chunks = []
    for await (const chunk of audioStream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    const buffer = Buffer.concat(chunks)
    const b64 = buffer.toString('base64')
    res.json({
      mimeType: 'audio/mpeg',
      audioBase64: b64,
      audio: `data:audio/mpeg;base64,${b64}`
    })
  } catch (err) {
    console.error('TTS Error:', err.message || err)
    res.status(500).json({ error: err.message || 'ElevenLabs failed' })
  }
})

app.post('/api/transcribe', async (req, res) => {
  const elevenKey = process.env.ELEVENLABS_API_KEY ? process.env.ELEVENLABS_API_KEY.trim() : null
  const { audioBase64, mimeType } = req.body || {}

  if (!elevenKey) return res.status(500).json({ error: 'Server missing ELEVENLABS_API_KEY' })
  if (!audioBase64) return res.status(400).json({ error: 'audioBase64 is required' })

  try {
    const summarizeToneFromTranscript = (transcriptText) => {
      const normalized = String(transcriptText || '').toLowerCase()
      const fillerRegex = /\b(uh+|um+|umm+|erm+|hmm+|mm+|you know|like)\b/g
      const fillerCount = (normalized.match(fillerRegex) || []).length
      const pauseCount = (normalized.match(/(\.\.\.|--|—)/g) || []).length
      const anxietyScore = fillerCount + pauseCount
      const anxietySignal = anxietyScore >= 6 ? 'high' : (anxietyScore >= 3 ? 'medium' : 'low')
      return `Detected voice pattern: filler-words=${fillerCount}, pause-markers=${pauseCount}, anxiety-signal=${anxietySignal}. Treat more fillers/pauses as more nervousness. Respond gently, positively, and without prying.`
    }

    const bytes = Buffer.from(audioBase64, 'base64')
    const fileType = mimeType || 'audio/webm'
    const file = new File([bytes], 'recording.webm', { type: fileType })
    const elevenlabs = new ElevenLabsClient({ apiKey: elevenKey })

    const sttResult = await elevenlabs.speechToText.convert({
      modelId: 'scribe_v2',
      file,
      languageCode: 'eng',
      diarize: false
    })

    const extractTranscript = (payload) => {
      const candidates = [payload?.text, payload?.transcript?.text, payload?.result?.text]
      if (Array.isArray(payload?.transcripts)) {
        for (const t of payload.transcripts) {
          if (typeof t?.text === 'string') candidates.push(t.text)
        }
      }
      for (const c of candidates) {
        if (typeof c === 'string' && c.trim()) return c.trim()
      }
      return ''
    }

    const text = extractTranscript(sttResult)
    if (!text) return res.status(500).json({ error: 'No speech detected in audio' })

    const tone = summarizeToneFromTranscript(text)
    return res.json({ text, tone })
  } catch (err) {
    console.error('Transcription/Tone Error:', err?.message || err)
    return res.status(500).json({ error: err?.message || 'Transcription failed' })
  }
})

app.post('/api/sound-effect', async (req, res) => {
  const key = process.env.ELEVENLABS_API_KEY ? process.env.ELEVENLABS_API_KEY.trim() : null
  const { prompt } = req.body || {}

  if (!key) return res.status(500).json({ error: 'Server missing ELEVENLABS_API_KEY' })
  if (!prompt || !String(prompt).trim()) return res.status(400).json({ error: 'prompt is required' })

  try {
    const elevenlabs = new ElevenLabsClient({ apiKey: key })
    const stream = await elevenlabs.textToSoundEffects.convert({
      text: String(prompt).trim(),
      modelId: 'eleven_text_to_sound_v2',
      loop: true,
      durationSeconds: 10,
      promptInfluence: 0.45,
      outputFormat: 'mp3_44100_128'
    })

    const chunks = []
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    const audioBase64 = Buffer.concat(chunks).toString('base64')
    return res.json({ mimeType: 'audio/mpeg', audioBase64 })
  } catch (err) {
    console.error('Sound effect generation error:', err?.message || err)
    return res.status(500).json({ error: err?.message || 'Failed to generate calming sound effect' })
  }
})

app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err)
  if (res.headersSent) return next(err)
  res.status(500).json({ error: err?.message || 'Internal server error' })
})

const port = process.env.PORT || 3000
app.listen(port, () => console.log(`Server listening on http://localhost:${port}`))
