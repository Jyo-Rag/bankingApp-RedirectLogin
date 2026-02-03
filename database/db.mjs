import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// JSON file path for preferences storage
const dbPath = path.join(__dirname, 'preferences.json');

/**
 * Load preferences from JSON file
 * @returns {object} Preferences data
 */
function loadData() {
  try {
    if (fs.existsSync(dbPath)) {
      const data = fs.readFileSync(dbPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading preferences:', error.message);
  }
  return { users: {} };
}

/**
 * Save preferences to JSON file
 * @param {object} data - Data to save
 */
function saveData(data) {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving preferences:', error.message);
  }
}

/**
 * Get default preferences
 * @returns {object} Default preference values
 */
function getDefaultPreferences() {
  return {
    email_notifications: 1,
    sms_notifications: 0,
    push_notifications: 1,
    transaction_alerts: 1,
    marketing_emails: 0,
    theme: 'light',
    language: 'en',
    currency_display: 'USD',
    date_format: 'MM/DD/YYYY',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

/**
 * Get user preferences by Okta user ID
 * @param {string} oktaUserId - Okta user ID
 * @returns {object|undefined} User preferences or undefined
 */
export function getUserPreferences(oktaUserId) {
  const data = loadData();
  return data.users[oktaUserId];
}

/**
 * Create user preferences record
 * @param {string} oktaUserId - Okta user ID
 * @param {string} email - User email
 * @returns {object} Created preferences
 */
export function createUserPreferences(oktaUserId, email) {
  const data = loadData();

  if (!data.users[oktaUserId]) {
    data.users[oktaUserId] = {
      okta_user_id: oktaUserId,
      email: email,
      ...getDefaultPreferences()
    };
    saveData(data);
  }

  return data.users[oktaUserId];
}

/**
 * Update user preferences
 * @param {string} oktaUserId - Okta user ID
 * @param {object} preferences - Preferences to update
 * @returns {object|null} Updated preferences
 */
export function updateUserPreferences(oktaUserId, preferences) {
  const allowedFields = [
    'email_notifications', 'sms_notifications', 'push_notifications',
    'transaction_alerts', 'marketing_emails', 'theme', 'language',
    'currency_display', 'date_format'
  ];

  const data = loadData();

  if (!data.users[oktaUserId]) {
    return null;
  }

  for (const [key, value] of Object.entries(preferences)) {
    if (allowedFields.includes(key)) {
      data.users[oktaUserId][key] = value;
    }
  }

  data.users[oktaUserId].updated_at = new Date().toISOString();
  saveData(data);

  return data.users[oktaUserId];
}

export default { getUserPreferences, createUserPreferences, updateUserPreferences };
