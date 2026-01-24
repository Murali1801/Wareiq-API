export default async function handler(req, res) {
  // 1. CORS & SECURITY
  const allowedOrigins = [
    'https://armor.shop', 
    'https://staging.armor.shop',
    'http://localhost:3000'
  ];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // 2. EXTRACT INPUTS
  const orderId = req.query.orderId || req.query.order_id || req.query.orderid;
  const mobile = req.query.mobile;
  const awb = req.query.awb;
  const AUTH_HEADER = process.env.WAREIQ_AUTH_HEADER;

  if (!AUTH_HEADER) return res.status(500).json({ error: "Server Configuration Error" });
  if (awb && (orderId || mobile)) return res.status(400).json({ error: "Invalid Request: Provide AWB OR OrderID/Mobile, not both." });

  try {
    let finalAwb = awb;

    // SCENARIO 1: SEARCH BY ORDER ID
    if (!finalAwb && orderId) {
        if (!mobile) return res.status(400).json({ error: "Mobile number is required." });
        if (!/^\d{10}$/.test(mobile)) return res.status(400).json({ error: "Mobile number must be exactly 10 digits." });

        const searchUrl = "https://track.wareiq.com/orders/v2/orders/b2c/all"; 
        const searchResponse = await fetch(searchUrl, {
            method: 'POST',
            headers: { 'Authorization': AUTH_HEADER, 'Content-Type': 'application/json' },
            body: JSON.stringify({ "search": { "order_details": orderId }, "page": 1, "per_page": 1 })
        });

        if (!searchResponse.ok) return res.status(searchResponse.status).json({ error: "Order search failed." });
        const searchData = await searchResponse.json();
        
        if (!searchData?.data?.length) return res.status(404).json({ error: "Order ID not found." });
        const order = searchData.data[0];

        // Mobile Verification
        const cleanStored = (order.customer_details?.phone || "").replace(/\D/g, ''); 
        if (!cleanStored.endsWith(mobile)) {
            return res.status(400).json({ error: "Mobile number does not match this Order ID." });
        }

        finalAwb = order.shipping_details?.awb;

        // *** PENDING ORDER LOGIC ***
        // If AWB is missing, we return a special 'processing' status WITH the date
        if (!finalAwb) {
             return res.status(200).json({ 
                 status: "processing", 
                 order_id: order.order_id,
                 order_date: order.order_date, // <--- Sending Date to Frontend
                 message: "Order confirmed, tracking generating."
             });
        }
    }

    // SCENARIO 2: TRACK BY AWB
    if (finalAwb) {
        const trackUrl = `https://track.wareiq.com/tracking/v1/shipments/${finalAwb}/all`;
        const trackResponse = await fetch(trackUrl, {
            method: 'GET',
            headers: { 'Authorization': AUTH_HEADER, 'Content-Type': 'application/json' }
        });

        if (!trackResponse.ok) return res.status(trackResponse.status).json({ error: "Tracking info not found." });
        const trackingData = await trackResponse.json();
        
        if (orderId && !trackingData.order_id) trackingData.order_id = orderId;
        return res.status(200).json(trackingData);
    } 
    
    return res.status(400).json({ error: "Please provide valid tracking details." });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}