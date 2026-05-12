import { Router } from 'express';
import { softAuth } from '../middleware/firebaseAuth.js';
import { callGemini, transcribeAudio } from '../services/llmRouter.js';
import { z } from 'zod';

export const voiceTriageRouter = Router();

const VoiceSchema = z.object({
  audioBase64:  z.string().min(1),
  mimeType:     z.string().default('audio/m4a'),
  language:     z.string().default('en'),
  durationSecs: z.number().int().min(0).max(90).default(0),
});

const TextSchema = z.object({
  text:     z.string().min(10).max(5000),
  language: z.string().default('en'),
});

// ── POST /v1/triage/voice ──────────────────────────────────────────────────────
voiceTriageRouter.post('/voice', softAuth, async (req, res, next) => {
  try {
    const parsed = VoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
    }
    const { audioBase64, mimeType, language, durationSecs } = parsed.data;

    // Step 1: Transcribe via Gemini
    const transcript = await transcribeAudio({ audioBase64, mimeType, language });

    // Step 2: Extract case file via Gemini
    const caseFile = await extractCaseFile(transcript);

    res.json({
      success: true,
      data: { caseFile, transcript, confidence: 0.92 }
    });
  } catch (err) { next(err); }
});

// ── POST /v1/triage/text ───────────────────────────────────────────────────────
voiceTriageRouter.post('/text', softAuth, async (req, res, next) => {
  try {
    const parsed = TextSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
    }

    const caseFile = await extractCaseFile(parsed.data.text);

    res.json({
      success: true,
      data: { caseFile, transcript: parsed.data.text, confidence: 1.0 }
    });
  } catch (err) { next(err); }
});

// ── Case extraction via Gemini ────────────────────────────────────────────────

async function extractCaseFile(text) {
  const now = Date.now();

  const prompt = `You are an expert Indian legal intake specialist.
Extract a structured case file from this citizen's description of their legal problem.
The person may be a farmer, tenant, accused, complainant, or property owner.

Indian legal context:
- Criminal cases: now governed by BNS (Bharatiya Nyaya Sanhita), BNSS (procedural), BSA (evidence)
- IPC/CrPC/IEA are superseded — map to BNS/BNSS/BSA equivalents
- Land/property: state land laws vary; flag which state if mentioned
- Urgency: arrest warrant, bail pending, or notice deadline = HIGH or CRITICAL

Description: "${text}"

Respond ONLY with this exact JSON — no markdown, no extra text:
{
  "id": "",
  "userId": "",
  "createdAt": ${now},
  "updatedAt": ${now},
  "domain": "CRIMINAL",
  "subDomain": "specific sub-type",
  "summary": "1-2 sentence plain-language summary",
  "rawInput": "${text.slice(0, 200).replace(/"/g, "'")}",
  "parties": {
    "complainant": "name if mentioned or empty string",
    "accused": "name if mentioned or empty string",
    "others": []
  },
  "keyFacts": ["fact 1", "fact 2"],
  "urgency": "NORMAL",
  "nextSteps": ["step 1", "step 2", "step 3"],
  "relevantSections": ["BNS S. X"],
  "status": "DRAFT"
}

For domain use exactly one of: CRIMINAL, LAND_PROPERTY, CIVIL, DIVORCE_FAMILY, CYBER, CONSUMER, LABOUR, TAX, UNKNOWN
For urgency use exactly one of: LOW, NORMAL, HIGH, CRITICAL`;

  const raw = await callGemini({ prompt });

  try {
    return JSON.parse(raw);
  } catch {
    const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(cleaned);
  }
}
