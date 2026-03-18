export type IncomingMediaItem = {
  index: number;
  url: string;
  contentType: string | null;
};

export function extractIncomingMedia(body: Record<string, string>): IncomingMediaItem[] {
  const numMedia = parseInt(body.NumMedia || "0", 10);

  if (!numMedia || Number.isNaN(numMedia)) return [];

  const media: IncomingMediaItem[] = [];

  for (let i = 0; i < numMedia; i++) {
    const url = body[`MediaUrl${i}`];
    const contentType = body[`MediaContentType${i}`] || null;

    if (url) {
      media.push({
        index: i,
        url,
        contentType,
      });
    }
  }

  return media;
}
