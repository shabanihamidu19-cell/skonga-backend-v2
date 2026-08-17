# SKONGA — Payment & transport security

SKONGA is **not** a mobile-money wallet. We initiate **STK Push** via a PSP/aggregator.
The user enters M-Pesa / Tigo / Airtel / Halo **PIN only on the phone STK dialog** — never in the app, never on our API.

## What the security checklist means for us

| Advice (generic) | SKONGA reality | Action |
|------------------|----------------|--------|
| TLS/SSL | Render terminates HTTPS | Always use `https://` API_BASE; no cleartext |
| Certificate pinning | Optional; certs rotate on Render | Prefer Play Store distribution + HTTPS; pin later if threat model requires |
| PIN / OTP in app | **Forbidden** | Reject `pin`/`otp`/`password` on `/api/payments/*` |
| MFA / biometrics | For **Firebase login**, not for M-Pesa PIN | Optional app lock later |
| AES-256 everything | Encrypt **server secrets** in env; do not store PIN | No mobile-money credentials on device |
| Root detection | Nice-to-have for Pro abuse | Not a substitute for server-side Pro |
| SIM swap | Handled by MNO + user | We only store phone for STK target |

## Anti–man-in-the-middle / middle trackers

### Already in place
- App → Backend: **HTTPS only** (`https://skonga-backend-v2.onrender.com`)
- Backend → Library / AI providers: HTTPS
- Webhook HMAC (`PAYMENT_WEBHOOK_SECRET` + `X-SKONGA-Signature`)
- `trust proxy` for correct client IP behind Render
- Rate limit on payment initiate
- Server-side plan prices (client cannot invent amount)

### Hard rules
1. **Never** log full phone + order secrets together in production logs.
2. **Never** accept or store mobile-money PIN/OTP.
3. Pro is granted **only** after verified webhook (or sandbox-confirm when `PAYMENT_MODE=sandbox`).
4. Client `localStorage` Pro is **cache only** — always re-check `GET /api/payments/pro`.
5. Do not ship payment provider API keys in the APK.

### Headers (server)
`server.js` should send:
- `Strict-Transport-Security` (when behind HTTPS)
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy` restricting camera/mic to self as needed

### Client
- Refuse non-HTTPS `API_BASE` in production builds
- Do not put PIN fields in the pay UI (already documented in UI copy)
- Clear phone field from memory after initiate when possible
- Prefer Play Store / signed APK (blocks sideloaded clones)

## Env (production)

```bash
PAYMENT_MODE=live
PAYMENT_PROVIDER=selcom   # or azampay / your PSP
PAYMENT_WEBHOOK_SECRET=<openssl rand -hex 32>
```

Sandbox:

```bash
PAYMENT_MODE=sandbox
# POST /api/payments/sandbox-confirm { orderId } only when sandbox
```

## Threat notes
- **Phishing:** Users must only enter PIN on the official network STK prompt.
- **Fake apps:** Distribute via Play Store; signed release keystore.
- **MITM on public Wi‑Fi:** TLS on all API calls mitigates passive sniffing.
- **localStorage Pro bypass:** Mitigated by server `getProStatus` before unlocking paid features (wire app to check API).

## Next engineering steps
1. Wire app `paySubmit()` → `POST /api/payments/initiate`
2. Poll `GET /api/payments/pro` or order status until paid
3. Connect live PSP + webhook URL on Render
4. Optional: certificate pinning in Capacitor HTTP layer
