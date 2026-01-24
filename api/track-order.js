export default async function handler(req, res) {
  // ---------------------------------------------------------
  // 1. CORS & SECURITY CONFIGURATION
  // ---------------------------------------------------------
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
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // *** FIX: DISABLE CACHING (Forces 200 OK instead of 304) ***
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store'); // Tells Vercel Edge not to cache

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // ---------------------------------------------------------
  // 2. EXTRACT & VALIDATE INPUTS
  // ---------------------------------------------------------
  const orderId = req.query.orderId || req.query.order_id || req.query.orderid;
  const mobile = req.query.mobile;
  const awb = req.query.awb;

  const AUTH_HEADER = process.env.WAREIQ_AUTH_HEADER;

  if (!AUTH_HEADER) {
    console.error("CRITICAL: WAREIQ_AUTH_HEADER is missing.");
    return res.status(500).json({ error: "Server Error: Configuration Missing" });
  }

  // Mutual Exclusion Check
  if (awb && (orderId || mobile)) {
      return res.status(400).json({ 
          error: "Invalid Request: Please provide EITHER an AWB OR an Order ID with Mobile. Do not provide all three." 
      });
  }

  try {
    let finalAwb = awb;

    // ---------------------------------------------------------
    // SCENARIO 1: SEARCH BY ORDER ID
    // ---------------------------------------------------------
    if (!finalAwb && orderId) {
        
        if (!mobile) {
            return res.status(400).json({ error: "Mobile number is required to track by Order ID." });
        }
        if (!/^\d{10}$/.test(mobile)) {
             return res.status(400).json({ error: "Mobile number must be exactly 10 digits (numbers only)." });
        }

        console.log(`STEP 1: Searching for Order ID: ${orderId}`);
        
        const searchUrl = "https://track.wareiq.com/orders/v2/orders/b2c/all"; 
        const searchPayload = {
            "search": { "order_details": orderId },
            "page": 1, 
            "per_page": 1
        };

        const searchResponse = await fetch(searchUrl, {
            method: 'POST',
            headers: {
                'Authorization': AUTH_HEADER,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(searchPayload)
        });

        if (!searchResponse.ok) {
            return res.status(searchResponse.status).json({ error: "Order search failed." });
        }

        const searchData = await searchResponse.json();
        
        if (!searchData?.data?.length) {
            return res.status(404).json({ error: "Order ID not found." });
        }

        const order = searchData.data[0];

        // Mobile Verification
        const storedPhone = order.customer_details?.phone || "";
        const cleanStored = storedPhone.replace(/\D/g, ''); 
        
        console.log(`Verifying Phone: Input(${mobile}) vs Stored(${cleanStored})`);

        if (!cleanStored.endsWith(mobile)) {
            return res.status(400).json({ error: "Mobile number does not match this Order ID." });
        }

        finalAwb = order.shipping_details?.awb; 

        // *** PENDING ORDER LOGIC (No AWB) ***
        if (!finalAwb) {
             console.log("Order confirmed, sending pending status with date.");
             return res.status(200).json({ 
                 status: "processing", 
                 order_id: order.order_id,
                 order_date: order.order_date, 
                 message: "Order confirmed, tracking generating."
             });
        }
    }

    // ---------------------------------------------------------
    // SCENARIO 2: TRACK BY AWB
    // ---------------------------------------------------------
    if (finalAwb) {
        console.log(`STEP 2: Tracking AWB: ${finalAwb}`);
        const trackUrl = `https://track.wareiq.com/tracking/v1/shipments/${finalAwb}/all`;

        const trackResponse = await fetch(trackUrl, {
            method: 'GET',
            headers: {
                'Authorization': AUTH_HEADER,
                'Content-Type': 'application/json'
            }
        });

        if (!trackResponse.ok) {
            return res.status(trackResponse.status).json({ error: "Tracking info not found." });
        }

        const trackingData = await trackResponse.json();
        
        if (orderId && !trackingData.order_id) {
            trackingData.order_id = orderId;
        }

        return res.status(200).json(trackingData);
    } 
    
    return res.status(400).json({ error: "Please provide valid tracking details." });

  } catch (error) {
    console.error("CRITICAL EXCEPTION:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}