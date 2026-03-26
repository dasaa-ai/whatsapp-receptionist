import Link from "next/link";
import { getDashboardData } from "./data";

const toneMap: Record<string, string> = {
  needs_action: "bg-amber-50 text-amber-700 border-amber-200",
  ready: "bg-emerald-50 text-emerald-700 border-emerald-200",
  live: "bg-sky-50 text-sky-700 border-sky-200",
};

function getStagePill(status: string) {
  if (status === "Needs action") {
    return {
      label: "Needs action",
      className: toneMap.needs_action,
    };
  }
  if (status === "Ready") {
    return {
      label: "Ready",
      className: toneMap.ready,
    };
  }
  return {
    label: "Live chat",
    className: toneMap.live,
  };
}

export default async function DashboardPage() {
  const { stats, conversations } = await getDashboardData();

  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-slate-50 to-slate-100 text-slate-900">
      <div className="mx-auto max-w-7xl px-6 py-8 lg:px-8">
        <div className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-sm text-slate-600 shadow-sm">
              <span>🏠</span>
              WhatsApp Receptionist
            </div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              A host dashboard that feels calm, warm, and in control.
            </h1>
            <p className="mt-2 max-w-3xl text-base text-slate-600 sm:text-lg">
              Track conversations, guest documents, and multilingual replies in one clear place.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm shadow-sm">
              Today
            </button>
            <button className="rounded-2xl bg-slate-900 px-4 py-2 text-sm text-white shadow-sm">
              Open live inbox
            </button>
          </div>
        </div>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
            <p className="text-sm text-slate-500">Active conversations</p>
            <p className="mt-3 text-3xl font-semibold tracking-tight">
              {stats.activeConversations}
            </p>
            <p className="mt-2 text-sm text-slate-500">Currently open</p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
            <p className="text-sm text-slate-500">Pending IDs</p>
            <p className="mt-3 text-3xl font-semibold tracking-tight">
              {stats.pendingIds}
            </p>
            <p className="mt-2 text-sm text-slate-500">Still awaiting upload</p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
            <p className="text-sm text-slate-500">Ready check-ins</p>
            <p className="mt-3 text-3xl font-semibold tracking-tight">
              {stats.readyCheckins}
            </p>
            <p className="mt-2 text-sm text-slate-500">Documents completed</p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
            <p className="text-sm text-slate-500">Languages used</p>
            <p className="mt-3 text-3xl font-semibold tracking-tight">
              {stats.languagesUsed}
            </p>
            <p className="mt-2 text-sm text-slate-500">Across live conversations</p>
          </div>
        </section>

        <section className="mt-8 grid gap-6 xl:grid-cols-[1.6fr_0.9fr]">
          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 p-6 pb-4">
              <h2 className="text-xl font-semibold">Guest conversations</h2>
              <p className="mt-1 text-sm text-slate-500">
                Live data from your WhatsApp receptionist flow.
              </p>
            </div>

            <div className="space-y-4 p-6">
              {conversations.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-sm text-slate-500">
                  No conversations yet.
                </div>
              ) : (
                conversations.map((item) => {
                  const pill = getStagePill(item.status);

                  return (
                    <Link
                      key={item.id}
                      href={`/dashboard/${item.id}`}
                      className="block rounded-3xl border border-slate-200 bg-slate-50/70 p-5 transition hover:bg-white hover:shadow-sm"
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-medium tracking-tight">{item.guest}</h3>
                            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600">
                              {item.displayId}
                            </span>
                            <span
                              className={`rounded-full border px-2.5 py-1 text-xs ${pill.className}`}
                            >
                              {pill.label}
                            </span>
                          </div>

                          <p className="mt-2 text-sm text-slate-600">{item.property}</p>
                          <p className="mt-3 line-clamp-1 text-sm text-slate-500">
                            {item.latest}
                          </p>
                          <p className="mt-2 text-xs uppercase tracking-wide text-slate-400">
                            Stage: {item.stage}
                          </p>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[360px]">
                          <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-100">
                            <div className="text-xs uppercase tracking-wide text-slate-500">
                              Check-in
                            </div>
                            <p className="mt-2 text-sm font-medium">{item.checkin}</p>
                          </div>

                          <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-100">
                            <div className="text-xs uppercase tracking-wide text-slate-500">
                              Documents
                            </div>
                            <p className="mt-2 text-sm font-medium">{item.docs}</p>
                          </div>

                          <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-100">
                            <div className="text-xs uppercase tracking-wide text-slate-500">
                              Language
                            </div>
                            <p className="mt-2 text-sm font-medium">{item.language}</p>
                          </div>
                        </div>
                      </div>
                    </Link>
                  );
                })
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="p-6">
                <h2 className="text-xl font-semibold">Today at a glance</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Simple live indicators from your current system state.
                </p>
              </div>
              <div className="space-y-4 px-6 pb-6">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="font-medium leading-tight">Active conversations</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {stats.activeConversations} currently open in the system.
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="font-medium leading-tight">Pending guest IDs</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {stats.pendingIds} required IDs are still awaiting upload.
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="font-medium leading-tight">Languages in use</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {stats.languagesUsed} languages detected across live conversations.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="p-6">
                <h2 className="text-xl font-semibold">Quick property pulse</h2>
                <p className="mt-1 text-sm text-slate-500">
                  A friendly summary for hosts.
                </p>
              </div>
              <div className="space-y-3 px-6 pb-6">
                <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <span className="text-sm text-slate-600">Open conversations</span>
                  <span className="text-sm font-medium">{stats.activeConversations}</span>
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <span className="text-sm text-slate-600">Pending IDs</span>
                  <span className="text-sm font-medium">{stats.pendingIds}</span>
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <span className="text-sm text-slate-600">Ready check-ins</span>
                  <span className="text-sm font-medium">{stats.readyCheckins}</span>
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <span className="text-sm text-slate-600">Languages used</span>
                  <span className="text-sm font-medium">{stats.languagesUsed}</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
