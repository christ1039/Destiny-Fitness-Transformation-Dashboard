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
  // Iframe token verification should use the Whop App API key/Company API key.
  // WHOP_CLIENT_SECRET is an OAuth secret; it is kept as a last-resort alias only
  // so existing Cloudflare env setup does not fail silently, but WHOP_API_KEY is preferred.
  return env.WHOP_API_KEY || env.WHOP_APP_API_KEY || env.WHOP_COMPANY_API_KEY || env.WHOP_CLIENT_SECRET;
}

function validateStatePayload(body) {
  if (!body || typeof body !== "object") return "Request body must be JSON.";
  if (!body.state || typeof body.state !== "object" || Array.isArray(body.state)) {
    return "Missing valid state object.";
  }

  const stateJson = JSON.stringify(body.state);
  if (stateJson.length > 900_000) return "Dashboard state is too large.";

  return null;
}

async function verifyWhopUser(request, env) {
  const headers = request.headers;
  const devUser = headers.get("x-dev-whop-user-id");

  if (env.ALLOW_DEV_AUTH === "true" && devUser) {
    return { userId: devUser, authMode: "dev" };
  }

  const token = headers.get("x-whop-user-token");
  if (!token) {
    throw json({
      ok: false,
      error: "Missing x-whop-user-token.",
      detail: "Open this dashboard from inside the Whop iframe/app and make same-origin fetches to /api. Direct pages.dev browser visits will not include this header.",
      appVersion: APP_VERSION,
    }, 401);
  }

  const apiKey = getWhopApiKey(env);
  if (!apiKey) {
    throw json({
      ok: false,
      error: "Server missing WHOP_API_KEY.",
      detail: "Add WHOP_API_KEY as a Cloudflare secret from your Whop app/company API key. Do not put this key in GitHub or index.html.",
      appVersion: APP_VERSION,
    }, 500);
  }

  const appID = getAppId(env);
  const whop = new Whop({ apiKey, appID });

  try {
    const verified = await whop.verifyUserToken(headers, { dontThrow: true });
    if (!verified || !verified.userId) {
      throw new Error("Whop SDK returned no userId.");
    }

    return { userId: verified.userId, authMode: "whop", appID };
  } catch (err) {
    console.error("Whop token verification failed", err);
    throw json({
      ok: false,
      error: "Invalid Whop user token.",
      detail: "The API received x-whop-user-token but could not verify it. Confirm WHOP_APP_ID and WHOP_API_KEY belong to the same Whop app that embeds this dashboard.",
      appVersion: APP_VERSION,
    }, 401);
  }
}

async function handleGet(request, env) {
  const { userId, authMode, appID } = await verifyWhopUser(request, env);
  const appId = appID || getAppId(env);

  const row = await env.DB.prepare(
    `SELECT state_json, app_version, client_updated_at, updated_at
     FROM dashboard_states
     WHERE whop_user_id = ? AND app_id = ?`
  ).bind(userId, appId).first();

  if (!row) {
    return json({
      ok: true,
      source: "empty",
      userId,
      authMode,
      appId,
      appVersion: APP_VERSION,
      state: null,
    });
  }

  let state = null;
  try {
    state = JSON.parse(row.state_json);
  } catch {
    return json({ ok: false, error: "Stored dashboard state is corrupted.", appVersion: APP_VERSION }, 500);
  }

  return json({
    ok: true,
    source: "remote",
    userId,
    authMode,
    appId,
    appVersion: row.app_version || APP_VERSION,
    state,
    clientUpdatedAt: row.client_updated_at,
    updatedAt: row.updated_at,
  });
}

async function handlePut(request, env) {
  const { userId, authMode, appID } = await verifyWhopUser(request, env);
  const appId = appID || getAppId(env);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body.", appVersion: APP_VERSION }, 400);
  }

  const validationError = validateStatePayload(body);
  if (validationError) return json({ ok: false, error: validationError, appVersion: APP_VERSION }, 400);

  const stateJson = JSON.stringify(body.state);
  const appVersion = String(body.appVersion || APP_VERSION).slice(0, 64);
  const clientUpdatedAt = String(body.clientUpdatedAt || new Date().toISOString()).slice(0, 64);

  await env.DB.prepare(
    `INSERT INTO dashboard_states
      (whop_user_id, app_id, state_json, app_version, client_updated_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(whop_user_id, app_id)
     DO UPDATE SET
       state_json = excluded.state_json,
       app_version = excluded.app_version,
       client_updated_at = excluded.client_updated_at,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(userId, appId, stateJson, appVersion, clientUpdatedAt).run();

  return json({
    ok: true,
    source: "remote",
    userId,
    authMode,
    appId,
    appVersion: APP_VERSION,
    savedAt: new Date().toISOString(),
  });
}

export async function onRequest(context) {
  const { request, env } = context;

  if (!env.DB) {
    return json({ ok: false, error: "D1 binding DB is missing.", appVersion: APP_VERSION }, 500);
  }

  try {
    if (request.method === "GET") return handleGet(request, env);
    if (request.method === "PUT") return handlePut(request, env);

    return json({ ok: false, error: "Method not allowed.", appVersion: APP_VERSION }, 405);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("Dashboard sync API error", err);
    return json({ ok: false, error: "Internal sync API error.", appVersion: APP_VERSION }, 500);
  }
}
