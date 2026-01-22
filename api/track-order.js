// api/track-order.js

module.exports = async (req, res) => {
    // ---------------------------------------------------------
    // 1. CORS Headers (Allows Shopify to talk to this backend)
    // ---------------------------------------------------------
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  
    // Handle browser "Preflight" checks
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
  
    // ---------------------------------------------------------
    // 2. Configuration & Input
    // ---------------------------------------------------------
    
    // CRITICAL: You must replace this with the real URL from your WareIQ Dashboard -> API Settings.
    // The documentation you shared lists it as {{base_url}}. 
    // It is likely "https://gateway.wareiq.com" or similar.
    const BASE_URL = process.env.WAREIQ_BASE_URL || 'https://gateway.wareiq.com'; 
    
    const API_TOKEN = process.env.WAREIQ_API_TOKEN;
  
    // Check if secrets are loaded
    if (!API_TOKEN) {
      console.error("Server Error: WAREIQ_API_TOKEN is missing.");
      return res.status(500).json({ error: 'Server Configuration Error' });
    }
  
    const { awb, orderId, mobile } = req.query;
  
    if (!awb && !orderId) {
      return res.status(400).json({ error: 'Please provide either an Order ID or AWB Number.' });
    }
  
    // ---------------------------------------------------------
    // 3. Main Logic (Using standard 'fetch')
    // ---------------------------------------------------------
    try {
      let response;
      let endpoint;
      
      // BASED ON YOUR DOCS: "GET Track an order"
      // We assume the standard WareIQ path below. 
      // If this fails (404), check your Postman for the exact path like '/shipping/v1/track'
      
      if (awb) {
        // Construction: BASE_URL + Path + Query Params
        endpoint = `${BASE_URL}/orders/v1/tracking?awb=${awb}`; 
      } else {
        endpoint = `${BASE_URL}/orders/v1/tracking?order_id=${orderId}`;
      }
  
      // Perform the Request
      const apiRequest = await fetch(endpoint, {
        method: 'GET', // Docs said "GET" for tracking
        headers: {
          'Authorization': `Bearer ${API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
  
      // ---------------------------------------------------------
      // 4. Error Handling
      // ---------------------------------------------------------
      if (!apiRequest.ok) {
        const errorText = await apiRequest.text();
        console.error(`WareIQ API Error (${apiRequest.status}):`, errorText);
  
        if (apiRequest.status === 404) {
          return res.status(404).json({ error: 'Shipment not found.' });
        }
        return res.status(500).json({ error: 'Failed to fetch data from WareIQ.' });
      }
  
      const data = await apiRequest.json();
  
      // ---------------------------------------------------------
      // 5. Security Check (Mobile Verification)
      // ---------------------------------------------------------
      if (orderId) {
        if (!mobile) {
          return res.status(400).json({ error: 'Mobile number is required for Order ID verification.' });
        }
  
        // Check phone in likely fields (Customer or Shipping)
        // Note: Adjust 'customer_details' if your specific API response uses 'shipping_address'
        const orderPhone = data.customer_details?.phone || data.shipping_address?.phone || '';
  
        const cleanInput = String(mobile).replace(/\D/g, '').slice(-10);
        const cleanActual = String(orderPhone).replace(/\D/g, '').slice(-10);
  
        if (cleanInput !== cleanActual) {
          return res.status(404).json({ error: 'Order details not found for this mobile number.' });
        }
      }
  
      // ---------------------------------------------------------
      // 6. Success Response
      // ---------------------------------------------------------
      return res.status(200).json({
        order_id: data.order_id || orderId,
        current_status: data.status?.current_status || 'Unknown',
        history: data.tracking_history || []
      });
  
    } catch (error) {
      // This catches the "ENOTFOUND" if the URL is still wrong
      console.error('System Error:', error.message);
      return res.status(500).json({ error: 'Tracking unavailable (System Error).' });
    }
  };