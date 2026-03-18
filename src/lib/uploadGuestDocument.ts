import { supabaseAdmin } from "./supabaseAdmin";

type UploadGuestDocumentParams = {
  fileBuffer: Buffer;
  contentType: string;
  storagePath: string;
};

export async function uploadGuestDocument({
  fileBuffer,
  contentType,
  storagePath,
}: UploadGuestDocumentParams) {
  const bucket = "guest-documents";

  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .upload(storagePath, fileBuffer, {
      contentType,
      upsert: false,
    });

  if (error) {
    throw error;
  }

  return {
    bucket,
    path: data.path,
  };
}
