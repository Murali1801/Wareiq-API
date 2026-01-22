module.exports = async (req, res) => {
    // ---------------------------------------------------------
    // 1. CORS HEADERS
    // Allows your Shopify store to talk to this backend safely
    // ---------------------------------------------------------
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  
    // Handle browser "Preflight" checks
    if (req.method === 'OPTIONS') return res.status(200).end();
  
    // ---------------------------------------------------------
    // 2. CONFIGURATION
    // ---------------------------------------------------------
    // We found this URL in your Network Tab screenshot
    const BASE_URL = process.env.WAREIQ_BASE_URL || 'https://track.wareiq.com'; 
    const API_TOKEN = process.env.WAREIQ_API_TOKEN;
  
    // Validation: Ensure the API Token is set in Vercel
    if (!API_TOKEN) {
      console.error("Server Error: WAREIQ_API_TOKEN is missing in Vercel Settings.");
      return res.status(500).json({ error: 'Server Configuration Error' });
    }
  
    const { awb, orderId, mobile } = req.query;
  
    if (!awb && !orderId) {
      return res.status(400).json({ error: 'Please provide either an Order ID or AWB Number.' });
    }
  
    // ---------------------------------------------------------
    // 3. MAIN LOGIC
    // ---------------------------------------------------------
    try {
      let endpoint;
      
      // Construct the URL based on the input
      // We assume the standard path is /orders/v1/tracking based on typical WareIQ docs.
      // If this specific path fails, try '/fc/v1/orders/search' instead.
      if (awb) {
        endpoint = `${BASE_URL}/orders/v1/tracking?awb=${awb}`;
      } else {
        endpoint = `${BASE_URL}/orders/v1/tracking?order_id=${orderId}`;
      }
  
      // Send the Request using standard 'fetch'
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
  
      // ---------------------------------------------------------
      // 4. ERROR HANDLING
      // ---------------------------------------------------------
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`WareIQ API Error (${response.status}) at ${endpoint}:`, errorText);
        
        if (response.status === 404) {
          return res.status(404).json({ error: 'Shipment not found. Please check your details.' });
        }
        return res.status(500).json({ error: 'Failed to fetch data from WareIQ.' });
      }
  
      const data = await response.json();
  
      // ---------------------------------------------------------
      // 5. SECURITY CHECK (MOBILE VERIFICATION)
      // ---------------------------------------------------------
      if (orderId) {
        if (!mobile) {
          return res.status(400).json({ error: 'Mobile number is required for Order ID verification.' });
        }
  
        // Check phone in likely fields (Customer or Shipping)
        const orderPhone = data.customer_details?.phone || data.shipping_address?.phone || '';
        
        // Clean numbers (remove +91, spaces, dashes) to compare just the last 10 digits
        const cleanInput = String(mobile).replace(/\D/g, '').slice(-10);
        const cleanActual = String(orderPhone).replace(/\D/g, '').slice(-10);
  
        if (cleanInput !== cleanActual) {
          return res.status(404).json({ error: 'Order details not found for this mobile number.' });
        }
      }
  
      // ---------------------------------------------------------
      // 6. SUCCESS RESPONSE
      // ---------------------------------------------------------
      return res.status(200).json({
        order_id: data.order_id || orderId,
        current_status: data.status?.current_status || 'Unknown',
        history: data.tracking_history || []
      });
  
    } catch (error) {
      console.error('System Crash:', error.message);
      return res.status(500).json({ error: 'Tracking unavailable (System Error).' });
    }
  };