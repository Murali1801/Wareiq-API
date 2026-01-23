export default async function handler(req, res) {
  // ---------------------------------------------------------
  // 1. SECURITY: DYNAMIC CORS CONFIGURATION
  // ---------------------------------------------------------
  const allowedOrigins = [
    'https://armor.shop', 
    'https://staging.armor.shop',
    'http://localhost:3000' // Keep localhost for your local testing
  ];

  const origin = req.headers.origin;

  // If the request comes from an allowed origin, set the header to that origin
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    // Optional: If you want to block other domains completely, you can return here.
    // For now, we just won't set the Allow-Origin header, which effectively blocks them in the browser.
  }

  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle Preflight Options
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // --- DEBUG LOGS ---
  console.log("------------------------------------------------");
  console.log("INCOMING REQUEST:", req.method);
  console.log("ORIGIN:", origin); // Helpful to see who is calling
  console.log("QUERY PARAMS:", JSON.stringify(req.query));

  // 2. Extract Data
  // Handle case-insensitivity for orderId
  const orderId = req.query.orderId || req.query.order_id || req.query.orderid;
  const mobile = req.query.mobile;
  const awb = req.query.awb;

  const AUTH_HEADER = process.env.WAREIQ_AUTH_HEADER;

  if (!AUTH_HEADER) {
    console.error("CRITICAL: WAREIQ_AUTH_HEADER is missing.");
    return res.status(500).json({ error: "Server Error: Configuration Missing" });
  }

  try {
    let finalAwb = awb;

    // ---------------------------------------------------------
    // STEP 1: Search by Order ID (if AWB is missing)
    // ---------------------------------------------------------
    if (!finalAwb && orderId) {
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
            const errText = await searchResponse.text();
            console.error(`Search API Failed (${searchResponse.status}):`, errText);
            return res.status(searchResponse.status).json({ error: "Order search failed.", details: errText });
        }

        const searchData = await searchResponse.json();
        console.log("Search Result Matches Found:", searchData?.data?.length || 0);

        if (!searchData?.data?.length) {
            console.warn("Order ID not found in WareIQ.");
            return res.status(404).json({ error: "Order ID not found." });
        }

        const order = searchData.data[0];

        // --- MOBILE VERIFICATION ---
        if (mobile) {
             const storedPhone = order.customer_details?.phone || "";
             console.log(`Verifying Phone: Input(${mobile}) vs Stored(${storedPhone})`);
             
             // Normalize and check
             const cleanStored = storedPhone.replace(/\D/g, ''); 
             const cleanInput = mobile.replace(/\D/g, ''); 

             if (!cleanStored.endsWith(cleanInput)) {
                 console.warn("Mobile mismatch.");
                 return res.status(400).json({ error: "Mobile number does not match this Order." });
             }
        }

        // --- AWB EXTRACTION ---
        finalAwb = order.shipping_details?.awb; 
        console.log(`Found AWB: ${finalAwb}`);

        if (!finalAwb) {
             return res.status(400).json({ error: "Order confirmed but AWB not yet assigned." });
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
            const errText = await trackResponse.text();
            console.error(`Tracking API Failed (${trackResponse.status}):`, errText);
            return res.status(trackResponse.status).json({ error: "Tracking info not found." });
        }

        const trackingData = await trackResponse.json();
        
        // Pass back the Order ID for the UI
        if (orderId && !trackingData.order_id) {
            trackingData.order_id = orderId;
        }

        return res.status(200).json(trackingData);
    } 
    
    console.warn("Fail: No AWB and No Order ID found in params.");
    return res.status(400).json({ error: "Provide AWB or Order ID." });

  } catch (error) {
    console.error("CRITICAL EXCEPTION:", error);
    return res.status(500).json({ error: "Internal Server Error", details: error.message });
  }
}