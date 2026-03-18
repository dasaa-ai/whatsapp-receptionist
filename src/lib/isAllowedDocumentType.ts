const ALLOWED_DOCUMENT_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "application/pdf",
  "image/webp",
]);

export function isAllowedDocumentType(contentType: string | null): boolean {
  if (!contentType) return false;
  return ALLOWED_DOCUMENT_TYPES.has(contentType.toLowerCase());
}
