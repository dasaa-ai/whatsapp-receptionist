"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Document = {
  id: string;
  file_path: string;
  file_type: string;
  file_size: number;
  created_at: string;
  review_status: string;
  verification_status: string;
};

export default function ConversationDocumentsPage() {
  const params = useParams();
  const conversationId = params.conversationId as string;

  const [documents, setDocuments] = useState<Document[]>([]);
  const [guestName, setGuestName] = useState<string>("");

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(
          `/api/conversation/${conversationId}/documents`
        );
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Failed to load documents");
        }

        setDocuments(data.documents || []);
        setGuestName(data.guestName || "Guest");
      } catch (err) {
        console.error(err);
      }
    }

    load();
  }, [conversationId]);

  // ✅ NEW FUNCTION (Step 2)
  async function updateReviewStatus(
    documentId: string,
    status: "approved" | "rejected"
  ) {
    try {
      const res = await fetch(`/api/documents/${documentId}/review`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status }),
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Failed to update status");
        return;
      }

      // reload to reflect changes
      window.location.reload();
    } catch (err) {
      alert("Something went wrong");
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <p className="text-sm text-gray-500">
            Dashboard / Conversation / Documents
          </p>
          <h1 className="text-2xl font-semibold">Documents</h1>
          <p className="text-gray-600">
            {guestName} · Conversation {conversationId.slice(0, 8)}
          </p>
        </div>

        <a
          href={`/dashboard/${conversationId}`}
          className="px-4 py-2 rounded border text-sm"
        >
          Back to conversation
        </a>
      </div>

      <div className="border rounded-lg p-4 space-y-4">
        <h2 className="text-lg font-medium">Uploaded documents</h2>
        <p className="text-sm text-gray-500">
          Review guest documents collected from WhatsApp.
        </p>

        {documents.map((doc) => {
          const fileName = doc.file_path.split("/").pop();

          return (
            <div
              key={doc.id}
              className="border rounded-lg p-4 flex flex-col gap-2"
            >
              <div className="font-medium">{fileName}</div>

              <div className="text-sm text-gray-500">
                {doc.file_type} · {(doc.file_size / 1024).toFixed(1)} KB
              </div>

              <div className="text-xs text-gray-400">
                Uploaded: {new Date(doc.created_at).toLocaleString()}
              </div>

              <div className="flex gap-2 mt-2 text-xs">
                <span className="px-2 py-1 border rounded">
                  Review: {doc.review_status || "pending"}
                </span>
                <span className="px-2 py-1 border rounded">
                  Verification: {doc.verification_status || "pending"}
                </span>
              </div>

              <div className="text-xs text-gray-400 mt-2">
                Path: {doc.file_path}
              </div>

              <div className="flex gap-2 mt-3">
                <a
                  href={`/api/documents/${doc.id}/view`}
                  target="_blank"
                  className="px-3 py-1 rounded bg-black text-white text-sm"
                >
                  View document
                </a>

                {/* ✅ NEW BUTTONS (Step 1) */}
                <button
                  onClick={() => updateReviewStatus(doc.id, "approved")}
                  className="px-3 py-1 rounded bg-green-600 text-white text-sm"
                >
                  Approve
                </button>

                <button
                  onClick={() => updateReviewStatus(doc.id, "rejected")}
                  className="px-3 py-1 rounded bg-red-600 text-white text-sm"
                >
                  Reject
                </button>
              </div>
            </div>
          );
        })}

        {documents.length === 0 && (
          <p className="text-sm text-gray-500">No documents found.</p>
        )}
      </div>
    </div>
  );
}

