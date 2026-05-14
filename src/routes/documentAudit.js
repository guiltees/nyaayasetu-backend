import { Router } from 'express';
import { softAuth } from '../middleware/firebaseAuth.js';
import { callGemini } from '../services/llmRouter.js';
import { z } from 'zod';

export const documentAuditRouter = Router();

const AuditSchema = z.object({
  documentBase64: z.string().min(1),
  mimeType:       z.string(),
  documentName:   z.string().default('document'),
  domain:         z.string().default(''),
});

// ── POST /v1/audit/document ────────────────────────────────────────────────────
documentAuditRouter.post('/document', softAuth, async (req, res, next) => {
  try {
    const parsed = AuditSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      });
    }

    const { documentBase64, mimeType, documentName, domain } = parsed.data;

    // Gemini vision can read images (jpg/png) and PDFs directly.
    // For audio/m4a or unsupported types, fall back to text-only prompt.
    const supportsVision = ['image/jpeg', 'image/png', 'image/webp', 'image/heic',
                            'application/pdf'].includes(mimeType);

    const prompt = buildAuditPrompt(documentName, domain, !supportsVision);

    const raw = await callGemini({
      prompt,
      imageBase64: supportsVision ? documentBase64 : null,
      mimeType:    supportsVision ? mimeType        : null,
    });

    let auditResult;
    try {
      const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim();
      // Find JSON object in case model adds preamble text
      const jsonStart = cleaned.indexOf('{');
      const jsonEnd   = cleaned.lastIndexOf('}');
      auditResult = JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1));
    } catch {
      return res.status(500).json({
        success: false,
        error: { code: 'PARSE_ERROR', message: 'Could not parse audit result from model' },
      });
    }

    res.json({
      success: true,
      data: {
        auditResult: {
          ...auditResult,
          documentName,
          auditedAt: Date.now(),
        },
        caseFileId: null,
      },
    });
  } catch (err) { next(err); }
});

// ── Prompts ────────────────────────────────────────────────────────────────────

function buildAuditPrompt(documentName, domain, textOnly) {
  const domainLine = domain ? `\nDocument domain: ${domain}` : '';
  const docLine = textOnly
    ? `\nNote: Document image unavailable — perform a general audit based on document name: "${documentName}".`
    : `\nAnalyse the attached document image/PDF: "${documentName}".`;

  return `You are a senior Indian advocate with 20+ years of experience auditing legal documents.

Critical knowledge:
1. IPC is replaced by BNS (Bharatiya Nyaya Sanhita) 2023 — flag IPC sections that should now cite BNS
2. CrPC is replaced by BNSS (Bharatiya Nagarik Suraksha Sanhita) 2023
3. Indian Evidence Act replaced by BSA (Bharatiya Sakshya Adhiniyam) 2023
4. Flag overruled judgments if known
5. FIRs must include: complainant details, time/date/place, BNS offence sections, signature
6. Bail applications must include: grounds, surety details, criminal antecedents, BNS/BNSS sections
7. Legal notices must include: cause of action, relief sought, time limit, sender details${domainLine}${docLine}

Return ONLY a valid JSON object — no markdown fences, no explanation outside JSON:

{
  "documentId": "${Date.now()}",
  "documentType": "FIR|BAIL_APPLICATION|CHARGE_SHEET|PLAINT|WRITTEN_STATEMENT|LEGAL_NOTICE|SALE_DEED|LEASE_DEED|WILL|AFFIDAVIT|UNKNOWN",
  "overallSeverity": "LOW|MEDIUM|HIGH|CRITICAL",
  "summary": "2-3 sentence overall assessment",
  "issues": [
    {
      "id": "issue_1",
      "severity": "LOW|MEDIUM|HIGH|CRITICAL",
      "title": "Issue title",
      "description": "Detailed description",
      "location": "Page or section reference",
      "suggestion": "How to fix it"
    }
  ],
  "missingSections": ["Required sections that are absent"],
  "wrongCitations": [
    {
      "cited": "What the document says",
      "correct": "What it should say",
      "reason": "Why it is wrong",
      "isMigrated": true
    }
  ],
  "correctSections": ["Correctly cited sections"],
  "suggestions": ["Overall improvement suggestions"]
}`;
}
