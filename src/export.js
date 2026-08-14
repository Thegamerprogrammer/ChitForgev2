import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle, ExternalHyperlink } from 'docx';
import { stripMarkdown } from './format.js';

function safe(value, fallback = 'MANUAL VERIFICATION') { return String(value ?? '').trim() || fallback; }
function boldRuns(text) {
  const runs = [];
  String(text || '').split(/(\*\*.*?\*\*)/g).filter(Boolean).forEach((part) => {
    const bold = part.startsWith('**') && part.endsWith('**');
    runs.push(new TextRun({ text: bold ? part.slice(2, -2) : part, bold }));
  });
  return runs.length ? runs : [new TextRun('MANUAL VERIFICATION')];
}
const line = (label, value) => new Paragraph({ children: [new TextRun({ text: `${label}: `, bold: true, color: 'D4AF37' }), new TextRun(safe(value))], spacing: { after: 100 } });
const heading = (text) => new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 120 }, border: { top: { style: BorderStyle.SINGLE, size: 8, color: 'D4AF37' } } });
const link = (text, url) => url ? new ExternalHyperlink({ link: url, children: [new TextRun({ text, style: 'Hyperlink' })] }) : new TextRun('MANUAL VERIFICATION');

export async function downloadBrief({ form, sliders, portfolioProfile, chits, poiCount, selectedTargets = [], modelInfo, targetMode }) {
  const children = [
    new Paragraph({ text: 'CHITFORGE', heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }),
    new Paragraph({ text: 'TACTICAL POI BRIEF', heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, border: { bottom: { style: BorderStyle.SINGLE, size: 16, color: 'D4AF37' } } }),
    line('Committee', form.committee || 'Unspecified'), line('Agenda', form.agenda), line('Portfolio', form.portfolio), line('Target Mode', targetMode || 'Selected + Global Research'), line('POI Count', `${chits.length}${poiCount ? ` / ${poiCount} requested` : ''}`), line('Primary Model', modelInfo?.model?.displayName || 'Not recorded'), line('Fact Check Model', modelInfo?.factCheckModel || '2-pass verification'), line('Targets', selectedTargets.length ? selectedTargets.map((t) => `${t.name} (${t.iso})`).join(', ') : 'Auto-discovery / Gemini-selected targets'),
    heading('PORTFOLIO INTELLIGENCE SUMMARY'), new Paragraph(stripMarkdown(portfolioProfile?.summary || 'Portfolio intelligence pending sourced verification.')),
  ];
  chits.forEach((chit, index) => {
    children.push(heading(`POI NUMBER ${index + 1}`), line('Target', chit.target), line('POI Type', chit.classification || chit.pressureProfile?.classification), new Paragraph({ children: [new TextRun({ text: 'QUESTION', bold: true, color: 'D4AF37' })], spacing: { before: 120, after: 80 } }), new Paragraph({ children: boldRuns(chit.poi), border: { left: { style: BorderStyle.SINGLE, size: 16, color: 'D4AF37' } }, spacing: { after: 160 } }), line('Pressure Score', `${chit.pressureScore ?? chit.pressureProfile?.score}/100`), line('Verification Status', chit.factCheck?.status || 'MANUAL VERIFICATION'), line('Aggression', chit.aggression ?? sliders.aggression), line('Controversy', chit.controversy ?? sliders.controversy), line('Diplomacy', chit.diplomacy ?? sliders.diplomacy), line('Length', chit.length ?? sliders.length), line('Word Count', `${chit.wordCount} words`), line('Estimated Speaking Time', `${chit.estimatedSeconds} seconds`), line('Legal Foundation', chit.legalFoundation || chit.legalPolicyFoundation), heading('SOURCE DETAILS'));
    (chit.evidence || []).forEach((e) => children.push(line('Source', `${safe(e.sourceName)} — ${safe(e.organization)} — ${safe(e.publicationDate)}`), line('Source Quality', e.quality || 'LIMITED'), line('Source Status', e.status || 'MANUAL VERIFICATION'), new Paragraph({ children: [new TextRun({ text: 'Source URL: ', bold: true, color: 'D4AF37' }), link('Open Source', e.url)] }), line('Claim Supported', e.claimSupported || e.claim)));
    children.push(line('Documented Issue', chit.documentedIssue || chit.pressurePoint?.conflict), line('Tactical Impact', chit.tacticalImpact), line('Legal Assessment', `${chit.factCheck?.legalAssessment?.status || 'UNCERTAIN'} — ${chit.factCheck?.legalAssessment?.reason || ''}`), line('Classification Assessment', `${chit.factCheck?.classificationAssessment?.status || 'UNCERTAIN'} — ${chit.factCheck?.classificationAssessment?.reason || ''}`));
    if (chit.followUp) children.push(line('Follow-up', chit.followUp.question || chit.followUp));
  });
  const doc = new Document({ sections: [{ properties: {}, children }] });
  const blob = await Packer.toBlob(doc);
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = 'ChitForge-Tactical-POI-Brief.docx';
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}
