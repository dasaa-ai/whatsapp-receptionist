"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";

type DocumentItem = {
  id: string;
  mime_type: string | null;
  review_status: string | null;
  verification_status: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  file_size_bytes: number | null;
  document_kind: string | null;
  created_at: string;
  ai_screening_status: string | null;
  ai_screening_notes: string | null;
  ai_screened_at: string | null;
  ai_document_type: string | null;
  ai_issuing_country: string | null;
  ai_full_name: string | null;
  ai_date_of_birth: string | null;
  ai_expiry_date: string | null;
  ai_document_number: string | null;
  ai_address: string | null;
  ai_is_expired: boolean | null;
  ai_name_match_booking: boolean | null;
  ai_suspicious: boolean | null;
  ai_confidence: number | null;
};

type DocumentsPayload = {
  guestName: string;
  conversationId: string;
  documents: DocumentItem[];
};

function getDisplayNameFromStoragePath(path: string | null) {
  if (!path) return "Untitled file";
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

function formatBytes(bytes: number | null) {
  if (!bytes || Number.isNaN(bytes)) return "Unknown size";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusBadgeClass(status: string | null) {
  if (status === "approved") {
    return "bg-green-50 text-green-700 border-green-200";
  }
  if (status === "rejected") {
    return "bg-red-50 text-red-700 border-red-200";
  }
  return "bg-slate-50 text-slate-700 border-slate-200";
}

function aiScreeningBadgeClass(status: string | null) {
  if (status === "pass") {
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  }
  if (status === "fail") {
    return "bg-red-50 text-red-700 border-red-200";
  }
  if (status === "review") {
    return "bg-amber-50 text-amber-700 border-amber-200";
  }
  return "bg-slate-50 text-slate-700 border-slate-200";
}

function booleanLabel(value: boolean | null, trueLabel: string, falseLabel: string) {
  if (value === true) return trueLabel;
  if (value === false) return falseLabel;
  return "Unknown";
}

export default function ConversationDocumentsPage() {
  const params = useParams();
  const conversationId = params?.conversationId as string;

  const [data, setData] = useState<DocumentsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openingId, setOpeningId] = useState("");
  const [updatingId, setUpdatingId] = useState("");
  const [reasonTargetId, setReasonTargetId] = useState("");
  const [reasonTargetStatus, setReasonTargetStatus] = useState<"approved" | "rejected" | "">("");
  const [reasonText, setReasonText] = useState("");

  const loadDocuments = useCallback(async (showLoading = false) => {
    if (!conversationId) return;

    try {
      if (showLoading) setLoading(true);
      setError("");

      const res = await fetch(`/api/conversation/${conversationId}/documents`, {
        cache: "no-store",
      });
      const payload = await res.json();

      if (!res.ok) {
        throw new Error(payload?.error || "Failed to load documents");
      }

      setData(payload);
    } catch (err: any) {
      setError(err?.message || "Failed to load documents");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    loadDocuments(true);
  }, [loadDocuments]);

  useEffect(() => {
    if (!data?.documents?.length) return;

    const hasPendingAi = data.documents.some(
      (doc) => (doc.ai_screening_status || "pending") === "pending"
    );

    if (!hasPendingAi) return;

    const interval = setInterval(() => {
      loadDocuments(false);
    }, 4000);

    return () => clearInterval(interval);
  }, [data, loadDocuments]);

  async function handleViewDocument(documentId: string) {
    try {
      setOpeningId(documentId);
      setError("");

      const res = await fetch(`/api/documents/${documentId}/view`);
      const payload = await res.json();

      if (!res.ok) {
        throw new Error(payload?.error || "Failed to open document");
      }

      if (payload?.url) {
        window.open(payload.url, "_blank", "noopener,noreferrer");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to open document");
    } finally {
      setOpeningId("");
    }
  }

  async function updateReviewStatus(
    documentId: string,
    status: "approved" | "rejected",
    reason?: string
  ) {
    try {
      setUpdatingId(documentId);
      setError("");

      const res = await fetch(`/api/documents/${documentId}/review`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status, reason: reason || "" }),
      });

      const payload = await res.json();

      if (!res.ok) {
        throw new Error(payload?.error || "Failed to update status");
      }

      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          documents: prev.documents.map((doc) =>
            doc.id === documentId ? { ...doc, review_status: status } : doc
          ),
        };
      });

      setReasonTargetId("");
      setReasonTargetStatus("");
      setReasonText("");
    } catch (err: any) {
      setError(err?.message || "Failed to update status");
    } finally {
      setUpdatingId("");
    }
  }

  function openReasonBox(documentId: string, targetStatus: "approved" | "rejected") {
    setReasonTargetId(documentId);
    setReasonTargetStatus(targetStatus);
    setReasonText("");
    setError("");
  }

  function cancelReasonBox() {
    setReasonTargetId("");
    setReasonTargetStatus("");
    setReasonText("");
  }

  async function submitReasonedChange() {
    if (!reasonTargetId || !reasonTargetStatus) return;

    const trimmed = reasonText.trim();
    if (!trimmed) {
      setError("A reason is required when reversing a document decision.");
      return;
    }

    await updateReviewStatus(reasonTargetId, reasonTargetStatus, trimmed);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-white via-slate-50 to-slate-100 p-10 text-slate-900">
        Loading documents...
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-white via-slate-50 to-slate-100 p-10 text-slate-900">
        <div className="mx-auto max-w-3xl rounded-3xl border border-rose-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-rose-600">Could not load documents</h1>
          <p className="mt-2 text-sm text-slate-600">{error}</p>
          <Link
            href="/dashboard"
            className="mt-4 inline-block rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm shadow-sm"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-white via-slate-50 to-slate-100 p-10 text-slate-900">
        No documents found.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-slate-50 to-slate-100 text-slate-900">
      <div className="mx-auto max-w-6xl px-6 py-8 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-500">Dashboard / Conversation / Documents</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Documents</h1>
            <p className="mt-2 text-slate-600">
              {data.guestName || "Guest"} · Conversation {data.conversationId.slice(0, 8)}
            </p>
          </div>

          <Link
            href={`/dashboard/${conversationId}`}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm shadow-sm"
          >
            Back to conversation
          </Link>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-6">
            <h2 className="text-xl font-semibold">Uploaded documents</h2>
            <p className="mt-1 text-sm text-slate-500">
              Review guest documents collected from WhatsApp.
            </p>
          </div>

          <div className="p-6">
            {error && (
              <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            )}

            {data.documents.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-sm text-slate-500">
                No documents found for this conversation.
              </div>
            ) : (
              <div className="space-y-4">
                {data.documents.map((doc) => {
                  const isApproved = doc.review_status === "approved";
                  const isRejected = doc.review_status === "rejected";
                  const isPending = !doc.review_status || doc.review_status === "pending";
                  const isReasonOpen = reasonTargetId === doc.id;

                  return (
                    <div
                      key={doc.id}
                      className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="min-w-0">
                          <p className="break-all font-medium text-slate-900">
                            {getDisplayNameFromStoragePath(doc.storage_path)}
                          </p>
                          <p className="mt-1 text-sm text-slate-500">
                            {doc.mime_type || "Unknown type"} · {formatBytes(doc.file_size_bytes)}
                          </p>
                          <p className="mt-1 text-xs text-slate-400">
                            Uploaded: {new Date(doc.created_at).toLocaleString()}
                          </p>
                          {doc.ai_screened_at && (
                            <p className="mt-1 text-xs text-slate-400">
                              AI screened: {new Date(doc.ai_screened_at).toLocaleString()}
                            </p>
                          )}
                        </div>

                        <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[520px]">
                          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                            <span className="text-slate-500">Kind:</span>{" "}
                            <span className="font-medium text-slate-900">
                              {doc.document_kind || "unknown"}
                            </span>
                          </div>

                          <div
                            className={`rounded-xl border px-3 py-2 text-sm ${statusBadgeClass(
                              doc.review_status
                            )}`}
                          >
                            <span className="text-slate-500">Review:</span>{" "}
                            <span className="font-medium">
                              {doc.review_status || "pending"}
                            </span>
                          </div>

                          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                            <span className="text-slate-500">Verification:</span>{" "}
                            <span className="font-medium text-slate-900">
                              {doc.verification_status || "pending"}
                            </span>
                          </div>

                          <div
                            className={`rounded-xl border px-3 py-2 text-sm ${aiScreeningBadgeClass(
                              doc.ai_screening_status
                            )}`}
                          >
                            <span className="text-slate-500">AI screening:</span>{" "}
                            <span className="font-medium">
                              {doc.ai_screening_status || "pending"}
                            </span>
                          </div>
                        </div>
                      </div>

                      {(doc.ai_screening_notes ||
                        doc.ai_document_type ||
                        doc.ai_issuing_country ||
                        doc.ai_full_name ||
                        doc.ai_date_of_birth ||
                        doc.ai_expiry_date ||
                        doc.ai_document_number ||
                        doc.ai_address ||
                        doc.ai_is_expired !== null ||
                        doc.ai_name_match_booking !== null ||
                        doc.ai_suspicious !== null ||
                        doc.ai_confidence !== null) && (
                        <div className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-4 text-sm text-indigo-900">
                          <p className="font-semibold">AI screening summary</p>

                          {doc.ai_screening_notes && (
                            <p className="mt-2 whitespace-pre-wrap break-words text-indigo-800">
                              {doc.ai_screening_notes}
                            </p>
                          )}

                          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {doc.ai_document_type && (
                              <div className="rounded-xl bg-white px-3 py-2">
                                <span className="text-indigo-500">Document type:</span>{" "}
                                <span className="font-medium text-slate-900">{doc.ai_document_type}</span>
                              </div>
                            )}
                            {doc.ai_issuing_country && (
                              <div className="rounded-xl bg-white px-3 py-2">
                                <span className="text-indigo-500">Issuing country:</span>{" "}
                                <span className="font-medium text-slate-900">{doc.ai_issuing_country}</span>
                              </div>
                            )}
                            {doc.ai_full_name && (
                              <div className="rounded-xl bg-white px-3 py-2">
                                <span className="text-indigo-500">Full name:</span>{" "}
                                <span className="font-medium text-slate-900">{doc.ai_full_name}</span>
                              </div>
                            )}
                            {doc.ai_date_of_birth && (
                              <div className="rounded-xl bg-white px-3 py-2">
                                <span className="text-indigo-500">Date of birth:</span>{" "}
                                <span className="font-medium text-slate-900">{doc.ai_date_of_birth}</span>
                              </div>
                            )}
                            {doc.ai_expiry_date && (
                              <div className="rounded-xl bg-white px-3 py-2">
                                <span className="text-indigo-500">Expiry date:</span>{" "}
                                <span className="font-medium text-slate-900">{doc.ai_expiry_date}</span>
                              </div>
                            )}
                            {doc.ai_document_number && (
                              <div className="rounded-xl bg-white px-3 py-2">
                                <span className="text-indigo-500">Document number:</span>{" "}
                                <span className="font-medium text-slate-900">{doc.ai_document_number}</span>
                              </div>
                            )}
                            {doc.ai_address && (
                              <div className="rounded-xl bg-white px-3 py-2 sm:col-span-2 lg:col-span-3">
                                <span className="text-indigo-500">Address:</span>{" "}
                                <span className="font-medium text-slate-900">{doc.ai_address}</span>
                              </div>
                            )}
                            {doc.ai_is_expired !== null && (
                              <div className="rounded-xl bg-white px-3 py-2">
                                <span className="text-indigo-500">Expired:</span>{" "}
                                <span className="font-medium text-slate-900">
                                  {booleanLabel(doc.ai_is_expired, "Yes", "No")}
                                </span>
                              </div>
                            )}
                            {doc.ai_name_match_booking !== null && (
                              <div className="rounded-xl bg-white px-3 py-2">
                                <span className="text-indigo-500">Matches booking name:</span>{" "}
                                <span className="font-medium text-slate-900">
                                  {booleanLabel(doc.ai_name_match_booking, "Likely yes", "Likely no")}
                                </span>
                              </div>
                            )}
                            {doc.ai_suspicious !== null && (
                              <div className="rounded-xl bg-white px-3 py-2">
                                <span className="text-indigo-500">Suspicious:</span>{" "}
                                <span className="font-medium text-slate-900">
                                  {booleanLabel(doc.ai_suspicious, "Yes", "No")}
                                </span>
                              </div>
                            )}
                            {doc.ai_confidence !== null && (
                              <div className="rounded-xl bg-white px-3 py-2">
                                <span className="text-indigo-500">Confidence:</span>{" "}
                                <span className="font-medium text-slate-900">
                                  {Math.round(doc.ai_confidence * 100)}%
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                          Bucket: {doc.storage_bucket || "N/A"} · Path: {doc.storage_path || "Not available"}
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => handleViewDocument(doc.id)}
                            disabled={openingId === doc.id}
                            className="rounded-2xl bg-slate-900 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                          >
                            {openingId === doc.id ? "Opening..." : "View document"}
                          </button>

                          {isPending && (
                            <>
                              <button
                                onClick={() => updateReviewStatus(doc.id, "approved")}
                                disabled={updatingId === doc.id}
                                className="rounded-2xl bg-green-600 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                              >
                                {updatingId === doc.id ? "Updating..." : "Approve"}
                              </button>

                              <button
                                onClick={() => updateReviewStatus(doc.id, "rejected")}
                                disabled={updatingId === doc.id}
                                className="rounded-2xl bg-red-600 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                              >
                                {updatingId === doc.id ? "Updating..." : "Reject"}
                              </button>
                            </>
                          )}

                          {isApproved && (
                            <>
                              <div className="rounded-2xl border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
                                Approved
                              </div>
                              <button
                                onClick={() => openReasonBox(doc.id, "rejected")}
                                disabled={updatingId === doc.id}
                                className="rounded-2xl border border-red-200 bg-white px-4 py-2 text-sm text-red-600 disabled:cursor-not-allowed disabled:bg-slate-100"
                              >
                                Change to rejected
                              </button>
                            </>
                          )}

                          {isRejected && (
                            <>
                              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
                                Rejected
                              </div>
                              <button
                                onClick={() => openReasonBox(doc.id, "approved")}
                                disabled={updatingId === doc.id}
                                className="rounded-2xl border border-green-200 bg-white px-4 py-2 text-sm text-green-700 disabled:cursor-not-allowed disabled:bg-slate-100"
                              >
                                Change to approved
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {isReasonOpen && (
                        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                          <p className="text-sm font-medium text-slate-900">
                            Reason required to change decision
                          </p>
                          <p className="mt-1 text-sm text-slate-600">
                            This reason will be sent to the guest on WhatsApp.
                          </p>

                          <textarea
                            value={reasonText}
                            onChange={(e) => setReasonText(e.target.value)}
                            placeholder="Write the reason for changing this decision..."
                            className="mt-3 min-h-[100px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none"
                          />

                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              onClick={submitReasonedChange}
                              disabled={updatingId === doc.id || !reasonText.trim()}
                              className="rounded-2xl bg-slate-900 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                            >
                              {updatingId === doc.id ? "Updating..." : "Confirm change"}
                            </button>

                            <button
                              onClick={cancelReasonBox}
                              disabled={updatingId === doc.id}
                              className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 disabled:cursor-not-allowed disabled:bg-slate-100"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
