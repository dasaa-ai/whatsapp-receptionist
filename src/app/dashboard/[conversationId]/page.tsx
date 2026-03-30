"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

type Message = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  translatedBody: string | null;
  created_at: string;
};

type ConversationDetail = {
  id: string;
  guestName: string;
  guestLanguage: string;
  hostLanguage: string;
  stage: string;
  documentStatus: string;
  requiredDocs: number;
  receivedDocs: number;
  checkinDate: string;
  propertyName: string;
  bookingId: string | null;
  messages: Message[];
};

function formatDateTime(value: string) {
  if (!value) return "";
  return new Date(value).toLocaleString();
}

function looksLikeFileMessage(text: string) {
  const normalized = (text || "").trim().toLowerCase();
  return (
    normalized.endsWith(".pdf") ||
    normalized.endsWith(".jpg") ||
    normalized.endsWith(".jpeg") ||
    normalized.endsWith(".png") ||
    normalized.endsWith(".webp")
  );
}

function renderMessageBody(text: string) {
  if (!looksLikeFileMessage(text)) {
    return <p className="whitespace-pre-wrap break-words">{text}</p>;
  }

  const ext = text.split(".").pop()?.toUpperCase() || "FILE";
  const isPdf = ext === "PDF";

  return (
    <div className="flex items-center gap-3">
      <div
        className={`flex h-10 w-10 items-center justify-center rounded-2xl text-xs font-semibold ${
          isPdf ? "bg-rose-100 text-rose-700" : "bg-sky-100 text-sky-700"
        }`}
      >
        {ext}
      </div>
      <div className="min-w-0">
        <p className="truncate font-medium">{text}</p>
        <p className="text-xs opacity-70">Document / media message</p>
      </div>
    </div>
  );
}

function getLanguageLabel(direction: "inbound" | "outbound", guestLanguage: string) {
  return direction === "inbound"
    ? `Received from guest in ${guestLanguage}`
    : `Sent to guest in ${guestLanguage}`;
}

function shouldShowSecondaryLine(message: Message) {
  if (!message.translatedBody) return false;
  if (looksLikeFileMessage(message.body)) return false;
  return message.translatedBody.trim() !== message.body.trim();
}

export default function ConversationDetailPage() {
  const params = useParams();
  const conversationId = params?.conversationId as string;

  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const bottomRef = useRef<HTMLDivElement | null>(null);

  async function loadConversation() {
    if (!conversationId) return;

    try {
      setLoading(true);
      setError("");

      const res = await fetch(`/api/conversation/${conversationId}`, {
        cache: "no-store",
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Failed to load conversation");
      }

      setDetail(data);
    } catch (err: any) {
      setError(err?.message || "Failed to load conversation");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadConversation();
  }, [conversationId]);

  useEffect(() => {
    if (detail?.messages?.length) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [detail?.messages]);

  async function handleSend() {
    const text = reply.trim();
    if (!text || !conversationId || sending) return;

    try {
      setSending(true);
      setError("");

      const res = await fetch(`/api/conversation/${conversationId}/reply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reply: text }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Failed to send reply");
      }

      setReply("");
      await loadConversation();
    } catch (err: any) {
      setError(err?.message || "Failed to send reply");
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-white via-slate-50 to-slate-100 p-10 text-slate-900">
        Loading...
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-white via-slate-50 to-slate-100 p-10 text-slate-900">
        <div className="mx-auto max-w-3xl rounded-3xl border border-rose-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-rose-600">Could not load conversation</h1>
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

  if (!detail) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-white via-slate-50 to-slate-100 p-10 text-slate-900">
        No conversation found.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-slate-50 to-slate-100 text-slate-900">
      <div className="mx-auto max-w-7xl px-6 py-8 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-500">Dashboard / Conversation</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">{detail.guestName}</h1>
            <p className="mt-2 text-slate-600">{detail.propertyName}</p>
          </div>

          <Link
            href="/dashboard"
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm shadow-sm"
          >
            Back to dashboard
          </Link>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.6fr_0.8fr]">
          <div className="flex h-[78vh] min-h-[600px] flex-col rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 p-6">
              <h2 className="text-xl font-semibold">Message thread</h2>
              <p className="mt-1 text-sm text-slate-500">
                Real messages from your WhatsApp receptionist flow.
              </p>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-6">
              {detail.messages.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
                  No messages yet.
                </div>
              ) : (
                detail.messages.map((message) => {
                  const isOutbound = message.direction === "outbound";
                  const showSecondaryLine = shouldShowSecondaryLine(message);
                  const languageLabel = getLanguageLabel(
                    message.direction,
                    detail.guestLanguage
                  );

                  return (
                    <div key={message.id}>
                      <div
                        className={
                          isOutbound
                            ? "ml-auto max-w-[75%] rounded-3xl rounded-br-md bg-slate-900 px-4 py-3 text-sm text-white"
                            : "max-w-[75%] rounded-3xl rounded-bl-md bg-slate-100 px-4 py-3 text-sm text-slate-800"
                        }
                      >
                        <div
                          className={
                            isOutbound
                              ? "mb-2 inline-flex rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-slate-200"
                              : "mb-2 inline-flex rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-600"
                          }
                        >
                          {languageLabel}
                        </div>

                        {renderMessageBody(message.body)}

                        {showSecondaryLine && (
                          <div
                            className={
                              isOutbound
                                ? "mt-3 border-t border-white/10 pt-3 text-xs text-slate-300"
                                : "mt-3 border-t border-slate-200 pt-3 text-xs text-slate-500"
                            }
                          >
                            <p className="mb-1 font-medium">
                              {isOutbound ? "Sent to guest as:" : "Original guest text:"}
                            </p>
                            <p className="whitespace-pre-wrap break-words">
                              {message.translatedBody}
                            </p>
                          </div>
                        )}
                      </div>

                      <p
                        className={
                          isOutbound
                            ? "mt-1 text-right text-xs text-slate-400"
                            : "mt-1 text-xs text-slate-400"
                        }
                      >
                        {formatDateTime(message.created_at)}
                      </p>
                    </div>
                  );
                })
              )}

              <div ref={bottomRef} />
            </div>

            <div className="border-t border-slate-100 p-4">
              {error && (
                <div className="mb-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {error}
                </div>
              )}

              <div className="flex gap-3">
                <input
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (!sending && reply.trim()) {
                        handleSend();
                      }
                    }
                  }}
                  placeholder="Type your reply..."
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none"
                  disabled={sending}
                />
                <button
                  onClick={handleSend}
                  disabled={sending || !reply.trim()}
                  className="rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {sending ? "Sending..." : "Send"}
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="p-6">
                <h2 className="text-xl font-semibold">Guest summary</h2>
                <div className="mt-4 space-y-3 text-sm text-slate-600">
                  <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <span>Guest</span>
                    <span className="font-medium text-slate-900">{detail.guestName}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <span>Guest language</span>
                    <span className="font-medium text-slate-900">{detail.guestLanguage}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <span>Host language</span>
                    <span className="font-medium text-slate-900">{detail.hostLanguage}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <span>Documents</span>
                    <span className="font-medium text-slate-900">
                      {detail.receivedDocs} / {detail.requiredDocs}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <span>Check-in</span>
                    <span className="font-medium text-slate-900">{detail.checkinDate}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <span>Stage</span>
                    <span className="font-medium text-slate-900">{detail.stage}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <span>Document status</span>
                    <span className="font-medium text-slate-900">{detail.documentStatus}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="p-6">
                <h2 className="text-xl font-semibold">Host actions</h2>
                <div className="mt-4 grid gap-3">
                  <button className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm shadow-sm">
                    Mark as priority
                  </button>
                  <Link
                    href={`/dashboard/${detail.id}/documents`}
                    className="block rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm shadow-sm"
                  >
                    Open documents
                  </Link>
                  <button className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm shadow-sm">
                    Booking: {detail.bookingId ? detail.bookingId.slice(0, 8) : "N/A"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
