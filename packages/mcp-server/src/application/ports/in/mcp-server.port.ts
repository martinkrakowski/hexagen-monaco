export interface MCPServerPort {
  start(): Promise<void>;
  stop(): Promise<void>;
}
