# Historical Convex Notes

> Status: this file describes older Convex modules and is not the source of truth for the current managed Moeazi backend.
>
> For the live app architecture, setup, and run instructions, use the root [README](../README.md).

# Market Data API - Convex Modules

This directory contains modular, reusable Convex actions for fetching real-time cryptocurrency market data from GMX and CoinGecko APIs.

## 📁 Module Structure

### `gmxApi.ts` - GMX Protocol Integration
Fetches real-time prices, tickers, and market information from GMX on Arbitrum.

**Actions:**
- `fetchGmxData()` - Get all tickers and markets data
- `getTokenPrice(tokenSymbol)` - Get specific token price
- `getMarketInfo(tokenAddress)` - Get market info including funding rates

### `coingeckoApi.ts` - CoinGecko Integration  
Fetches 24-hour price changes, volume, and market cap data.

**Actions:**
- `fetch24hData(symbols)` - Get 24h data for multiple tokens
- `getToken24hData(symbol)` - Get 24h data for a single token

### `marketData.ts` - Combined Market Data
Unified action that combines GMX and CoinGecko data for a complete market overview.

**Actions:**
- `getMarketData(pairs?)` - Get complete market data for trading pairs

---

## 🚀 Usage Examples

### 1. Using in React Components

```tsx
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";

function MyComponent() {
  const getMarketData = useAction(api.marketData.getMarketData);
  
  const fetchData = async () => {
    const data = await getMarketData({ 
      pairs: ["BTC-PERP", "ETH-PERP", "SOL-PERP"] 
    });
    console.log(data);
  };
}
```

### 2. Using Individual GMX Actions

```tsx
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";

function PriceWidget() {
  const getTokenPrice = useAction(api.gmxApi.getTokenPrice);
  
  const fetchBtcPrice = async () => {
    const price = await getTokenPrice({ tokenSymbol: "BTC" });
    // Returns: { symbol, address, price, minPrice, maxPrice, timestamp }
  };
}
```

### 3. Using CoinGecko Actions

```tsx
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";

function MarketStats() {
  const fetch24hData = useAction(api.coingeckoApi.fetch24hData);
  
  const fetchStats = async () => {
    const data = await fetch24hData({ 
      symbols: ["BTC", "ETH", "SOL"] 
    });
    // Returns: { BTC: { price, change24h, volume24h, marketCap }, ... }
  };
}
```

---

## 🤖 Using with AI Agents

### Agent Communication Pattern

Agents can call these Convex actions to get real-time market data for decision-making:

```typescript
// Inside an agent's logic
const marketData = await ctx.runAction(api.marketData.getMarketData, {
  pairs: ["BTC-PERP", "ETH-PERP"]
});

// Agent analyzes data
marketData.forEach(token => {
  if (token.changePct24h > 5) {
    console.log(`${token.symbol} is up ${token.changePct24h}% - Consider long position`);
  }
  
  if (token.fundingRate && token.fundingRate < -0.01) {
    console.log(`${token.symbol} has negative funding - Shorts are paying longs`);
  }
});
```

### Agent Action Example

```typescript
// convex/agents/tradingAgent.ts
import { action } from "./_generated/server";
import { api } from "./_generated/api";

export const analyzeMarket = action({
  args: {},
  handler: async (ctx) => {
    // Get market data
    const data = await ctx.runAction(api.marketData.getMarketData, {
      pairs: ["BTC-PERP", "ETH-PERP"]
    });
    
    // Agent decision logic
    const signals = data.map(token => ({
      symbol: token.symbol,
      signal: token.changePct24h > 5 ? "LONG" : token.changePct24h < -5 ? "SHORT" : "HOLD",
      confidence: Math.abs(token.changePct24h) / 10,
      fundingRate: token.fundingRate
    }));
    
    return signals;
  }
});
```

---

## 📊 Data Structure Reference

### MarketData Object
```typescript
{
  pair: string;           // "BTC/USD"
  symbol: string;         // "BTC"
  price: number;          // Current price from GMX
  changePct24h: number;   // 24h change % from CoinGecko
  change24h: number;      // 24h change in $ 
  volume24h: number;      // 24h trading volume
  fundingRate?: number;   // Funding rate from GMX (if available)
  lastUpdate: number;     // Timestamp of last update
  tokenAddress: string;   // Token contract address
}
```

---

## 🔧 Configuration

### Adding New Tokens

To add support for new tokens, update the `COINGECKO_IDS` mapping in `coingeckoApi.ts`:

```typescript
const COINGECKO_IDS: Record<string, string> = {
  // Add your token here
  NEWTOKEN: 'coingecko-id',
  // Example:
  DOGE: 'dogecoin',
};
```

### API Keys

CoinGecko API key is configured in `coingeckoApi.ts`:
```typescript
headers: {
  'x-cg-demo-api-key': 'YOUR_API_KEY'
}
```

---

## ⚡ Performance Notes

- **GMX data** updates in real-time (recommended polling: 10 seconds)
- **CoinGecko data** updates less frequently (recommended: fetch once on mount)
- All actions run server-side in Convex, avoiding CORS issues
- Actions can be called from components, agents, or other Convex functions

---

## 🛠️ Best Practices

1. **Cache CoinGecko data** - Don't fetch on every render, it changes slowly
2. **Poll GMX data** - Prices update frequently, poll every 5-10 seconds
3. **Error handling** - Always wrap action calls in try/catch
4. **Rate limits** - Be mindful of API rate limits (especially CoinGecko)
5. **Reusability** - These modules are designed to be used across your entire app

---

## 📝 Example: Complete Implementation

```tsx
"use client";

import { useAction } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";

export function MarketDashboard({ pairs }: { pairs: string[] }) {
  const [data, setData] = useState([]);
  const getMarketData = useAction(api.marketData.getMarketData);

  useEffect(() => {
    const fetch = async () => {
      const result = await getMarketData({ pairs });
      setData(result);
    };
    
    fetch();
    const interval = setInterval(fetch, 10000);
    return () => clearInterval(interval);
  }, [pairs, getMarketData]);

  return (
    <div>
      {data.map(token => (
        <div key={token.symbol}>
          <h3>{token.pair}</h3>
          <p>Price: ${token.price}</p>
          <p>24h Change: {token.changePct24h}%</p>
          <p>Funding: {token.fundingRate}%</p>
        </div>
      ))}
    </div>
  );
}
```

---

## 🎯 Summary

- **3 modular files** for clean separation of concerns
- **Reusable across components** and AI agents
- **Server-side execution** avoids CORS and exposes API keys safely
- **Real-time + historical data** combined in one call
- **Type-safe** with full TypeScript support
