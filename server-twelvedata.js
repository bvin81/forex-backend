import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const API_KEY = process.env.TWELVEDATA_API_KEY;
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

// ============= TWELVE DATA API HELPER =============
function twelveDataUrl(pair, interval) {
  const symbol = `${pair.slice(0, 3)}/${pair.slice(3, 6)}`;
  
  const intervalMap = {
    'daily': '1day',
    '60min': '1h',
    '15min': '15min'
  };
  
  const mappedInterval = intervalMap[interval] || interval;
  
  return `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=${mappedInterval}&outputsize=100&apikey=${API_KEY}`;
}

async function fetchCandles(url, pair, interval) {
  const cacheKey = `${pair}-${interval}`;
  
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

    // Check for Twelve Data errors
    if (data.status === 'error') {
      console.error('[TWELVE DATA ERROR]', data.message);
      throw new Error(`API_ERROR: ${data.message}`);
    }

    if (data.code === 429) {
      throw new Error('API_LIMIT_REACHED');
    }

    if (!data.values || !Array.isArray(data.values)) {
      console.error('[NO VALUES] Response:', JSON.stringify(data).substring(0, 300));
      throw new Error('NO_TIME_SERIES_DATA');
    }

    // Convert Twelve Data format to our format
    const candles = data.values.map(item => ({
      time: item.datetime,
      open: parseFloat(item.open),
      high: parseFloat(item.high),
      low: parseFloat(item.low),
      close: parseFloat(item.close)
    }));

    // Twelve Data returns newest first, reverse to get oldest first
    const result = candles.reverse();
    
    // Cache the result
    cache.set(cacheKey, result);
    console.log(`[API CALL] Twelve Data - ${pair} ${interval}`);
    
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
    
    const url = twelveDataUrl(pair, 'daily');
    const candles = await fetchCandles(url, pair, 'daily');
    
    if (!candles) {
      throw new Error('NO_DATA');
    }
    
    res.json({ candles });
  } catch (error) {
    if (error.message === 'API_LIMIT') {
      return res.status(429).json({
        error: 'API_LIMIT_REACHED',
        message: 'Twelve Data API limit reached. Please try again later or enable DEMO_MODE.'
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
    
    const url = twelveDataUrl(pair, '60min');
    const candles = await fetchCandles(url, pair, '60min');
    
    if (!candles) {
      throw new Error('NO_DATA');
    }
    
    res.json({ candles });
  } catch (error) {
    if (error.message === 'API_LIMIT') {
      return res.status(429).json({
        error: 'API_LIMIT_REACHED',
        message: 'Twelve Data API limit reached. Please try again later or enable DEMO_MODE.'
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
    
    const url = twelveDataUrl(pair, '15min');
    const candles = await fetchCandles(url, pair, '15min');
    
    if (!candles) {
      throw new Error('NO_DATA');
    }
    
    res.json({ candles });
  } catch (error) {
    if (error.message === 'API_LIMIT') {
      return res.status(429).json({
        error: 'API_LIMIT_REACHED',
        message: 'Twelve Data API limit reached. Please try again later or enable DEMO_MODE.'
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
    provider: 'Twelve Data',
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
║   Provider: Twelve Data API               ║
╚════════════════════════════════════════════╝
  
  🌐 Server:     http://${HOST}:${PORT}
  📊 Mode:       ${DEMO_MODE ? '⚠️  DEMO (Generated Data)' : '✅ LIVE (Twelve Data)'}
  💾 Cache TTL:  ${CACHE_TTL / 1000}s
  🔑 API Key:    ${API_KEY ? '✅ Loaded' : '❌ Missing'}
  📡 Provider:   Twelve Data (800 calls/day FREE)
  
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
