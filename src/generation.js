import { callGemini, callFactCheck, repairJsonWithGemini, GeminiError, CHITFORGE_RESPONSE_SCHEMA, FOLLOW_UP_RESPONSE_SCHEMA } from './gemini.js';
import { findDuplicatePoiIndexes } from './validation.js';
import { toInternalMission, validateInternalMission, extractJson } from './responseParser.js';
import { applyFactCheckToSources, validateSources } from './sourceValidation.js';

export async function generateMission({ form, sliders, portfolioCountry, oppositionCountries = [], targetingMode, includeFollowUp, poiCount, poisPerCountry = 0, generateOppositionPois = true, poiTypes = ['AUTO'], customPoiType = '', researchConfig = {}, onProgress, modelSelection }) {
  const missionConfig = buildMissionConfig({ form, sliders, portfolioCountry, oppositionCountries, targetingMode, includeFollowUp, poiCount, poisPerCountry, generateOppositionPois, poiTypes, customPoiType, researchConfig });
  const prompt = buildMissionPrompt(missionConfig);
  const requestedPoiCount = missionConfig.requestedPoiCount;
  onProgress?.({ stage: 'INITIALIZING', detail: 'Initializing ChitForge synthesis engine.', done: 0, total: requestedPoiCount });
  onProgress?.({ stage: 'READING AGENDA', detail: 'Reading committee, agenda and portfolio inputs.', done: 0, total: requestedPoiCount });
  onProgress?.({ stage: 'BACKGROUND GUIDE ANALYSIS', detail: missionConfig.researchConfig?.backgroundGuide ? `Using compact guide context from ${missionConfig.researchConfig.backgroundGuide.name}.` : 'No background guide attached; continuing without guide context.', done: 0, total: requestedPoiCount });
  onProgress?.({ stage: 'PORTFOLIO INTELLIGENCE', detail: 'Analyzing portfolio foreign-policy interests.', done: 0, total: requestedPoiCount });
  onProgress?.({ stage: 'TARGET INTELLIGENCE', detail: 'Mapping foreign-policy alignment and constraints.', done: 0, total: requestedPoiCount });
  onProgress?.({ stage: 'RESEARCH PLANNING', detail: 'Mapping selected and global target opportunities.', done: 0, total: requestedPoiCount });
  onProgress?.({ stage: 'RESEARCHING EVIDENCE', detail: 'Requesting traceable source-backed evidence.', done: 0, total: requestedPoiCount });
  onProgress?.({ stage: 'ANALYZING LEGAL FRAMEWORKS', detail: 'Separating legal obligations from political commitments.', done: 0, total: requestedPoiCount });
  let response = await callGemini(form.apiKey, prompt, { ...modelSelection, schema: CHITFORGE_RESPONSE_SCHEMA, operation: researchConfig.researchAiEnabled === false ? 'generation' : 'research', onModelStatus: (status) => onProgress?.({ stage: 'RESEARCH PLANNING', detail: `Using ${status.model.displayName} for ${status.mode}.`, done: 0, total: requestedPoiCount }) });
  let text = response.text;
  let mission = await recoverMission({ apiKey: form.apiKey, text, ctx: { form, sliders, includeFollowUp, poiCount: requestedPoiCount, targetingMode, poiTypes: missionConfig.effectivePoiTypes, lengthInfo: lengthInfo(sliders.length) }, modelSelection, modelInfo: { primaryModel: response.model.displayName } });
  const duplicates = findDuplicatePoiIndexes(mission.chits);
  if (duplicates.length) {
    onProgress?.({ stage: 'GENERATING POIs', detail: `Replacing ${duplicates.length} duplicate POI(s)...`, done: mission.chits.length - duplicates.length, total: requestedPoiCount });
    mission = await replaceDuplicatePois({ form, sliders, includeFollowUp, mission, duplicates, poiCount: requestedPoiCount, modelSelection });
  }
  const missing = Math.max(0, requestedPoiCount - mission.chits.length);
  if (missing) {
    onProgress?.({ stage: 'GENERATING POIs', detail: `Gemini returned ${mission.chits.length}/${poiCount}. Attempting ${missing} missing POI(s)...`, done: mission.chits.length, total: requestedPoiCount });
    mission = await generateMissingPois({ form, sliders, selectedTargets: missionConfig.generationScope, targetingMode, includeFollowUp, mission, missing, poiCount: requestedPoiCount, poiTypes: missionConfig.effectivePoiTypes, modelSelection, missionConfig });
  }
  onProgress?.({ stage: 'VALIDATING STRUCTURE', detail: `${mission.chits.length}/${requestedPoiCount} usable POIs normalized. Validating source structures...`, done: mission.chits.length, total: requestedPoiCount });
  { const validated = [];
  for (const poi of mission.chits || []) validated.push({ ...poi, evidence: await validateSources(poi.evidence || []) });
  mission.chits = validated; }
  onProgress?.({ stage: 'CALCULATING PRESSURE', detail: 'Calculating local pressure, word count, line and speaking-time metrics.', done: mission.chits.length, total: requestedPoiCount });
  mission = await runFactChecks({ mission, form, missionConfig, apiKey: form.apiKey, primaryModel: response.model, modelSelection, onProgress });
  return { ...mission, missionConfig, modelInfo: { model: response.model, factCheckModel: mission.metadata.factCheckModel, mode: response.mode, fallbackLog: response.fallbackLog } };
}

export async function regenerateChit({ form, sliders, chit, existingChits, apiKey, includeFollowUp, onProgress, modelSelection }) {
  onProgress?.({ stage: 'GENERATING POIs', detail: `Regenerating POI for ${chit.target}...`, done: 0, total: 1 });
  const prompt = `Return STRICT JSON only, no markdown fences. Regenerate exactly 1 distinct ChitForge POI to replace the weak POI below. Use the same agenda, portfolio, target, slider profile, evidence standards, simple English, no ceremonial opening, and Markdown bold emphasis. Do not duplicate these existing POIs: ${JSON.stringify(existingChits.map((item) => item.poi))}.\nAGENDA: ${form.agenda}\nPORTFOLIO: ${form.portfolio}\nTARGET: ${chit.target}\nSLIDERS: ${JSON.stringify(sliders)}\nFOLLOW-UP: ${includeFollowUp ? 'GENERATE' : 'DO NOT GENERATE'}\nOLD CHIT: ${JSON.stringify(chit)}\nReturn schema {"research_summary":"...","portfolio_alignment":"...","targets":[{"country":"${chit.target}","pressure_points":[{"poi":"...","legal_foundation":"...","evidence":[{"claim":"...","source_name":"...","source_url":"..."}],"documented_contradiction":"...","tactical_impact":"...","classification":"...","follow_up":${includeFollowUp ? '"..."' : 'null'}}]}]}`;
  const response = await callGemini(apiKey, prompt, { ...modelSelection, schema: CHITFORGE_RESPONSE_SCHEMA, operation: 'generation' });
  const text = response.text;
  const mission = await recoverMission({ apiKey, text, ctx: { form, sliders, includeFollowUp, poiCount: 1, targetingMode: 'regenerate', lengthInfo: lengthInfo(sliders.length) }, modelSelection, modelInfo: { primaryModel: response.model.displayName } });
  return mission.chits[0] || chit;
}

export async function generateFollowUp({ form, sliders, chit, apiKey, onProgress, modelSelection }) {
  onProgress?.({ stage: 'GENERATING FOLLOW-UP', detail: `Generating optional follow-up for ${chit.target}...`, done: 0, total: 1 });
  const prompt = `Return STRICT JSON only, no markdown fences. Generate an optional follow-up for this MUN POI.\nAGENDA: ${form.agenda}\nPORTFOLIO: ${form.portfolio}\nSLIDERS: ${JSON.stringify(sliders)}\nEXISTING CHIT: ${JSON.stringify(chit)}\nReturn {"expectedEvasion":"...","question":"..."}. The follow-up must be short, direct, evidence-based, and must return to the original pressure point. Do not introduce unrelated issues, ceremonial openings, or new unsupported sources.`;
  const response = await callGemini(apiKey, prompt, { ...modelSelection, schema: FOLLOW_UP_RESPONSE_SCHEMA, operation: 'generation' });
  const text = response.text;
  try {
    const parsed = extractJson(text);
    return { ...chit, followUp: { expectedEvasion: parsed.expectedEvasion || 'MANUAL VERIFICATION', question: parsed.question || 'What evidence addresses the original contradiction directly?' } };
  } catch (cause) {
    throw new GeminiError('Invalid JSON returned by Gemini while generating the follow-up. Try again.', { category: 'invalid-json', cause });
  }
}


async function recoverMission({ apiKey, text, ctx, modelSelection, modelInfo }) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const mission = toInternalMission(text, ctx, modelInfo);
      const usable = mission.chits.length;
      if (usable > 0 || ctx.poiCount === 0) return mission;
      const problems = validateInternalMission(mission, { poiCount: ctx.poiCount, includeFollowUp: ctx.includeFollowUp });
      if (attempt === 2) throw new GeminiError(`Normalization failure: parsed=${mission.diagnostics?.parseSucceeded}; candidates=${mission.diagnostics?.candidatesFound}; normalized=${usable}; requested=${ctx.poiCount}. ${problems.slice(0, 3).join('; ')}`, { category: 'normalization', rawText: text });
      const repair = await repairJsonWithGemini(apiKey, text, { modelSelection, schema: CHITFORGE_RESPONSE_SCHEMA });
      text = repair.text;
    } catch (err) {
      if (attempt === 2) {
        if (err instanceof GeminiError) throw err;
        throw new GeminiError('Gemini returned usable content requiring normalization, but ChitForge could not safely recover it.', { category: 'format-recovery-failed', cause: err, rawText: text });
      }
      const repair = await repairJsonWithGemini(apiKey, text, { modelSelection, schema: CHITFORGE_RESPONSE_SCHEMA });
      text = repair.text;
    }
  }
  throw new GeminiError("Gemini returned a response that did not match ChitForge's required format.", { category: 'schema-failure' });
}

function buildFactCheckPrompt({ form, missionConfig, poi, pass }) {
  const instruction = pass === 1 ? `You are ChitForge's factual verification engine. Independently verify every factual claim. Do not rewrite the POI. Classify each claim as verified, partially_verified, disputed, unverified, or false. Check dates, statistics, policies, resolutions, treaties, legal claims, institutional actions, financial claims and source relevance. Do not assume that a source proves a claim merely because it is listed.` : `Independently verify the factual and legal claims. Do not rely on another model's conclusion. Identify unsupported, exaggerated, misleading or incorrectly classified claims. Pay particular attention to legal terminology. Do not classify something as a legal violation unless the evidence actually supports that conclusion.`;
  return `${instruction}
Return ONLY valid JSON with overallStatus (VERIFIED|MANUAL_VERIFICATION|FAILED), confidence 0-100, claims[], legalAssessment, and classificationAssessment. Check whether each source actually supports its mapped claim and whether the POI classification is evidence-driven. Return PASS/REVISE/REJECT/NEEDS_EVIDENCE reasoning through source existence, evidence support, legal applicability/binding status, target attribution, agenda relevance, portfolio relevance, Freeze Date validity, allegation-vs-finding distinction, no fabricated URLs, and whether the POI forces defense of a documented record.
AGENDA: ${form.agenda}
PORTFOLIO: ${form.portfolio}
MISSION CONFIG: ${JSON.stringify({ freezeDate: missionConfig?.researchConfig?.freezeDate || '', portfolioCountry: missionConfig?.portfolioCountry, oppositionCountries: missionConfig?.oppositionCountries, targetingMode: missionConfig?.targetingMode, researchAiEnabled: missionConfig?.researchConfig?.researchAiEnabled, extensiveLegalities: missionConfig?.researchConfig?.extensiveLegalities })}
TARGET: ${poi.target}
POI: ${poi.poi}
LEGAL FOUNDATION: ${poi.legalFoundation}
CLASSIFICATION: ${poi.classification}
CLASSIFICATION REASON: ${poi.classificationReason}
EVIDENCE: ${JSON.stringify(poi.evidence)}
DOCUMENTED ISSUE: ${poi.documentedIssue}`;
}

function normalizeFactCheck(parsed) {
  const rawStatus = String(parsed.overallStatus || '').toUpperCase().replace(/_/g, ' ');
  const status = ['VERIFIED', 'MANUAL VERIFICATION', 'FAILED'].includes(rawStatus) ? rawStatus : 'MANUAL VERIFICATION';
  return { overallStatus: status, confidence: Number(parsed.confidence || 0), claims: Array.isArray(parsed.claims) ? parsed.claims.map((claim) => ({ ...claim, status: String(claim.status || 'UNVERIFIED').toUpperCase().replace(/ /g, '_') })) : [], legalAssessment: parsed.legalAssessment || { status: 'UNCERTAIN', reason: 'No legal assessment returned.' }, classificationAssessment: parsed.classificationAssessment || { status: 'UNCERTAIN', reason: 'No classification assessment returned.' } };
}

function combineFactChecks(first, second) {
  if (first.overallStatus === 'FAILED' && second.overallStatus === 'FAILED') return { status: 'FAILED', confidence: Math.round((first.confidence + second.confidence) / 2), claims: [...first.claims, ...second.claims], legalAssessment: first.legalAssessment, classificationAssessment: first.classificationAssessment };
  if (first.overallStatus === second.overallStatus && first.overallStatus === 'VERIFIED') return { status: 'VERIFIED', confidence: Math.round((first.confidence + second.confidence) / 2), claims: [...first.claims, ...second.claims], legalAssessment: first.legalAssessment, classificationAssessment: first.classificationAssessment };
  return { status: 'MANUAL VERIFICATION', confidence: Math.round((first.confidence + second.confidence) / 2), claims: [...first.claims, ...second.claims], legalAssessment: first.legalAssessment, classificationAssessment: first.classificationAssessment };
}

async function runFactChecks({ mission, form, missionConfig, apiKey, primaryModel, modelSelection, onProgress }) {
  const updated = []; let factCheckModel = '';
  for (let i = 0; i < mission.chits.length; i += 1) {
    const poi = mission.chits[i];
    onProgress?.({ stage: 'FACT CHECK PASS 1', detail: `Fact-check pass 1 for POI ${i + 1}/${mission.chits.length}.`, done: i, total: mission.chits.length });
    try {
      const first = await callFactCheck(apiKey, buildFactCheckPrompt({ form, missionConfig, poi, pass: 1 }), { primaryModelId: primaryModel.id, modelSelection });
      onProgress?.({ stage: 'FACT CHECK PASS 2', detail: `Fact-check pass 2 for POI ${i + 1}/${mission.chits.length}.`, done: i, total: mission.chits.length });
      const second = await callFactCheck(apiKey, buildFactCheckPrompt({ form, missionConfig, poi, pass: 2 }), { primaryModelId: primaryModel.id, modelSelection });
      factCheckModel = second.model.displayName;
      { const combined = combineFactChecks(normalizeFactCheck(extractJson(first.text)), normalizeFactCheck(extractJson(second.text))); updated.push({ ...poi, factCheck: combined, evidence: applyFactCheckToSources(poi.evidence || [], combined) }); }
    } catch {
      updated.push({ ...poi, factCheck: { status: 'MANUAL VERIFICATION', confidence: 0, claims: [], legalAssessment: { status: 'UNCERTAIN', reason: 'Fact-check unavailable; verify evidence manually.' }, classificationAssessment: { status: 'UNCERTAIN', reason: 'Classification could not be independently verified.' } } });
    }
  }
  mission.chits = updated;
  mission.targets = mission.targets.map((target) => ({ ...target, pois: updated.filter((poi) => poi.target === target.country) }));
  onProgress?.({ stage: 'FINALIZING CHITS', detail: 'Final verification states calculated and chits finalized.', done: mission.chits.length, total: mission.chits.length });
  mission.metadata.factCheckModel = factCheckModel || 'Unavailable';
  return mission;
}

function band(value, bands) { return bands.find(([max]) => value <= max)?.[1] || bands.at(-1)[1]; }
export function lengthInfo(length) { return band(length, [[10, { lines: '≈ 1 line', words: 'approximately 8–15 words', min: 8, max: 15 }], [25, { lines: '≈ 1–2 lines', words: 'approximately 15–25 words', min: 15, max: 25 }], [40, { lines: '≈ 2 lines', words: 'approximately 20–35 words', min: 20, max: 35 }], [55, { lines: '≈ 2–3 lines', words: 'approximately 30–45 words', min: 30, max: 45 }], [70, { lines: '≈ 3 lines', words: 'approximately 40–55 words', min: 40, max: 55 }], [85, { lines: '≈ 3–4 lines', words: 'approximately 50–70 words', min: 50, max: 70 }], [100, { lines: '≈ 4–5 lines', words: 'approximately 65–90 words', min: 65, max: 90 }]]); }
function aggressionInstruction(value) { return band(value, [[10, 'Use a calm, neutral question with minimal confrontation.'], [30, 'Use a mild challenge that asks for a clear policy explanation.'], [50, 'Use a firm challenge and clearly expose the relevant disagreement.'], [70, 'Use strong direct wording and pressure; ask how the delegation can justify the contradiction.'], [85, 'Use very aggressive but MUN-usable wording. Lead into the contradiction and give little room for vague answers.'], [100, 'Use maximum directness. Lead with the strongest verified contradiction, remove unnecessary diplomatic cushioning, end with a direct challenge, and do not soften the wording. Do not use insults or unsupported accusations.']]); }
function controversyInstruction(value) { return band(value, [[10, 'Use a normal policy disagreement only.'], [30, 'Use a minor documented inconsistency if available.'], [50, 'Use a clear policy contradiction tied to the agenda.'], [70, 'Use a serious documented contradiction, commitment gap, vote, dispute, or implementation failure.'], [85, 'Prioritize major verified controversies, commitment failures, policy-practice gaps, legal disputes, or financial inconsistencies.'], [100, 'Search for the strongest relevant VERIFIED pressure point available: broken commitments, conflicting statements, voting contradictions, legal disputes, implementation failures, or financial inconsistencies. Never manufacture or exaggerate controversy.']]); }
function diplomacyInstruction(value) { return band(value, [[10, 'Use blunt, direct wording. Do not add diplomatic cushioning.'], [30, 'Use very direct MUN wording with minimal restraint.'], [50, 'Use normal MUN language with moderate diplomatic restraint.'], [70, 'Use formal language while preserving pressure.'], [85, 'Use highly diplomatic polish without weakening the challenge.'], [100, 'Use maximum diplomatic polish, but preserve the same substantive pressure and direct question. High diplomacy does not reduce pressure.']]); }
export function buildMissionConfig({ form, sliders, portfolioCountry, oppositionCountries = [], targetingMode, includeFollowUp, poiCount, poisPerCountry = 0, generateOppositionPois = true, poiTypes = ['AUTO'], customPoiType = '', researchConfig = {} }) {
  const portfolio = portfolioCountry || (form.portfolio ? { name: form.portfolio, iso: '' } : null);
  const opposition = oppositionCountries || [];
  const generationScope = targetingMode === 'general'
    ? [portfolio, ...(generateOppositionPois ? opposition : [])].filter(Boolean)
    : (generateOppositionPois ? opposition : []);
  const perCountryCount = Math.max(0, Number(poisPerCountry) || 0);
  const totalCount = Math.max(1, Number(poiCount) || 1);
  const requestedPoiCount = totalCount + (perCountryCount * generationScope.length);
  const effectivePoiTypes = poiTypes.includes('CUSTOM') && customPoiType.trim()
    ? [...poiTypes.filter((type) => type !== 'CUSTOM'), `CUSTOM: ${customPoiType.trim()}`]
    : poiTypes;
  return { form, sliders, portfolioCountry: portfolio, oppositionCountries: opposition, targetingMode, includeFollowUp, poiCount: totalCount, poisPerCountry: perCountryCount, generateOppositionPois, generationScope, requestedPoiCount, poiTypes, customPoiType: customPoiType.trim(), effectivePoiTypes, researchConfig };
}

export function buildMissionPrompt(config) {
  const { form, sliders, portfolioCountry, oppositionCountries, targetingMode, includeFollowUp, poiCount, poisPerCountry, generateOppositionPois, generationScope, requestedPoiCount, effectivePoiTypes, customPoiType, researchConfig = {} } = config;
  const manualTargets = oppositionCountries.map((c) => `${c.name} (${c.iso})`).join(', ') || 'NONE';
  const scope = generationScope.map((c) => `${c.name}${c.iso ? ` (${c.iso})` : ''}`).join(', ') || 'GLOBAL V0 DISCOVERY';
  const info = lengthInfo(sliders.length);
  const guide = researchConfig.backgroundGuide?.text ? `BACKGROUND GUIDE ANALYZED ONCE (${researchConfig.backgroundGuide.name}):\n${researchConfig.backgroundGuide.text}` : 'NONE';
  const links = String(researchConfig.researchLinks || '').split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
  return `COMMITTEE:
${form.committee || 'Unspecified'}

AGENDA:
${form.agenda}

PORTFOLIO COUNTRY:
${portfolioCountry?.name || form.portfolio}${portfolioCountry?.iso ? ` (${portfolioCountry.iso})` : ''}

OPPOSITION COUNTRIES:
${manualTargets}

GENERATION TARGET MODE:
${targetingMode === 'opposition_only' ? 'SELECTED OPPOSITION COUNTRIES — dedicated POIs only for opposition countries when opposition-country POIs are enabled.' : targetingMode === 'opposition_agenda' ? 'SELECTED COUNTRIES + AGENDA — dedicated POIs for opposition countries with agenda relevance mandatory when opposition-country POIs are enabled.' : 'GENERAL — preserve V0 global portfolio/agenda discovery; opposition countries are contextual unless opposition-country POIs are enabled.'}

OPPOSITION-COUNTRY POIs:
${generateOppositionPois ? 'ENABLED — include selected opposition countries as explicit generation targets.' : 'DISABLED — use opposition countries for context/research only; do not automatically assign dedicated POIs to them.'}

COUNTRY-SPECIFIC GENERATION SCOPE:
${scope}

TOTAL POIs:
${poiCount}

POIs PER COUNTRY:
${poisPerCountry}

REQUESTED OUTPUT COUNT:
${requestedPoiCount}
This equals Total POIs plus POIs per Country for each country in the generation scope. These settings are independent and must not overwrite each other.

RESEARCH AI:
${researchConfig.researchAiEnabled === false ? 'OFF — use built-in generic extensive research strategy from portfolio, agenda, opposition context, guide, freeze date, sliders and POI type. Do not output generic filler.' : 'ON — perform portfolio-aware, country-centric research planning before generation.'}

RESEARCH NOTES (instructions, not facts):
${researchConfig.researchNotes?.trim() || 'NONE'}

RESEARCH LINKS (anchors, not trusted evidence until inspected):
${links.join('\n') || 'NONE'}

BACKGROUND GUIDE CONTEXT:
${guide}

FREEZE DATE:
${researchConfig.freezeDate || 'NONE'}

EXTENSIVE LEGALITIES:
${researchConfig.extensiveLegalities ? 'ON — increase genuine legal depth where applicable; include multiple relevant frameworks/provisions only when tied to the incident.' : 'OFF — include the strongest directly relevant legal/policy framework only where genuinely applicable.'}

AGGRESSION:
${sliders.aggression}/100

CONTROVERSY:
${sliders.controversy}/100

DIPLOMACY:
${sliders.diplomacy}/100

LENGTH:
${sliders.length}/100

TARGET WORD RANGE:
${info.words}

TARGET DISPLAY LENGTH:
${info.lines}

FOLLOW-UPS:
${includeFollowUp ? 'ON' : 'OFF'}

POI TYPE INSTRUCTIONS:
${effectivePoiTypes.join(', ')}
${customPoiType ? `CUSTOM POI TYPE MUST BE FOLLOWED: ${customPoiType}` : ''}

You are ChitForge V2, a precision MUN intelligence and POI system evolved from the stable V0 foundation. Your central rule: make the opposing delegation defend a documented record, not a generic accusation.

MANDATORY REAL PIPELINE: prepare mission inputs → analyze Background Guide once if provided → Portfolio Intelligence Profile → Target Intelligence Profiles for each selected opposition country → country-centric Research Packets → Evidence Packet → Verified Pressure Points → Pinpointed POIs → Review AI verification. Do not skip from agenda to generic POI.

Portfolio-first requirement: first establish the portfolio country's foreign policy, stated agenda position, regional interests, alliances/partnerships, diplomatic constraints, commitments, voting patterns where relevant, and what it can credibly criticize without contradicting itself. Do not hardcode geopolitical assumptions.

Opposition-country intelligence: for each selected opposition country, research foreign policy, doctrine, agenda-relevant actions, contradictions, incidents, controversies, malpractice, legal disputes, treaty obligations, voting records, implementation failures, diplomatic inconsistencies, likely defenses, and weaknesses relevant to the portfolio country.

Research must be country/evidence-centric, not POI-centric. Build reusable evidence pools and derive many POIs from each packet. Do not perform a separate imagined research mission per POI.

SLIDER PIPELINE: sliders influence research priority, pressure-point ranking and framing; sliders never change facts, dates, legal status, treaty status, attribution, statistics or evidence. Aggression controls how hard verified evidence is used. ${aggressionInstruction(sliders.aggression)}

Controversy controls research depth and political discomfort: low values prioritize current policy disagreements; high values prioritize historical incidents, controversies, voting contradictions, institutional criticism and accountability gaps only when documented. ${controversyInstruction(sliders.controversy)}

Diplomacy controls attribution and principle-based framing, not filler. Never add ceremonial openings or empty politeness. ${diplomacyInstruction(sliders.diplomacy)}

Length controls actual word count. Stay approximately within ${info.words} and ${info.lines}. Longer means more verified reasoning, not filler.

Pinpointed POI structure: one factual hook + one source/evidence anchor + one relevant legal/policy framework where supported + one contradiction/accountability issue + one sharp direct question.

Freeze Date reasoning: if a freeze date is provided, assess event/incident/action/vote/treaty date, publication date, and temporal scope separately. A later publication can document a pre-freeze event; a post-freeze event is invalid; if uncertain mark DATE UNCERTAIN. Do not use publication date alone.

Legal engine: identify the instrument/principle, applicability, binding status, obligation, conduct, evidence and classification (BINDING VIOLATION, POSSIBLE VIOLATION, LEGAL CONCERN, POLICY CONTRADICTION, POLITICAL COMMITMENT CONTRADICTION, NO CONTRADICTION, INSUFFICIENT EVIDENCE). Never make UNGA resolutions automatically binding. Never upgrade alleged/criticized into found/violated.

Support doctrine traps only when both the stated principle and conflicting action/vote/support are documented: force the target to distinguish its principle from its record.

Do not fabricate allegations, violations, statistics, resolutions, treaties, quotations, sources, URLs, scandals or government positions. Do not output fake URLs or search-engine result URLs as sources.

Every factual statement must be supported by a real source where possible. If a claim cannot be verified, mark it MANUAL VERIFICATION instead of inventing evidence. Source objects should include sourceName, organization, publicationDate, url, claimSupported, sourceType, confidence, eventDate when known, evidenceExcerpt when safe, freezeAssessment when relevant.

Use authoritative legal sources where relevant: UN Charter, UNSC resolutions, UNGA resolutions with non-binding status unless independently binding through another route, treaties, court judgments, official government sources, IMF/World Bank/WTO/OECD documents, regional frameworks and official court records.

Generate exactly ${requestedPoiCount} distinct POIs. No duplicates. Respect target scope and country-specific quantity semantics.

If FOLLOW-UPS is OFF, set followUp to null for every POI. If ON, generate one concise follow-up that anticipates an evasive answer and presses the same issue from another angle.

Return ONLY valid JSON, no markdown fences, no comments, no trailing commas.

Required JSON shape:
{"portfolioProfile":{"summary":"...","interests":["..."],"statements":[{"text":"...","status":"MANUAL VERIFICATION","sources":[]}]},"recommendedTargets":[],"pois":[{"target":"","question":"","legalFoundation":"include binding/non-binding/applicability status","evidence":[{"sourceName":"","organization":"","publicationDate":"","eventDate":"","url":"","claimSupported":"","evidenceExcerpt":"","freezeAssessment":"","sourceType":"PRIMARY","confidence":0}],"documentedIssue":"specific event/action/date/actor plus contradiction, portfolio relevance, agenda relevance, likely defense, freeze assessment","classification":"DOCTRINE TRAP or VOTING CONTRADICTION or LEGAL CONCERN or other evidence-backed type","classificationReason":"why this exact pressure point is supported","tacticalImpact":"how it forces defense of the documented record","followUp":null}]}`;
}

async function generateMissingPois({ form, sliders, selectedTargets, targetingMode, includeFollowUp, mission, missing, poiCount, poiTypes = ['AUTO'], modelSelection, missionConfig }) {
  const prompt = buildMissionPrompt({ ...(missionConfig || buildMissionConfig({ form, sliders, oppositionCountries: selectedTargets, targetingMode, includeFollowUp, poiCount: missing, poiTypes })), poiCount: missing, requestedPoiCount: missing }) + `\n\nAlready generated POIs to avoid duplicating: ${JSON.stringify(mission.chits.map((chit) => chit.poi))}. Generate exactly ${missing} additional distinct replacement POI chits only.`;
  const response = await callGemini(form.apiKey, prompt, { ...modelSelection, schema: CHITFORGE_RESPONSE_SCHEMA, operation: 'generation' });
  const text = response.text;
  const extra = await recoverMission({ apiKey: form.apiKey, text, ctx: { form, sliders, includeFollowUp, poiCount: missing, targetingMode, poiTypes, lengthInfo: lengthInfo(sliders.length) }, modelSelection, modelInfo: { primaryModel: response.model.displayName } });
  return { ...mission, chits: [...mission.chits, ...extra.chits].slice(0, poiCount), recommendedTargets: [...(mission.recommendedTargets || []), ...(extra.recommendedTargets || [])] };
}

async function replaceDuplicatePois({ form, sliders, includeFollowUp, mission, duplicates, poiCount, modelSelection }) {
  const keep = mission.chits.filter((_, index) => !duplicates.includes(index));
  const prompt = `Return STRICT JSON only, no markdown fences. Generate exactly ${duplicates.length} distinct replacement POI chits. Do not duplicate these POIs: ${JSON.stringify(keep.map((chit) => chit.poi))}. Agenda: ${form.agenda}. Portfolio: ${form.portfolio}. Sliders: ${JSON.stringify(sliders)}. Follow-up: ${includeFollowUp ? 'GENERATE' : 'DO NOT GENERATE'}. Use the same ChitForge schema with targets[].pressure_points[].`;
  const response = await callGemini(form.apiKey, prompt, { ...modelSelection, schema: CHITFORGE_RESPONSE_SCHEMA, operation: 'generation' });
  const text = response.text;
  const replacement = await recoverMission({ apiKey: form.apiKey, text, ctx: { form, sliders, includeFollowUp, poiCount: duplicates.length, targetingMode: 'replacement', lengthInfo: lengthInfo(sliders.length) }, modelSelection, modelInfo: { primaryModel: response.model.displayName } });
  return { ...mission, chits: [...keep, ...replacement.chits].slice(0, poiCount) };
}
