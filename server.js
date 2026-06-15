const express = require('express');
const cors = require('cors');
const app = express();

function normalizeAmountToCents(input) {
  const amountNumber = Number(input);
  if (!Number.isFinite(amountNumber)) return null;
  if (amountNumber <= 0) return null;

  // Accept either cents (integer >= 100) or RM (decimal), always send integer cents.
  if (Number.isInteger(amountNumber) && amountNumber >= 100) {
    return amountNumber;
  }

  return Math.round(amountNumber * 100);
}

function normalizeMobile(input) {
  if (!input) return '';
  const raw = String(input).trim();
  if (!raw) return '';

  // Billplz expects digits-only Malaysian mobile format, e.g. 60123456789.
  const digitsOnly = raw.replace(/\D/g, '');
  if (!digitsOnly) return '';

  let normalized = digitsOnly;
  if (normalized.startsWith('0')) {
    normalized = `60${normalized.slice(1)}`;
  }

  if (normalized.startsWith('6') && !normalized.startsWith('60')) {
    normalized = `60${normalized.slice(1)}`;
  }

  if (!/^60\d{8,11}$/.test(normalized)) {
    return '';
  }

  return normalized;
}

function isValidHttpUrl(input) {
  try {
    const parsed = new URL(input);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// Enable CORS for live site and local testing
app.use(cors({
  origin: ['https://www.nuteeth.my', 'http://127.0.0.1:5500', 'http://localhost:5500'],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

// Middleware to parse JSON request bodies
app.use(express.json());

// Health check route to verify the server is running
app.get('/', (req, res) => {
  res.send('NewTeeth Backend is running successfully!');
});

const BILLPLZ_API_KEY = process.env.BILLPLZ_API_KEY || process.env.BILLPLZ_SANDBOX_API_KEY || '13c37303-e30d-43e7-9fe1-b1ec334295b0';
const BILLPLZ_COLLECTION_ID = process.env.BILLPLZ_COLLECTION_ID || 'yhvzkwkw';
const BILLPLZ_API_BASE_URL = process.env.BILLPLZ_API_BASE_URL || 'https://www.billplz-sandbox.com';

app.post('/api/create-bill', async (req, res) => {
  try {
    const {
      amount,
      name,
      email,
      mobile,
      address,
      cart_items_summary,
      redirect_url,
      callback_url
    } = req.body;

    const normalizedAmount = normalizeAmountToCents(amount);
    const normalizedName = String(name || '').trim();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedMobile = normalizeMobile(mobile);
    const normalizedAddress = String(address || '').trim();
    const normalizedCartSummary = String(cart_items_summary || '').trim();
    const normalizedRedirectUrl = String(redirect_url || '').trim();
    const normalizedCallbackUrl = String(callback_url || '').trim();

    if (!normalizedAmount || !normalizedName || !normalizedEmail || !normalizedRedirectUrl || !normalizedCallbackUrl) {
      return res.status(400).json({
        error: 'Missing or invalid required fields',
        required: ['amount', 'name', 'email', 'redirect_url', 'callback_url']
      });
    }

    if (!isValidHttpUrl(normalizedRedirectUrl) || !isValidHttpUrl(normalizedCallbackUrl)) {
      return res.status(400).json({
        error: 'redirect_url and callback_url must be valid http/https URLs'
      });
    }

    // Billplz Basic Authentication uses the API key as the username with an empty password
    const authHeader = 'Basic ' + Buffer.from(`${BILLPLZ_API_KEY}:`).toString('base64');

    const billDescription = normalizedCartSummary
      ? `Order: ${normalizedCartSummary}`.slice(0, 190)
      : 'NewTeeth Product Order';

    // Create the Billplz bill payload
    const payload = {
      collection_id: BILLPLZ_COLLECTION_ID,
      description: billDescription,
      amount: normalizedAmount,
      name: normalizedName,
      email: normalizedEmail,
      redirect_url: normalizedRedirectUrl,
      callback_url: normalizedCallbackUrl
    };

    if (normalizedMobile) payload.mobile = normalizedMobile;
    if (normalizedAddress) {
      payload.reference_1_label = 'Home Address';
      payload.reference_1 = normalizedAddress;
    }
    if (normalizedCartSummary) {
      payload.reference_2_label = 'Items';
      payload.reference_2 = normalizedCartSummary.slice(0, 240);
    }

    const formPayload = new URLSearchParams();
    Object.entries(payload).forEach(([key, value]) => {
      formPayload.append(key, String(value));
    });

    const candidateBaseUrls = process.env.BILLPLZ_API_BASE_URL
      ? [process.env.BILLPLZ_API_BASE_URL]
      : [BILLPLZ_API_BASE_URL, 'https://www.billplz.com'];

    let lastResponseStatus = 500;
    let lastResponseData = null;

    for (const baseUrl of candidateBaseUrls) {
      const response = await fetch(`${baseUrl}/api/v3/bills`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: authHeader
        },
        body: formPayload.toString()
      });

      const contentType = response.headers.get('content-type') || '';
      const data = contentType.includes('application/json') ? await response.json() : { raw: await response.text() };

      if (response.ok) {
        return res.json({
          url: data.url,
          bill_id: data.id,
          billplz_base_url: baseUrl
        });
      }

      lastResponseStatus = response.status;
      lastResponseData = { ...data, billplz_base_url: baseUrl };

      // If unauthorized, try alternate endpoint (sandbox vs production) once.
      if (response.status !== 401) {
        break;
      }
    }

    return res.status(lastResponseStatus).json({
      error: 'Failed to create bill',
      details: lastResponseData,
      hint: lastResponseStatus === 422
        ? 'Billplz rejected one or more payload fields. Check amount (integer cents), collection_id, email/mobile format, and callback/redirect URLs.'
        : undefined
    });
  } catch (error) {
    console.error('Error creating bill:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error && error.message ? error.message : 'Unknown error'
    });
  }
});


const crypto = require('crypto');
// Middleware to parse URL-encoded bodies (for webhooks)
app.use(express.urlencoded({ extended: true }));

const BILLPLZ_X_SIGNATURE_KEY = 'S-ehD3TfLC1XVQQrkNA7fZkg'; // TODO: Replace with your actual Signature Key

app.post('/api/webhook', (req, res) => {
  const data = req.body;
  const signatureReceived = data.x_signature;

  if (!signatureReceived) {
    return res.status(400).send('Signature missing');
  }

  // Extract all keys except x_signature and sort them alphabetically
  const sortedKeys = Object.keys(data)
    .filter(key => key !== 'x_signature')
    .sort();

  // Create the string to hash by concatenating key and value separated by pipe
  const stringToHash = sortedKeys.map(key => `${key}${data[key]}`).join('|');

  // Generate HMAC SHA256
  const generatedSignature = crypto
    .createHmac('sha256', BILLPLZ_X_SIGNATURE_KEY)
    .update(stringToHash)
    .digest('hex');

  if (generatedSignature === signatureReceived) {
    // Signature is valid
    if (data.state === 'paid' || data.paid === 'true') {
      // TODO: Write your database update logic here
      // E.g., db.orders.update({ status: 'PAID' }).where({ bill_id: data.id });
      console.log('Payment verified and successful for bill ID:', data.id);
    }
    return res.status(200).send('OK');
  } else {
    // Signature is invalid
    console.log('Invalid signature received.');
    return res.status(403).send('Forbidden: Invalid Signature');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
