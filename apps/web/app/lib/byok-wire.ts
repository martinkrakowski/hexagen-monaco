import {
  EncryptApiKeyUseCase,
  ProxyRequestUseCase,
  RevokeKeyUseCase,
  AesGcmEncryptionAdapter,
  FetchProviderProxyAdapter,
  ConsoleAuditLogAdapter,
} from "@hexagen/byok";
import type { EncryptKeyPort } from "@hexagen/byok";
import type { ProxyRequestPort } from "@hexagen/byok";
import type { RevokeKeyPort } from "@hexagen/byok";
import type { KeyMetadataStorePort, RevocationStorePort } from "@hexagen/byok";
// Key metadata + revocation are backed by a volume-mounted SQLite store so
// revocations survive container restarts (AUD-007). The native better-sqlite3
// module lives in apps/web/lib/ (alongside the quota store) and is only ever
// imported from here — a server-only module — so it stays out of client
// bundles.
import { getByokStore, closeByokStore } from "../../lib/byok-store";

let _encryptUseCase: EncryptApiKeyUseCase | null = null;
let _proxyUseCase: ProxyRequestUseCase | null = null;
let _revokeUseCase: RevokeKeyUseCase | null = null;

let _encryptionAdapter: AesGcmEncryptionAdapter | null = null;
let _proxyAdapter: FetchProviderProxyAdapter | null = null;
let _auditLogAdapter: ConsoleAuditLogAdapter | null = null;

function getEncryptionAdapter(): AesGcmEncryptionAdapter {
  if (!_encryptionAdapter) {
    _encryptionAdapter = new AesGcmEncryptionAdapter();
  }
  return _encryptionAdapter;
}

export function getMetadataAdapter(): KeyMetadataStorePort {
  return getByokStore().metadata;
}

function getRevocationAdapter(): RevocationStorePort {
  return getByokStore().revocation;
}

function getProxyAdapter(): FetchProviderProxyAdapter {
  if (!_proxyAdapter) {
    _proxyAdapter = new FetchProviderProxyAdapter();
  }
  return _proxyAdapter;
}

function getAuditLogAdapter(): ConsoleAuditLogAdapter {
  if (!_auditLogAdapter) {
    _auditLogAdapter = new ConsoleAuditLogAdapter();
  }
  return _auditLogAdapter;
}

export const getEncryptKeyUseCase = (): EncryptKeyPort => {
  if (!_encryptUseCase) {
    _encryptUseCase = new EncryptApiKeyUseCase(
      getEncryptionAdapter(),
      getMetadataAdapter(),
      getAuditLogAdapter(),
    );
  }
  return _encryptUseCase;
};

export const getProxyRequestUseCase = (): ProxyRequestPort => {
  if (!_proxyUseCase) {
    _proxyUseCase = new ProxyRequestUseCase(
      getEncryptionAdapter(),
      getRevocationAdapter(),
      getProxyAdapter(),
      getAuditLogAdapter(),
      getMetadataAdapter(),
    );
  }
  return _proxyUseCase;
};

export const getRevokeKeyUseCase = (): RevokeKeyPort => {
  if (!_revokeUseCase) {
    _revokeUseCase = new RevokeKeyUseCase(
      getRevocationAdapter(),
      getMetadataAdapter(),
      getAuditLogAdapter(),
    );
  }
  return _revokeUseCase;
};

export const clearByokCache = (): void => {
  _encryptUseCase = null;
  _proxyUseCase = null;
  _revokeUseCase = null;
  _encryptionAdapter = null;
  _proxyAdapter = null;
  _auditLogAdapter = null;
  // Drop the SQLite handle too, so the next getByokStore() reopens from disk —
  // this is what lets tests simulate a container restart.
  closeByokStore();
};
