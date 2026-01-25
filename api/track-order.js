// 1. IMPORTS
import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, serverTimestamp } from "firebase/firestore";
import crypto from 'crypto'; // Built-in Node module for hashing IPs (Privacy)

// 2. FIREBASE INIT (Outside handler to prevent cold-start re-initialization)
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
  measurementId: process.env.FIREBASE_MEASUREMENT_ID
};

// Initialize only if config is present (prevents crashes during build)
let db;
if (process.env.FIREBASE_API_KEY) {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
} else {
    console.warn("Firebase Config Missing: Logging disabled.");
}

// Helper: Anonymize User (Hash IP)
const getAnonymousUserId = (ip, userAgent) => {
    return crypto.createHash('sha256').update(`${ip}-${userAgent}`).digest('hex').substring(0, 12);
};

// Helper: Async Logger (Fire and Forget)
async function logSearchEvent(req, searchType, searchValue, status, errorMsg = null) {
    if (!db) return;

    try {
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
        const userAgent = req.headers['user-agent'] || 'unknown';
        const city = req.headers['x-vercel-ip-city'] || 'Unknown City';
        const country = req.headers['x-vercel-ip-country'] || 'Unknown Country';
        
        // Detect Device Type roughly
        const isMobile = /mobile/i.test(userAgent);
        
        const logData = {
            timestamp: serverTimestamp(),
            event_type: "track_search",
            anonymous_user_id: getAnonymousUserId(ip, userAgent), // Unique ID for "Unique User" counts
            search_type: searchType, // "AWB" or "ORDER_ID"
            search_value: searchValue,
            status: status, // "success", "pending", "failed"
            error_details: errorMsg,
            device_info: {
                is_mobile: isMobile,
                user_agent_raw: userAgent
            },
            location: {
                city: decodeURIComponent(city),
                country: country,
                ip_hash: getAnonymousUserId(ip, "salt") // Just IP hash
            }
        };

        // Write to "tracking_logs" collection
        await addDoc(collection(db, "tracking_logs"), logData);
        // console.log("Logged to Firebase"); 

    } catch (e) {
        console.error("Firebase Logging Failed:", e.message);
        // We do NOT throw error here, to keep the user experience tracking working.
    }
}

export default async function handler(req, res) {
  // ---------------------------------------------------------
  // 1. CORS & SECURITY
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
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  
  // Disable Caching
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // ---------------------------------------------------------
  // 2. INPUTS
  // ---------------------------------------------------------
  const orderId = req.query.orderId || req.query.order_id || req.query.orderid;
  const mobile = req.query.mobile;
  const awb = req.query.awb;
  const AUTH_HEADER = process.env.WAREIQ_AUTH_HEADER;

  if (!AUTH_HEADER) return res.status(500).json({ error: "Server Configuration Error" });
  if (awb && (orderId || mobile)) return res.status(400).json({ error: "Invalid Request: Provide AWB OR OrderID/Mobile, not both." });

  try {
    let finalAwb = awb;

    // ---------------------------------------------------------
    // SCENARIO 1: SEARCH BY ORDER ID
    // ---------------------------------------------------------
    if (!finalAwb && orderId) {
        // Validation Errors -> Log Failure
        if (!mobile) {
            logSearchEvent(req, "ORDER_ID", orderId, "failed", "Missing Mobile");
            return res.status(400).json({ error: "Mobile number is required." });
        }
        if (!/^\d{10}$/.test(mobile)) {
             logSearchEvent(req, "ORDER_ID", orderId, "failed", "Invalid Mobile Format");
             return res.status(400).json({ error: "Mobile number must be exactly 10 digits." });
        }

        const searchUrl = "https://track.wareiq.com/orders/v2/orders/b2c/all"; 
        const searchResponse = await fetch(searchUrl, {
            method: 'POST',
            headers: { 'Authorization': AUTH_HEADER, 'Content-Type': 'application/json' },
            body: JSON.stringify({ "search": { "order_details": orderId }, "page": 1, "per_page": 1 })
        });

        if (!searchResponse.ok) {
            logSearchEvent(req, "ORDER_ID", orderId, "failed", "WareIQ API Error");
            return res.status(searchResponse.status).json({ error: "Order search failed." });
        }

        const searchData = await searchResponse.json();
        
        if (!searchData?.data?.length) {
            logSearchEvent(req, "ORDER_ID", orderId, "failed", "Order Not Found");
            return res.status(404).json({ error: "Order ID not found." });
        }

        const order = searchData.data[0];

        // Mobile Verification
        const cleanStored = (order.customer_details?.phone || "").replace(/\D/g, ''); 
        if (!cleanStored.endsWith(mobile)) {
            logSearchEvent(req, "ORDER_ID", orderId, "failed", "Mobile Mismatch");
            return res.status(400).json({ error: "Mobile number does not match this Order ID." });
        }

        finalAwb = order.shipping_details?.awb;

        // PENDING ORDER LOGIC
        if (!finalAwb) {
             // LOG SUCCESSFUL (Pending) SEARCH
             logSearchEvent(req, "ORDER_ID", orderId, "pending");
             
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
        const trackUrl = `https://track.wareiq.com/tracking/v1/shipments/${finalAwb}/all`;
        const trackResponse = await fetch(trackUrl, {
            method: 'GET',
            headers: { 'Authorization': AUTH_HEADER, 'Content-Type': 'application/json' }
        });

        if (!trackResponse.ok) {
            logSearchEvent(req, "AWB", finalAwb, "failed", "AWB Not Found");
            return res.status(trackResponse.status).json({ error: "Tracking info not found." });
        }

        const trackingData = await trackResponse.json();
        if (orderId && !trackingData.order_id) trackingData.order_id = orderId;

        // LOG SUCCESSFUL SEARCH
        // Note: We use 'orderId' if available, otherwise just 'finalAwb' as the identifier
        logSearchEvent(req, orderId ? "ORDER_ID" : "AWB", orderId || finalAwb, "success");

        return res.status(200).json(trackingData);
    } 
    
    return res.status(400).json({ error: "Please provide valid tracking details." });

  } catch (error) {
    console.error(error);
    // Log System Errors
    logSearchEvent(req, "UNKNOWN", "SYSTEM", "error", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}