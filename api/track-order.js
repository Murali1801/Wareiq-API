module.exports = async (req, res) => {
    // 1. CORS Headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  
    if (req.method === 'OPTIONS') return res.status(200).end();
  
    // 2. Configuration Logging
    const BASE_URL = process.env.WAREIQ_BASE_URL || 'https://gateway.wareiq.com'; 
    const API_TOKEN = process.env.WAREIQ_API_TOKEN;
  
    console.log("--- STARTING REQUEST ---");
    console.log(`Configured BASE_URL: ${BASE_URL}`);
    console.log(`API Token Present: ${API_TOKEN ? 'YES' : 'NO'}`);
  
    if (!API_TOKEN) {
      console.error("CRITICAL ERROR: WAREIQ_API_TOKEN is missing.");
      return res.status(500).json({ error: 'Server Configuration Error' });
    }
  
    const { awb, orderId, mobile } = req.query;
    const searchTerm = awb || orderId;
  
    console.log(`Incoming Query - OrderID: ${orderId}, AWB: ${awb}, Mobile: ${mobile}`);
  
    if (!searchTerm) {
      return res.status(400).json({ error: 'Please provide either an Order ID or AWB Number.' });
    }
  
    try {
      // 3. Construct Endpoint (Using V2 Search)
      const endpoint = `${BASE_URL}/orders/v2/orders/b2c/all`;
      console.log(`Requesting Endpoint: ${endpoint}`);
  
      // 4. Send Request
      const startTime = Date.now();
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          search: {
            order_details: searchTerm 
          }
        })
      });
      
      const duration = Date.now() - startTime;
      console.log(`Request Duration: ${duration}ms`);
      console.log(`Response Status: ${response.status} ${response.statusText}`);
  
      // 5. Handle Errors
      if (!response.ok) {
        const errorText = await response.text();
        console.error("API ERROR BODY:", errorText);
        return res.status(500).json({ error: 'Failed to connect to WareIQ.', details: errorText });
      }
  
      const jsonResponse = await response.json();
      console.log("API Response Success. Data keys:", Object.keys(jsonResponse));
  
      // 6. Extract Data
      const orders = jsonResponse.data || [];
      if (orders.length === 0) {
        console.warn("Search successful but no orders found.");
        return res.status(404).json({ error: 'Shipment not found.' });
      }
  
      const orderData = orders[0];
  
      // 7. Security Check
      if (orderId) {
        if (!mobile) return res.status(400).json({ error: 'Mobile number required.' });
  
        const orderPhone = orderData.customer_details?.phone || orderData.shipping_address?.phone || '';
        const cleanInput = String(mobile).replace(/\D/g, '').slice(-10);
        const cleanActual = String(orderPhone).replace(/\D/g, '').slice(-10);
  
        console.log(`Mobile Verify - Input: ...${cleanInput}, Actual: ...${cleanActual}`);
  
        if (cleanInput !== cleanActual) {
          console.warn("Security Block: Mobile number mismatch.");
          return res.status(404).json({ error: 'Mobile number mismatch.' });
        }
      }
  
      // 8. Success
      return res.status(200).json({
        order_id: orderData.unique_id || orderId,
        current_status: orderData.status?.current_status || orderData.status || 'Unknown',
        history: orderData.tracking_history || []
      });
  
    } catch (error) {
      // LOG THE EXACT CRASH REASON
      console.error("--- SYSTEM CRASH ---");
      console.error("Error Name:", error.name);
      console.error("Error Message:", error.message);
      if (error.cause) console.error("Error Cause:", error.cause);
      
      return res.status(500).json({ error: 'Tracking service unavailable.', debug: error.message });
    }
  };