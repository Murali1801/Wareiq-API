// api/track-order.js

export default async function handler(req, res) {
  // ---------------------------------------------------------
  // 1. CORS CONFIGURATION (Allows Shopify to talk to Vercel)
  // ---------------------------------------------------------
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle Browser Preflight Request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // ---------------------------------------------------------
  // 2. INITIAL SETUP
  // ---------------------------------------------------------
  const { awb, orderId, mobile } = req.query;
  
  // Get API Credentials from Vercel Environment Variables
  const AUTH_HEADER = process.env.WAREIQ_AUTH_HEADER;

  if (!AUTH_HEADER) {
    return res.status(500).json({ error: "Server Configuration Error: Missing API Credentials." });
  }

  try {
    let finalAwb = awb;

    // ---------------------------------------------------------
    // STEP 1: If we have Order ID but NO AWB, search for it first
    // ---------------------------------------------------------
    if (!finalAwb && orderId) {
        
        // DOCUMENTATION REFERENCE: Page 47 "POST Orders List V2"
        // We use this endpoint to search for the order details using the Order ID.
        const searchUrl = "https://api.wareiq.com/orders/v2/orders/b2c/all"; 
        
        const searchPayload = {
            "search": {
                [cite_start]"order_details": orderId // Searches by Order ID or AWB [cite: 47]
            },
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
            console.error("Search API Error:", searchResponse.status, await searchResponse.text());
            return res.status(404).json({ error: "Could not find order. Please check the Order ID." });
        }

        const searchData = await searchResponse.json();

        // Validate we got a result
        if (!searchData || !searchData.data || searchData.data.length === 0) {
            return res.status(404).json({ error: "Order ID not found in WareIQ system." });
        }

        // Extract the order object
        const order = searchData.data[0];

        // OPTIONAL SECURITY: Verify Mobile Number if provided
        [cite_start]// Note: 'customer_phone' is the standard field per docs [cite: 49]
        if (mobile) {
             const storedPhone = order.customer_phone || "";
             // Simple check: does the stored phone end with the user's input?
             if (!storedPhone.includes(mobile)) {
                 return res.status(400).json({ error: "Mobile number does not match this Order ID." });
             }
        }

        // Get AWB from the search result
        finalAwb = order.awb; 

        if (!finalAwb) {
            return res.status(400).json({ error: "This order is confirmed but has not been assigned an AWB yet." });
        }
    }

    // ---------------------------------------------------------
    // STEP 2: Fetch Tracking Details using the AWB
    // ---------------------------------------------------------
    if (finalAwb) {
        // DOCUMENTATION REFERENCE: Page 22 "GET Track an order"
        const trackUrl = `https://track.wareiq.com/tracking/v1/shipments/${finalAwb}/all`;

        const trackResponse = await fetch(trackUrl, {
            method: 'GET',
            headers: {
                'Authorization': AUTH_HEADER,
                'Content-Type': 'application/json'
            }
        });

        if (!trackResponse.ok) {
            // Handle 404 specifically for invalid AWBs
            if (trackResponse.status === 404) {
                return res.status(404).json({ error: "Tracking information not found for this shipment." });
            }
            throw new Error(`Tracking API responded with status ${trackResponse.status}`);
        }

        const trackingData = await trackResponse.json();
        
        // Inject the original Order ID into the response if WareIQ didn't return it
        // This ensures your UI displays the Order ID the user typed in
        if (orderId && !trackingData.order_id) {
            trackingData.order_id = orderId;
        }

        return res.status(200).json(trackingData);
    } 
    
    // Fallback if neither AWB nor Order ID was provided
    return res.status(400).json({ error: "Please provide either an AWB Number or an Order ID." });

  } catch (error) {
    console.error("Middleware Error:", error.message);
    return res.status(500).json({ error: "Internal Server Error. Please try again later." });
  }
}