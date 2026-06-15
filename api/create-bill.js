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

    const normalizedAmount = normalizeAmountToCents(amount);
    const normalizedName = String(name || '').trim();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedMobile = normalizeMobile(mobile);
    const normalizedAddress = String(address || '').trim();
    const normalizedRedirectUrl = String(redirect_url || '').trim();
    const normalizedCallbackUrl = String(callback_url || '').trim();

    if (!normalizedAmount || !normalizedName || !normalizedEmail || !normalizedRedirectUrl || !normalizedCallbackUrl) {
      return res.status(400).json({
        error: 'Missing or invalid required fields',
        required: ['amount', 'name', 'email', 'redirect_url', 'callback_url'],
      });
    }

    if (!isValidHttpUrl(normalizedRedirectUrl) || !isValidHttpUrl(normalizedCallbackUrl)) {
      return res.status(400).json({
        error: 'redirect_url and callback_url must be valid http/https URLs',
      });
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
      amount: normalizedAmount,
      name: normalizedName,
      email: normalizedEmail,
      redirect_url: normalizedRedirectUrl,
      callback_url: normalizedCallbackUrl,
    };

    if (normalizedMobile) payload.mobile = normalizedMobile;
    if (normalizedAddress) {
      payload.reference_1_label = 'Home Address';
      payload.reference_1 = normalizedAddress;
    }

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
        return res.status(200).json({
          url: data.url,
          bill_id: data.id,
          billplz_base_url: baseUrl,
        });
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
      hint: lastStatus === 422
        ? 'Billplz rejected one or more payload fields. Check amount (integer cents), collection_id, email/mobile format, and callback/redirect URLs.'
        : undefined,
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Internal Server Error',
      message: error && error.message ? error.message : 'Unknown error',
    });
  }
};
