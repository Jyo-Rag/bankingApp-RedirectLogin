import express from 'express';
const router = express.Router();

// MFA verification timeout (5 minutes)
const MFA_TIMEOUT = 5 * 60 * 1000;

function ensureLoggedIn(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/login');
}

/**
 * Middleware to ensure user has completed MFA step-up authentication
 * Required for sensitive operations like wire transfers
 */
function ensureMfaVerified(req, res, next) {
  const mfaVerified = req.session.mfaVerified;
  const mfaVerifiedAt = req.session.mfaVerifiedAt;
  const now = Date.now();

  if (mfaVerified && mfaVerifiedAt && (now - mfaVerifiedAt) < MFA_TIMEOUT) {
    return next();
  }

  console.log('MFA step-up required for wire transfer');
  req.session.mfaReturnUrl = '/wire-transfer';
  res.redirect('/stepup-mfa');
}

// Source accounts (hardcoded to match dashboard display)
const SOURCE_ACCOUNTS = [
  { id: 'checking', label: 'Checking Account (****4582)', balance: 12458.32 },
  { id: 'savings', label: 'Savings Account (****7891)', balance: 45230.00 }
];

// GET /wire-transfer - Show the wire transfer form
router.get('/', ensureLoggedIn, ensureMfaVerified, (req, res) => {
  res.render('wire-transfer', {
    authenticated: req.isAuthenticated(),
    accounts: SOURCE_ACCOUNTS,
    error: req.query.error || null,
    formData: {}
  });
});

// POST /wire-transfer - Validate and process the wire transfer
router.post('/', ensureLoggedIn, (req, res) => {
  const { fromAccount, recipientName, recipientBank, routingNumber, accountNumber, amount, memo } = req.body;

  // Validation
  const errors = [];

  if (!fromAccount || !SOURCE_ACCOUNTS.find(a => a.id === fromAccount)) {
    errors.push('Please select a valid source account.');
  }

  if (!recipientName || !recipientName.trim()) {
    errors.push('Recipient name is required.');
  }

  if (!recipientBank || !recipientBank.trim()) {
    errors.push('Recipient bank name is required.');
  }

  if (!routingNumber || !/^\d{9}$/.test(routingNumber.trim())) {
    errors.push('Routing number must be exactly 9 digits.');
  }

  if (!accountNumber || !accountNumber.trim()) {
    errors.push('Account number is required.');
  }

  const parsedAmount = parseFloat(amount);
  if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
    errors.push('Please enter a valid amount greater than $0.00.');
  }

  const sourceAccount = SOURCE_ACCOUNTS.find(a => a.id === fromAccount);
  if (sourceAccount && parsedAmount > sourceAccount.balance) {
    errors.push(`Insufficient funds. Available balance: $${sourceAccount.balance.toFixed(2)}`);
  }

  if (errors.length > 0) {
    return res.render('wire-transfer', {
      authenticated: req.isAuthenticated(),
      accounts: SOURCE_ACCOUNTS,
      error: errors.join(' '),
      formData: req.body
    });
  }

  // Generate a confirmation reference number
  const refNumber = 'WT-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
  const timestamp = new Date().toLocaleString('en-US', {
    dateStyle: 'full',
    timeStyle: 'short'
  });

  res.render('wire-transfer-confirm', {
    authenticated: req.isAuthenticated(),
    transfer: {
      fromAccount: sourceAccount.label,
      recipientName: recipientName.trim(),
      recipientBank: recipientBank.trim(),
      routingNumber: routingNumber.trim(),
      accountNumber: accountNumber.trim(),
      amount: parsedAmount.toFixed(2),
      memo: memo ? memo.trim() : 'N/A',
      refNumber,
      timestamp
    }
  });
});

export default router;
