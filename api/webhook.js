const crypto = require('crypto');

async function parseWebhookBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }

  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
  }

  const contentType = req.headers['content-type'] || '';

  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw));
  }

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(raw || '{}');
    } catch (e) {
      return {};
    }
  }

  return {};
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const data = await parseWebhookBody(req);
  const signatureReceived = data.x_signature;

  if (!signatureReceived) {
    return res.status(400).send('Signature missing');
  }

  const xSignatureKey = process.env.BILLPLZ_X_SIGNATURE_KEY;
  if (!xSignatureKey) {
    return res.status(500).send('Missing BILLPLZ_X_SIGNATURE_KEY');
  }

  const sortedKeys = Object.keys(data)
    .filter((key) => key !== 'x_signature')
    .sort();

  const stringToHash = sortedKeys
    .map((key) => `${key}${String(data[key])}`)
    .join('|');

  const generatedSignature = crypto
    .createHmac('sha256', xSignatureKey)
    .update(stringToHash)
    .digest('hex');

  if (generatedSignature !== signatureReceived) {
    return res.status(403).send('Forbidden: Invalid Signature');
  }

  if (data.state === 'paid' || data.paid === 'true') {
    // TODO: Write your database update logic here
    // Example: update order status to paid using bill id (data.id)
  }

  return res.status(200).send('OK');
};
