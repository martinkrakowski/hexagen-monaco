import { useCallback } from "react";

export function useRelativeTime() {
  const relativeTime = useCallback((timestamp: number): string => {
    const diff = Date.now() - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 30) {
      const months = Math.floor(days / 30);
      return `${months}mo ago`;
    }
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return "Just now";
  }, []);

  const fullDateTime = useCallback((timestamp: number): string => {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(timestamp));
  }, []);

  const shortDate = useCallback((timestamp: number): string => {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(timestamp));
  }, []);

  return { relativeTime, fullDateTime, shortDate };
}
