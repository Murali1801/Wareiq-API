const axios = require('axios');

module.exports = async (req, res) => {
  // ---------------------------------------------------------
  // 1. CORS CONFIGURATION
  // Allows your Shopify store to talk to this backend
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
  // 2. INPUT & CONFIGURATION
  // ---------------------------------------------------------
  const { awb, orderId, mobile } = req.query;
  
  // WareIQ API Configuration
  const WAREIQ_API_URL = 'https://api.wareiq.com/fc/v1/orders/search'; 
  const WAREIQ_API_TOKEN = process.env.WAREIQ_API_TOKEN;

  // Basic Validation
  if (!WAREIQ_API_TOKEN) {
    console.error("Error: WAREIQ_API_TOKEN is missing in Environment Variables");
    return res.status(500).json({ error: 'Server Configuration Error' });
  }

  if (!awb && !orderId) {
    return res.status(400).json({ error: 'Please provide either an Order ID or AWB Number.' });
  }

  // ---------------------------------------------------------
  // 3. MAIN LOGIC
  // ---------------------------------------------------------
  try {
    let response;

    // --- CASE A: SEARCH BY AWB ---
    if (awb) {
      response = await axios.post(
        WAREIQ_API_URL,
        { search_by: 'awb', value: awb },
        { 
          headers: { 
            'Authorization': `Bearer ${WAREIQ_API_TOKEN}`, 
            'Content-Type': 'application/json' 
          } 
        }
      );
    }

    // --- CASE B: SEARCH BY ORDER ID (With Mobile Check) ---
    else if (orderId) {
      if (!mobile) {
        return res.status(400).json({ error: 'Mobile number is required for Order ID verification.' });
      }

      // 1. Fetch the Order
      response = await axios.post(
        WAREIQ_API_URL,
        { search_by: 'order_id', value: orderId },
        { 
          headers: { 
            'Authorization': `Bearer ${WAREIQ_API_TOKEN}`, 
            'Content-Type': 'application/json' 
          } 
        }
      );

      // 2. VERIFY MOBILE NUMBER
      const orderData = response.data;
      
      // Look for phone number in customer or shipping details
      const orderPhone = orderData.customer_details?.phone || orderData.shipping_address?.phone || '';

      // Clean the numbers (remove +91, spaces, dashes) to compare just the last 10 digits
      const cleanInput = String(mobile).replace(/\D/g, '').slice(-10);
      const cleanActual = String(orderPhone).replace(/\D/g, '').slice(-10);

      // If they don't match, block the request
      if (cleanInput !== cleanActual) {
        return res.status(404).json({ error: 'Order details not found for this mobile number.' });
      }
    }

    // ---------------------------------------------------------
    // 4. PREPARE RESPONSE (CLEAN DATA)
    // ---------------------------------------------------------
    if (!response.data) {
       throw new Error('No data received from WareIQ');
    }

    const cleanData = {
      order_id: response.data.order_id || orderId,
      current_status: response.data.status?.current_status || 'In Transit',
      history: response.data.tracking_history || []
    };

    return res.status(200).json(cleanData);

  } catch (error) {
    // Log the actual error for debugging
    console.error('API Request Failed:', error.response?.data || error.message);

    // Send a safe error message to the user
    if (error.response?.status === 404) {
      return res.status(404).json({ error: 'Shipment not found. Please check your details.' });
    }

    return res.status(500).json({ error: 'Unable to track shipment at this time.' });
  }
};