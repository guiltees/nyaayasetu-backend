import { Router } from 'express';
import { requireAuth } from '../middleware/firebaseAuth.js';
import { callClaude, twoModelGauntlet } from '../services/llmRouter.js';
import { z } from 'zod';

export const documentAuditRouter = Router();

const AuditSchema = z.object({
  documentBase64: z.string().min(1),
  mimeType:       z.string(),
  documentName:   z.string().default('document'),
  domain:         z.string().default(''),
});

// ── POST /v1/audit/document ────────────────────────────────────────────────────
documentAuditRouter.post('/document', requireAuth, async (req, res, next) => {
  try {
    const parsed = AuditSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
    }

    const { documentBase64, mimeType, documentName, domain } = parsed.data;

    // Two-model gauntlet: Claude drafts the audit, then audits itself
    const { draft, auditNotes } = await twoModelGauntlet({
      draftSystemPrompt: AUDIT_SYSTEM_PROMPT,
      draftUserPrompt: buildAuditUserPrompt(documentBase64, mimeType, documentName, domain),
      auditUserPromptFn: (draftAudit) => `Review this audit result for accuracy:\n${draftAudit}\n\nReturn JSON: { "issues": ["list any errors"], "approved": true }`,
    });

    let auditResult;
    try {
      const cleaned = draft.replace(/```json\n?|\n?```/g, '').trim();
      auditResult = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ success: false, error: { code: 'PARSE_ERROR', message: 'Could not parse audit result' } });
    }

    // Attach audit notes if the second model flagged anything
    try {
      const notes = JSON.parse(auditNotes.replace(/```json\n?|\n?```/g, '').trim());
      if (!notes.approved && notes.issues?.length > 0) {
        auditResult.suggestions = [...(auditResult.suggestions || []), ...notes.issues];
      }
    } catch { /* non-critical */ }

    res.json({
      success: true,
      data: {
        auditResult: { ...auditResult, documentName, auditedAt: Date.now() },
        caseFileId: null,
      }
    });
  } catch (err) { next(err); }
});

// ── Prompts ───────────────────────────────────────────────────────────────────

const AUDIT_SYSTEM_PROMPT = `You are a senior Indian advocate with 20+ years of experience.
Your speciality is auditing legal documents for errors, missing elements, and outdated citations.

Critical knowledge:
1. IPC is replaced by BNS (Bharatiya Nyaya Sanhita) 2023 — flag any IPC sections that should now reference BNS
2. CrPC is replaced by BNSS (Bharatiya Nagarik Suraksha Sanhita) 2023
3. Indian Evidence Act replaced by BSA (Bharatiya Sakshya Adhiniyam) 2023
4. Flag overruled judgments if you know they are overruled
5. All FIRs must include: complainant details, time/date/place, offence sections (BNS), signature
6. Bail applications must include: grounds, surety details, criminal antecedents, BNS/BNSS sections
7. Legal notices must include: cause of action, relief sought, time limit, sender details

Respond ONLY with a valid JSON object — no markdown, no explanation outside JSON.`;

function buildAuditUserPrompt(documentBase64, mimeType, documentName, domain) {
  const domainContext = domain ? `\nDocument domain: ${domain}` : '';
  return `Audit this legal document: "${documentName}"${domainContext}

Document (base64, ${mimeType}): [The document content is provided below]
Note: In production, pass the document bytes to Claude's vision API for OCR.
For this call, assume the document text has been pre-extracted and is: [DOCUMENT_TEXT_PLACEHOLDER]

Return this exact JSON:
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
      "location": "Page/section reference",
      "suggestion": "How to fix it"
    }
  ],
  "missingSections": ["List of required sections that are missing"],
  "wrongCitations": [
    {
      "cited": "What the document says",
      "correct": "What it should be",
      "reason": "Why it is wrong",
      "isMigrated": true
    }
  ],
  "correctSections": ["Correctly cited sections"],
  "suggestions": ["Overall improvement suggestions"]
}`;
}
