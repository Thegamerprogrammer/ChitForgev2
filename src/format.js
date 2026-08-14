export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

export function stripMarkdown(value) {
  return String(value ?? '').replace(/\*\*(.*?)\*\*/g, '$1').replace(/__(.*?)__/g, '$1');
}

export function renderMarkdownBold(value) {
  const escaped = escapeHtml(value);
  return escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/__(.+?)__/g, '<strong>$1</strong>');
}

export function markdownToWordHtml(value) {
  const escaped = escapeHtml(value);
  return escaped.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/__(.+?)__/g, '<b>$1</b>');
}

export function countWords(value) {
  const plain = stripMarkdown(value).replace(/https?:\/\/\S+/g, '').match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu);
  return plain ? plain.length : 0;
}

export function speakingSeconds(wordCount) {
  return Math.max(1, Math.round((wordCount / 140) * 60));
}
