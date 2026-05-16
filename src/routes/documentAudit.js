import { Router } from 'express';
import { softAuth } from '../middleware/firebaseAuth.js';
import { callGemini, callGPT } from '../services/llmRouter.js';
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

    const supportsVision = ['image/jpeg', 'image/png', 'image/webp', 'image/heic',
                            'application/pdf'].includes(mimeType);

    // ── Step 1: Gemini reads the document (vision) and produces first audit ──
    const geminiPrompt = buildGeminiAuditPrompt(documentName, domain, !supportsVision);
    const geminiRaw = await callGemini({
      prompt:      geminiPrompt,
      imageBase64: supportsVision ? documentBase64 : null,
      mimeType:    supportsVision ? mimeType        : null,
    });

    let draft;
    try {
      const cleaned = geminiRaw.replace(/```json\n?|\n?```/g, '').trim();
      const s = cleaned.indexOf('{');
      const e = cleaned.lastIndexOf('}');
      draft = JSON.parse(cleaned.slice(s, e + 1));
    } catch {
      return res.status(500).json({
        success: false,
        error: { code: 'PARSE_ERROR', message: 'Gemini audit result could not be parsed' },
      });
    }

    // ── Step 2: GPT-4o reviews Gemini's audit for legal accuracy ────────────
    let auditResult = draft;
    try {
      const gptRaw = await callGPT({
        systemPrompt: GPT_REVIEW_SYSTEM,
        userPrompt:   buildGPTReviewPrompt(draft, documentName, domain),
        maxTokens:    2048,
      });

      const gptCleaned = gptRaw.replace(/```json\n?|\n?```/g, '').trim();
      const reviewed   = JSON.parse(gptCleaned);

      // Merge GPT corrections into the draft
      if (reviewed.correctedIssues?.length) {
        auditResult.issues = reviewed.correctedIssues;
      }
      if (reviewed.additionalMissingSections?.length) {
        auditResult.missingSections = [
          ...new Set([...(auditResult.missingSections || []), ...reviewed.additionalMissingSections])
        ];
      }
      if (reviewed.correctedCitations?.length) {
        auditResult.wrongCitations = [
          ...(auditResult.wrongCitations || []),
          ...reviewed.correctedCitations,
        ];
      }
      if (reviewed.additionalSuggestions?.length) {
        auditResult.suggestions = [
          ...new Set([...(auditResult.suggestions || []), ...reviewed.additionalSuggestions])
        ];
      }
      if (reviewed.overallSeverity) {
        // Escalate severity if GPT found it worse — never downgrade
        const order = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
        const current = order.indexOf(auditResult.overallSeverity);
        const proposed = order.indexOf(reviewed.overallSeverity);
        if (proposed > current) auditResult.overallSeverity = reviewed.overallSeverity;
      }
      auditResult.reviewedByGPT = true;
    } catch (err) {
      // GPT review is non-critical — return Gemini draft if GPT fails
      console.warn('GPT review failed, returning Gemini draft:', err.message);
      auditResult.reviewedByGPT = false;
    }

    res.json({
      success: true,
      data: {
        auditResult: { ...auditResult, documentName, auditedAt: Date.now() },
        caseFileId: null,
      },
    });
  } catch (err) { next(err); }
});

// ── Gemini prompt — reads the actual document ─────────────────────────────────

function buildGeminiAuditPrompt(documentName, domain, textOnly) {
  const domainLine = domain ? `\nDocument domain: ${domain}` : '';
  const docLine = textOnly
    ? `Perform a thorough audit of the document named "${documentName}" based on common Indian legal document standards.`
    : `Read and audit the attached legal document: "${documentName}". Extract all visible text, section numbers, citations, signatures, dates, and parties.`;

  return `${AUDIT_SYSTEM_CONTEXT}${domainLine}

${docLine}

Return ONLY a valid JSON object — no markdown, no text outside JSON:

{
  "documentId": "${Date.now()}",
  "documentType": "FIR|BAIL_APPLICATION|CHARGE_SHEET|PLAINT|WRITTEN_STATEMENT|LEGAL_NOTICE|SALE_DEED|LEASE_DEED|WILL|AFFIDAVIT|UNKNOWN",
  "overallSeverity": "LOW|MEDIUM|HIGH|CRITICAL",
  "summary": "3-4 sentences: what this document is, what it attempts to do, its main legal weaknesses, and overall quality.",
  "issues": [
    {
      "id": "issue_1",
      "severity": "LOW|MEDIUM|HIGH|CRITICAL",
      "title": "Specific issue title",
      "description": "Precise description of what is wrong and why it matters legally",
      "location": "Page number or specific section/paragraph reference",
      "suggestion": "Exact corrective action with section reference"
    }
  ],
  "missingSections": ["List every required section absent from this document type"],
  "wrongCitations": [
    {
      "cited": "Exact text found in document",
      "correct": "What it should say under current law",
      "reason": "Why this is wrong — e.g. IPC repealed, section renumbered, judgment overruled",
      "isMigrated": true
    }
  ],
  "correctSections": ["Sections cited correctly"],
  "suggestions": ["Specific improvement suggestions with legal basis"]
}`;
}

// ── GPT-4o review prompt — cross-checks Gemini's legal analysis ───────────────

const GPT_REVIEW_SYSTEM = `You are a senior Indian Supreme Court advocate and legal document specialist with expertise in BNS, BNSS, BSA, and all major Indian statutes. You are reviewing a first-pass AI audit of an Indian legal document.

Your job: find what the first AI missed, correct any wrong section numbers, and escalate severity if the issues are worse than rated.

India's current criminal codes (as of July 2024):
- BNS (Bharatiya Nyaya Sanhita) replaces IPC 1860
- BNSS (Bharatiya Nagarik Suraksha Sanhita) replaces CrPC 1973
- BSA (Bharatiya Sakshya Adhiniyam) replaces Indian Evidence Act 1872

Common IPC→BNS migrations: 302→103, 304→104, 323→115, 325→118, 376→64, 392→310, 406→316, 420→318, 441→329, 463→336.
Common CrPC→BNSS: S.154(FIR)→S.173, S.438(anticipatory bail)→S.482, S.439(bail)→S.480.

Return ONLY a valid JSON object:
{
  "correctedIssues": [ { "id": "issue_1", "severity": "...", "title": "...", "description": "...", "location": "...", "suggestion": "..." } ],
  "additionalMissingSections": ["sections the first audit missed"],
  "correctedCitations": [ { "cited": "...", "correct": "...", "reason": "...", "isMigrated": true } ],
  "additionalSuggestions": ["deeper legal suggestions"],
  "overallSeverity": "LOW|MEDIUM|HIGH|CRITICAL",
  "legalAccuracyNotes": "Brief note on what the first audit got right or wrong"
}`;

function buildGPTReviewPrompt(draft, documentName, domain) {
  return `Review this AI-generated audit of a ${domain || 'legal'} document named "${documentName}".

FIRST AUDIT RESULT:
${JSON.stringify(draft, null, 2)}

Check every section number, citation, and legal reference for accuracy under current Indian law (BNS/BNSS/BSA). Add anything the first audit missed. Correct any wrong section numbers. If severity should be higher, say so.`;
}

// ── Shared legal context ───────────────────────────────────────────────────────

const AUDIT_SYSTEM_CONTEXT = `You are a senior Indian advocate with 25 years of experience auditing legal documents for district courts and high courts.

MANDATORY CHECKS for every document:
1. IPC sections → must now cite BNS (e.g. IPC 302 should be BNS S.103)
2. CrPC sections → must cite BNSS (e.g. CrPC S.154 should be BNSS S.173)
3. Indian Evidence Act → must cite BSA
4. FIR requirements: complainant name+address, date/time/place of offence, BNS offence sections, signature, witness names
5. Bail applications: grounds (S.479/480 BNSS), surety details, prior criminal antecedents, personal bond amount
6. Legal notices: cause of action with dates, specific relief demanded, 15/30/60-day response window, sender's advocate details
7. Sale deeds: schedule of property with boundaries, consideration amount (words + figures), stamp duty endorsement, sub-registrar seal
8. Affidavits: deponent's full name+age+address, notary/oath commissioner seal, proper verification clause`;
