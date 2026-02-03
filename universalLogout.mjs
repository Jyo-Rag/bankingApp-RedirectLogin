import { Router } from 'express';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { destroyUserSessions } from './sessionStore.mjs';

export const universalLogoutRoute = Router();

// JWKS client for fetching Okta's public keys
let jwksClientInstance = null;

/**
 * Initialize the JWKS client with the Okta org URL
 * @param {string} orgUrl - The Okta organization URL
 */
export function initializeJwksClient(orgUrl) {
  const baseUrl = orgUrl.endsWith('/') ? orgUrl.slice(0, -1) : orgUrl;
  jwksClientInstance = jwksClient({
    jwksUri: `${baseUrl}/oauth2/v1/keys`,
    cache: true,
    cacheMaxAge: 86400000, // 24 hours
    rateLimit: true,
    jwksRequestsPerMinute: 10
  });
  console.log(`JWKS client initialized for: ${baseUrl}/oauth2/v1/keys`);
}

/**
 * Get the signing key from JWKS
 * @param {object} header - JWT header containing kid
 * @returns {Promise<string>} The public key
 */
function getSigningKey(header) {
  return new Promise((resolve, reject) => {
    if (!jwksClientInstance) {
      reject(new Error('JWKS client not initialized'));
      return;
    }
    jwksClientInstance.getSigningKey(header.kid, (err, key) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(key.getPublicKey());
    });
  });
}

/**
 * Validate the Universal Logout JWT token from Okta
 *
 * Expected JWT format:
 * Header: { "typ": "global-token-revocation+jwt", "alg": "RS256" }
 * Payload: { "jti", "iss", "sub", "aud", "exp", "nbf", "iat" }
 *
 * @param {string} token - The JWT token
 * @param {string} expectedAudience - The expected audience (revocation endpoint URL)
 * @param {string} expectedIssuer - The expected issuer (Okta org URL)
 * @returns {Promise<object>} Decoded token payload
 */
async function validateLogoutToken(token, expectedAudience, expectedIssuer) {
  // First decode without verification to get the header
  const decoded = jwt.decode(token, { complete: true });

  if (!decoded) {
    throw new Error('Invalid token format');
  }

  // Validate token type
  if (decoded.header.typ !== 'global-token-revocation+jwt') {
    console.warn(`Unexpected token type: ${decoded.header.typ}`);
    // Allow for flexibility during development/testing
  }

  // Get the signing key
  const signingKey = await getSigningKey(decoded.header);

  // Verify the token
  return new Promise((resolve, reject) => {
    jwt.verify(token, signingKey, {
      algorithms: ['RS256', 'RS384', 'RS512'],
      issuer: expectedIssuer,
      audience: expectedAudience,
      clockTolerance: 30 // Allow 30 seconds of clock skew
    }, (err, payload) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(payload);
    });
  });
}

/**
 * Extract user identifier from the request body
 * Supports both 'email' and 'iss_sub' formats per Okta specification
 *
 * @param {object} subId - The sub_id object from the request
 * @returns {object} Object with identifier type and value
 */
function extractUserIdentifier(subId) {
  if (!subId || typeof subId !== 'object') {
    return null;
  }

  switch (subId.format) {
    case 'email':
      if (!subId.email) return null;
      return {
        type: 'email',
        value: subId.email,
        email: subId.email
      };

    case 'iss_sub':
      if (!subId.iss || !subId.sub) return null;
      return {
        type: 'iss_sub',
        value: `${subId.iss}|${subId.sub}`,
        issuer: subId.iss,
        subject: subId.sub
      };

    default:
      return null;
  }
}

/**
 * Middleware to authenticate Universal Logout requests
 * Validates the JWT bearer token from Okta
 */
export function universalLogoutAuth(orgUrl, revocationEndpoint) {
  const expectedIssuer = orgUrl.endsWith('/') ? orgUrl.slice(0, -1) : orgUrl;

  return async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      console.log('Universal logout: Missing authorization header');
      return res.status(401).json({
        error: 'unauthorized',
        error_description: 'Missing authorization header'
      });
    }

    const [scheme, token] = authHeader.split(' ');

    if (scheme.toLowerCase() !== 'bearer' || !token) {
      console.log('Universal logout: Invalid authorization scheme');
      return res.status(401).json({
        error: 'unauthorized',
        error_description: 'Invalid authorization scheme. Expected: Bearer {token}'
      });
    }

    try {
      // Validate the JWT
      const payload = await validateLogoutToken(token, revocationEndpoint, expectedIssuer);

      console.log('Universal logout: Token validated successfully');
      console.log('Token payload:', JSON.stringify(payload, null, 2));

      // Attach the validated token payload to the request
      req.logoutToken = payload;
      next();
    } catch (err) {
      console.error('Universal logout: Token validation failed:', err.message);

      // Check for specific JWT errors
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          error: 'unauthorized',
          error_description: 'Token has expired'
        });
      }

      if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({
          error: 'unauthorized',
          error_description: `Invalid token: ${err.message}`
        });
      }

      return res.status(401).json({
        error: 'unauthorized',
        error_description: 'Token validation failed'
      });
    }
  };
}

/**
 * Global Token Revocation Endpoint
 *
 * Implements the IETF Global Token Revocation specification as required by Okta
 * https://developer.okta.com/docs/guides/oin-universal-logout-overview/
 *
 * Request format:
 * POST /global-token-revocation
 * Authorization: Bearer {JWT signed by Okta}
 * Content-Type: application/json
 *
 * Body (email format):
 * {
 *   "sub_id": {
 *     "format": "email",
 *     "email": "user@example.com"
 *   }
 * }
 *
 * Body (iss_sub format):
 * {
 *   "sub_id": {
 *     "format": "iss_sub",
 *     "iss": "https://issuer.example.com/",
 *     "sub": "user_id_123"
 *   }
 * }
 *
 * Response codes per Okta specification:
 * - 204: Success - user sessions and tokens revoked
 * - 400: Malformed request or unrecognized subject identifier
 * - 401: Missing or invalid authentication credentials
 * - 403: Insufficient authorization/missing scope
 * - 404: User not found by subject identifier
 * - 422: Unable to revoke user sessions
 */
universalLogoutRoute.post('/global-token-revocation', async (req, res) => {
  console.log('==========================================');
  console.log('Universal Logout Request Received');
  console.log('==========================================');
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body:', JSON.stringify(req.body, null, 2));

  // Validate request body exists
  if (!req.body) {
    console.log('Error: Empty request body');
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'Request body is required'
    });
  }

  const { sub_id } = req.body;

  // Validate sub_id structure
  if (!sub_id) {
    console.log('Error: Missing sub_id');
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'sub_id is required'
    });
  }

  // Extract user identifier (supports both email and iss_sub formats)
  const userIdentifier = extractUserIdentifier(sub_id);

  if (!userIdentifier) {
    console.log('Error: Invalid or unrecognized subject identifier format');
    return res.status(400).json({
      error: 'invalid_request',
      error_description: `Unrecognized subject identifier format: ${sub_id.format}. Supported formats: email, iss_sub`
    });
  }

  console.log(`Processing logout for: ${userIdentifier.type} = ${userIdentifier.value}`);

  try {
    let destroyedCount = 0;

    // Handle based on identifier type
    if (userIdentifier.type === 'email') {
      destroyedCount = await destroyUserSessions(userIdentifier.email);
    } else if (userIdentifier.type === 'iss_sub') {
      // For iss_sub format, we need to look up the user by their Okta subject ID
      // This would typically involve a database lookup to map sub to email
      // For now, we'll attempt to destroy sessions using the subject as an identifier
      destroyedCount = await destroyUserSessionsBySubject(userIdentifier.subject);
    }

    if (destroyedCount === 0) {
      // Per Okta spec: 404 if user not found by subject identifier
      // However, for security, some implementations return 204 to not leak user existence
      console.log(`No active sessions found for: ${userIdentifier.value}`);

      // Return 204 for idempotent behavior (recommended for security)
      return res.sendStatus(204);
    }

    console.log(`Successfully revoked ${destroyedCount} session(s) for: ${userIdentifier.value}`);
    return res.sendStatus(204);

  } catch (error) {
    console.error('Error during universal logout:', error);

    // 422: Unable to revoke user sessions
    return res.status(422).json({
      error: 'unprocessable_entity',
      error_description: 'Unable to revoke user sessions'
    });
  }
});

/**
 * Destroy sessions by Okta subject ID
 * Used for iss_sub format identifiers
 *
 * @param {string} subject - The Okta subject ID
 * @returns {Promise<number>} Number of sessions destroyed
 */
async function destroyUserSessionsBySubject(subject) {
  // Import store directly for session scanning
  const { store } = await import('./sessionStore.mjs');

  return new Promise((resolve) => {
    let destroyedCount = 0;

    store.all((err, sessions) => {
      if (err || !sessions) {
        resolve(0);
        return;
      }

      for (const [sid, sessionData] of Object.entries(sessions)) {
        if (sessionData.passport && sessionData.passport.user) {
          const user = sessionData.passport.user;
          // Check if the user's Okta ID matches the subject
          if (user.id === subject || user._json?.sub === subject) {
            store.destroy(sid, (destroyErr) => {
              if (destroyErr) {
                console.error(`Error destroying session ${sid}:`, destroyErr);
              }
            });
            destroyedCount++;
          }
        }
      }

      console.log(`Destroyed ${destroyedCount} sessions for subject: ${subject}`);
      resolve(destroyedCount);
    });
  });
}

/**
 * Health check endpoint
 */
universalLogoutRoute.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'SecureBank Universal Logout',
    version: '2.0',
    supported_formats: ['email', 'iss_sub'],
    timestamp: new Date().toISOString()
  });
});

// Error handler for universal logout routes
universalLogoutRoute.use((err, req, res, next) => {
  console.error('Universal logout error:', err);
  return res.status(500).json({
    error: 'server_error',
    error_description: 'An unexpected error occurred'
  });
});

export default universalLogoutRoute;
