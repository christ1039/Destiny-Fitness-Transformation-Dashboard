import Whop from "@whop/sdk";

const APP_VERSION = "1.6.1";
const DEFAULT_APP_ID = "app_cv4W2wj4fEkMD4";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function getAppId(env) {
  return env.WHOP_APP_ID || env.WHOP_CLIENT_ID || DEFAULT_APP_ID;
}

function getWhopApiKey(env) {
  return env.WHOP_API_KEY || env.WHOP_APP_API_KEY || env.WHOP_COMPANY_API_KEY || env.WHOP_CLIENT_SECRET;
}

export async function onRequest({ request, env }) {
  const token = request.headers.get("x-whop-user-token");
  const appID = getAppId(env);
  const apiKey = getWhopApiKey(env);

  const result = {
    ok: true,
    appVersion: APP_VERSION,
    sameOriginAuthHeaderPresent: Boolean(token),
    configured: {
      DB: Boolean(env.DB),
      WHOP_APP_ID_or_CLIENT_ID: Boolean(appID),
      WHOP_API_KEY: Boolean(apiKey),
    },
    appID,
    authMode: "none",
    userId: null,
    note: token
      ? "x-whop-user-token was received. If verification succeeds below, sync can work."
      : "No x-whop-user-token was received. Open this endpoint from inside the Whop iframe/app, not directly in a normal browser tab.",
  };

  if (!token || !apiKey) return json(result, token ? 500 : 401);

  try {
    const whop = new Whop({ apiKey, appID });
    const verified = await whop.verifyUserToken(request.headers, { dontThrow: true });
    result.authMode = "whop";
    result.userId = verified?.userId || null;
    result.tokenVerified = Boolean(verified?.userId);
    return json(result, verified?.userId ? 200 : 401);
  } catch (err) {
    result.ok = false;
    result.tokenVerified = false;
    result.error = "Whop token verification failed.";
    return json(result, 401);
  }
}
