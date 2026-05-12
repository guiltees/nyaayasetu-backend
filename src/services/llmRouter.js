/**
 * LLM Router — routes jobs to the right model.
 *
 * Routing table:
 *   LEGAL_REASONING, DOCUMENT_AUDIT   → Claude (Anthropic) — best at legal nuance
 *   FORMAL_DRAFTING                    → GPT-4o (OpenAI)    — best at structured legal prose
 *   VOICE_TRANSCRIPTION, CLASSIFICATION→ Gemini Flash        — fast & cheap, multilingual
 *
 * Two-model gauntlet for critical outputs:
 *   Claude drafts → Claude audits → deterministic citation verifier checks every cite
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Lazy clients — only instantiated when a route actually calls them.
// This lets the server boot without all keys present during development.
let _anthropic = null;
let _openai    = null;
let _genAI     = null;

function getAnthropic() {
  if (!_anthropic) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropic;
}

function getOpenAI() {
  if (!_openai) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set — OpenAI routes are disabled');
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

function getGenAI() {
  if (!_genAI) {
    if (!process.env.GOOGLE_AI_API_KEY) throw new Error('GOOGLE_AI_API_KEY is not set');
    _genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
  }
  return _genAI;
}

export const JobType = {
  VOICE_TRIAGE:      'VOICE_TRIAGE',
  TEXT_TRIAGE:       'TEXT_TRIAGE',
  DOCUMENT_AUDIT:    'DOCUMENT_AUDIT',
  CITATION_VERIFY:   'CITATION_VERIFY',
  FORMAL_DRAFTING:   'FORMAL_DRAFTING',
  CLASSIFICATION:    'CLASSIFICATION',
};

// ── Claude (legal reasoning) ──────────────────────────────────────────────────

export async function callClaude({ systemPrompt, userPrompt, maxTokens = 4096 }) {
  const message = await getAnthropic().messages.create({
    model: 'claude-opus-4-6',
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });
  return message.content[0]?.text ?? '';
}

// ── GPT-4o (formal drafting) ──────────────────────────────────────────────────

export async function callGPT({ systemPrompt, userPrompt, maxTokens = 4096 }) {
  const completion = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
    response_format: { type: 'json_object' },
  });
  return completion.choices[0]?.message?.content ?? '';
}

// ── Gemini Flash (voice/classification/Hindi) ──────────────────────────────────

export async function callGemini({ prompt, imageBase64 = null, mimeType = null }) {
  const model = getGenAI().getGenerativeModel({ model: 'gemini-2.5-flash' });

  const parts = [{ text: prompt }];
  if (imageBase64 && mimeType) {
    parts.unshift({ inlineData: { data: imageBase64, mimeType } });
  }

  const result = await model.generateContent({ contents: [{ role: 'user', parts }] });
  return result.response.text();
}

/**
 * Transcribe audio via Gemini (supports Hindi/regional).
 * @param {string} audioBase64  — base64 encoded audio
 * @param {string} mimeType     — e.g. "audio/m4a"
 * @param {string} language     — "en" | "hi" | "auto"
 */
export async function transcribeAudio({ audioBase64, mimeType, language = 'auto' }) {
  const model = getGenAI().getGenerativeModel({ model: 'gemini-2.5-flash' });

  const langHint = language === 'hi'
    ? 'The audio is in Hindi. Transcribe in Hindi Devanagari, then provide an English translation.'
    : language === 'auto'
    ? 'Auto-detect the language. If Hindi, provide both Devanagari and English translation.'
    : 'Transcribe the audio in English.';

  const prompt = `Transcribe this legal problem audio recording accurately. ${langHint} Return only the transcription text.`;

  const result = await model.generateContent({
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { data: audioBase64, mimeType } },
        { text: prompt }
      ]
    }]
  });

  return result.response.text();
}

// ── Two-model gauntlet ────────────────────────────────────────────────────────

/**
 * For critical outputs: Claude drafts, Claude audits its own output.
 * Returns { draft, auditNotes, final }.
 */
export async function twoModelGauntlet({ draftSystemPrompt, draftUserPrompt, auditUserPromptFn }) {
  const draft = await callClaude({ systemPrompt: draftSystemPrompt, userPrompt: draftUserPrompt });
  const auditPrompt = auditUserPromptFn(draft);
  const auditResult = await callClaude({
    systemPrompt: AUDIT_SYSTEM_PROMPT,
    userPrompt: auditPrompt,
    maxTokens: 1024,
  });
  return { draft, auditNotes: auditResult };
}

const AUDIT_SYSTEM_PROMPT = `You are a senior Indian legal expert reviewing AI-generated legal analysis.
Check for: incorrect section numbers, wrong citations, outdated IPC sections that should be BNS,
overruled case law, missing mandatory sections, and factual errors.
Return a JSON: { "issues": [...], "approved": true/false }`;
