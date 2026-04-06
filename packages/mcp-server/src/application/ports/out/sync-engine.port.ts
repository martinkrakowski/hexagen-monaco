import type { ArchitectureGraph, LinterReport, Result } from "@hexagen/shared";

export interface ScaffoldModuleCommand {
  name: string;
  layer: "domain" | "application" | "infrastructure";
}

export interface CreatePortCommand {
  domainName: string;
  portName: string;
  type: "inbound" | "outbound";
}

export interface CreateAdapterCommand {
  portName: string;
  infrastructureName: string;
}

export interface SyncEnginePort {
  getArchitectureGraph(): Promise<Result<ArchitectureGraph>>;
  getLinterReport(): Promise<Result<LinterReport>>;
  scaffoldModule(
    command: ScaffoldModuleCommand,
  ): Promise<Result<{ filesCreated: string[] }>>;
  createPort(
    command: CreatePortCommand,
  ): Promise<Result<{ fileCreated: string }>>;
  createAdapter(
    command: CreateAdapterCommand,
  ): Promise<Result<{ fileCreated: string }>>;
}
