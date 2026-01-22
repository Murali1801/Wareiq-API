module.exports = async (req, res) => {
    // -------------------------------------------------
    // 1. CORS
    // -------------------------------------------------
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization'
    );
  
    if (req.method === 'OPTIONS') return res.status(200).end();
  
    // -------------------------------------------------
    // 2. Config (FIXED)
    // -------------------------------------------------
    const BASE_URL = process.env.WAREIQ_BASE_URL || 'https://api.wareiq.in';
    const API_TOKEN = process.env.WAREIQ_API_TOKEN;
  
    if (!API_TOKEN) {
      return res
        .status(500)
        .json({ error: 'WAREIQ_API_TOKEN is missing' });
    }
  
    const { awb, orderId, mobile } = req.query;
  
    if (!awb && !orderId) {
      return res
        .status(400)
        .json({ error: 'Provide either AWB or Order ID' });
    }
  
    try {
      let awbNumber = awb;
      let orderData = null;
  
      // -------------------------------------------------
      // 3. If ORDER ID → Get AWB first
      // -------------------------------------------------
      if (orderId) {
        if (!mobile) {
          return res
            .status(400)
            .json({ error: 'Mobile number is required' });
        }
  
        const orderSearchRes = await fetch(
          `${BASE_URL}/orders/v2/orders/b2c/all`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${API_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              search: { order_details: orderId },
              page: 1,
              per_page: 1,
            }),
          }
        );
  
        if (!orderSearchRes.ok) {
          return res.status(404).json({ error: 'Order not found' });
        }
  
        const orderSearchData = await orderSearchRes.json();
        orderData = orderSearchData?.data?.[0];
  
        if (!orderData || !orderData.awb) {
          return res
            .status(404)
            .json({ error: 'AWB not generated yet' });
        }
  
        // Mobile verification
        const orderPhone =
          orderData.customer_details?.phone ||
          orderData.shipping_address?.phone ||
          '';
  
        const inputMobile = mobile.replace(/\D/g, '').slice(-10);
        const actualMobile = orderPhone.replace(/\D/g, '').slice(-10);
  
        if (inputMobile !== actualMobile) {
          return res
            .status(403)
            .json({ error: 'Mobile number mismatch' });
        }
  
        awbNumber = orderData.awb;
      }
  
      // -------------------------------------------------
      // 4. TRACK USING CORRECT ENDPOINT (FIXED)
      // -------------------------------------------------
      const trackRes = await fetch(
        `${BASE_URL}/tracking/v1/shipments/${awbNumber}/wiq?details=true`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${API_TOKEN}`,
          },
        }
      );
  
      if (!trackRes.ok) {
        return res.status(404).json({ error: 'Tracking not found' });
      }
  
      const trackingData = await trackRes.json();
  
      // -------------------------------------------------
      // 5. RESPONSE (CLEAN FOR FRONTEND)
      // -------------------------------------------------
      return res.status(200).json({
        order_id: orderData?.unique_id || null,
        awb: awbNumber,
        courier: trackingData.courier || null,
        current_status: trackingData.tracking_status,
        wareiq_status: trackingData.status,
        location: trackingData.location,
        event_time: trackingData.event_time,
        tracking_url: trackingData.tracking_url,
        history: trackingData.tracking_history || [],
      });
    } catch (err) {
      console.error('Tracking Error:', err);
      return res
        .status(500)
        .json({ error: 'Tracking service unavailable' });
    }
  };
  