export const SOURCE_STATUSES = { VERIFIED: 'VERIFIED', MANUAL: 'MANUAL VERIFICATION', FAILED: 'FAILED', PENDING: 'PENDING' };
export const SOURCE_TYPES = ['PRIMARY', 'GOVERNMENT', 'UN', 'INTERNATIONAL_ORGANIZATION', 'COURT', 'NEWS', 'ACADEMIC', 'THINK_TANK', 'OTHER_CREDIBLE'];
const BAD_URL = /^(?:n\/a|none|null|undefined|verification required|manual verification|example\.com|example\.org|localhost|about:blank)$/i;
const cache = new Map();

export function normalizeSourceType(value = '') {
  const text = String(value).toUpperCase().replace(/[\s-]+/g, '_');
  if (SOURCE_TYPES.includes(text)) return text;
  if (/UN|UNITED_NATIONS/.test(text)) return 'UN';
  if (/GOV|OFFICIAL/.test(text)) return 'GOVERNMENT';
  if (/IMF|WORLD_BANK|WTO|OECD|INTERNATIONAL/.test(text)) return 'INTERNATIONAL_ORGANIZATION';
  if (/COURT|ICJ|JUDG/.test(text)) return 'COURT';
  if (/REUTERS|AP|BBC|BLOOMBERG|FINANCIAL|NEWS/.test(text)) return 'NEWS';
  if (/ACADEMIC|UNIVERSITY|JOURNAL/.test(text)) return 'ACADEMIC';
  if (/THINK/.test(text)) return 'THINK_TANK';
  return 'OTHER_CREDIBLE';
}

export function sourceQuality(sourceType) {
  const type = normalizeSourceType(sourceType);
  if (['PRIMARY', 'GOVERNMENT', 'UN', 'INTERNATIONAL_ORGANIZATION', 'COURT'].includes(type)) return 'PRIMARY';
  if (type === 'NEWS') return 'HIGH';
  if (['ACADEMIC', 'THINK_TANK'].includes(type)) return 'GOOD';
  return 'LIMITED';
}

export function domainFromUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

export function validateSourceUrl(url) {
  const raw = String(url || '').trim();
  if (!raw || BAD_URL.test(raw)) return { status: SOURCE_STATUSES.FAILED, reason: 'No traceable source URL was supplied.' };
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return { status: SOURCE_STATUSES.FAILED, reason: 'Source URL must use http or https.' };
    if (/example\.|placeholder|verification|required/i.test(parsed.hostname + parsed.pathname)) return { status: SOURCE_STATUSES.FAILED, reason: 'Source URL looks like a placeholder.' };
    return { status: SOURCE_STATUSES.MANUAL, reason: 'Traceable URL supplied; source/claim support awaits two-pass fact check.', domain: parsed.hostname.replace(/^www\./, '') };
  } catch {
    return { status: SOURCE_STATUSES.FAILED, reason: 'Source URL could not be parsed.' };
  }
}

export function normalizeEvidenceSource(raw = {}) {
  const sourceName = raw.sourceName || raw.source_name || raw.title || raw.source || raw.name || 'Manual verification source';
  const organization = raw.organization || raw.publisher || raw.publication || raw.sourceName || raw.source_name || sourceName;
  const publicationDate = raw.publicationDate || raw.publication_date || raw.date || 'MANUAL VERIFICATION';
  const url = raw.url || raw.sourceUrl || raw.source_url || raw.link || '';
  const structural = validateSourceUrl(url);
  const sourceType = normalizeSourceType(raw.sourceType || raw.source_type || raw.sourceClassification || raw.type || organization);
  return { sourceName, organization, publicationDate, url, claimSupported: raw.claimSupported || raw.claim || raw.text || 'MANUAL VERIFICATION: claim support must be checked.', sourceType, confidence: Number(raw.confidence || 0), quality: sourceQuality(sourceType), status: structural.status, verificationReason: structural.reason, domain: structural.domain || domainFromUrl(url) };
}

export function applyFactCheckToSources(evidence = [], factCheck) {
  const claims = factCheck?.claims || [];
  return evidence.map((source) => {
    const matching = claims.find((claim) => source.claimSupported && claim.claim && source.claimSupported.toLowerCase().includes(String(claim.claim).slice(0, 40).toLowerCase())) || claims.find((claim) => source.sourceName && String(claim.source || '').toLowerCase().includes(source.sourceName.toLowerCase()));
    if (!matching) return source.status === SOURCE_STATUSES.FAILED ? source : { ...source, status: SOURCE_STATUSES.MANUAL, verificationReason: source.verificationReason || 'No fact-check claim mapping was returned.' };
    if (matching.status === 'VERIFIED' || matching.status === 'PARTIALLY_VERIFIED') return { ...source, status: SOURCE_STATUSES.VERIFIED, verificationReason: matching.reason || 'Fact-check supports this source/claim mapping.' };
    if (matching.status === 'FAILED') return { ...source, status: SOURCE_STATUSES.FAILED, verificationReason: matching.reason || 'Fact-check rejected this source/claim mapping.' };
    return { ...source, status: SOURCE_STATUSES.MANUAL, verificationReason: matching.reason || 'Fact-check requires manual verification.' };
  });
}

export async function validateSources(evidence = []) {
  return Promise.all(evidence.map(async (source) => {
    if (cache.has(source.url)) return { ...source, ...cache.get(source.url) };
    const structural = validateSourceUrl(source.url);
    cache.set(source.url, structural);
    return { ...source, status: structural.status, verificationReason: structural.reason, domain: structural.domain || source.domain };
  }));
}
