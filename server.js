import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const API_KEY = process.env.ALPHAVANTAGE_API_KEY;
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const CACHE_TTL = parseInt(process.env.CACHE_TTL) || 5 * 60 * 1000; // 5 minutes
const DEMO_MODE = process.env.DEMO_MODE === 'true';

// ============= CACHE SYSTEM =============
class Cache {
  constructor(ttl) {
    this.cache = new Map();
    this.ttl = ttl;
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    
    if (Date.now() - item.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    console.log(`[CACHE HIT] ${key}`);
    return item.data;
  }

  set(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  clear() {
    this.cache.clear();
  }

  size() {
    return this.cache.size;
  }
}

const cache = new Cache(CACHE_TTL);

// ============= HELPER FUNCTIONS =============
function alphaUrl(pair, interval) {
  const base = pair.slice(0, 3);
  const quote = pair.slice(3, 6);

  if (interval === "daily") {
    return `https://www.alphavantage.co/query?function=FX_DAILY&from_symbol=${base}&to_symbol=${quote}&apikey=${API_KEY}`;
  }

  return `https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=${base}&to_symbol=${quote}&interval=${interval}&apikey=${API_KEY}`;
}

async function fetchCandles(url) {
  const cacheKey = url;
  
  // Check cache first
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch(url, {
      timeout: 10000
    });
    
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();

    if (data.Note) {
      throw new Error('API_LIMIT_REACHED');
    }

    if (data["Error Message"]) {
      throw new Error(`API_ERROR: ${data["Error Message"]}`);
    }

    const key = Object.keys(data).find(k => k.includes("Time Series"));
    if (!key) {
      throw new Error('NO_TIME_SERIES_DATA');
    }

    const series = data[key];

    const candles = Object.entries(series).map(([time, ohlc]) => ({
      time,
      open: parseFloat(ohlc["1. open"]),
      high: parseFloat(ohlc["2. high"]),
      low: parseFloat(ohlc["3. low"]),
      close: parseFloat(ohlc["4. close"])
    }));

    const result = candles.reverse();
    
    // Cache the result
    cache.set(cacheKey, result);
    console.log(`[API CALL] ${url}`);
    
    return result;
  } catch (error) {
    console.error(`[FETCH ERROR] ${error.message}`);
    
    if (error.message === 'API_LIMIT_REACHED') {
      throw new Error('API_LIMIT');
    }
    
    throw error;
  }
}

// ============= DEMO DATA GENERATOR =============
function generateDemoCandles(count, basePrice, volatility) {
  const candles = [];
  let price = basePrice;
  
  for (let i = 0; i < count; i++) {
    const change = (Math.random() - 0.5) * volatility;
    price += change;
    
    const open = price;
    const close = price + (Math.random() - 0.5) * volatility * 0.5;
    const high = Math.max(open, close) + Math.random() * volatility * 0.3;
    const low = Math.min(open, close) - Math.random() * volatility * 0.3;
    
    candles.push({
      time: new Date(Date.now() - (count - i) * 86400000).toISOString().split('T')[0],
      open: parseFloat(open.toFixed(5)),
      high: parseFloat(high.toFixed(5)),
      low: parseFloat(low.toFixed(5)),
      close: parseFloat(close.toFixed(5))
    });
    
    price = close;
  }
  
  return candles;
}

// ============= ROUTES =============
app.get("/api/daily", async (req, res) => {
  const pair = req.query.pair;
  
  if (!pair) {
    return res.status(400).json({ 
      error: 'MISSING_PAIR',
      message: 'Pair parameter is required' 
    });
  }
  
  try {
    if (DEMO_MODE) {
      console.log(`[DEMO MODE] Generating daily data for ${pair}`);
      const candles = generateDemoCandles(100, 1.1500, 0.01);
      return res.json({ candles });
    }
    
    const url = alphaUrl(pair, "daily");
    const candles = await fetchCandles(url);
    
    if (!candles) {
      throw new Error('NO_DATA');
    }
    
    res.json({ candles });
  } catch (error) {
    if (error.message === 'API_LIMIT') {
      return res.status(429).json({
        error: 'API_LIMIT_REACHED',
        message: 'AlphaVantage API limit reached. Please try again later or enable DEMO_MODE.'
      });
    }
    
    console.error(`[ERROR] /api/daily - ${error.message}`);
    res.status(500).json({ 
      error: 'SERVER_ERROR',
      message: error.message 
    });
  }
});

app.get("/api/h1", async (req, res) => {
  const pair = req.query.pair;
  
  if (!pair) {
    return res.status(400).json({ 
      error: 'MISSING_PAIR',
      message: 'Pair parameter is required' 
    });
  }
  
  try {
    if (DEMO_MODE) {
      console.log(`[DEMO MODE] Generating H1 data for ${pair}`);
      const candles = generateDemoCandles(100, 1.1500, 0.005);
      return res.json({ candles });
    }
    
    const url = alphaUrl(pair, "60min");
    const candles = await fetchCandles(url);
    
    if (!candles) {
      throw new Error('NO_DATA');
    }
    
    res.json({ candles });
  } catch (error) {
    if (error.message === 'API_LIMIT') {
      return res.status(429).json({
        error: 'API_LIMIT_REACHED',
        message: 'AlphaVantage API limit reached. Please try again later or enable DEMO_MODE.'
      });
    }
    
    console.error(`[ERROR] /api/h1 - ${error.message}`);
    res.status(500).json({ 
      error: 'SERVER_ERROR',
      message: error.message 
    });
  }
});

app.get("/api/m15", async (req, res) => {
  const pair = req.query.pair;
  
  if (!pair) {
    return res.status(400).json({ 
      error: 'MISSING_PAIR',
      message: 'Pair parameter is required' 
    });
  }
  
  try {
    if (DEMO_MODE) {
      console.log(`[DEMO MODE] Generating M15 data for ${pair}`);
      const candles = generateDemoCandles(100, 1.1500, 0.002);
      return res.json({ candles });
    }
    
    const url = alphaUrl(pair, "15min");
    const candles = await fetchCandles(url);
    
    if (!candles) {
      throw new Error('NO_DATA');
    }
    
    res.json({ candles });
  } catch (error) {
    if (error.message === 'API_LIMIT') {
      return res.status(429).json({
        error: 'API_LIMIT_REACHED',
        message: 'AlphaVantage API limit reached. Please try again later or enable DEMO_MODE.'
      });
    }
    
    console.error(`[ERROR] /api/m15 - ${error.message}`);
    res.status(500).json({ 
      error: 'SERVER_ERROR',
      message: error.message 
    });
  }
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: 'OK',
    mode: DEMO_MODE ? 'DEMO' : 'LIVE',
    cache_size: cache.size(),
    uptime: process.uptime()
  });
});

// Clear cache endpoint
app.post("/api/cache/clear", (req, res) => {
  cache.clear();
  res.json({ 
    message: 'Cache cleared successfully',
    cache_size: cache.size()
  });
});

// ============= SERVER START =============
app.listen(PORT, HOST, () => {
  console.log(`
╔════════════════════════════════════════════╗
║   FOREX TRADING BACKEND - READY           ║
╚════════════════════════════════════════════╝
  
  🌐 Server:     http://${HOST}:${PORT}
  📊 Mode:       ${DEMO_MODE ? '⚠️  DEMO (Generated Data)' : '✅ LIVE (AlphaVantage)'}
  💾 Cache TTL:  ${CACHE_TTL / 1000}s
  🔑 API Key:    ${API_KEY ? '✅ Loaded' : '❌ Missing'}
  
  Endpoints:
    GET  /api/daily?pair=EURUSD
    GET  /api/h1?pair=EURUSD
    GET  /api/m15?pair=EURUSD
    GET  /api/health
    POST /api/cache/clear
  `);
  
  if (DEMO_MODE) {
    console.log('  ⚠️  WARNING: DEMO MODE ACTIVE - Using generated data\n');
  }
});
