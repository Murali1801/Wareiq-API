export default async function handler(req, res) {
  // 1. CORS Configuration
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
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
        
        // UPDATED ENDPOINT based on your request
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

        // Get the first matching order
        const order = searchData.data[0];

        // --- MOBILE VERIFICATION (UPDATED FOR YOUR JSON) ---
        if (mobile) {
             // Extract phone from nested object: "customer_details": { "phone": "..." }
             const storedPhone = order.customer_details?.phone || "";
             
             console.log(`Verifying Phone: Input(${mobile}) vs Stored(${storedPhone})`);
             
             // Logic: Check if the stored phone ENDS with the user's input
             // This handles cases like stored "098..." vs input "98..." or "+91..."
             const cleanStored = storedPhone.replace(/\D/g, ''); // Remove non-digits
             const cleanInput = mobile.replace(/\D/g, '');       // Remove non-digits

             if (!cleanStored.endsWith(cleanInput)) {
                 console.warn("Mobile mismatch.");
                 return res.status(400).json({ error: "Mobile number does not match this Order." });
             }
        }

        // --- AWB EXTRACTION (UPDATED FOR YOUR JSON) ---
        // Extract AWB from nested object: "shipping_details": { "awb": "..." }
        finalAwb = order.shipping_details?.awb; 
        console.log(`Found AWB in Shipping Details: ${finalAwb}`);

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