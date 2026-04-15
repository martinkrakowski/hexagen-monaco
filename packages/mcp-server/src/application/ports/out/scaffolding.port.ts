import type { Result } from "@hexagen/shared";

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

export interface ScaffoldingPort {
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
