module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      endpoint: '/api/create-bill',
      message: 'Endpoint is live. Use POST with checkout payload to create a Billplz bill.',
    });
  }

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

    const apiKey = process.env.BILLPLZ_API_KEY || process.env.BILLPLZ_SANDBOX_API_KEY;
    const collectionId = process.env.BILLPLZ_COLLECTION_ID;
    const configuredBaseUrl = process.env.BILLPLZ_API_BASE_URL;

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

    const formBody = new URLSearchParams(
      Object.entries(payload).map(([key, value]) => [key, String(value)])
    ).toString();

    const baseUrls = configuredBaseUrl
      ? [configuredBaseUrl]
      : ['https://www.billplz-sandbox.com', 'https://www.billplz.com'];

    let lastStatus = 500;
    let lastDetails = null;

    for (const baseUrl of baseUrls) {
      const response = await fetch(`${baseUrl}/api/v3/bills`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: authHeader,
        },
        body: formBody,
      });

      const contentType = response.headers.get('content-type') || '';
      const data = contentType.includes('application/json')
        ? await response.json()
        : { raw: await response.text() };

      if (response.ok) {
        return res.status(200).json({ url: data.url });
      }

      lastStatus = response.status;
      lastDetails = { ...data, billplz_base_url: baseUrl };

      if (response.status !== 401) {
        break;
      }
    }

    return res.status(lastStatus).json({
      error: 'Failed to create bill',
      details: lastDetails,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
