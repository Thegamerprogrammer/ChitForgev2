import { countWords, speakingSeconds, stripMarkdown } from './format.js';
import { calculatePressureScore, classifyPressure, findDuplicatePoiIndexes, normalizeClassification } from './validation.js';
import { normalizeEvidenceSource } from './sourceValidation.js';

const QUESTION_FIELDS = ['poi', 'question', 'questionText', 'poiQuestion', 'text', 'chit', 'content'];
const TARGET_FIELDS = ['target', 'targetCountry', 'country', 'countryName', 'delegation'];
const LEGAL_FIELDS = ['legalFoundation', 'legalBasis', 'legal', 'legalFramework', 'legal_foundation'];
const EVIDENCE_FIELDS = ['evidence', 'sources', 'citations', 'references', 'evidenceSources'];
const ISSUE_FIELDS = ['documentedIssue', 'issue', 'contradiction', 'violation', 'problem', 'documented_contradiction'];
const TACTICAL_FIELDS = ['tacticalImpact', 'impact', 'pressurePoint', 'tacticalPressure', 'tactical_impact'];
const CLASS_FIELDS = ['classification', 'poiType', 'type', 'category', 'trapType'];
const CLASS_REASON_FIELDS = ['classificationReason', 'classification_reason', 'typeReason', 'categoryReason'];
const FOLLOW_FIELDS = ['followUp', 'followup', 'follow_up', 'followUpQuestion'];
const CONTAINER_FIELDS = ['pois', 'targets', 'chits', 'results', 'data', 'result', 'pressure_points'];

export function extractGeminiText(response) {
  if (typeof response === 'string') return response;
  if (!response) return '';
  if (typeof response.output_text === 'string') return response.output_text;
  if (typeof response.outputText === 'string') return response.outputText;
  if (typeof response.text === 'string') return response.text;
  if (typeof response.text === 'function') return response.text();
  const parts = response.candidates?.flatMap((c) => c.content?.parts || []) || response.response?.candidates?.flatMap((c) => c.content?.parts || []) || [];
  const text = parts.map((p) => p.text).filter(Boolean).join('\n').trim();
  return text || JSON.stringify(response);
}

function unfence(text) { return String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim(); }

export function extractJsonCandidate(raw) {
  const text = unfence(raw);
  try { JSON.parse(text); return text; } catch { /* balanced extraction */ }
  const starts = [...text].map((ch, i) => (ch === '{' || ch === '[' ? i : -1)).filter((i) => i >= 0);
  for (const start of starts) {
    const stack = []; let inString = false; let escaped = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') inString = false; continue; }
      if (ch === '"') { inString = true; continue; }
      if (ch === '{' || ch === '[') stack.push(ch);
      if (ch === '}' || ch === ']') {
        const open = stack.pop();
        if ((ch === '}' && open !== '{') || (ch === ']' && open !== '[')) break;
        if (!stack.length) {
          const candidate = text.slice(start, i + 1).replace(/,\s*([}\]])/g, '$1');
          try { JSON.parse(candidate); return candidate; } catch { break; }
        }
      }
    }
  }
  return '';
}

export function extractJson(raw) {
  if (typeof raw !== 'string') return raw;
  const candidate = extractJsonCandidate(raw);
  if (!candidate) throw new Error('Response received but no JSON object or array was detected.');
  return JSON.parse(candidate);
}

const firstField = (obj, fields) => fields.map((f) => obj?.[f]).find((v) => v !== undefined && v !== null && v !== '');
const asArray = (v) => Array.isArray(v) ? v : v ? [v] : [];

function normalizeEvidence(raw) {
  return asArray(raw).map((e) => typeof e === 'string'
    ? normalizeEvidenceSource({ claimSupported: `MANUAL VERIFICATION: ${e}` })
    : normalizeEvidenceSource(e));
}


function pushCandidate(out, obj, inheritedTarget) {
  const question = firstField(obj, QUESTION_FIELDS);
  if (!question || typeof question !== 'string') return;
  const target = firstField(obj, TARGET_FIELDS) || inheritedTarget || 'AUTO-DISCOVERED TARGET';
  out.push({ target, question, legalFoundation: firstField(obj, LEGAL_FIELDS) || 'MANUAL VERIFICATION', evidence: normalizeEvidence(firstField(obj, EVIDENCE_FIELDS)), documentedIssue: firstField(obj, ISSUE_FIELDS) || 'MANUAL VERIFICATION', classification: normalizeClassification(firstField(obj, CLASS_FIELDS) || 'AUTO'), tacticalImpact: firstField(obj, TACTICAL_FIELDS) || 'MANUAL VERIFICATION', followUp: firstField(obj, FOLLOW_FIELDS) ?? null, classificationReason: firstField(obj, CLASS_REASON_FIELDS) || 'MANUAL VERIFICATION: classification reason was not supplied.' });
}

export function findPoiCandidates(value, inheritedTarget = undefined, seen = new Set()) {
  const out = [];
  if (!value || typeof value !== 'object' || seen.has(value)) return out;
  seen.add(value);
  if (Array.isArray(value)) { value.forEach((item) => out.push(...findPoiCandidates(item, inheritedTarget, seen))); return out; }
  const target = firstField(value, TARGET_FIELDS) || inheritedTarget;
  pushCandidate(out, value, target);
  CONTAINER_FIELDS.forEach((field) => { if (value[field] !== undefined) out.push(...findPoiCandidates(value[field], target, seen)); });
  Object.entries(value).forEach(([field, child]) => { if (!CONTAINER_FIELDS.includes(field) && typeof child === 'object') out.push(...findPoiCandidates(child, target, seen)); });
  return out;
}

function plainTextCandidates(text) {
  return String(text || '').split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const m = line.match(/^(?:\d+[.)]\s*)?([A-Z][A-Za-z .'-]{1,45}|[A-Z]{2,3})\s+[—-]\s+(.+\?)\s*$/);
    return m ? { target: m[1].trim(), question: m[2].trim(), legalFoundation: 'MANUAL VERIFICATION', evidence: [], documentedIssue: 'MANUAL VERIFICATION', classification: 'ACCOUNTABILITY', classificationReason: 'Plain-text fallback did not include classification evidence.', tacticalImpact: 'MANUAL VERIFICATION', followUp: null } : null;
  }).filter(Boolean);
}

function classificationReason(type) {
  return type === 'AUTO' ? 'AUTO classification requested; ChitForge selected the strongest supported tactical type.' : `${type} selected because the POI structure and evidence support that tactical category.`;
}

function chooseClassification(candidate, ctx) {
  const selected = ctx.poiTypes || ['AUTO'];
  const normalizedCandidate = normalizeClassification(candidate.classification || 'AUTO');
  if (!selected.includes('AUTO') && selected.length === 1) return selected[0];
  if (!selected.includes('AUTO') && selected.includes(normalizedCandidate)) return normalizedCandidate;
  if (normalizedCandidate !== 'AUTO') return normalizedCandidate;
  const text = `${candidate.question || ''} ${candidate.legalFoundation || ''} ${candidate.documentedIssue || ''}`.toLowerCase();
  if (/treaty|article|charter|binding|obligation|legal framework/.test(text)) return 'LEGAL TRAP';
  if (/vote|voting|abstain|resolution/.test(text)) return 'VOTING CONTRADICTION';
  if (/debt|loan|imf|world bank|sanction|finance|tax/.test(text)) return 'FINANCIAL PRESSURE';
  if (/implement|implementation|failed to|gap/.test(text)) return 'IMPLEMENTATION FAILURE';
  if (/commit|pledge|promise|agreement/.test(text)) return 'COMMITMENT CONTRADICTION';
  if (/controvers|investigation|scandal|alleged/.test(text)) return 'CONTROVERSY';
  if ((candidate.evidence || []).length) return 'EVIDENCE TRAP';
  return classifyPressure(50);
}

function normalizePortfolioProfile(parsed) {
  const profile = parsed?.portfolioProfile || {};
  const sources = normalizeEvidence(profile.sources || parsed?.portfolioSources || []);
  return {
    summary: profile.summary || parsed?.research_summary || 'Portfolio intelligence pending sourced verification.',
    statements: (profile.statements || profile.officialPositions || []).map((item) => typeof item === 'string' ? { text: item, status: 'MANUAL VERIFICATION', sources } : { status: 'MANUAL VERIFICATION', sources, ...item }),
    interests: profile.interests || [],
    sources,
  };
}

export function normalizePoi(candidate, ctx, index) {
  const poiText = candidate.question || candidate.poi || '';
  const evidence = normalizeEvidence(candidate.evidence);
  const evidenceScore = evidence.some((e) => /^https?:\/\//i.test(e.url)) ? 70 : 20;
  const classification = chooseClassification(candidate, ctx);
  const pressureScore = calculatePressureScore(ctx.sliders, evidenceScore, 60, 70, 70, /legal|treaty|charter|resolution|obligation/i.test(candidate.legalFoundation) ? 70 : 45);
  const wordCount = countWords(poiText);
  return { id: `poi-${index + 1}`, target: candidate.target || 'AUTO-DISCOVERED TARGET', poi: poiText, legalFoundation: candidate.legalFoundation || 'MANUAL VERIFICATION', legalPolicyFoundation: candidate.legalFoundation || 'MANUAL VERIFICATION', evidence, documentedIssue: candidate.documentedIssue || 'MANUAL VERIFICATION', classification, tacticalImpact: candidate.tacticalImpact || 'MANUAL VERIFICATION', pressureScore, aggression: ctx.sliders.aggression, controversy: ctx.sliders.controversy, diplomacy: ctx.sliders.diplomacy, length: ctx.sliders.length, wordCount, estimatedSeconds: speakingSeconds(wordCount), estimatedLines: ctx.lengthInfo?.lines || '≈ 1 line', followUp: ctx.includeFollowUp ? candidate.followUp : null, factCheck: { status: 'PENDING', confidence: 0, claims: [], legalAssessment: { status: 'UNCERTAIN', reason: '' }, classificationAssessment: { status: 'UNCERTAIN', reason: '' } }, pressureProfile: { ...ctx.sliders, score: pressureScore, classification }, legalTacticalTypes: [classification], classificationReason: candidate.classificationReason || classificationReason(classification), pressurePoint: { portfolioPosition: 'MANUAL VERIFICATION', targetPositionAction: candidate.documentedIssue || 'MANUAL VERIFICATION', conflict: candidate.documentedIssue || 'MANUAL VERIFICATION', agendaRelevance: candidate.tacticalImpact || 'MANUAL VERIFICATION' } };
}

export function validatePoi(poi) { return !!stripMarkdown(poi?.poi || '').trim(); }

export function toInternalMission(raw, ctx, modelInfo = {}) {
  let parsed = null; let parseError = null;
  try { parsed = typeof raw === 'string' ? extractJson(raw) : raw; } catch (e) { parseError = e; }
  const rawCandidates = parsed ? findPoiCandidates(parsed) : plainTextCandidates(raw);
  const unique = [];
  rawCandidates.forEach((c) => { if (c.question && !unique.some((u) => stripMarkdown(u.question).toLowerCase() === stripMarkdown(c.question).toLowerCase())) unique.push(c); });
  const pois = unique.map((c, i) => normalizePoi(c, ctx, i)).filter(validatePoi);
  const groups = new Map();
  pois.forEach((poi) => { if (!groups.has(poi.target)) groups.set(poi.target, { country: poi.target, reasonForTargeting: 'Agenda-relevant pressure point identified by Gemini or parser recovery.', pois: [] }); groups.get(poi.target).pois.push(poi); });
  const mission = { metadata: { committee: ctx.form?.committee || 'Unspecified', agenda: ctx.form?.agenda || '', portfolio: ctx.form?.portfolio || '', targetMode: ctx.targetingMode, primaryModel: modelInfo.primaryModel || '', factCheckModel: modelInfo.factCheckModel || '' }, researchSummary: parsed?.research_summary || parsed?.researchSummary || 'Portfolio intelligence requires sourced verification.', portfolioProfile: normalizePortfolioProfile(parsed), portfolioAlignment: parsed?.portfolio_alignment || parsed?.portfolioAlignment || 'MANUAL VERIFICATION', recommendedTargets: parsed?.recommendedTargets || [], targets: [...groups.values()], diagnostics: { parseSucceeded: !!parsed, parseError: parseError?.message, candidatesFound: rawCandidates.length, normalizedPois: pois.length } };
  mission.chits = mission.targets.flatMap((t) => t.pois);
  return mission;
}

export function validateInternalMission(mission, { poiCount, includeFollowUp }) {
  const problems = [];
  const pois = mission?.chits || [];
  if (!mission?.metadata) problems.push('Missing metadata');
  if (!Array.isArray(mission?.targets)) problems.push('Missing targets');
  if (pois.length !== poiCount) problems.push(`Expected ${poiCount} POIs, received ${pois.length}`);
  pois.forEach((poi, index) => { if (!validatePoi(poi)) problems.push(`POI ${index + 1} missing question`); if (!includeFollowUp && poi.followUp) problems.push(`POI ${index + 1} included follow-up while disabled`); });
  findDuplicatePoiIndexes(pois).forEach((idx) => problems.push(`Duplicate POI argument detected at ${idx + 1}`));
  return problems.slice(0, 12);
}
