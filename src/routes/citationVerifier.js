import { Router } from 'express';
import { softAuth } from '../middleware/firebaseAuth.js';
import { callGemini } from '../services/llmRouter.js';
import { z } from 'zod';
import { deterministicCheck } from '../services/citationDb.js';

export const citationVerifierRouter = Router();

const SingleSchema = z.object({
  citation: z.string().min(1).max(500),
  context:  z.string().default(''),
});

const BulkSchema = z.object({
  citations: z.array(z.string()).min(1).max(50),
  context:   z.string().default(''),
});

// ── POST /v1/verify/citation ──────────────────────────────────────────────────
citationVerifierRouter.post('/citation', softAuth, async (req, res, next) => {
  try {
    const parsed = SingleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
    }

    const { citation, context } = parsed.data;

    // 1. Deterministic DB check first (fast, no LLM cost)
    const dbResult = deterministicCheck(citation);
    if (dbResult) {
      return res.json({ success: true, data: { ...dbResult, verifiedAt: Date.now() } });
    }

    // 2. Fallback: Claude for nuanced reasoning
    const result = await verifyCitationWithClaude(citation, context);
    res.json({ success: true, data: { ...result, verifiedAt: Date.now() } });
  } catch (err) { next(err); }
});

// ── POST /v1/verify/citations/bulk ────────────────────────────────────────────
citationVerifierRouter.post('/citations/bulk', softAuth, async (req, res, next) => {
  try {
    const parsed = BulkSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
    }

    const { citations, context } = parsed.data;

    // Run deterministic checks in parallel, fallback to Claude for unknown ones
    const results = await Promise.all(
      citations.map(async (citation) => {
        const dbResult = deterministicCheck(citation);
        if (dbResult) return { ...dbResult, verifiedAt: Date.now() };
        return verifyCitationWithClaude(citation, context);
      })
    );

    const issueCount = results.filter(r => r.status !== 'VALID').length;
    res.json({
      success: true,
      data: {
        results,
        summary: `Found ${issueCount} issue(s) across ${citations.length} citation(s).`,
      }
    });
  } catch (err) { next(err); }
});

// ── Claude citation verification ──────────────────────────────────────────────

async function verifyCitationWithClaude(citation, context) {
  const prompt = `You are an expert in Indian statutes, especially the new criminal law codes.

Key knowledge:
- IPC → superseded by BNS (Bharatiya Nyaya Sanhita) 2023
- CrPC → superseded by BNSS (Bharatiya Nagarik Suraksha Sanhita) 2023
- Indian Evidence Act → superseded by BSA (Bharatiya Sakshya Adhiniyam) 2023
- Flag IPC/CrPC/IEA citations as MIGRATED and give BNS/BNSS/BSA equivalent

Verify this citation: "${citation}"
${context ? `Context: ${context}` : ''}

Respond ONLY with this JSON — no markdown, no extra text:
{
  "input": "${citation}",
  "status": "VALID",
  "canonicalForm": "S. X BNS",
  "description": "What this section says in 1-2 sentences",
  "punishment": "Punishment if applicable or empty string",
  "bnsEquivalent": null,
  "bnssEquivalent": null,
  "ipcOrigin": null,
  "overruledBy": null,
  "overruledReason": null,
  "relatedSections": []
}

For status use exactly one of: VALID, INVALID, MIGRATED, OVERRULED, AMENDED, REPEALED, UNKNOWN`;

  const raw = await callGemini({ prompt });
  const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim();
  return JSON.parse(cleaned);
}
