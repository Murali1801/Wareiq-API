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

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // --- DEBUG LOGS ---
  console.log("------------------------------------------------");
  console.log("INCOMING REQUEST:", req.method);
  console.log("PARAMS:", JSON.stringify(req.query));

  // 2. Extract Data
  const orderId = req.query.orderId || req.query.order_id || req.query.orderid;
  const mobile = req.query.mobile;
  const awb = req.query.awb;

  const AUTH_HEADER = process.env.WAREIQ_AUTH_HEADER;

  if (!AUTH_HEADER) {
    console.error("CRITICAL: WAREIQ_AUTH_HEADER is missing.");
    return res.status(500).json({ error: "Server Error: Configuration Missing" });
  }

  // ---------------------------------------------------------
  // VALIDATION: MUTUAL EXCLUSION (Either AWB OR OrderID/Mobile)
  // ---------------------------------------------------------
  // If AWB is present AND (OrderId OR Mobile) is present -> ERROR
  if (awb && (orderId || mobile)) {
      console.warn("Blocked request: Client sent both AWB and Order ID.");
      return res.status(400).json({ 
          error: "Invalid Request: Please provide EITHER an AWB OR an Order ID with Mobile. Do not provide all three." 
      });
  }

  try {
    let finalAwb = awb;

    // ---------------------------------------------------------
    // STEP 1: Search by Order ID (Requires Mobile verification)
    // ---------------------------------------------------------
    if (!finalAwb && orderId) {
        
        // Security Check: Mobile is MANDATORY for Order ID lookup
        if (!mobile) {
            console.warn(`Blocked request for Order ID ${orderId}: Missing Mobile Number.`);
            return res.status(400).json({ error: "Mobile number is required to track by Order ID." });
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

        // Strict Mobile Verification
        const storedPhone = order.customer_details?.phone || "";
        console.log(`Verifying: Input(${mobile}) vs Stored(${storedPhone})`);
        
        const cleanStored = storedPhone.replace(/\D/g, ''); 
        const cleanInput = mobile.replace(/\D/g, ''); 

        if (!cleanStored.endsWith(cleanInput)) {
            console.warn("Security Alert: Mobile number mismatch.");
            return res.status(400).json({ error: "Mobile number does not match this Order ID." });
        }

        finalAwb = order.shipping_details?.awb; 

        if (!finalAwb) {
             return res.status(400).json({ error: "Order found, but no tracking number (AWB) assigned yet." });
        }
    }

    // ---------------------------------------------------------
    // STEP 2: Track using AWB
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
        
        // Pass back the Order ID for the UI
        if (orderId && !trackingData.order_id) {
            trackingData.order_id = orderId;
        }

        return res.status(200).json(trackingData);
    } 
    
    return res.status(400).json({ error: "Please provide an AWB Number or Order ID with Mobile Number." });

  } catch (error) {
    console.error("CRITICAL EXCEPTION:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}