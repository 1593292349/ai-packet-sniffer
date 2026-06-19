export function parseRawViewId(search: string): number | null {
  const params = new URLSearchParams(search);
  if (params.get('view') !== 'raw') return null;
  const value = params.get('rawId');
  if (!value || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

const MAX_STRUCTURED_TEXT_LENGTH = 1_000_000;

export function isStructuredRawText(text: string | null | undefined): boolean {
  return Boolean(text && text.length <= MAX_STRUCTURED_TEXT_LENGTH);
}

export function formatRawText(text: string | null | undefined): string {
  if (!text) return '';
  if (!isStructuredRawText(text)) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
