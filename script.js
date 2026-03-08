// Flow - frontend
// sound mixer and tts

const form = document.getElementById('form')
const input = document.getElementById('input')
const messages = document.getElementById('messages')
const themeToggle = document.getElementById('themeToggle')
const voiceBtn = document.getElementById('voiceBtn')
const ttsVoiceSelect = document.getElementById('ttsVoiceSelect')
const generateQuotesBtn = document.getElementById('generateQuotesBtn')
const quotesList = document.getElementById('quotesList')
const soundPromptInput = document.getElementById('soundPromptInput')
const generateSoundBtn = document.getElementById('generateSoundBtn')
const soundPromptStatus = document.getElementById('soundPromptStatus')
const customSoundKnobContainer = document.getElementById('customSoundKnobContainer')
const customSoundLabel = document.getElementById('customSoundLabel')
const apiBases = window.location.port === '3000'
  ? ['']
  : ['', 'http://localhost:3000']

// tab elements
const tabBtns = document.querySelectorAll('.tab-btn')
const tabContents = document.querySelectorAll('.tab-content')

// sliders
const knobs = document.querySelectorAll('.knob')
const sliders = {
  brown: document.getElementById('vol_brown'),
  white: document.getElementById('vol_white'),
  pink: document.getElementById('vol_pink'),
  custom: document.getElementById('vol_custom')
}

let audioCtx = null
const sources = {}
let playing = false
let currentTtsAudio = null
let currentTtsUrl = null
let mediaRecorder = null
let micStream = null
let micChunks = []
const MASTER_SOUND_GAIN = 0.4
const defaultTtsVoice = 'xKhbyU7E3bC6T89Kn26c'
let selectedTtsVoice = defaultTtsVoice

if (ttsVoiceSelect) {
  const savedVoice = localStorage.getItem('flow_tts_voice')
  if (savedVoice) selectedTtsVoice = savedVoice
  ttsVoiceSelect.value = selectedTtsVoice
  ttsVoiceSelect.addEventListener('change', () => {
    selectedTtsVoice = ttsVoiceSelect.value || defaultTtsVoice
    localStorage.setItem('flow_tts_voice', selectedTtsVoice)
  })
}

async function requestSoundEffect(prompt) {
  let lastErr = null
  for (const base of apiBases) {
    try {
      const res = await fetch(`${base}/api/sound-effect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      })
      const raw = await res.text()
      let j = {}
      if (raw) {
        try {
          j = JSON.parse(raw)
        } catch {
          if (!res.ok) throw new Error(`Sound generation failed (${res.status}). ${raw.slice(0, 200)}`)
          throw new Error('Server returned invalid JSON from /api/sound-effect')
        }
      }
      if (!res.ok) throw new Error(j.error || `Failed to generate sound (${res.status})`)
      return j
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr || new Error('Unable to reach sound generation backend')
}

if (generateSoundBtn && soundPromptInput) {
  generateSoundBtn.addEventListener('click', async () => {
    const prompt = soundPromptInput.value.trim()
    if (!prompt) {
      if (soundPromptStatus) soundPromptStatus.textContent = 'Enter a calming sound prompt first.'
      return
    }

    generateSoundBtn.disabled = true
    generateSoundBtn.textContent = 'Generating...'
    if (soundPromptStatus) soundPromptStatus.textContent = 'Creating your custom calming sound...'

    try {
      const j = await requestSoundEffect(prompt)
      if (!j.audioBase64) throw new Error('No audio returned for this prompt')
      const audioEl = document.getElementById('audio_custom')
      if (!audioEl) throw new Error('Custom audio channel not found')

      const mime = j.mimeType || 'audio/mpeg'
      audioEl.src = `data:${mime};base64,${j.audioBase64}`
      audioEl.load()
      audioEl.volume = parseFloat(sliders.custom?.value || 0) * MASTER_SOUND_GAIN

      if (customSoundKnobContainer) {
        customSoundKnobContainer.classList.remove('hidden-sound')
      }
      if (customSoundLabel) {
        customSoundLabel.textContent = prompt
      }

      if (!sources.custom) {
        sources.custom = { isMp3: true, elem: audioEl }
      }

      if (playing) {
        await audioEl.play().catch(() => {})
      }
      if (soundPromptStatus) soundPromptStatus.textContent = 'Custom calming sound generated and loaded.'
    } catch (err) {
      if (soundPromptStatus) soundPromptStatus.textContent = `Oops: ${err.message || String(err)}`
    } finally {
      generateSoundBtn.disabled = false
      generateSoundBtn.textContent = 'Generate Sound'
    }
  })
}

// Audio generation

function ensureAudioCtx(){
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)()
}

function makeNoiseBuffer(){
  const sr = audioCtx.sampleRate || 44100
  const bufferSize = 2 * sr
  const noiseBuffer = audioCtx.createBuffer(1, bufferSize, sr)
  const output = noiseBuffer.getChannelData(0)
  for (let i = 0; i < bufferSize; i++) output[i] = Math.random() * 2 - 1
  return noiseBuffer
}

function createNoiseSource(type){
  ensureAudioCtx()
  const src = audioCtx.createBufferSource()
  src.buffer = makeNoiseBuffer()
  src.loop = true
  const gain = audioCtx.createGain()
  let nodeChain = [src]
  const lfos = []

  if (type === 'custom') {

    return null;
  }

  if (type === 'brown'){
    const lp1 = audioCtx.createBiquadFilter(); lp1.type = 'lowpass'; lp1.frequency.value = 1200
    const lp2 = audioCtx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 800
    src.connect(lp1); lp1.connect(lp2); lp2.connect(gain)
    nodeChain.push(lp1, lp2)
  } else if (type === 'pink'){
    const hp = audioCtx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=100
    const lp = audioCtx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=6000
    src.connect(hp); hp.connect(lp); lp.connect(gain)
    nodeChain.push(hp, lp)
  } else {
    src.connect(gain)
  }

  gain.connect(audioCtx.destination)
  nodeChain.push(gain)
  return { src, gain, nodeChain, lfos }
}

function startAll(){
  ensureAudioCtx()
  if (playing) return
  Object.keys(sliders).forEach(type => {
    const s = createNoiseSource(type)
    const vol = parseFloat(sliders[type].value || 0)

    if (type === 'custom') {
      const audioEl = document.getElementById(`audio_${type}`);
      if (audioEl) {
        audioEl.volume = vol * MASTER_SOUND_GAIN;
        if (audioEl.src) {
          audioEl.play().catch(e => console.warn(`Could not play ${type}.mp3`, e));
        }
        sources[type] = { isMp3: true, elem: audioEl };
      }
    } else {
      sources[type] = s
      s.gain.gain.setValueAtTime(vol * MASTER_SOUND_GAIN, audioCtx.currentTime)
      s.src.start(0)
    }
  })
  playing = true
}

// audio start
document.addEventListener('click', () => {
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  if (!playing) startAll();
}, { once: false });

// tabs
tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const tabName = btn.getAttribute('data-tab');
    tabBtns.forEach(b => b.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`${tabName}-tab`).classList.add('active');
  });
});

// light/dark
themeToggle.addEventListener('change', () => {
  if (themeToggle.checked) {
    document.body.classList.add('light');
    localStorage.setItem('flow-theme', 'light');
  } else {
    document.body.classList.remove('light');
    localStorage.setItem('flow-theme', 'dark');
  }
});

if (localStorage.getItem('flow-theme') === 'light') {
  themeToggle.checked = true;
  document.body.classList.add('light');
}

// slider knob
function updateKnob(knob, value) {
  const path = knob.querySelector('.knob-value');
  const type = knob.getAttribute('data-type');
  const input = sliders[type];
  knob.style.setProperty('--glow-strength', String(value));
  
  const maxLength = 188.5;
  const offset = maxLength - (value * maxLength);
  path.style.strokeDashoffset = offset;
  
  input.value = value;
  localStorage.setItem(`flow_${type}_volume`, value);
  
  const thumb = knob.querySelector('.knob-thumb');
  if (thumb) {
    const angleDeg = 135 + value * 270;
    const angleRad = angleDeg * Math.PI / 180;
    const x = 95 + 76 * Math.cos(angleRad);
    const y = 95 + 76 * Math.sin(angleRad);
    thumb.style.left = `${x}px`;
    thumb.style.top = `${y}px`;
  }
  
  if (sources[type]) {
    if (sources[type].isMp3) {
      sources[type].elem.volume = value * MASTER_SOUND_GAIN;
    } else if (sources[type].gain) {
      sources[type].gain.gain.setValueAtTime(parseFloat(value) * MASTER_SOUND_GAIN, audioCtx.currentTime);
    }
  }
}

knobs.forEach(knob => {
  let isDragging = false;
  const type = knob.getAttribute('data-type');
  
  const thumb = document.createElement('div');
  thumb.className = 'knob-thumb';
  knob.appendChild(thumb);
  
  // saved volume
  const savedVol = localStorage.getItem(`flow_${type}_volume`) || (type === 'brown' ? 0.1 : (type === 'custom' ? 0.1 : 0.05));
  updateKnob(knob, parseFloat(savedVol));

  const handleMove = (e) => {
    if (!isDragging) return;
    const rect = knob.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    

    const angle = Math.atan2(clientY - centerY, clientX - centerX) * 180 / Math.PI;

    let normalized = (angle + 450) % 360; // 0 is top
    // math because the sliders are round
    let val = 0;
    if (normalized >= 225 && normalized <= 360) {
      val = (normalized - 225) / 270; // Map back half
    } else if (normalized >= 0 && normalized <= 135) {
      val = (normalized + 135) / 270;
    } else if (normalized > 135 && normalized < 180) {
      val = 1;
    } else {
      val = 0;
    }
    
    updateKnob(knob, Math.min(Math.max(val, 0), 1));
  };

  knob.addEventListener('mousedown', () => isDragging = true);
  knob.addEventListener('touchstart', (e) => { isDragging = true; e.preventDefault(); });
  window.addEventListener('mousemove', handleMove);
  window.addEventListener('touchmove', handleMove);
  window.addEventListener('mouseup', () => isDragging = false);
  window.addEventListener('touchend', () => isDragging = false);
});

function appendMessage(text, cls='bot'){
  const el = document.createElement('div')
  el.className = 'message ' + cls
  el.textContent = text
  messages.appendChild(el)
  messages.scrollTop = messages.scrollHeight
}

async function handleUserText(txt, toneContext = '') {
  appendMessage(txt, 'user')
  input.value = ''
  appendMessage('Flow is listening...', 'bot')
  try {
    const resp = await sendToGemini(txt, toneContext)
    const botMsgs = Array.from(document.querySelectorAll('.message.bot'))
    const last = botMsgs[botMsgs.length-1]
    if (last) last.textContent = resp
    else appendMessage(resp,'bot')
    await speakText(resp)
  } catch (err) {
    const botMsgs2 = Array.from(document.querySelectorAll('.message.bot'))
    const last2 = botMsgs2[botMsgs2.length-1]
    if (last2) last2.textContent = 'Oops: ' + (err.message || String(err))
    else appendMessage('Oops: ' + (err.message || String(err)),'bot')
    console.error(err)
  }
}

form.addEventListener('submit', async (e)=>{
  e.preventDefault()
  const txt = input.value.trim()
  if (!txt) return
  await handleUserText(txt)
})

if (generateQuotesBtn && quotesList) {
  generateQuotesBtn.addEventListener('click', async () => {
    generateQuotesBtn.disabled = true
    generateQuotesBtn.textContent = 'Generating...'
    quotesList.innerHTML = '<div class="quote-item">Generating 10 motivational quotes...</div>'

    try {
      const prompt = 'Generate exactly 10 short motivational quotes. Return plain text only, one quote per line, no intro and no closing.'
      const resp = await sendToGemini(prompt)
      const quotes = resp
        .split('\n')
        .map(q => q.replace(/^\s*\d+[\).\-\s]*/, '').trim())
        .filter(Boolean)
        .slice(0, 10)

      if (!quotes.length) throw new Error('No quotes returned')
      quotesList.innerHTML = quotes.map((q, i) => `<div class="quote-item">${i + 1}. ${q}</div>`).join('')

      generateQuotesBtn.style.display = 'none'
      for (const quote of quotes) {
        await speakText(quote, true, 0.6)
      }
    } catch (err) {
      quotesList.innerHTML = `<div class="quote-item">Oops: ${err.message || String(err)}</div>`
    } finally {
      generateQuotesBtn.disabled = false
      generateQuotesBtn.textContent = 'Generate 10 Quotes'
      generateQuotesBtn.style.display = ''
    }
  })
}

async function sendToGemini(userText, toneContext = ''){
  let lastErr = null

  for (const base of apiBases) {
    try {
      const res = await fetch(`${base}/api/gemini`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: userText, toneContext })
      })

      const raw = await res.text()
      let j = {}
      if (raw) {
        try {
          j = JSON.parse(raw)
        } catch {
          if (!res.ok) throw new Error(`Gemini request failed (${res.status}). ${raw.slice(0, 200)}`)
          throw new Error('Server returned invalid JSON from /api/gemini')
        }
      }

      if (!res.ok) throw new Error(j.error || `Failed to get response from Gemini (${res.status})`)
      if (!j.response) throw new Error('Gemini returned an empty response')
      return j.response
    } catch (err) {
      lastErr = err
    }
  }

  if (lastErr && String(lastErr.message || '').toLowerCase().includes('failed to fetch')) {
    throw new Error('Cannot reach backend. Start server with: npm start (on port 3000).')
  }
  throw lastErr || new Error('Unable to reach Gemini backend')
}

async function requestTts(text) {
  let lastErr = null

  for (const base of apiBases) {
    try {
      const res = await fetch(`${base}/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: selectedTtsVoice })
      })

      const raw = await res.text()
      let j = {}
      if (raw) {
        try {
          j = JSON.parse(raw)
        } catch {
          if (!res.ok) throw new Error(`TTS request failed (${res.status}). ${raw.slice(0, 200)}`)
          throw new Error('Server returned invalid JSON from /api/tts')
        }
      }

      if (!res.ok) throw new Error(j.error || `Text-to-speech failed (${res.status})`)
      if (!j.audio && !j.audioBase64) throw new Error('TTS returned empty audio')
      return j
    } catch (err) {
      lastErr = err
    }
  }

  throw lastErr || new Error('Unable to reach text-to-speech backend')
}

function base64ToBlobUrl(b64, mimeType='audio/mpeg') {
  const bin = atob(b64)
  const len = bin.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i)
  const blob = new Blob([bytes], { type: mimeType })
  return URL.createObjectURL(blob)
}

function cleanTextForSpeech(text) {
  return String(text || '')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, ' ')
    .replace(/[\u{2600}-\u{27BF}]/gu, ' ')
    .replace(/[^\S\r\n]+/g, ' ')
    .trim()
}

async function ensureVoicesReady() {
  if (!('speechSynthesis' in window)) return []
  let voices = window.speechSynthesis.getVoices() || []
  if (voices.length) return voices

  voices = await new Promise(resolve => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      window.speechSynthesis.removeEventListener('voiceschanged', onVoices)
      resolve(window.speechSynthesis.getVoices() || [])
    }
    const onVoices = () => finish()
    window.speechSynthesis.addEventListener('voiceschanged', onVoices)
    setTimeout(finish, 1000)
  })

  return voices
}

function pickFriendlyBrowserVoice() {
  if (!('speechSynthesis' in window)) return null
  const voices = window.speechSynthesis.getVoices() || []
  if (!voices.length) return null

  const preferredNames = [
    'Google UK English Female',
    'Microsoft Aria Online (Natural) - English (United States)',
    'Microsoft Jenny Online (Natural) - English (United States)',
    'Samantha',
    'Serena',
    'Samantha',
    'Ava',
    'Allison',
    'Karen',
    'Google US English',
    'Moira'
  ]

  for (const name of preferredNames) {
    const match = voices.find(v => v.name === name)
    if (match) return match
  }

  const englishVoices = voices.filter(v => /en[-_](US|CA|GB|AU|IN)/i.test(v.lang))
  if (!englishVoices.length) return voices[0]

  const friendlyHint = /(female|jenny|aria|samantha|ava|serena|allison|karen|zira)/i
  return englishVoices.find(v => friendlyHint.test(v.name)) || englishVoices[0]
}

async function speakText(text, waitUntilEnd = false, playbackRate = 1) {
  const speechText = cleanTextForSpeech(text)
  if (!speechText) return
  try {
    const tts = await requestTts(speechText)
    const src = tts.audioBase64
      ? base64ToBlobUrl(tts.audioBase64, tts.mimeType || 'audio/mpeg')
      : tts.audio

    if (currentTtsAudio) {
      currentTtsAudio.pause()
      currentTtsAudio = null
    }
    if (currentTtsUrl) {
      URL.revokeObjectURL(currentTtsUrl)
      currentTtsUrl = null
    }

    currentTtsAudio = new Audio(src)
    if (src.startsWith('blob:')) currentTtsUrl = src
    currentTtsAudio.playbackRate = playbackRate
    await currentTtsAudio.play()
    if (waitUntilEnd) {
      await new Promise((resolve, reject) => {
        currentTtsAudio.onended = resolve
        currentTtsAudio.onerror = () => reject(new Error('Audio playback failed'))
      })
    }
  } catch (err) {
    const msg = err?.message || String(err)
    appendMessage(`TTS unavailable (ElevenLabs): ${msg}`, 'bot')
    console.warn('ElevenLabs TTS failed:', msg)
    if (waitUntilEnd) throw err
  }
}

async function blobToBase64(blob) {
  const arr = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i])
  return btoa(binary)
}

async function transcribeWithElevenLabs(blob) {
  const audioBase64 = await blobToBase64(blob)
  let lastErr = null

  for (const base of apiBases) {
    try {
      const res = await fetch(`${base}/api/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioBase64,
          mimeType: blob.type || 'audio/webm'
        })
      })

      const raw = await res.text()
      let j = {}
      if (raw) {
        try {
          j = JSON.parse(raw)
        } catch {
          if (!res.ok) throw new Error(`Transcription request failed (${res.status}). ${raw.slice(0, 200)}`)
          throw new Error('Server returned invalid JSON from /api/transcribe')
        }
      }

      if (!res.ok) throw new Error(j.error || `Transcription failed (${res.status})`)
      if (!j.text) throw new Error('No speech detected')
      return { text: j.text, tone: j.tone || '' }
    } catch (err) {
      lastErr = err
    }
  }

  if (lastErr && String(lastErr.message || '').toLowerCase().includes('failed to fetch')) {
    throw new Error('Cannot reach backend. Start server with: npm start (on port 3000).')
  }
  throw lastErr || new Error('Unable to reach transcription backend')
}

// vc
if (voiceBtn) {
  voiceBtn.addEventListener('click', async () => {
    try {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop()
        voiceBtn.textContent = '🎤'
        voiceBtn.title = 'Voice Mode'
        voiceBtn.disabled = true
        return
      }

      micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      micChunks = []
      input.placeholder = 'Listening... click the mic again to stop.'

      mediaRecorder = new MediaRecorder(micStream)
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) micChunks.push(e.data)
      }

      mediaRecorder.onstop = async () => {
        try {
          input.placeholder = 'Transcribing...'
          const blob = new Blob(micChunks, { type: mediaRecorder.mimeType || 'audio/webm' })
          const transcript = await transcribeWithElevenLabs(blob)
          const text = String(transcript?.text || '').trim()
          if (!text) throw new Error('No speech detected')
          input.placeholder = 'Share what\'s on your mind...'
          await handleUserText(text, transcript?.tone || '')
        } catch (err) {
          appendMessage('Oops: ' + (err.message || String(err)), 'bot')
          console.error(err)
          input.placeholder = 'Share what\'s on your mind...'
        } finally {
          if (micStream) {
            micStream.getTracks().forEach(t => t.stop())
            micStream = null
          }
          micChunks = []
          voiceBtn.disabled = false
        }
      }

      mediaRecorder.start()
      voiceBtn.textContent = '⏹️'
      voiceBtn.title = 'Stop Recording'
    } catch (err) {
      appendMessage('Oops: ' + (err.message || String(err)), 'bot')
      console.error(err)
      if (micStream) {
        micStream.getTracks().forEach(t => t.stop())
        micStream = null
      }
      micChunks = []
      voiceBtn.textContent = '🎤'
      voiceBtn.title = 'Voice Mode'
      input.placeholder = 'Share what\'s on your mind...'
    }
  })
}

input.focus()
