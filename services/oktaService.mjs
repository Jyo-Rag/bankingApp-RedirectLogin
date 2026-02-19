import okta from '@okta/okta-sdk-nodejs';
import dotenv from 'dotenv';

// Load from .okta.env for local development
dotenv.config({ path: '.okta.env' });

// Get from environment (works for both local and Render)
const ORG_URL = process.env.ORG_URL;
const OKTA_API_TOKEN = process.env.OKTA_API_TOKEN;

console.log('Okta Service initializing...');
console.log('ORG_URL:', ORG_URL ? 'Set' : 'Not set');
console.log('OKTA_API_TOKEN:', OKTA_API_TOKEN ? 'Set (length: ' + OKTA_API_TOKEN.length + ')' : 'Not set');

// Initialize Okta client with Management API token
let oktaClient = null;

if (OKTA_API_TOKEN && ORG_URL) {
  try {
    oktaClient = new okta.Client({
      orgUrl: ORG_URL,
      token: OKTA_API_TOKEN
    });
    console.log('Okta Management API client initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Okta client:', error.message);
  }
} else {
  console.warn('OKTA_API_TOKEN or ORG_URL not set - profile updates to Okta will be disabled');
}

/**
 * Get user profile from Okta
 * @param {string} userId - Okta user ID or login (email)
 * @returns {Promise<object>} User profile data
 */
export async function getOktaUserProfile(userId) {
  if (!oktaClient) {
    throw new Error('Okta Management API not configured');
  }

  console.log('Fetching Okta profile for:', userId);

  try {
    const user = await oktaClient.userApi.getUser({ userId });
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
    if (error.status) {
      console.error('HTTP Status:', error.status);
    }
    throw error;
  }
}

/**
 * Update user profile in Okta
 * @param {string} userId - Okta user ID or login (email)
 * @param {object} profileData - Profile fields to update
 * @returns {Promise<object>} Updated profile
 */
export async function updateOktaUserProfile(userId, profileData) {
  if (!oktaClient) {
    throw new Error('Okta Management API not configured');
  }

  console.log('Updating Okta profile for:', userId);
  console.log('Profile data:', JSON.stringify(profileData));

  try {
    // First get the current user
    const currentUser = await oktaClient.userApi.getUser({ userId });
    console.log('Found user:', currentUser.id);

    // Build the update payload
    const updatePayload = {
      profile: { ...currentUser.profile }
    };

    // Only update allowed fields
    const allowedFields = ['firstName', 'lastName', 'mobilePhone', 'displayName'];
    for (const field of allowedFields) {
      if (profileData[field] !== undefined) {
        updatePayload.profile[field] = profileData[field];
      }
    }

    // Update the user
    const updatedUser = await oktaClient.userApi.updateUser({
      userId: currentUser.id,
      user: updatePayload
    });

    console.log('User updated successfully');

    return {
      success: true,
      profile: {
        firstName: updatedUser.profile.firstName,
        lastName: updatedUser.profile.lastName,
        mobilePhone: updatedUser.profile.mobilePhone,
        displayName: updatedUser.profile.displayName
      }
    };
  } catch (error) {
    console.error('Error updating Okta user:', error.message);
    if (error.status) {
      console.error('HTTP Status:', error.status);
    }
    if (error.errorCauses) {
      console.error('Error causes:', JSON.stringify(error.errorCauses));
    }
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
