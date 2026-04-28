# Destiny Fitness Dashboard v1.6.0 — Whop Cross-Device Sync

This package turns the dashboard from localStorage-only into account-level sync.

## What changed

- `index.html` keeps localStorage as fast/offline cache.
- The reactive state Proxy now queues remote saves to `/api/dashboard/state`.
- `/functions/api/dashboard/state.js` verifies the Whop iframe user token server-side.
- Cloudflare D1 stores one dashboard state per verified Whop user ID + Whop app ID.

## Why same-origin `/api`

Whop iframe auth sends `x-whop-user-token` only to same-origin app requests. Keep the frontend and API under the same Cloudflare Pages domain, or reverse-proxy `/api` to the backend.

## Setup

1. Create D1:

```bash
npm install
npx wrangler d1 create destiny_fitness_dashboard
```

2. Put the returned database ID into `wrangler.toml`.

3. Run schema:

```bash
npx wrangler d1 execute destiny_fitness_dashboard --remote --file=schema.sql
```

4. Add secret:

```bash
npx wrangler secret put WHOP_API_KEY
```

5. Deploy Cloudflare Pages.

6. In Whop app settings, make sure the app base URL points to the same Cloudflare Pages domain that serves this HTML and `/api/dashboard/state`.

## Local dev

You can temporarily enable dev auth:

```toml
ALLOW_DEV_AUTH = "true"
```

Then pass `x-dev-whop-user-id: dev_user_123` to API calls. Do not enable this in production.

## Security notes

- Never expose `WHOP_API_KEY` in the frontend.
- Never trust a user ID sent from the browser.
- Server derives identity from Whop's iframe token.
