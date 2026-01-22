module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  
    if (req.method === 'OPTIONS') return res.status(200).end();
  
    // 1. Configuration
    // Use the standard gateway: https://gateway.wareiq.com
    const BASE_URL = process.env.WAREIQ_BASE_URL || 'https://gateway.wareiq.com'; 
    const API_TOKEN = process.env.WAREIQ_API_TOKEN;
  
    if (!API_TOKEN) {
      return res.status(500).json({ error: 'Server Error: WAREIQ_API_TOKEN is missing.' });
    }
  
    const { awb, orderId, mobile } = req.query;
    const searchTerm = awb || orderId;
  
    if (!searchTerm) {
      return res.status(400).json({ error: 'Please provide either an Order ID or AWB Number.' });
    }
  
    try {
      // 2. Prepare Request (Based on WareIQ "Orders V2" Docs)
      // Endpoint: POST /orders/v2/orders/b2c/all
      // Documentation: https://documenter.getpostman.com/view/17076115/U16nM5Tu
      const endpoint = `${BASE_URL}/orders/v2/orders/b2c/all`;
  
      // 3. Send Request
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          search: {
            // This field accepts BOTH Order ID and AWB
            order_details: searchTerm 
          }
        })
      });
  
      // 4. Handle Errors
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`WareIQ API Error (${response.status}):`, errorText);
        return res.status(500).json({ error: 'Failed to connect to WareIQ.' });
      }
  
      const jsonResponse = await response.json();
  
      // WareIQ returns a list of orders. We take the first match.
      // Structure is usually { data: [ ...orders... ] }
      const orders = jsonResponse.data || [];
      const orderData = orders[0];
  
      if (!orderData) {
        return res.status(404).json({ error: 'Shipment not found.' });
      }
  
      // 5. Security Check (Mobile Verification)
      if (orderId) {
        if (!mobile) return res.status(400).json({ error: 'Mobile number required.' });
  
        const orderPhone = orderData.customer_details?.phone || orderData.shipping_address?.phone || '';
        const cleanInput = String(mobile).replace(/\D/g, '').slice(-10);
        const cleanActual = String(orderPhone).replace(/\D/g, '').slice(-10);
  
        if (cleanInput !== cleanActual) {
          return res.status(404).json({ error: 'Mobile number mismatch.' });
        }
      }
  
      // 6. Success - Map the data to your Frontend format
      return res.status(200).json({
        order_id: orderData.unique_id || orderId, // 'unique_id' is standard in WareIQ V2
        current_status: orderData.status?.current_status || orderData.status || 'Unknown',
        // Note: Tracking history might be nested differently in V2. 
        // We check 'tracking_history' or fallback to empty.
        history: orderData.tracking_history || [] 
      });
  
    } catch (error) {
      console.error('System Crash:', error.message);
      return res.status(500).json({ error: 'Tracking service unavailable.' });
    }
  };