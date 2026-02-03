import session from 'express-session';

// Create a memory store instance that can be shared across the application
// This allows the universal logout endpoint to access and destroy sessions
const MemoryStore = session.MemoryStore;
export const store = new MemoryStore();

// Map to track session IDs by user email for quick lookup during universal logout
// Key: user email, Value: Set of session IDs
export const userSessions = new Map();

/**
 * Register a session for a user
 * @param {string} email - User's email address
 * @param {string} sessionId - Session ID to register
 */
export function registerUserSession(email, sessionId) {
  if (!email || !sessionId) return;

  const normalizedEmail = email.toLowerCase();
  if (!userSessions.has(normalizedEmail)) {
    userSessions.set(normalizedEmail, new Set());
  }
  userSessions.get(normalizedEmail).add(sessionId);
  console.log(`Session registered for ${normalizedEmail}: ${sessionId}`);
}

/**
 * Unregister a session for a user
 * @param {string} email - User's email address
 * @param {string} sessionId - Session ID to unregister
 */
export function unregisterUserSession(email, sessionId) {
  if (!email || !sessionId) return;

  const normalizedEmail = email.toLowerCase();
  if (userSessions.has(normalizedEmail)) {
    userSessions.get(normalizedEmail).delete(sessionId);
    if (userSessions.get(normalizedEmail).size === 0) {
      userSessions.delete(normalizedEmail);
    }
  }
}

/**
 * Destroy all sessions for a user by email
 * @param {string} email - User's email address
 * @returns {Promise<number>} Number of sessions destroyed
 */
export async function destroyUserSessions(email) {
  if (!email) return 0;

  const normalizedEmail = email.toLowerCase();
  let destroyedCount = 0;

  // Method 1: Use the userSessions map for quick lookup
  if (userSessions.has(normalizedEmail)) {
    const sessionIds = userSessions.get(normalizedEmail);
    for (const sid of sessionIds) {
      store.destroy(sid, (err) => {
        if (err) {
          console.error(`Error destroying session ${sid}:`, err);
        }
      });
      destroyedCount++;
    }
    userSessions.delete(normalizedEmail);
  }

  // Method 2: Also scan all sessions as a fallback (in case map is out of sync)
  // This handles edge cases where sessions exist but weren't properly tracked
  return new Promise((resolve) => {
    store.all((err, sessions) => {
      if (err || !sessions) {
        resolve(destroyedCount);
        return;
      }

      for (const [sid, sessionData] of Object.entries(sessions)) {
        if (sessionData.passport && sessionData.passport.user) {
          const user = sessionData.passport.user;
          const userEmail = user.emails?.[0]?.value ||
                           user.email ||
                           user._json?.email ||
                           user.preferred_username;

          if (userEmail && userEmail.toLowerCase() === normalizedEmail) {
            store.destroy(sid, (destroyErr) => {
              if (destroyErr) {
                console.error(`Error destroying session ${sid}:`, destroyErr);
              }
            });
            destroyedCount++;
          }
        }
      }

      console.log(`Destroyed ${destroyedCount} sessions for ${normalizedEmail}`);
      resolve(destroyedCount);
    });
  });
}
