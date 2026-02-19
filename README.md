> **Disclaimer:** This sample app intended as example only, to be used only within non-production environments for testing Okta Universal Logout functionality in lab type settings. No warranties nor support are provided. Use at your own risk.

# SecureBank — Okta Identity Demo App

A Node.js/Express banking demo application that showcases Okta's core identity and security features: OIDC authentication, MFA step-up for sensitive operations, profile management via the Okta Management API, and **Universal Logout** via the Global Token Revocation (GTR) specification.

---

## Features

### Authentication (OIDC)
Users sign in via Okta using the Authorization Code flow (`passport-openidconnect`). On successful login the session is registered in an in-memory store for Universal Logout tracking.

### MFA Step-Up Authentication
Sensitive operations require the user to re-authenticate with a second factor before proceeding, even if they already have an active session. This is implemented using Okta's `acr_values: urn:okta:loa:2fa:any` parameter, which forces a fresh MFA challenge. The MFA verification is valid for **5 minutes**; after that the user must step up again.

Protected routes:
- `GET /profile/edit` — edit profile
- `POST /profile/okta` — save Okta profile changes
- `POST /profile/preferences` — save local preferences
- `GET /wire-transfer` — initiate a wire transfer

### Profile Management
Authenticated users can view their Okta profile. After completing MFA step-up they can edit:
- First name, last name, mobile phone (written back to Okta via the Management API)
- App-level preferences (notifications, theme, language, currency display, date format) stored in a local SQLite database

### Wire Transfers
A demo wire transfer form (MFA-gated) validates recipient details, routing/account numbers, and available balance before generating a confirmation reference number.

### Universal Logout — Global Token Revocation (GTR)
The app implements the [Okta Universal Logout](https://developer.okta.com/docs/guides/oin-universal-logout-overview/) specification. When an admin triggers Universal Logout from the Okta dashboard, Okta sends a signed JWT to the app's GTR endpoint. The app validates the JWT and immediately destroys all server-side sessions for the identified user.

#### GTR Endpoint
```
POST /api/global-token-revocation
Authorization: Bearer <Okta-signed JWT>
Content-Type: application/json
```

**Request body — email format:**
```json
{
  "sub_id": {
    "format": "email",
    "email": "user@example.com"
  }
}
```

**Request body — iss_sub format:**
```json
{
  "sub_id": {
    "format": "iss_sub",
    "iss": "https://your-org.okta.com",
    "sub": "00u1ab2cd3EF456gh7i8"
  }
}
```

**Response codes:**
| Code | Meaning |
|------|---------|
| 204 | Sessions revoked successfully |
| 400 | Malformed request or unrecognized subject format |
| 401 | Missing or invalid JWT |
| 422 | Unable to revoke sessions |

#### JWT Validation
Okta signs the GTR request with RS256 using its private key. The app:
1. Fetches Okta's public keys from the JWKS endpoint (`/oauth2/v1/keys`)
2. Verifies the JWT signature, issuer, and expiry
3. Validates the `aud` claim against the registered revocation endpoint URL
4. Destroys all matching sessions from the in-memory store

---

## Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/` | — | Home / landing page |
| `GET` | `/login` | — | Initiates Okta OIDC login |
| `GET` | `/authorization-code/callback` | — | OIDC callback |
| `GET` | `/stepup-mfa` | Session | Initiates MFA step-up |
| `GET` | `/authorization-code/callback-mfa` | — | MFA step-up callback |
| `GET` | `/profile` | Session | View profile |
| `GET` | `/profile/edit` | Session + MFA | Edit profile form |
| `POST` | `/profile/okta` | Session + MFA | Save Okta profile |
| `POST` | `/profile/preferences` | Session + MFA | Save local preferences |
| `GET` | `/wire-transfer` | Session + MFA | Wire transfer form |
| `POST` | `/wire-transfer` | Session | Submit wire transfer |
| `POST` | `/logout` | Session | Sign out (Okta + local session) |
| `POST` | `/api/global-token-revocation` | Okta JWT | Universal Logout GTR endpoint |
| `GET` | `/api/health` | — | Health check |

---

## Setup

### Prerequisites
- Node.js 18+
- An Okta org (developer or preview)
- An Okta OIDC Web Application with:
  - The appropriate redirect URIs registered (see below)
  - Universal Logout enabled and the GTR endpoint URL configured
- An Okta API token (SSWS) for the Management API

### Environment Variables

Create a `.okta.env` file in the project root:

```env
ORG_URL=https://your-org.oktapreview.com/
CLIENT_ID=your_client_id
CLIENT_SECRET=your_client_secret
OKTA_API_TOKEN=your_ssws_api_token
BASE_URL=https://your-app-domain.com   # omit for localhost:3000
SESSION_SECRET=your_session_secret     # optional, has a default
```

### Install & Run

```bash
npm install
npm start        # production
npm run dev      # development (nodemon)
```

The app listens on port **3000** by default.

### Redirect URIs to Register in Okta

**Sign-in redirect URIs:**
```
http://localhost:3000/authorization-code/callback
http://localhost:3000/authorization-code/callback-mfa
```

**Sign-out redirect URIs:**
```
http://localhost:3000/
```

Replace `http://localhost:3000` with your `BASE_URL` for non-local deployments.

---

## Running with ngrok

To expose the app publicly (e.g. for Okta Universal Logout callbacks):

```bash
# Set auth token once
ngrok config add-authtoken <your_token>

# Start tunnel
ngrok http 3000
```

Then update `.okta.env`:
```env
BASE_URL=https://your-ngrok-subdomain.ngrok-free.dev
```

Add the ngrok redirect URIs to your Okta app and restart the server. The Universal Logout GTR endpoint will be reachable at:
```
https://your-ngrok-subdomain.ngrok-free.dev/api/global-token-revocation
```

> **Note:** Free-tier ngrok URLs change on every restart. You will need to update `BASE_URL`, the Okta app redirect URIs, and the Universal Logout endpoint configuration each time.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                        Browser                          │
└────────────────────┬──────────────────┬─────────────────┘
                     │                  │
              OIDC / MFA          App requests
                     │                  │
          ┌──────────▼──────┐   ┌───────▼────────────────┐
          │    Okta Org     │   │   Express App (:3000)   │
          │                 │   │                         │
          │  Authorization  │   │  passport-openidconnect │
          │  Token endpoint │   │  Session store          │
          │  JWKS endpoint  │   │  Profile routes         │
          │  Management API │   │  Wire transfer routes   │
          │                 │   │  GTR endpoint           │
          └────────┬────────┘   └─────────────────────────┘
                   │
        Universal Logout trigger
                   │
          POST /api/global-token-revocation
          (Okta-signed JWT → validate → destroy sessions)
```

---

## Tech Stack

- **Runtime:** Node.js (ESM)
- **Framework:** Express 5
- **Auth:** passport + passport-openidconnect
- **Identity Provider:** Okta (OIDC + Management API)
- **Session store:** express-session (in-memory)
- **Database:** SQLite (user preferences)
- **JWT validation:** jsonwebtoken + jwks-rsa
- **Views:** Pug
