module.exports = async (req, res) => {
    // 1. CORS Headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  
    if (req.method === 'OPTIONS') return res.status(200).end();
  
    // 2. Configuration
    // Uses the domain you found: https://track.wareiq.com
    const BASE_URL = process.env.WAREIQ_BASE_URL || 'https://track.wareiq.com'; 
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
      let response;
      let endpoint;
  
      // ---------------------------------------------------------
      // SCENARIO A: Search by Order ID (or Generic Search)
      // Uses "Orders List V2" endpoint from PDF Page 47 
      // ---------------------------------------------------------
      if (orderId) {
        endpoint = `${BASE_URL}/orders/v2/orders/b2c/all`;
        
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${API_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            search: {
              order_details: orderId // "Use this field to search on order ID or AWB" [cite: 1420]
            }
          })
        });
      } 
      
      // ---------------------------------------------------------
      // SCENARIO B: Search by AWB
      // Uses "Track an order" endpoint from PDF Page 58 
      // ---------------------------------------------------------
      else if (awb) {
        endpoint = `${BASE_URL}/orders/v1/track/${awb}`;
        
        response = await fetch(endpoint, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${API_TOKEN}`,
            'Content-Type': 'application/json'
          }
        });
      }
  
      // ---------------------------------------------------------
      // 3. Handle API Errors
      // ---------------------------------------------------------
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`WareIQ Error (${response.status}) at ${endpoint}:`, errorText);
        
        if (response.status === 404) return res.status(404).json({ error: 'Shipment not found.' });
        return res.status(500).json({ error: 'Failed to fetch data from WareIQ.' });
      }
  
      const data = await response.json();
      let orderData = null;
  
      // Handle different response structures
      if (orderId) {
        // V2 Search returns { data: [ ... ] } [cite: 1464]
        const list = data.data || [];
        orderData = list[0];
      } else {
        // V1 Track usually returns the object directly or in 'data'
        orderData = data;
      }
  
      if (!orderData) {
        return res.status(404).json({ error: 'Shipment not found.' });
      }
  
      // ---------------------------------------------------------
      // 4. Security Check (Mobile Verification)
      // ---------------------------------------------------------
      if (orderId) {
        if (!mobile) return res.status(400).json({ error: 'Mobile number required.' });
  
        const orderPhone = orderData.customer_details?.phone || orderData.shipping_address?.phone || '';
        const cleanInput = String(mobile).replace(/\D/g, '').slice(-10);
        const cleanActual = String(orderPhone).replace(/\D/g, '').slice(-10);
  
        if (cleanInput !== cleanActual) {
          return res.status(404).json({ error: 'Mobile number mismatch.' });
        }
      }
  
      // ---------------------------------------------------------
      // 5. Success
      // ---------------------------------------------------------
      return res.status(200).json({
        order_id: orderData.unique_id || orderId,
        // Map status based on documentation fields [cite: 1826]
        current_status: orderData.status?.current_status || orderData.status || 'Unknown', 
        history: orderData.tracking_history || []
      });
  
    } catch (error) {
      console.error('System Crash:', error.message);
      return res.status(500).json({ error: 'Tracking service unavailable (System Error).' });
    }
  };