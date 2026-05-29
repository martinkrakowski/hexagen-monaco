"use client";

import { useEffect } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseClient } from "../client";

// Subscribe to INSERTs on a table. Returns the channel — call .unsubscribe() to
// tear down. `filter` uses PostgREST filter syntax, e.g. "user_id=eq.123".
export function subscribeToTable<T>(
  table: string,
  filter: string,
  onInsert: (record: T) => void,
): RealtimeChannel {
  const supabase = getSupabaseClient();
  // Unique channel name per subscription so multiple subscriptions to the same
  // table (different filters/callbacks) don't collide or tear each other down.
  const channelName =
    "realtime:" + table + ":" + filter + ":" + crypto.randomUUID();
  return supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table, filter },
      (payload) => onInsert(payload.new as T),
    )
    .subscribe();
}

// React hook: subscribe on mount, unsubscribe on unmount.
export function useRealtimeTable<T>(
  table: string,
  filter: string,
  onInsert: (record: T) => void,
): void {
  useEffect(() => {
    const channel = subscribeToTable<T>(table, filter, onInsert);
    return () => {
      void channel.unsubscribe();
    };
  }, [table, filter, onInsert]);
}
