const ENV = (process.env.ADOBE_IMS_ENVIRONMENT ?? "{environment}") === "stage" ? "stage" : "prod";

const IMS_HOSTS = {
  prod: "https://ims-na1.adobelogin.com",
  stage: "https://ims-na1-stg1.adobelogin.com",
} as const;

const clientId = process.env.ADOBE_IMS_CLIENT_ID ?? "{client_id}";

if (!clientId || clientId === "{client_id}") {
  throw new Error(
    "ADOBE_IMS_CLIENT_ID is required. " +
      "Set it in .env.local from the Adobe Developer Console.",
  );
}

export const IMS_CONFIG = {
  clientId,
  redirectUri:
    process.env.ADOBE_IMS_REDIRECT_URI ??
    "{redirect_uri}",
  scopes: (process.env.ADOBE_IMS_SCOPES ?? "{scopes}").split(",").map((s) => s.trim()),
  environment: ENV,
  imsHost: IMS_HOSTS[ENV],
  autoRefresh: (process.env.ADOBE_IMS_AUTO_REFRESH ?? "{auto_refresh}") !== "false",
  refreshWindowSeconds: 300,
} as const;

export const IMS_ENDPOINTS = {
  authorize: `${IMS_CONFIG.imsHost}/ims/authorize/v2`,
  token: `${IMS_CONFIG.imsHost}/ims/token/v4`,
  profile: `${IMS_CONFIG.imsHost}/ims/profile/v1`,
  revoke: `${IMS_CONFIG.imsHost}/ims/revoke`,
} as const;
