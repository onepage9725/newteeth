module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const {
      amount,
      name,
      email,
      mobile,
      address,
      redirect_url,
      callback_url,
    } = req.body || {};

    if (!amount || !name || !email || !mobile || !address || !redirect_url || !callback_url) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const apiKey = process.env.BILLPLZ_SANDBOX_API_KEY;
    const collectionId = process.env.BILLPLZ_COLLECTION_ID;

    if (!apiKey || !collectionId) {
      return res.status(500).json({ error: 'Missing Billplz environment variables' });
    }

    const authHeader = `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`;

    const payload = {
      collection_id: collectionId,
      description: 'NewTeeth Product Order',
      amount,
      name,
      email,
      mobile,
      redirect_url,
      callback_url,
      reference_1_label: 'Home Address',
      reference_1: address,
    };

    const response = await fetch('https://www.billplz-sandbox.com/api/v3/bills', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: 'Failed to create bill',
        details: data,
      });
    }

    return res.status(200).json({ url: data.url });
  } catch (error) {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
