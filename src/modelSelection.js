export const MODEL_SELECTION_MODES = {
  BEST: 'best',
  ROTATION: 'rotation',
  MANUAL: 'manual',
};

export const PREFERRED_MODELS = [
  { id: 'gemini-3.1-pro-preview', priority: 100, tier: 'S', reason: 'Highest-quality complex reasoning' },
  { id: 'gemini-3.6-flash', priority: 95, tier: 'S', reason: 'Excellent reasoning with strong speed' },
  { id: 'gemini-3.5-flash', priority: 90, tier: 'A', reason: 'Strong general reasoning' },
  { id: 'gemini-2.5-pro', priority: 88, tier: 'A', reason: 'Strong complex reasoning' },
  { id: 'gemini-2.5-flash', priority: 80, tier: 'B', reason: 'Strong price-performance and reasoning' },
  { id: 'gemini-3.1-flash-lite', priority: 60, tier: 'C', reason: 'Fast fallback' },
  { id: 'gemini-3.5-flash-lite', priority: 55, tier: 'C', reason: 'High-throughput fallback' },
];

const PREFERENCE_BY_ID = new Map(PREFERRED_MODELS.map((item) => [item.id, item]));
const INCOMPATIBLE_NAME = /(embedding|embed|imagen|image|vision|tts|audio|aqa|live|veo|chirp|preview-image)/i;
const DEPRECATED = /(deprecated|retired|shutdown|legacy)/i;

export const CHITFORGE_RESPONSE_SCHEMA = {
  type: 'object',
  required: ['pois'],
  properties: {
    pois: {
      type: 'array',
      items: {
        type: 'object',
        required: ['target', 'question', 'legalFoundation', 'evidence', 'documentedIssue', 'classification', 'classificationReason', 'tacticalImpact', 'followUp'],
        properties: {
          target: { type: 'string', description: 'Target country or delegation.' },
          question: { type: 'string', description: 'The concise MUN Point of Information question.' },
          legalFoundation: { type: 'string', description: 'Relevant treaty, resolution, institution rule, legal framework, or political commitment with binding status distinguished.' },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              required: ['sourceName', 'organization', 'publicationDate', 'url', 'claimSupported', 'sourceType', 'confidence'],
              properties: { claim: { type: 'string' }, sourceName: { type: 'string' }, organization: { type: 'string' }, publicationDate: { type: 'string' }, url: { type: 'string' }, claimSupported: { type: 'string' }, sourceType: { type: 'string' }, confidence: { type: 'number' }, sourceUrl: { type: 'string' } },
            },
          },
          documentedIssue: { type: 'string' },
          classification: { type: 'string' },
          classificationReason: { type: 'string' },
          tacticalImpact: { type: 'string' },
          followUp: { type: 'string', nullable: true },
        },
      },
    },
  },
};

export const FOLLOW_UP_RESPONSE_SCHEMA = { type: 'object', required: ['expectedEvasion', 'question'], properties: { expectedEvasion: { type: 'string' }, question: { type: 'string' } } };
export const FACT_CHECK_RESPONSE_SCHEMA = {
  type: 'object',
  required: ['overallStatus', 'confidence', 'claims', 'legalAssessment', 'classificationAssessment'],
  properties: {
    overallStatus: { type: 'string' },
    confidence: { type: 'number' },
    claims: { type: 'array', items: { type: 'object', properties: { claim: { type: 'string' }, status: { type: 'string' }, source: { type: 'string' }, reason: { type: 'string' }, sourceRelevant: { type: 'boolean' } } } },
    legalAssessment: { type: 'object', properties: { status: { type: 'string' }, reason: { type: 'string' } } },
    classificationAssessment: { type: 'object', properties: { status: { type: 'string' }, reason: { type: 'string' } } },
  },
};


export function modelId(model) { return (model.name || model.id || '').replace(/^models\//, ''); }
export function displayModelName(model) { return model.displayName || model.display_name || modelId(model).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }

function hasGenerateContent(model) { return (model.supportedGenerationMethods || model.supported_generation_methods || []).includes('generateContent'); }
function inferPriority(id, model) {
  const preferred = PREFERENCE_BY_ID.get(id);
  if (preferred) return preferred;
  const haystack = `${id} ${model.displayName || ''}`.toLowerCase();
  let priority = 50; let tier = 'C'; let reason = 'Discovered compatible Gemini text model';
  if (/pro/.test(haystack)) { priority += 30; tier = 'A'; reason = 'Discovered high-reasoning Pro-family model'; }
  if (/flash/.test(haystack)) { priority += 18; tier = 'B'; reason = 'Discovered fast reasoning Flash-family model'; }
  const version = haystack.match(/gemini-(\d+(?:\.\d+)?)/)?.[1];
  if (version) priority += Math.min(12, Number(version) * 3);
  if (/lite/.test(haystack)) priority -= 15;
  if (/preview/.test(haystack)) priority -= 2;
  return { id, priority, tier, reason };
}

export function classifyDiscoveredModel(model, verification) {
  const id = modelId(model);
  const textGeneration = hasGenerateContent(model) && !INCOMPATIBLE_NAME.test(id) && !INCOMPATIBLE_NAME.test(model.displayName || '') && !DEPRECATED.test(model.description || '');
  const pref = inferPriority(id, model);
  const inputLimit = model.inputTokenLimit || model.input_token_limit || 0;
  const outputLimit = model.outputTokenLimit || model.output_token_limit || 0;
  const structuredJson = textGeneration;
  const status = !textGeneration ? 'INCOMPATIBLE' : 'TEXT GENERATION — JSON RECOVERY ENABLED';
  return { ...model, id, displayName: displayModelName(model), textGeneration, structuredJson, verified: !!verification?.verified, compatibilityStatus: status, priority: pref.priority + (inputLimit >= 100000 ? 4 : 0) + (outputLimit >= 8192 ? 2 : 0), tier: pref.tier, reason: pref.reason, inputTokenLimit: inputLimit, outputTokenLimit: outputLimit };
}

export function rankModels(models) { return [...models].sort((a, b) => b.priority - a.priority || a.displayName.localeCompare(b.displayName)); }
export function compatibleModels(models) { return rankModels(models.filter((m) => m.textGeneration)); }
export function selectBest(models) { return compatibleModels(models)[0] || null; }
export function selectFactCheckModel(models, primaryModelId) {
  return rankModels(models.filter((m) => m.id !== primaryModelId)).sort((a, b) => (a.priority - b.priority) || a.displayName.localeCompare(b.displayName))[0] || rankModels(models)[0] || null;
}

export function selectSmartRotation(models) {
  const ranked = compatibleModels(models); if (!ranked.length) return null;
  const top = ranked[0].priority; const pool = ranked.filter((m) => top - m.priority <= 20).slice(0, 5);
  const weights = [40, 30, 20, 8, 2]; let r = Math.random() * pool.reduce((s, _, i) => s + weights[i], 0);
  for (let i = 0; i < pool.length; i += 1) { r -= weights[i]; if (r <= 0) return pool[i]; }
  return pool[0];
}
