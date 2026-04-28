import Whop from "@whop/sdk";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function validateStatePayload(body) {
  if (!body || typeof body !== "object") return "Request body must be JSON.";
  if (!body.state || typeof body.state !== "object" || Array.isArray(body.state)) {
    return "Missing valid state object.";
  }

  const stateJson = JSON.stringify(body.state);
  // Dashboard state should be small. This blocks accidental massive uploads.
  if (stateJson.length > 900_000) return "Dashboard state is too large.";

  return null;
}

async function getWhopUserId(request, env) {
  const headers = request.headers;
  const devUser = headers.get("x-dev-whop-user-id");

  if (env.ALLOW_DEV_AUTH === "true" && devUser) {
    return { userId: devUser, authMode: "dev" };
  }

  const token = headers.get("x-whop-user-token");
  if (!token) {
    throw new Response(JSON.stringify({
      ok: false,
      error: "Missing x-whop-user-token. Use a same-origin /api request from inside the Whop iframe.",
    }), { status: 401, headers: JSON_HEADERS });
  }

  if (!env.WHOP_API_KEY) {
    throw new Response(JSON.stringify({
      ok: false,
      error: "Server missing WHOP_API_KEY secret.",
    }), { status: 500, headers: JSON_HEADERS });
  }

  const whop = new Whop({ apiKey: env.WHOP_API_KEY });

  // Whop docs show verifyUserToken(headers) returning { userId }.
  // Keep request.headers intact so the SDK can read x-whop-user-token directly.
  const verified = await whop.verifyUserToken(headers);
  if (!verified || !verified.userId) {
    throw new Response(JSON.stringify({ ok: false, error: "Invalid Whop user token." }), {
      status: 401,
      headers: JSON_HEADERS,
    });
  }

  return { userId: verified.userId, authMode: "whop" };
}

async function handleGet(request, env) {
  const { userId, authMode } = await getWhopUserId(request, env);
  const appId = "app_cv4W2wj4fEkMD4";

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
      state: null,
    });
  }

  let state = null;
  try {
    state = JSON.parse(row.state_json);
  } catch {
    return json({ ok: false, error: "Stored dashboard state is corrupted." }, 500);
  }

  return json({
    ok: true,
    source: "remote",
    userId,
    authMode,
    state,
    appVersion: row.app_version,
    clientUpdatedAt: row.client_updated_at,
    updatedAt: row.updated_at,
  });
}

async function handlePut(request, env) {
  const { userId, authMode } = await getWhopUserId(request, env);
  const appId = "app_cv4W2wj4fEkMD4";

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body." }, 400);
  }

  const validationError = validateStatePayload(body);
  if (validationError) return json({ ok: false, error: validationError }, 400);

  const stateJson = JSON.stringify(body.state);
  const appVersion = String(body.appVersion || "unknown").slice(0, 64);
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
    savedAt: new Date().toISOString(),
  });
}

export async function onRequest(context) {
  const { request, env } = context;

  if (!env.DB) {
    return json({ ok: false, error: "D1 binding DB is missing." }, 500);
  }

  try {
    if (request.method === "GET") return handleGet(request, env);
    if (request.method === "PUT") return handlePut(request, env);

    return json({ ok: false, error: "Method not allowed." }, 405);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("Dashboard sync API error", err);
    return json({ ok: false, error: "Internal sync API error." }, 500);
  }
}
