const axios = require('axios');

export default async function handler(req, res) {
  // ---------------------------------------------------------
  // 1. CORS CONFIGURATION
  // Allows your Shopify store (Frontend) to talk to this Backend
  // ---------------------------------------------------------
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*'); // IN PRODUCTION: Replace '*' with your actual Shopify URL for better security
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  // Handle the "Preflight" check from the browser
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // ---------------------------------------------------------
  // 2. INPUT & CONFIGURATION
  // ---------------------------------------------------------
  const { awb, orderId, mobile } = req.query;
  
  // Your WareIQ API Endpoint (Check your specific docs if this differs)
  const WAREIQ_API_URL = 'https://api.wareiq.com/fc/v1/orders/search'; 
  const WAREIQ_API_TOKEN = process.env.WAREIQ_API_TOKEN;

  // Basic Validation
  if (!WAREIQ_API_TOKEN) {
    return res.status(500).json({ error: 'Server Error: API Token is missing.' });
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
    // AWB is usually unique and public, so strict mobile check is optional (but recommended if data contains personal info)
    if (awb) {
      response = await axios.post(
        WAREIQ_API_URL,
        { search_by: 'awb', value: awb },
        { headers: { 'Authorization': `Bearer ${WAREIQ_API_TOKEN}`, 'Content-Type': 'application/json' } }
      );
    }

    // --- CASE B: SEARCH BY ORDER ID ---
    // Order IDs are easy to guess (e.g. #1001, #1002). We MUST verify the mobile number.
    else if (orderId) {
      if (!mobile) {
        return res.status(400).json({ error: 'Mobile number is required for Order ID verification.' });
      }

      // 1. Fetch the Order
      response = await axios.post(
        WAREIQ_API_URL,
        { search_by: 'order_id', value: orderId },
        { headers: { 'Authorization': `Bearer ${WAREIQ_API_TOKEN}`, 'Content-Type': 'application/json' } }
      );

      // 2. VERIFY MOBILE NUMBER
      const orderData = response.data;
      
      // Extract phone from response (WareIQ structure may vary, checking common paths)
      const orderPhone = orderData.customer_details?.phone || orderData.shipping_address?.phone || '';

      // Normalize numbers: Remove spaces/dashes, take last 10 digits
      // Example: "+91 98765-43210" -> "9876543210"
      const cleanInput = String(mobile).replace(/\D/g, '').slice(-10);
      const cleanActual = String(orderPhone).replace(/\D/g, '').slice(-10);

      // If they don't match, DENY ACCESS
      if (cleanInput !== cleanActual) {
        // We return 404 to avoid confirming the order exists to a hacker
        return res.status(404).json({ error: 'Order details not found for this mobile number.' });
      }
    }

    // ---------------------------------------------------------
    // 4. PREPARE RESPONSE (CLEANING)
    // We only send back the fields the UI needs. 
    // This hides sensitive data (like costs/emails) from the browser.
    // ---------------------------------------------------------
    
    // Check if WareIQ returned a valid order object
    if (!response.data) {
       throw new Error('No data received from WareIQ');
    }

    const cleanData = {
      order_id: response.data.order_id || orderId, // Fallback to input if not in response
      current_status: response.data.status?.current_status || 'In Transit', // Adjust path based on actual JSON
      history: response.data.tracking_history || [] // The array of timeline events
    };

    return res.status(200).json(cleanData);

  } catch (error) {
    // Log the actual error for the developer (You see this in Vercel Logs)
    console.error('API Request Failed:', error.response?.data || error.message);

    // Send a user-friendly error
    if (error.response?.status === 404) {
      return res.status(404).json({ error: 'Shipment not found. Please check your details.' });
    }

    return res.status(500).json({ error: 'Unable to track shipment at this time.' });
  }
}