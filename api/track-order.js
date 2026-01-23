export default async function handler(req, res) {
  // 1. CORS Configuration
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle Preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // --- DEBUG LOG: START ---
  console.log("------------------------------------------------");
  console.log("INCOMING REQUEST:", req.method);
  console.log("QUERY PARAMS:", JSON.stringify(req.query));

  // 2. Extract Data
  const { awb, orderId, mobile } = req.query;
  const AUTH_HEADER = process.env.WAREIQ_AUTH_HEADER;

  // --- DEBUG LOG: AUTH CHECK ---
  if (!AUTH_HEADER) {
    console.error("CRITICAL ERROR: WAREIQ_AUTH_HEADER is missing in Environment Variables.");
    return res.status(500).json({ error: "Server Error: Configuration Missing" });
  } else {
    console.log("Auth Header is present.");
  }

  try {
    let finalAwb = awb;

    // ---------------------------------------------------------
    // STEP 1: Search by Order ID (if AWB is missing)
    // ---------------------------------------------------------
    if (!finalAwb && orderId) {
        console.log(`STEP 1: Searching for Order ID: ${orderId}`);
        
        const searchUrl = "https://api.wareiq.com/orders/v2/orders/b2c/all"; 
        
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

        console.log(`WareIQ Search Status: ${searchResponse.status}`);

        if (!searchResponse.ok) {
            const errorText = await searchResponse.text();
            console.error("WareIQ Search API Error Body:", errorText);
            return res.status(404).json({ error: "Order lookup failed." });
        }

        const searchData = await searchResponse.json();
        console.log("WareIQ Search Response Data:", JSON.stringify(searchData));

        if (!searchData?.data?.length) {
            console.warn("Order ID not found in WareIQ database.");
            return res.status(404).json({ error: "Order ID not found." });
        }

        const order = searchData.data[0];
        console.log("Order Found. details:", JSON.stringify(order));

        // Optional Mobile Check
        if (mobile) {
             console.log(`Verifying Mobile: Input(${mobile}) vs Order(${order.customer_phone})`);
             if (order.customer_phone && !order.customer_phone.includes(mobile)) {
                 console.warn("Mobile verification failed.");
                 return res.status(400).json({ error: "Mobile number does not match this Order ID." });
             }
        }

        finalAwb = order.awb; 
        console.log(`Extracted AWB from Order: ${finalAwb}`);

        if (!finalAwb) {
             console.warn("Order exists but has no AWB assigned.");
             return res.status(400).json({ error: "Order confirmed but shipment not yet created (No AWB)." });
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

        console.log(`WareIQ Track Status: ${trackResponse.status}`);

        if (!trackResponse.ok) {
            const errorText = await trackResponse.text();
            console.error("Tracking API Error Body:", errorText);
            return res.status(trackResponse.status).json({ error: "Tracking info not found." });
        }

        const trackingData = await trackResponse.json();
        console.log("Tracking Data Received Success.");
        
        // Ensure UI gets the Order ID back
        if (orderId && !trackingData.order_id) {
            trackingData.order_id = orderId;
        }

        return res.status(200).json(trackingData);
    } 
    
    console.warn("Request failed: No AWB and No Order ID provided.");
    return res.status(400).json({ error: "Provide AWB or Order ID." });

  } catch (error) {
    console.error("CRITICAL EXCEPTION:", error);
    return res.status(500).json({ error: "Internal Server Error", details: error.message });
  }
}