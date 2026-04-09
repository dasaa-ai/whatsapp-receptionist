"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function DashboardRealtime() {
  const router = useRouter();

  useEffect(() => {
    let refreshTimeout: ReturnType<typeof setTimeout> | null = null;

    const scheduleRefresh = () => {
      if (refreshTimeout) return;

      refreshTimeout = setTimeout(() => {
        router.refresh();
        refreshTimeout = null;
      }, 300);
    };

    const channel = supabase
      .channel("dashboard-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversations",
        },
        () => {
          scheduleRefresh();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "guest_documents",
        },
        () => {
          scheduleRefresh();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
        },
        () => {
          scheduleRefresh();
        }
      )
      .subscribe((status) => {
        console.log("[dashboard-realtime]", status);
      });

    return () => {
      if (refreshTimeout) {
        clearTimeout(refreshTimeout);
      }
      supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}
