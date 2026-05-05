import {
  EncryptApiKeyUseCase,
  ProxyRequestUseCase,
  RevokeKeyUseCase,
  AesGcmEncryptionAdapter,
  InMemoryKeyMetadataAdapter,
  InMemoryRevocationAdapter,
  FetchProviderProxyAdapter,
  ConsoleAuditLogAdapter,
} from "@hexagen/byok";
import type { EncryptKeyPort } from "@hexagen/byok";
import type { ProxyRequestPort } from "@hexagen/byok";
import type { RevokeKeyPort } from "@hexagen/byok";

let _encryptUseCase: EncryptApiKeyUseCase | null = null;
let _proxyUseCase: ProxyRequestUseCase | null = null;
let _revokeUseCase: RevokeKeyUseCase | null = null;

let _encryptionAdapter: AesGcmEncryptionAdapter | null = null;
let _metadataAdapter: InMemoryKeyMetadataAdapter | null = null;
let _revocationAdapter: InMemoryRevocationAdapter | null = null;
let _proxyAdapter: FetchProviderProxyAdapter | null = null;
let _auditLogAdapter: ConsoleAuditLogAdapter | null = null;

function getEncryptionAdapter(): AesGcmEncryptionAdapter {
  if (!_encryptionAdapter) {
    _encryptionAdapter = new AesGcmEncryptionAdapter();
  }
  return _encryptionAdapter;
}

export function getMetadataAdapter(): InMemoryKeyMetadataAdapter {
  if (!_metadataAdapter) {
    _metadataAdapter = new InMemoryKeyMetadataAdapter();
  }
  return _metadataAdapter;
}

function getRevocationAdapter(): InMemoryRevocationAdapter {
  if (!_revocationAdapter) {
    _revocationAdapter = new InMemoryRevocationAdapter();
  }
  return _revocationAdapter;
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
  _metadataAdapter = null;
  _revocationAdapter = null;
  _proxyAdapter = null;
  _auditLogAdapter = null;
};
