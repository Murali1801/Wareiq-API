const axios = require('axios');

export default async function handler(req, res) {
  // 1. CORS Configuration (Allow Shopify to access this)
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle Preflight (Browser Check)
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // 2. Extract Data from Query
  const { awb, orderId, mobile } = req.query;

  // 3. Environment Variables (Set these in Vercel Dashboard)
  // The long string from your image goes here
  const AUTH_HEADER = process.env.WAREIQ_AUTH_HEADER; 

  if (!AUTH_HEADER) {
    return res.status(500).json({ error: "Server Error: Missing API Credentials" });
  }

  try {
    let apiUrl;

    // 4. Determine which WareIQ Endpoint to hit
    if (awb) {
      // CASE A: Search by AWB
      // URL format from your example: https://track.wareiq.com/tracking/v1/shipments/{AWB}/all
      apiUrl = `https://track.wareiq.com/tracking/v1/shipments/${awb}/all`;
    
    } else if (orderId && mobile) {
      // CASE B: Search by Order ID + Mobile
      // TODO: If WareIQ has a different endpoint for Order ID lookup (e.g., /orders/), change this URL.
      // For now, we attempt to use the Order ID in place of the shipment ID, or you might need a "lookup" step first.
      apiUrl = `https://track.wareiq.com/tracking/v1/shipments/${orderId}/all`; 
    } else {
      return res.status(400).json({ error: "Missing required fields. Provide AWB or Order ID." });
    }

    // 5. Make the API Call to WareIQ
    const response = await axios.get(apiUrl, {
      headers: {
        'Authorization': AUTH_HEADER, // This takes the value from your environment variable
        'Content-Type': 'application/json'
      }
    });

    // 6. Return Data to Frontend
    // We send back exactly what WareIQ sends us
    return res.status(200).json(response.data);

  } catch (error) {
    console.error("WareIQ API Error:", error.response?.data || error.message);
    
    // Handle 404 (Not Found) specifically
    if (error.response?.status === 404) {
      return res.status(404).json({ error: "Shipment not found. Please check your details." });
    }

    return res.status(500).json({ error: "Failed to fetch tracking details." });
  }
}