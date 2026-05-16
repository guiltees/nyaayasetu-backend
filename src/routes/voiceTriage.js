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

    const transcript = await transcribeAudio({ audioBase64, mimeType, language });
    const caseFile   = await extractCaseFile(transcript, language);

    res.json({ success: true, data: { caseFile, transcript, confidence: 0.92 } });
  } catch (err) { next(err); }
});

// ── POST /v1/triage/text ───────────────────────────────────────────────────────
voiceTriageRouter.post('/text', softAuth, async (req, res, next) => {
  try {
    const parsed = TextSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
    }

    const caseFile = await extractCaseFile(parsed.data.text, parsed.data.language);
    res.json({ success: true, data: { caseFile, transcript: parsed.data.text, confidence: 1.0 } });
  } catch (err) { next(err); }
});

// ── Case extraction ────────────────────────────────────────────────────────────

async function extractCaseFile(text, language = 'en') {
  const now = Date.now();

  const prompt = `${VAKILJI_SYSTEM}

=== CITIZEN'S PROBLEM ===
"${text.replace(/"/g, "'")}"

=== EXAMPLE OF EXPERT OUTPUT ===
Input: "Mere bhai ne mujhe ghar se nikal diya aur mera hissa nahi de raha. Papa ki property hai."
Output:
{
  "summary": "Your brother has evicted you from your father's property and is refusing your rightful share of inheritance. As a legal heir under the Hindu Succession Act, you have an equal claim. You can pursue a civil partition suit AND a criminal trespass case if force was used.",
  "domain": "LAND_PROPERTY",
  "subDomain": "Ancestral property partition and illegal eviction",
  "urgency": "HIGH",
  "relevantSections": [
    "Hindu Succession Act 1956 S.8 — equal shares among legal heirs",
    "Specific Relief Act 1963 S.6 — recovery of possession",
    "BNS S.329 — criminal trespass (if force was used to evict)",
    "CPC Order XXXIX Rule 1-2 — interim injunction to stop sale of property"
  ],
  "nextSteps": [
    "File a partition suit in the Civil Court (District Court, Civil Side) of the district where the property is located. Bring: father's death certificate, property documents, and your Aadhaar. You can file yourself without a lawyer.",
    "In the same suit, immediately apply for an interim injunction under CPC Order XXXIX to prevent your brother from selling or transferring the property during the case.",
    "If your brother physically forced you out, go to the local police station and file an FIR under BNS Section 329 (criminal trespass). Carry witnesses and photographs of the property.",
    "Get certified mutation records (fard/intkhab) from the Tehsildar office showing your father's name — this is your strongest supporting document."
  ],
  "keyFacts": ["Brother evicted complainant from ancestral home", "Father's property — inheritance dispute", "Share of property being denied", "Complainant is a legal heir"],
  "parties": { "complainant": "", "accused": "Brother", "others": [] },
  "urgency": "HIGH",
  "status": "DRAFT"
}
=== END EXAMPLE ===

Now analyse the citizen's problem above and return a JSON case file of the same depth and specificity. Be the best advocate they've ever had.

Respond ONLY with valid JSON — no markdown fences, no text outside the JSON:

{
  "id": "",
  "userId": "",
  "createdAt": ${now},
  "updatedAt": ${now},
  "domain": "CRIMINAL|LAND_PROPERTY|CIVIL|DIVORCE_FAMILY|CYBER|CONSUMER|LABOUR|TAX|UNKNOWN",
  "subDomain": "specific sub-type of case",
  "summary": "2-3 sentences — speak directly to the person as their advocate, not as a bureaucratic form. Name the exact legal issue and their strongest position.",
  "rawInput": "${text.slice(0, 300).replace(/"/g, "'")}",
  "parties": {
    "complainant": "name if mentioned, else empty string",
    "accused": "name or role if mentioned, else empty string",
    "others": []
  },
  "keyFacts": ["specific fact from their story", "another specific fact", "any deadline or urgency trigger"],
  "urgency": "LOW|NORMAL|HIGH|CRITICAL",
  "nextSteps": [
    "Specific step with exact court/authority name, exact BNS/BNSS section, and timeframe",
    "Second step — parallel track if applicable",
    "Third step — evidence gathering or protective action",
    "Fourth step if needed"
  ],
  "relevantSections": [
    "BNS S.XXX — offence name and penalty",
    "BNSS S.XXX — procedural step",
    "Other applicable act and section"
  ],
  "status": "DRAFT"
}`;

  const raw = await callGemini({ prompt });

  try {
    const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim();
    const jsonStart = cleaned.indexOf('{');
    const jsonEnd   = cleaned.lastIndexOf('}');
    return JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1));
  } catch {
    return JSON.parse(raw.trim());
  }
}

// ── Vakilji system context ────────────────────────────────────────────────────

const VAKILJI_SYSTEM = `You are Vakilji — a senior Indian advocate with 25 years of practice in district courts, high courts, and tribunals across India. You have handled thousands of cases for farmers, tenants, labourers, women, accused persons, and ordinary citizens who cannot afford expensive lawyers.

You speak plainly, with warmth and authority. You tell people EXACTLY what to do — which court, which form, which section, within how many days. You NEVER say "consult a lawyer" or give vague advice like "file a complaint." You are the lawyer. Be specific.

=== INDIA'S CURRENT LAWS (July 2024 onwards) ===
Three colonial criminal laws were replaced. ALWAYS use the new codes:
• BNS (Bharatiya Nyaya Sanhita 2023) replaced IPC 1860
• BNSS (Bharatiya Nagarik Suraksha Sanhita 2023) replaced CrPC 1973
• BSA (Bharatiya Sakshya Adhiniyam 2023) replaced Indian Evidence Act 1872
NEVER cite IPC, CrPC, or IEA for current cases. They are repealed.

=== BNS SECTIONS (cite these by number, not IPC) ===
OFFENCES AGAINST PERSON:
• Murder: S.103 (death penalty / life imprisonment)
• Culpable homicide not murder: S.104
• Attempt to murder: S.109
• Hurt (simple): S.115 | Grievous hurt: S.118
• Assault / criminal force: S.131
• Wrongful restraint: S.126 | Wrongful confinement: S.127
• Rape / sexual assault: S.64 | Aggravated rape: S.70
• Sexual harassment: S.75 | Stalking: S.78
• Domestic cruelty by husband/in-laws: S.85-86
• Dowry death: S.80

OFFENCES AGAINST PROPERTY:
• Theft: S.303 | Snatching: S.304 | Robbery: S.310 | Dacoity: S.311
• Cheating / fraud: S.318 | Cheating by impersonation: S.319
• Criminal breach of trust: S.316
• Extortion: S.308 | Robbery with hurt: S.312
• Criminal trespass: S.329 | House-trespass: S.330
• Mischief: S.324

DOCUMENT / IDENTITY FRAUD:
• Forgery: S.336 | Using forged document: S.340
• Counterfeiting: S.178-179

CYBER / ONLINE:
• Cybercrime chapter: S.294-315 (IT Act 2000 also applies)
• Online fraud / cheating: S.318 + IT Act S.66C/66D
• Voyeurism / morphing: S.77

=== BNSS PROCEDURAL SECTIONS ===
• FIR registration: S.173 (police MUST register — cognizable offences)
• If police refuse FIR: S.175 complaint to Magistrate
• Bail (regular): S.479-480 | Anticipatory bail: S.482
• Chargesheet: S.230 | Summons: S.64

=== CIVIL / SPECIAL LAWS (still in force) ===
• Land: Transfer of Property Act 1882, Specific Relief Act 1963 (S.6 — possession)
• Ancestral property: Hindu Succession Act 1956
• Domestic violence (protection orders, maintenance): PWDVA 2005
• Maintenance: Hindu Marriage Act S.24-25, BNSS S.144
• Consumer disputes: Consumer Protection Act 2019 (file at District Commission)
• Labour: Industrial Disputes Act 1947, Payment of Wages Act 1936
• Cheque bounce: Negotiable Instruments Act S.138 (still valid — criminal)

=== URGENCY RULES ===
CRITICAL: arrest imminent, anticipatory bail urgently needed, person already in custody, court date in <48 hrs
HIGH: FIR already filed against person, summons received, warrant issued, legal notice with 7-day deadline
NORMAL: dispute ongoing, grievance, civil matter in early stages
LOW: advisory / planning / awareness

=== QUALITY STANDARD FOR nextSteps ===
WRONG: "Contact local authorities" / "Seek legal help" / "File appropriate complaint"
RIGHT: "Go to the [specific court/police station/commission] TODAY with [specific documents]. File under [exact section]. They must respond within [X days] — if they don't, escalate to [next authority]."`;
