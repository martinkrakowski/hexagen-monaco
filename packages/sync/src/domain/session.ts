// packages/sync/src/domain/session.ts
export interface Session {
  id: string; // unique identifier for the editor session
  userId: string; // id of the user owning the session
  createdAt: string; // ISO‑8601 timestamp
  // add any additional fields required by the UI or Monaco
}
