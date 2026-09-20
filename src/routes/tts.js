/**
 * src/routes/tts.js
 * POST /api/tts  → audio for "Listen" button
 *
 * Strategy:
 *  1. If ELEVENLABS_API_KEY is set → use ElevenLabs (custom voice)
 *  2. Else return { useBrowser: true } so the client falls back to
 *     Web Speech API (free, works offline-ish, Swahili support varies)
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');

// Simple in-memory audio cache by text hash (avoid re-billing TTS)
const audioCache = new Map();
const AUDIO_TTL_MS = 24 * 60 * 60 * 1000;
const AUDIO_MAX = 80;

function textHash(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex').slice(0, 24);
}

function pruneAudio() {
  const now = Date.now();
  for (const [k, v] of audioCache) {
    if (now - v.ts > AUDIO_TTL_MS) audioCache.delete(k);
  }
  while (audioCache.size > AUDIO_MAX) {
    const first = audioCache.keys().next().value;
    audioCache.delete(first);
  }
}

router.post('/tts', async (req, res) => {
  const { text, voiceId, lang } = req.body || {};
  if (!text || typeof text !== 'string' || text.trim().length < 1) {
    return res.status(400).json({ error: 'Field "text" is required.' });
  }

  const clean = text.trim().slice(0, 4000);
  const key = textHash(clean + '|' + (voiceId || '') + '|' + (lang || ''));
  pruneAudio();

  if (audioCache.has(key)) {
    const hit = audioCache.get(key);
    res.setHeader('Content-Type', hit.contentType);
    res.setHeader('X-SKONGA-TTS-Cache', 'HIT');
    return res.send(hit.buffer);
  }

  const elevenKey = process.env.ELEVENLABS_API_KEY || '';
  const elevenVoice = voiceId || process.env.ELEVENLABS_VOICE_ID || '';

  if (!elevenKey) {
    // Client should use Web Speech API
    return res.status(200).json({
      useBrowser: true,
      reason: 'No cloud TTS key configured. Use browser speechSynthesis.',
      lang: lang || 'sw-TZ',
    });
  }

  try {
    const voice = elevenVoice || '21m00Tcm4TlvDq8ikWAM'; // default Rachel if unset
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voice}`;
    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': elevenKey,
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: clean,
        model_id: process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2',
        voice_settings: { stability: 0.45, similarity_boost: 0.75 },
      }),
    });

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => '');
      console.error('[TTS] ElevenLabs error', upstream.status, errText.slice(0, 200));
      return res.status(502).json({
        useBrowser: true,
        error: `TTS provider error (${upstream.status})`,
      });
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    audioCache.set(key, { buffer: buf, contentType: 'audio/mpeg', ts: Date.now() });
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('X-SKONGA-TTS-Cache', 'MISS');
    return res.send(buf);
  } catch (err) {
    console.error('[TTS]', err.message);
    return res.status(200).json({
      useBrowser: true,
      error: err.message || 'TTS failed',
      lang: lang || 'sw-TZ',
    });
  }
});

module.exports = router;
