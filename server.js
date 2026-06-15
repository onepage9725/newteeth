const express = require('express');
const cors = require('cors');
const app = express();

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
      redirect_url,
      callback_url
    } = req.body;

    if (!amount || !name || !email || !mobile || !address || !redirect_url || !callback_url) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Billplz Basic Authentication uses the API key as the username with an empty password
    const authHeader = 'Basic ' + Buffer.from(`${BILLPLZ_API_KEY}:`).toString('base64');

    // Create the Billplz bill payload
    const payload = {
      collection_id: BILLPLZ_COLLECTION_ID,
      description: 'NewTeeth Product Order',
      amount,
      name,
      email,
      mobile,
      redirect_url,
      callback_url,
      reference_1_label: 'Home Address',
      reference_1: address
    };

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
        return res.json({ url: data.url });
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
      details: lastResponseData
    });
  } catch (error) {
    console.error('Error creating bill:', error);
    res.status(500).json({ error: 'Internal Server Error' });
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
