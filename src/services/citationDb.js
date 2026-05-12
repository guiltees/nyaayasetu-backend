/**
 * Deterministic citation database.
 *
 * Covers the most common IPC→BNS, CrPC→BNSS, IEA→BSA migrations.
 * Fast O(1) lookup — no LLM cost for known sections.
 * Extend this table from IndianKanoon data + official gazette.
 */

// ── IPC → BNS migration map ───────────────────────────────────────────────────
const IPC_TO_BNS = {
  // Offences against body
  '299': { bns: '100', description: 'Culpable homicide' },
  '300': { bns: '101', description: 'Murder' },
  '302': { bns: '103', description: 'Punishment for murder', punishment: 'Death or imprisonment for life, and fine' },
  '304': { bns: '105', description: 'Culpable homicide not amounting to murder' },
  '304A':{ bns: '106', description: 'Causing death by negligence', punishment: 'Imprisonment up to 5 years, or fine, or both' },
  '304B':{ bns: '80',  description: 'Dowry death', punishment: 'Imprisonment 7 years to life' },
  '307': { bns: '109', description: 'Attempt to murder' },
  '309': { bns: '226', description: 'Attempt to commit suicide — now treated as mental health issue' },
  '320': { bns: '114', description: 'Grievous hurt' },
  '323': { bns: '115', description: 'Voluntarily causing hurt', punishment: 'Imprisonment up to 1 year, or fine up to ₹10,000' },
  '324': { bns: '117', description: 'Voluntarily causing hurt by dangerous weapons' },
  '325': { bns: '116', description: 'Voluntarily causing grievous hurt' },
  '326': { bns: '118', description: 'Grievous hurt by dangerous weapons or means' },
  '354': { bns: '74',  description: 'Assault or criminal force on woman with intent to outrage modesty' },
  '354A':{ bns: '75',  description: 'Sexual harassment' },
  '375': { bns: '63',  description: 'Rape' },
  '376': { bns: '64',  description: 'Punishment for rape', punishment: 'Rigorous imprisonment not less than 10 years, extendable to life, and fine' },

  // Offences against property
  '378': { bns: '303', description: 'Theft' },
  '379': { bns: '303(2)', description: 'Punishment for theft', punishment: 'Imprisonment up to 3 years, or fine, or both' },
  '380': { bns: '305', description: 'Theft in dwelling house' },
  '390': { bns: '309', description: 'Robbery' },
  '395': { bns: '310', description: 'Dacoity', punishment: 'Rigorous imprisonment for life, or up to 10 years, and fine' },
  '406': { bns: '316', description: 'Criminal breach of trust', punishment: 'Imprisonment up to 3 years, or fine, or both' },
  '420': { bns: '318', description: 'Cheating and dishonestly inducing delivery of property', punishment: 'Imprisonment up to 7 years, and fine' },
  '447': { bns: '329', description: 'Punishment for criminal trespass', punishment: 'Imprisonment up to 3 months, or fine up to ₹5,000' },
  '448': { bns: '330', description: 'Punishment for house-trespass' },

  // Offences against public order
  '141': { bns: '189', description: 'Unlawful assembly' },
  '147': { bns: '191', description: 'Rioting', punishment: 'Imprisonment up to 2 years, or fine, or both' },
  '148': { bns: '191(2)', description: 'Rioting with deadly weapon' },
  '153A':{ bns: '196', description: 'Promoting enmity between classes' },

  // Other
  '120B':{ bns: '61',  description: 'Criminal conspiracy' },
  '34':  { bns: '3(5)', description: 'Acts done by several persons in furtherance of common intention' },
  '107': { bns: '45',  description: 'Abetment' },
  '511': { bns: '62',  description: 'Punishment for attempting to commit offences' },
};

// ── CrPC → BNSS migration map ─────────────────────────────────────────────────
const CRPC_TO_BNSS = {
  '41':  { bnss: '35',  description: 'When police may arrest without warrant' },
  '41A': { bnss: '35A', description: 'Notice of appearance before police officer' },
  '154': { bnss: '173', description: 'Information in cognizable cases (FIR)' },
  '161': { bnss: '180', description: 'Examination of witnesses by police' },
  '164': { bnss: '183', description: 'Recording of confessions and statements' },
  '173': { bnss: '193', description: 'Report of police officer on completion of investigation' },
  '190': { bnss: '210', description: 'Cognizance of offences by magistrates' },
  '204': { bnss: '227', description: 'Issue of process' },
  '227': { bnss: '250', description: 'Discharge' },
  '228': { bnss: '251', description: 'Framing of charge' },
  '313': { bnss: '351', description: 'Power to examine accused' },
  '374': { bnss: '415', description: 'Appeals from convictions' },
  '437': { bnss: '479', description: 'When bail may be taken in case of non-bailable offence' },
  '438': { bnss: '482', description: 'Direction for grant of bail to person apprehending arrest (anticipatory bail)' },
  '439': { bnss: '483', description: "High Court's and Court of Sessions' powers regarding bail" },
  '482': { bnss: '528', description: 'Inherent powers of High Court' },
};

// ── IEA → BSA migration map ───────────────────────────────────────────────────
const IEA_TO_BSA = {
  '45':  { bsa: '39',  description: 'Opinions of experts' },
  '65B': { bsa: '63',  description: 'Admissibility of electronic records' },
  '101': { bsa: '97',  description: 'Burden of proof' },
  '114': { bsa: '118', description: 'Court may presume existence of certain facts' },
};

// ── Known BNS sections (direct lookup) ───────────────────────────────────────
const BNS_DIRECT = {
  '103': { description: 'Murder', punishment: 'Death or imprisonment for life, and fine', ipcOrigin: '302' },
  '63':  { description: 'Rape', punishment: 'Rigorous imprisonment not less than 10 years to life, and fine', ipcOrigin: '375' },
  '64':  { description: 'Punishment for rape', ipcOrigin: '376' },
  '80':  { description: 'Dowry death', punishment: '7 years to life imprisonment', ipcOrigin: '304B' },
  '106': { description: 'Causing death by negligence', punishment: 'Up to 5 years and fine', ipcOrigin: '304A' },
  '318': { description: 'Cheating', punishment: 'Up to 7 years and fine', ipcOrigin: '420' },
  '303': { description: 'Theft', ipcOrigin: '378' },
  '316': { description: 'Criminal breach of trust', ipcOrigin: '406' },
};

// ── Normalisation helper ──────────────────────────────────────────────────────

function normaliseCitation(input) {
  // e.g. "Section 302 IPC" → { code: "IPC", section: "302" }
  // "S. 103 BNS" → { code: "BNS", section: "103" }
  // "IPC 302" → { code: "IPC", section: "302" }

  const clean = input.trim().toUpperCase()
    .replace(/SECTION|SEC\.|SEC\b/g, 'S.')
    .replace(/\s+/g, ' ');

  const patterns = [
    /S\.\s*(\d+[A-Z]?)\s+(IPC|BNS|CRPC|BNSS|IEA|BSA|POCSO)/,
    /(IPC|BNS|CRPC|BNSS|IEA|BSA|POCSO)\s+S\.\s*(\d+[A-Z]?)/,
    /(IPC|BNS|CRPC|BNSS|IEA|BSA|POCSO)\s+(\d+[A-Z]?)/,
    /(\d+[A-Z]?)\s+(IPC|BNS|CRPC|BNSS|IEA|BSA)/,
  ];

  for (const pattern of patterns) {
    const match = clean.match(pattern);
    if (match) {
      // Determine which group is the section number and which is the code
      const isCodeFirst = isNaN(match[1][0]);
      return {
        code: isCodeFirst ? match[1] : match[2],
        section: isCodeFirst ? match[2] : match[1],
      };
    }
  }
  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Deterministic check. Returns a CitationResult-shaped object or null if unknown.
 */
export function deterministicCheck(citation) {
  const parsed = normaliseCitation(citation);
  if (!parsed) return null;

  const { code, section } = parsed;

  if (code === 'IPC') {
    const mapping = IPC_TO_BNS[section];
    if (mapping) {
      return {
        input: citation,
        status: 'MIGRATED',
        canonicalForm: `S. ${section} IPC`,
        description: mapping.description,
        punishment: mapping.punishment || '',
        bnsEquivalent: `S. ${mapping.bns} BNS`,
        bnssEquivalent: null,
        ipcOrigin: null,
        overruledBy: null,
        overruledReason: null,
        relatedSections: [`S. ${mapping.bns} BNS`],
      };
    }
  }

  if (code === 'BNS') {
    const direct = BNS_DIRECT[section];
    if (direct) {
      return {
        input: citation,
        status: 'VALID',
        canonicalForm: `S. ${section} BNS`,
        description: direct.description,
        punishment: direct.punishment || '',
        bnsEquivalent: null,
        bnssEquivalent: null,
        ipcOrigin: direct.ipcOrigin ? `S. ${direct.ipcOrigin} IPC` : null,
        overruledBy: null,
        overruledReason: null,
        relatedSections: direct.ipcOrigin ? [`S. ${direct.ipcOrigin} IPC (superseded)`] : [],
      };
    }
  }

  if (code === 'CRPC') {
    const mapping = CRPC_TO_BNSS[section];
    if (mapping) {
      return {
        input: citation,
        status: 'MIGRATED',
        canonicalForm: `S. ${section} CrPC`,
        description: mapping.description,
        punishment: '',
        bnsEquivalent: null,
        bnssEquivalent: `S. ${mapping.bnss} BNSS`,
        ipcOrigin: null,
        overruledBy: null,
        overruledReason: null,
        relatedSections: [`S. ${mapping.bnss} BNSS`],
      };
    }
  }

  if (code === 'IEA') {
    const mapping = IEA_TO_BSA[section];
    if (mapping) {
      return {
        input: citation,
        status: 'MIGRATED',
        canonicalForm: `S. ${section} IEA`,
        description: mapping.description,
        punishment: '',
        bnsEquivalent: `S. ${mapping.bsa} BSA`,
        bnssEquivalent: null,
        ipcOrigin: null,
        overruledBy: null,
        overruledReason: null,
        relatedSections: [`S. ${mapping.bsa} BSA`],
      };
    }
  }

  // Not in our deterministic DB — hand off to Claude
  return null;
}
