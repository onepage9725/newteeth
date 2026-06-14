const express = require('express');
const cors = require('cors');
const app = express();

// Enable CORS for frontend requests
app.use(cors());

// Middleware to parse JSON request bodies
app.use(express.json());

// TODO: Replace with your actual Billplz Sandbox credentials
const BILLPLZ_SECRET_KEY = '13c37303-e30d-43e7-9fe1-b1ec334295b0';
const COLLECTION_ID = 'yhvzkwkw';

app.post('/api/create-bill', async (req, res) => {
  try {
    const { 
      amount, 
      name, 
      email, 
      mobile, 
      callback_url, 
      redirect_url, 
      address 
    } = req.body;

    // Billplz Basic Authentication uses the API key as the username with an empty password
    const authHeader = 'Basic ' + Buffer.from(`${BILLPLZ_SECRET_KEY}:`).toString('base64');

    // Create the Billplz bill payload
    const payload = {
      collection_id: COLLECTION_ID,
      description: 'NewTeeth Product Order',
      email: email,
      name: name,
      amount: amount, // Note: Billplz amount is usually in cents (e.g., RM10 = 1000)
      mobile: mobile,
      callback_url: callback_url,
      redirect_url: redirect_url,
      reference_1_label: 'Home Address',
      reference_1: address
    };

    // Make the POST request to the Sandbox endpoint
    const response = await fetch('https://www.billplz-sandbox.com/api/v3/bills', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    // Check if the request was successful
    if (response.ok) {
      // Send the payment URL back to the client
      res.json({ url: data.url });
    } else {
      res.status(response.status).json({ error: 'Failed to create bill', details: data });
    }
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
