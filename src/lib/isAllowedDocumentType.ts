const ALLOWED_DOCUMENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
]);

export function isAllowedDocumentType(contentType: string | null): boolean {
  if (!contentType) return false;
  return ALLOWED_DOCUMENT_TYPES.has(contentType.toLowerCase());
}
