import okta from '@okta/okta-sdk-nodejs';
import dotenv from 'dotenv';

dotenv.config({ path: '.okta.env' });

const { ORG_URL, OKTA_API_TOKEN } = process.env;

// Initialize Okta client with Management API token
let oktaClient = null;

if (OKTA_API_TOKEN) {
  oktaClient = new okta.Client({
    orgUrl: ORG_URL,
    token: OKTA_API_TOKEN
  });
  console.log('Okta Management API client initialized');
} else {
  console.warn('OKTA_API_TOKEN not set - profile updates to Okta will be disabled');
}

/**
 * Get user profile from Okta
 * @param {string} userId - Okta user ID
 * @returns {Promise<object>} User profile data
 */
export async function getOktaUserProfile(userId) {
  if (!oktaClient) {
    throw new Error('Okta Management API not configured');
  }

  try {
    const user = await oktaClient.getUser(userId);
    return {
      id: user.id,
      firstName: user.profile.firstName,
      lastName: user.profile.lastName,
      email: user.profile.email,
      mobilePhone: user.profile.mobilePhone,
      displayName: user.profile.displayName,
      login: user.profile.login
    };
  } catch (error) {
    console.error('Error fetching Okta user:', error.message);
    throw error;
  }
}

/**
 * Update user profile in Okta
 * @param {string} userId - Okta user ID
 * @param {object} profileData - Profile fields to update
 * @returns {Promise<object>} Updated profile
 */
export async function updateOktaUserProfile(userId, profileData) {
  if (!oktaClient) {
    throw new Error('Okta Management API not configured');
  }

  try {
    const user = await oktaClient.getUser(userId);

    // Only allow specific fields to be updated
    const allowedFields = ['firstName', 'lastName', 'mobilePhone', 'displayName'];

    for (const field of allowedFields) {
      if (profileData[field] !== undefined) {
        user.profile[field] = profileData[field];
      }
    }

    await user.update();

    return {
      success: true,
      profile: {
        firstName: user.profile.firstName,
        lastName: user.profile.lastName,
        mobilePhone: user.profile.mobilePhone,
        displayName: user.profile.displayName
      }
    };
  } catch (error) {
    console.error('Error updating Okta user:', error.message);
    throw error;
  }
}

/**
 * Check if Okta Management API is available
 * @returns {boolean}
 */
export function isOktaApiAvailable() {
  return oktaClient !== null;
}
