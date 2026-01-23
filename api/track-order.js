export default async function handler(req, res) {
  // 1. CORS Configuration
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // 2. Extract Data
  const { awb, orderId, mobile } = req.query;
  const AUTH_HEADER = process.env.WAREIQ_AUTH_HEADER;

  if (!AUTH_HEADER) {
    return res.status(500).json({ error: "Server Error: Missing API Credentials" });
  }

  try {
    let apiUrl;

    // 3. Determine Endpoint
    if (awb) {
      apiUrl = `https://track.wareiq.com/tracking/v1/shipments/${awb}/all`;
    } else if (orderId && mobile) {
      apiUrl = `https://track.wareiq.com/tracking/v1/shipments/${orderId}/all`;
    } else {
      return res.status(400).json({ error: "Missing required fields." });
    }

    // 4. Native Fetch Call (No Axios needed)
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': AUTH_HEADER,
        'Content-Type': 'application/json'
      }
    });

    // 5. Handle Response
    if (!response.ok) {
        // If 404 or 500, try to parse error text
        const errorText = await response.text();
        console.error("WareIQ Error:", response.status, errorText);
        
        if (response.status === 404) {
            return res.status(404).json({ error: "Shipment not found." });
        }
        return res.status(response.status).json({ error: "Error fetching data from WareIQ" });
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (error) {
    console.error("Server Error:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}