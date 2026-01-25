// 1. IMPORTS
import { initializeApp } from "firebase/app";
import { getFirestore, collection, doc, runTransaction, serverTimestamp } from "firebase/firestore";
import crypto from 'crypto'; 

// 2. FIREBASE INIT
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
  measurementId: process.env.FIREBASE_MEASUREMENT_ID
};

let db;
if (process.env.FIREBASE_API_KEY) {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
} else {
    console.warn("LOGGING WARNING: Firebase Config missing.");
}

// Helper: Anonymize User (Privacy Preserving)
const getAnonymousUserId = (ip, userAgent) => {
    return crypto.createHash('sha256').update(`${ip}-${userAgent}`).digest('hex').substring(0, 16);
};

// Helper: Smart Logger with Transaction
async function logSearchEvent(req, searchType, searchValue, status, errorMsg = null) {
    // 1. Prepare Data
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    const city = req.headers['x-vercel-ip-city'] || 'Unknown City';
    const country = req.headers['x-vercel-ip-country'] || 'Unknown Country';
    const isMobile = /mobile/i.test(userAgent);
    const userId = getAnonymousUserId(ip, userAgent);

    // Console Log (System Fallback)
    console.log(`[LOG] ${status.toUpperCase()} | ${searchType} | ${searchValue} | User: ${userId}`);

    if (!db) return;

    // 2. REFERENCES
    const statsRef = doc(db, "analytics", "main_stats"); // The Counter
    const userRef = doc(db, "users", userId); // Unique User Record
    const logRef = doc(collection(db, "tracking_logs")); // Detailed History Entry

    const logData = {
        event_type: "track_search",
        anonymous_user_id: userId,
        search_type: searchType,
        search_value: searchValue,
        status: status,
        error_details: errorMsg,
        device_info: { is_mobile: isMobile, user_agent_raw: userAgent },
        location: { city: decodeURIComponent(city), country: country }
    };

    try {
        // 3. TRANSACTION (Updates Counts & Logs Atomically)
        await runTransaction(db, async (transaction) => {
            const statsDoc = await transaction.get(statsRef);
            const userDoc = await transaction.get(userRef);

            let totalClicks = 0;
            let uniqueUsers = 0;

            if (statsDoc.exists()) {
                totalClicks = statsDoc.data().total_clicks || 0;
                uniqueUsers = statsDoc.data().unique_users || 0;
            }

            // Logic: Always increment total. Only increment unique if user is new.
            totalClicks++;
            if (!userDoc.exists()) {
                uniqueUsers++;
            }

            // A. Update Global Stats
            transaction.set(statsRef, {
                total_clicks: totalClicks,
                unique_users: uniqueUsers,
                last_activity: serverTimestamp()
            }, { merge: true });

            // B. Update Unique User Profile
            if (!userDoc.exists()) {
                transaction.set(userRef, {
                    first_seen: serverTimestamp(),
                    last_seen: serverTimestamp(),
                    visit_count: 1,
                    latest_location: logData.location,
                    device: logData.device_info
                });
            } else {
                transaction.update(userRef, {
                    last_seen: serverTimestamp(),
                    visit_count: (userDoc.data().visit_count || 0) + 1,
                    latest_location: logData.location
                });
            }

            // C. Add Detailed Log
            transaction.set(logRef, {
                ...logData,
                timestamp: serverTimestamp()
            });
        });
    } catch (e) {
        console.error("FIREBASE TRANSACTION ERROR:", e.message);
    }
}

export default async function handler(req, res) {
  // CORS & Security Headers
  const allowedOrigins = ['https://armor.shop', 'https://staging.armor.shop', 'http://localhost:3000'];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  
  // Disable Caching
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // Extract Inputs
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers.host;
  const currentUrl = new URL(req.url, `${protocol}://${host}`);

  const orderId = currentUrl.searchParams.get('orderId') || currentUrl.searchParams.get('order_id') || currentUrl.searchParams.get('orderid');
  const mobile = currentUrl.searchParams.get('mobile');
  const awb = currentUrl.searchParams.get('awb');
  const AUTH_HEADER = process.env.WAREIQ_AUTH_HEADER;

  if (!AUTH_HEADER) {
      console.error("CRITICAL: WAREIQ_AUTH_HEADER missing.");
      return res.status(500).json({ error: "Server Error: Configuration Missing" });
  }

  // Mutual Exclusion
  if (awb && (orderId || mobile)) {
      await logSearchEvent(req, "MIXED", "AWB+Order", "failed", "Invalid Parameters");
      return res.status(400).json({ error: "Invalid Request: Provide EITHER AWB OR OrderID/Mobile." });
  }

  try {
    let finalAwb = awb;

    // SCENARIO 1: SEARCH BY ORDER ID
    if (!finalAwb && orderId) {
        if (!mobile) {
            await logSearchEvent(req, "ORDER_ID", orderId, "failed", "Missing Mobile");
            return res.status(400).json({ error: "Mobile number is required." });
        }
        if (!/^\d{10}$/.test(mobile)) {
             await logSearchEvent(req, "ORDER_ID", orderId, "failed", "Invalid Mobile Format");
             return res.status(400).json({ error: "Mobile number must be exactly 10 digits." });
        }

        const searchUrl = "https://track.wareiq.com/orders/v2/orders/b2c/all"; 
        const searchPayload = { "search": { "order_details": orderId }, "page": 1, "per_page": 1 };

        const searchResponse = await fetch(searchUrl, {
            method: 'POST',
            headers: { 'Authorization': AUTH_HEADER, 'Content-Type': 'application/json' },
            body: JSON.stringify(searchPayload)
        });

        if (!searchResponse.ok) {
            await logSearchEvent(req, "ORDER_ID", orderId, "failed", "WareIQ API Error");
            return res.status(searchResponse.status).json({ error: "Order search failed." });
        }

        const searchData = await searchResponse.json();
        
        if (!searchData?.data?.length) {
            await logSearchEvent(req, "ORDER_ID", orderId, "failed", "Order Not Found");
            return res.status(404).json({ error: "Order ID not found." });
        }

        const order = searchData.data[0];
        const cleanStored = (order.customer_details?.phone || "").replace(/\D/g, ''); 
        
        if (!cleanStored.endsWith(mobile)) {
            await logSearchEvent(req, "ORDER_ID", orderId, "failed", "Mobile Mismatch");
            return res.status(400).json({ error: "Mobile number does not match this Order ID." });
        }

        finalAwb = order.shipping_details?.awb;

        if (!finalAwb) {
             await logSearchEvent(req, "ORDER_ID", orderId, "pending", "Confirmed, No AWB");
             return res.status(200).json({ 
                 status: "processing", 
                 order_id: order.order_id,
                 order_date: order.order_date,
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

        if (!trackResponse.ok) {
            await logSearchEvent(req, "AWB", finalAwb, "failed", "Tracking Info Not Found");
            return res.status(trackResponse.status).json({ error: "Tracking info not found." });
        }

        const trackingData = await trackResponse.json();
        if (orderId && !trackingData.order_id) trackingData.order_id = orderId;

        await logSearchEvent(req, orderId ? "ORDER_ID" : "AWB", orderId || finalAwb, "success");
        return res.status(200).json(trackingData);
    } 
    
    return res.status(400).json({ error: "Please provide valid tracking details." });

  } catch (error) {
    console.error("CRITICAL EXCEPTION:", error);
    await logSearchEvent(req, "UNKNOWN", "SYSTEM", "error", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}