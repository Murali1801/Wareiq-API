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

  // MUTUAL EXCLUSION CHECK
  if (awb && (orderId || mobile)) {
      return res.status(400).json({ 
          error: "Invalid Request: Please provide EITHER an AWB OR an Order ID with Mobile. Do not provide all three." 
      });
  }

  try {
    let finalAwb = awb;

    // ---------------------------------------------------------
    // SCENARIO 1: SEARCH BY ORDER ID (REQUIRES MOBILE VERIFICATION)
    // ---------------------------------------------------------
    if (!finalAwb && orderId) {
        
        // 1. Enforce Mobile Presence
        if (!mobile) {
            return res.status(400).json({ error: "Mobile number is required to track by Order ID." });
        }

        console.log(`STEP 1: Searching for Order ID: ${orderId}`);
        
        // 2. Call WareIQ Order Search API
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
        
        // 3. check if Order Exists
        if (!searchData?.data?.length) {
            return res.status(404).json({ error: "Order ID not found." });
        }

        const order = searchData.data[0];

        // ---------------------------------------------------------
        // CRITICAL STEP: MOBILE NUMBER VERIFICATION
        // ---------------------------------------------------------
        const storedPhone = order.customer_details?.phone || "";
        
        // Normalize numbers (remove spaces, dashes, country codes if needed)
        // We check if the stored phone ENDS with the input phone.
        // Example: Stored "09876543210" ends with Input "9876543210" -> MATCH
        const cleanStored = storedPhone.replace(/\D/g, ''); 
        const cleanInput = mobile.replace(/\D/g, ''); 

        console.log(`Verifying Phone: Input(${cleanInput}) vs Stored(${cleanStored})`);

        if (!cleanStored.endsWith(cleanInput)) {
            // STOP HERE: The mobile number does not match.
            console.warn(`Security Alert: Mobile mismatch for Order ${orderId}`);
            return res.status(400).json({ error: "Mobile number does not match this Order ID." });
        }

        // ---------------------------------------------------------
        // VALIDATION SUCCESS: EXTRACT AWB
        // ---------------------------------------------------------
        finalAwb = order.shipping_details?.awb; 

        if (!finalAwb) {
             // Order matches, Mobile matches, but no AWB yet.
             return res.status(400).json({ error: "Order found, but no tracking number (AWB) assigned yet." });
        }
    }

    // ---------------------------------------------------------
    // SCENARIO 2: TRACK BY AWB (Either provided directly or found above)
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
        
        // Inject Order ID into response for UI consistency
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