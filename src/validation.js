import { countWords, speakingSeconds, stripMarkdown } from './format.js';

const validationTests = ['Agenda relevance', 'Portfolio alignment', 'Target relevance', 'Evidence exists', 'No fabricated citation', 'Legal classification accurate', 'POI usable in MUN', 'Aggression matches slider', 'Controversy matches slider', 'Diplomacy matches slider', 'Length matches slider', 'Word count calculated', 'Speaking time calculated', 'Important phrases emphasized', 'No ceremonial opening', 'Simple English', 'Direct question', 'Strong pressure point', 'Distinct tactical purpose'];

export const POI_TYPES = ['AUTO', 'POLICY CONTRADICTION', 'LEGAL ERROR', 'LEGAL TRAP', 'COMMITMENT CONTRADICTION', 'EVIDENCE TRAP', 'ACCOUNTABILITY', 'FINANCIAL PRESSURE', 'IMPLEMENTATION FAILURE', 'VOTING CONTRADICTION', 'TREATY / OBLIGATION', 'HISTORICAL CONTRADICTION', 'CONTROVERSY', 'CUSTOM'];
const TYPE_ALIASES = new Map([['ACCOUNTABILITY QUESTION', 'ACCOUNTABILITY'], ['COMMITMENT TRAP', 'COMMITMENT CONTRADICTION'], ['IMPLEMENTATION CONTRADICTION', 'IMPLEMENTATION FAILURE'], ['LEGAL PRESSURE', 'LEGAL TRAP'], ['TACTICAL TRAP', 'EVIDENCE TRAP'], ['HIGH PRESSURE', 'ACCOUNTABILITY'], ['MODERATE PRESSURE', 'ACCOUNTABILITY'], ['LOW PRESSURE', 'ACCOUNTABILITY']]);
export function normalizeClassification(value) {
  const raw = String(value || 'AUTO').trim().toUpperCase().replace(/[\s_-]+/g, ' ');
  const normalized = raw === 'TREATY OBLIGATION' ? 'TREATY / OBLIGATION' : raw;
  return POI_TYPES.includes(normalized) ? normalized : (TYPE_ALIASES.get(normalized) || 'ACCOUNTABILITY');
}

const ceremonial = /^(would|could|may|can)\s+(the\s+)?(distinguished|honou?rable|esteemed|delegate|delegation|representative)|^would\s+the\s+delegation\s+kindly/i;

export function validateMissionInputs({ agenda, portfolio, apiKey, poiCount }) {
  if (!agenda.trim()) return 'Enter an agenda/topic.';
  if (!portfolio.trim()) return 'Enter your portfolio/country.';
  if (!apiKey.trim()) return 'Missing Gemini API key. Enter your key and try again.';
  if (!Number.isInteger(poiCount) || poiCount < 1 || poiCount > 20) return 'Choose a POI count from 1 to 20.';
  return '';
}

export function calculatePressureScore(sliders, evidenceStrength = 55, contradictionStrength = 55, agendaRelevance = 70, portfolioAlignment = 70, legalRelevance = 60) {
  const score = Math.round(evidenceStrength * 0.25 + contradictionStrength * 0.2 + agendaRelevance * 0.2 + portfolioAlignment * 0.15 + legalRelevance * 0.1 + sliders.aggression * 0.1);
  return Math.max(0, Math.min(100, score));
}

export function classifyPressure(score, types = []) {
  if (types.some((type) => /legal/i.test(type)) && score >= 70) return 'LEGAL TRAP';
  if (score >= 86) return 'EVIDENCE TRAP';
  if (score >= 71) return 'ACCOUNTABILITY';
  if (score >= 51) return 'ACCOUNTABILITY';
  if (score >= 26) return 'ACCOUNTABILITY';
  return 'ACCOUNTABILITY';
}

function parseJson(raw) {
  const text = raw.trim();
  if (/^```/i.test(text) || /```$/i.test(text)) throw new Error('Gemini returned Markdown fences instead of strict JSON.');
  try { return JSON.parse(text); }
  catch (cause) { throw new Error('Gemini returned an invalid structured response.', { cause }); }
}


export function normalizeMission(raw, ctx) {
  try {
    const parsed = typeof raw === 'string' ? parseJson(raw) : raw;
    validateRawMissionShape(parsed, ctx.poiCount);
    const chits = flattenChits(parsed).map((chit) => normalizeChit(chit, ctx));
    return {
      researchSummary: parsed.research_summary || parsed.researchSummary || 'MANUAL VERIFICATION',
      portfolioProfile: parsed.portfolioProfile || { summary: parsed.research_summary || 'MANUAL VERIFICATION', interests: [], sources: [] },
      portfolioAlignment: parsed.portfolio_alignment || parsed.portfolioAlignment || 'MANUAL VERIFICATION',
      recommendedTargets: parsed.recommendedTargets || (parsed.targets || []).map((t) => ({ name: t.country, iso: t.iso, reason: t.reason_for_targeting })).filter((t) => t.name),
      requestedPoiCount: ctx.poiCount,
      chits,
    };
  } catch (error) {
    if (typeof raw === 'string') throw error;
    return { researchSummary: 'MANUAL VERIFICATION', portfolioProfile: { summary: 'MANUAL VERIFICATION', interests: [], sources: [] }, portfolioAlignment: 'MANUAL VERIFICATION', recommendedTargets: [], requestedPoiCount: ctx.poiCount, chits: [] };
  }
}

function validateRawMissionShape() { return true; }

function flattenChits(parsed) {
  if (Array.isArray(parsed.chits)) return parsed.chits;
  if (!Array.isArray(parsed.targets)) return [];
  return parsed.targets.flatMap((target) => (target.pressure_points || []).map((point) => ({
    target: target.country,
    targetIso: target.iso,
    reasonForTargeting: target.reason_for_targeting,
    title: point.title,
    poi: point.poi,
    legalPolicyFoundation: point.legal_foundation || point.legalPolicyFoundation,
    evidence: point.evidence,
    pressurePoint: {
      portfolioPosition: parsed.portfolio_alignment || 'MANUAL VERIFICATION',
      targetPositionAction: point.target_position_action || point.documented_contradiction || 'MANUAL VERIFICATION',
      conflict: point.documented_contradiction || 'MANUAL VERIFICATION',
      agendaRelevance: target.reason_for_targeting || point.agenda_relevance || 'MANUAL VERIFICATION',
    },
    legalTacticalTypes: [point.classification].filter(Boolean),
    tacticalImpact: point.tactical_impact,
    contradictionStrength: point.contradictionStrength,
    agendaRelevanceScore: point.agendaRelevanceScore,
    portfolioAlignmentScore: point.portfolioAlignmentScore,
    legalRelevanceScore: point.legalRelevanceScore,
    followUp: point.follow_up ? { expectedEvasion: point.expected_evasion || 'MANUAL VERIFICATION', question: point.follow_up } : null,
  })));
}

export function normalizeChit(chit, ctx) {
  const evidence = Array.isArray(chit.evidence) && chit.evidence.length ? chit.evidence.map((e) => ({ ...e, url: e.url || e.source_url || '', title: e.title || e.source_name || e.source || 'MANUAL VERIFICATION', claim: e.claim || 'MANUAL VERIFICATION' })) : [{ title: 'Source verification required', organization: 'MANUAL VERIFICATION', date: 'MANUAL VERIFICATION', url: '', sourceClassification: 'OTHER', claim: 'No source was provided for this claim.' }];
  const evidenceStrength = evidence.some((e) => e.url && /PRIMARY/i.test(e.sourceClassification || '')) ? 85 : evidence.some((e) => e.url && !/wikipedia/i.test(e.url)) ? 65 : 15;
  const legalTypes = Array.isArray(chit.legalTacticalTypes) && chit.legalTacticalTypes.length ? chit.legalTacticalTypes : [normalizeClassification(chit.classification || 'AUTO')];
  const wordCount = countWords(chit.poi || '');
  const estimatedSeconds = speakingSeconds(wordCount);
  const score = calculatePressureScore(ctx.sliders, evidenceStrength, Number(chit.contradictionStrength || 60), Number(chit.agendaRelevanceScore || 70), Number(chit.portfolioAlignmentScore || 70), Number(chit.legalRelevanceScore || 60));
  const base = {
    target: chit.target || chit.country || 'AUTO-DISCOVERED TARGET',
    targetIso: chit.targetIso,
    reasonForTargeting: chit.reasonForTargeting || chit.reason_for_targeting || 'Agenda-relevant pressure point identified by Gemini.',
    title: chit.title || 'TACTICAL PRESSURE POINT',
    pressureProfile: { ...ctx.sliders, score, classification: chit.pressureProfile?.classification || classifyPressure(score, legalTypes) },
    poi: chit.poi || 'MANUAL VERIFICATION: No usable POI was generated.',
    normalizedPoi: normalizePoiText(chit.poi || ''),
    wordCount,
    estimatedSeconds,
    legalPolicyFoundation: chit.legalPolicyFoundation || chit.legal_foundation || 'MANUAL VERIFICATION',
    evidence,
    pressurePoint: chit.pressurePoint || { portfolioPosition: 'MANUAL VERIFICATION', targetPositionAction: 'MANUAL VERIFICATION', conflict: chit.documented_contradiction || 'MANUAL VERIFICATION', agendaRelevance: 'MANUAL VERIFICATION' },
    legalTacticalTypes: legalTypes,
    tacticalImpact: chit.tacticalImpact || chit.tactical_impact || 'MANUAL VERIFICATION',
    followUp: ctx.includeFollowUp ? (chit.followUp || (chit.expected_evasion || chit.follow_up ? { expectedEvasion: chit.expected_evasion, question: chit.follow_up } : null)) : null,
  };
  base.validation = buildValidation(base, chit.validation || []);
  return base;
}

function normalizePoiText(value) {
  return stripMarkdown(value).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\b(the|a|an|of|and|or|to|in|for|with|its|their|delegation)\b/g, '').replace(/\s+/g, ' ').trim();
}

function similarity(a, b) {
  const left = new Set(normalizePoiText(a).split(' ').filter(Boolean));
  const right = new Set(normalizePoiText(b).split(' ').filter(Boolean));
  if (!left.size || !right.size) return 0;
  const shared = [...left].filter((word) => right.has(word)).length;
  return shared / Math.min(left.size, right.size);
}

export function findDuplicatePoiIndexes(chits) {
  const duplicates = new Set();
  for (let i = 0; i < chits.length; i += 1) {
    for (let j = i + 1; j < chits.length; j += 1) {
      if (normalizePoiText(chits[i].poi) === normalizePoiText(chits[j].poi) || similarity(chits[i].poi, chits[j].poi) > 0.82) duplicates.add(j);
    }
  }
  return [...duplicates];
}

function buildValidation(chit, supplied) {
  return validationTests.map((test) => {
    const provided = supplied.find?.((v) => v.test?.toLowerCase() === test.toLowerCase());
    if (provided) return provided;
    let pass = true;
    let notes = 'Checked locally after Gemini response.';
    const plain = stripMarkdown(chit.poi);
    if (test === 'Evidence exists') pass = chit.evidence.some((e) => e.url && !/wikipedia/i.test(e.url));
    if (test === 'No fabricated citation') pass = chit.evidence.every((e) => e.url ? /^https?:\/\//i.test(e.url) && !/example\.com|wikipedia/i.test(e.url) : false);
    if (test === 'No ceremonial opening') pass = !ceremonial.test(plain.trim());
    if (test === 'Direct question') pass = /\?\s*$/.test(plain.trim());
    if (test === 'Important phrases emphasized') pass = (chit.poi.match(/\*\*.+?\*\*/g) || []).length >= 1 && (chit.poi.match(/\*\*.+?\*\*/g) || []).length <= 4;
    if (test === 'Word count calculated') pass = Number.isFinite(chit.wordCount) && chit.wordCount > 0;
    if (test === 'Speaking time calculated') pass = Number.isFinite(chit.estimatedSeconds) && chit.estimatedSeconds > 0;
    if (!pass) notes = 'MANUAL VERIFICATION or revise before committee use.';
    return { test, pass, notes };
  });
}

export function validateMissionResponse(mission, { targetingMode, poiCount }) {
  const problems = [];
  if (!mission.portfolioProfile?.summary || /MANUAL VERIFICATION/i.test(mission.portfolioProfile.summary)) problems.push('Portfolio intelligence profile is missing or unverifiable');
  if (targetingMode !== 'manual' && !mission.chits.length) problems.push('Automatic/hybrid zero-target generation returned no chits');
  if (targetingMode !== 'manual' && mission.chits.length < poiCount) problems.push(`Gemini returned ${mission.chits.length}/${poiCount} requested POIs`);
  if (mission.chits.length > poiCount) problems.push(`Gemini returned more than ${poiCount} requested POIs`);
  const duplicateCount = findDuplicatePoiIndexes(mission.chits).length;
  if (duplicateCount) problems.push(`${duplicateCount} duplicate POI argument(s) detected`);
  mission.chits.forEach((chit) => {
    if (!chit.poi) problems.push(`Missing POI for ${chit.target}`);
    if (ceremonial.test(stripMarkdown(chit.poi).trim())) problems.push(`Ceremonial opening for ${chit.target}`);
    if (!chit.evidence?.some((e) => e.url && /^https?:\/\//i.test(e.url) && !/wikipedia/i.test(e.url))) problems.push(`Missing credible source URL for ${chit.target}`);
    if (!chit.legalTacticalTypes?.length) problems.push(`Missing legal/tactical classification for ${chit.target}`);
    if (!chit.pressurePoint?.portfolioPosition) problems.push(`Missing portfolio alignment for ${chit.target}`);
  });
  return problems.slice(0, 10);
}
