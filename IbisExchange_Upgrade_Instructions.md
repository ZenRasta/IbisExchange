# IbisExchange — Comprehensive Upgrade Instructions for Claude Code

## Repository
- **URL:** https://github.com/ZenRasta/IbisExchange
- **Stack:** TypeScript monorepo (`packages/`), Telegram Mini App + Bot, TON blockchain escrow
- **Description:** Caribbean P2P USDT↔Local Currency Trading Platform

---

## Thoughts on the 0.5% Fee

The 0.5% fee is a **smart, competitive choice** for IbisExchange. Here's why:

**Market comparison:**
- Binance P2P: 0% (but they make money elsewhere — spot trading, withdrawals, futures)
- Paxful: 1% seller fee, 0% buyer fee
- LocalCoinSwap: ~1% per trade
- OpenPeer: 0.3% seller fee
- LocalBitcoins (before shutdown): ~1% per trade

**0.5% is the sweet spot because:**
1. **It's lower than the established players** (Paxful at 1%, LocalBitcoins at 1%) — a genuine competitive advantage you can market: "Half the fee of Paxful."
2. **It's sustainable** — unlike 0% which requires massive volume or alternate revenue streams that a new platform won't have.
3. **On a $100 USDT trade, that's $0.50** — barely noticeable. Even on $1 min trade, it's half a cent.
4. **For the Caribbean market**, where spreads on USDT/local currency can be 2-5%, a 0.5% platform fee is lost in the noise. Traders care more about the exchange rate than the fee.

**Recommended fee structure:**
- **0.5% per trade, charged to the seller** (the person selling USDT). Buyer pays 0%. This follows the Paxful model and incentivizes buyers (the growth side of the marketplace).
- Alternatively: **0.25% each side** (split). This feels fairer and is easier to explain.
- Consider a **promotional period: 0% for first 3 months** to bootstrap liquidity and attract early users.
- Consider **reduced fees for high-volume traders**: 0.5% under $1,000/month, 0.3% for $1,000-$10,000/month, 0.1% for $10,000+/month.
- **Warning for micro-trades**: On a $1 USDT trade, the 0.5% fee ($0.005) is negligible, but TON network gas fees could be $0.01-0.05. Show users the total cost (fee + gas) before confirming.

---

## All Changes Summary

| # | Change | Priority |
|---|--------|----------|
| 1 | Average rate on main page | Medium |
| 2 | Remove completed orders from order book | High |
| 3 | Order book depth chart visualization | Medium |
| 4 | Multi-currency expansion (TTD, BBD, XCD, JMD, GYD, VES, EUR, SRD, XCG) | High |
| 5 | Caribbean theme + IbisExchange branding | Low (do last) |
| 6 | Minimum trade $1.00 USDT | High |
| 7 | Reputation system (upvotes/downvotes) | Medium |
| 8 | Users/leaderboard page | Medium |
| 9 | Dispute resolution + ban system + admin panel | High |
| 10 | 0.5% fee implementation | High |

---

## Change 1: Average Rate on Main Page

### Description
Display the average sell rate (average of all active sell orders across all exchanges/users) prominently on the mini app's main/home page.

### Instructions

```
In the miniapp frontend (likely packages/miniapp/src/ or similar), locate the main 
page/home component. This is the first screen users see when they open the Telegram Mini App.

1. BACKEND — Create or update an API endpoint:
   - Add a new endpoint GET /api/rates/average (or extend the existing rates endpoint)
   - Query all ACTIVE sell orders from the database
   - Group by currency pair (e.g., USDT/TTD, USDT/BBD, etc.)
   - Calculate: averageRate = sum(all sell rates) / count(sell orders) for each pair
   - Return JSON like:
     {
       "averages": {
         "TTD": { "avgSellRate": 6.78, "orderCount": 12, "updated": "2025-..." },
         "BBD": { "avgSellRate": 2.02, "orderCount": 5, "updated": "2025-..." },
         "JMD": { "avgSellRate": 156.50, "orderCount": 8, "updated": "2025-..." },
         "EUR": { "avgSellRate": 0.92, "orderCount": 3, "updated": "2025-..." },
         "SRD": { "avgSellRate": 36.20, "orderCount": 2, "updated": "2025-..." },
         "XCG": { "avgSellRate": 1.79, "orderCount": 4, "updated": "2025-..." },
         ...
       }
     }
   - Consider caching this (Redis or in-memory) with 30-second TTL since it's hit on every page load
   - Only include orders that are status='active' (not completed, cancelled, or expired)

2. FRONTEND — Display on the main page:
   - Add a prominent "Market Rate" or "Average Exchange Rate" card/section at the top
   - For each supported currency, show:
     "1 USDT ≈ X.XX [CURRENCY]" with the average sell rate
     Small text: "Based on N active offers"
   - Style with the Caribbean theme (see Change 5)
   - Auto-refresh every 30 seconds using setInterval or WebSocket
   - Show a subtle loading skeleton while fetching
   - If no active orders exist for a currency, show "No active offers" instead of 0.00

3. EDGE CASES:
   - Handle division by zero (no active sell orders)
   - Handle API errors gracefully (show "Rate unavailable" with retry button)
   - Consider showing min/max range alongside average: "6.50 - 7.10 (avg 6.78)"
```

---

## Change 2: Remove Completed Orders from Order Book

### Description
Completed (filled) orders should not appear in the active order book. Only active/open orders should be visible.

### Instructions

```
1. DATABASE QUERY — Find the order book query:
   - Locate the database query that fetches orders for the order book display
   - This is likely in packages/bot/ or packages/miniapp/ backend, in a file like 
     orders.ts, orderbook.ts, or a database service file
   - The query probably looks like:
     db.orders.find({}) or similar
   
2. ADD STATUS FILTER:
   - Modify the query to filter: WHERE status = 'active' (or status NOT IN ('completed', 'cancelled', 'expired'))
   - If using MongoDB: { status: 'active' } or { status: { $nin: ['completed', 'cancelled', 'expired'] } }
   - If using SQL: WHERE status = 'active'
   - If orders don't have a status field yet, ADD ONE:
     - Add 'status' field to the order schema/model with enum: 'active', 'matched', 'escrow_funded', 'completed', 'cancelled', 'expired', 'disputed'
     - Default new orders to 'active'
     - Update the order lifecycle to set status='completed' when escrow releases

3. ORDER LIFECYCLE STATUS TRANSITIONS:
   - 'active' → order is placed, visible in order book
   - 'matched' → buyer and seller paired, still visible but marked
   - 'escrow_funded' → USDT locked in escrow contract
   - 'completed' → fiat confirmed, USDT released → REMOVE from order book
   - 'cancelled' → user cancelled → REMOVE from order book
   - 'expired' → TTL expired → REMOVE from order book
   - 'disputed' → under dispute resolution → show with "disputed" badge

4. ALSO update the Telegram bot commands:
   - /orderbook command should also filter to only active orders
   - /myorders should show ALL of the user's orders (including completed) but 
     with status labels

5. Add an order expiry mechanism if not present:
   - Orders older than 24 hours (configurable) without activity → auto-expire
   - Run a cron job or scheduled task every 5 minutes to expire stale orders
```

---

## Change 3: Order Book Display Style (Depth Chart)

### Description
Display the order book as a depth chart visualization, matching the attached image — green (bids/buy) on the left, red (asks/sell) on the right, with cumulative volume on the Y-axis and price on the X-axis.

### Instructions

```
Reference image: A classic exchange depth chart with:
- X-axis: price levels (e.g., 0.0306 to 0.0320)
- Y-axis: cumulative volume (0 to 1800)
- Green filled area (left): buy orders, highest price nearest center
- Red filled area (right): sell orders, lowest price nearest center
- The gap in the middle is the spread

1. FRONTEND — Create a DepthChart component:
   
   File: packages/miniapp/src/components/DepthChart.tsx (or .jsx)
   
   Use a charting library compatible with Telegram Mini Apps:
   - RECOMMENDED: lightweight-charts (by TradingView) — very lightweight, perfect for this
   - OR: Chart.js with custom area fill
   - OR: D3.js for full custom control
   - OR: Recharts if already using React
   
   Install: npm install lightweight-charts (or your chosen lib)

2. DATA TRANSFORMATION:
   
   The order book data needs to be transformed into cumulative depth format:
   
   function buildDepthData(orders) {
     const bids = orders.filter(o => o.side === 'buy')
       .sort((a, b) => b.price - a.price);
     const asks = orders.filter(o => o.side === 'sell')
       .sort((a, b) => a.price - b.price);
     
     let cumBidVol = 0;
     const bidDepth = bids.map(o => {
       cumBidVol += o.amount;
       return { price: o.price, cumVolume: cumBidVol };
     });
     
     let cumAskVol = 0;
     const askDepth = asks.map(o => {
       cumAskVol += o.amount;
       return { price: o.price, cumVolume: cumAskVol };
     });
     
     return { bidDepth, askDepth };
   }

3. CHART RENDERING:
   - Green area (rgba(76, 175, 80, 0.4) fill, #4CAF50 stroke) for bids
   - Red area (rgba(244, 67, 54, 0.4) fill, #F44336 stroke) for asks
   - Step interpolation (not smooth curves) — use stepAfter/stepBefore
   - X-axis: price in local currency per USDT
   - Y-axis: cumulative volume in USDT
   - Show the spread value between highest bid and lowest ask
   - Tooltip on hover showing exact price and volume
   - Responsive sizing for mobile (Telegram Mini App is mobile-first)
   
4. INTEGRATION:
   - Replace or supplement the existing order book list view with this chart
   - Consider a toggle: "List View" / "Depth Chart" so users can choose
   - Add a currency selector dropdown if supporting multiple currencies
   - Fetch order book data via WebSocket for real-time updates, or poll every 10s
   - Show "Current Spread: X.XX" between the two sides
   
5. MOBILE OPTIMIZATION:
   - Chart should be full-width on mobile
   - Minimum height: 250px
   - Touch-friendly tooltips
```

---

## Change 4: Multi-Currency Expansion

### Description
Add support for: TTD (Trinidad & Tobago Dollar), BBD (Barbados Dollar), XCD (Eastern Caribbean Dollar), JMD (Jamaican Dollar), GYD (Guyanese Dollar), VES (Venezuelan Bolívar), EUR (Euro — for Martinique & Guadeloupe), SRD (Surinamese Dollar), XCG (Caribbean Guilder — for Curaçao & Sint Maarten).

### Important Currency Notes
- **Martinique & Guadeloupe** are French overseas departments — they use the **Euro (EUR)**, not a local currency
- **Suriname** uses the **Surinamese Dollar (SRD)**, introduced in 2004 replacing the guilder
- **Curaçao & Sint Maarten** switched from the Netherlands Antillean Guilder (ANG) to the **Caribbean Guilder (XCG)** on March 31, 2025. XCG is pegged to USD at 1:1.79

### Instructions

```
1. CURRENCY CONFIGURATION — Create/update a currencies config file:

   File: packages/shared/src/config/currencies.ts (or similar shared config)
   
   export const SUPPORTED_CURRENCIES = {
     TTD: {
       code: 'TTD',
       name: 'Trinidad & Tobago Dollar',
       symbol: 'TT$',
       flag: '🇹🇹',
       country: 'Trinidad and Tobago',
       decimalPlaces: 2,
       banks: [
         { name: 'Republic Bank', code: 'REPUBLIC', swift: 'RABORUTT' },
         { name: 'First Citizens Bank', code: 'FCB', swift: 'FCBKTTPS' },
         { name: 'Scotiabank Trinidad', code: 'SCOTIA_TT', swift: 'NABORUTT' },
         { name: 'RBC Royal Bank', code: 'RBC_TT', swift: 'RBTTTTPX' },
         { name: 'JMMB Bank', code: 'JMMB_TT', swift: 'JMMBTTPS' },
         { name: 'Citibank Trinidad', code: 'CITI_TT', swift: 'CITITTPS' },
         { name: 'Bank of Baroda', code: 'BOB_TT', swift: 'BARBTTPX' },
       ],
       paymentMethods: ['Bank Transfer', 'Linx', 'WiPay', 'Cash Deposit'],
     },
     BBD: {
       code: 'BBD',
       name: 'Barbados Dollar',
       symbol: 'BDS$',
       flag: '🇧🇧',
       country: 'Barbados',
       decimalPlaces: 2,
       banks: [
         { name: 'Republic Bank Barbados', code: 'REPUBLIC_BB', swift: 'RABOBBBR' },
         { name: 'FirstCaribbean International Bank', code: 'FCIB_BB', swift: 'FCIBBBBB' },
         { name: 'Scotiabank Barbados', code: 'SCOTIA_BB', swift: 'NOSCBBBB' },
         { name: 'RBC Royal Bank Barbados', code: 'RBC_BB', swift: 'RBTTBBBR' },
         { name: 'CIBC First Caribbean', code: 'CIBC_BB', swift: 'FCIBBBBB' },
         { name: 'Sagicor Bank', code: 'SAGICOR_BB', swift: '' },
       ],
       paymentMethods: ['Bank Transfer', 'Cash Deposit'],
     },
     XCD: {
       code: 'XCD',
       name: 'Eastern Caribbean Dollar',
       symbol: 'EC$',
       flag: '🇦🇬',
       country: 'Eastern Caribbean (AG, DM, GD, KN, LC, VC)',
       decimalPlaces: 2,
       banks: [
         { name: 'Bank of Saint Lucia', code: 'BOSL', swift: '' },
         { name: 'FirstCaribbean International (EC)', code: 'FCIB_EC', swift: '' },
         { name: 'Republic Bank Grenada', code: 'REPUBLIC_GD', swift: '' },
         { name: 'Bank of Nevis', code: 'BON', swift: '' },
         { name: 'Scotiabank (EC)', code: 'SCOTIA_EC', swift: '' },
         { name: 'Eastern Caribbean Amalgamated Bank', code: 'ECAB', swift: '' },
         { name: 'St Kitts-Nevis-Anguilla National Bank', code: 'SKNANB', swift: '' },
         { name: 'Grenada Co-operative Bank', code: 'GCB', swift: '' },
         { name: '1st National Bank St Lucia', code: 'FNB_LC', swift: '' },
       ],
       paymentMethods: ['Bank Transfer', 'Cash Deposit'],
     },
     JMD: {
       code: 'JMD',
       name: 'Jamaican Dollar',
       symbol: 'J$',
       flag: '🇯🇲',
       country: 'Jamaica',
       decimalPlaces: 2,
       banks: [
         { name: 'National Commercial Bank (NCB)', code: 'NCB_JM', swift: 'JABORJMK' },
         { name: 'Scotiabank Jamaica', code: 'SCOTIA_JM', swift: 'NOSCJMKN' },
         { name: 'JMMB Bank Jamaica', code: 'JMMB_JM', swift: '' },
         { name: 'Sagicor Bank Jamaica', code: 'SAGICOR_JM', swift: '' },
         { name: 'First Global Bank', code: 'FGB_JM', swift: '' },
         { name: 'CIBC FirstCaribbean Jamaica', code: 'CIBC_JM', swift: '' },
         { name: 'JN Bank', code: 'JN_JM', swift: '' },
         { name: 'Bank of Nova Scotia Jamaica', code: 'BNS_JM', swift: '' },
       ],
       paymentMethods: ['Bank Transfer', 'Cash Deposit', 'Bill Payment'],
     },
     GYD: {
       code: 'GYD',
       name: 'Guyanese Dollar',
       symbol: 'G$',
       flag: '🇬🇾',
       country: 'Guyana',
       decimalPlaces: 2,
       banks: [
         { name: 'Demerara Bank', code: 'DEMERARA', swift: 'DEMBGYGE' },
         { name: 'Republic Bank Guyana', code: 'REPUBLIC_GY', swift: '' },
         { name: 'Guyana Bank for Trade & Industry', code: 'GBTI', swift: 'GABORGYG' },
         { name: 'Citizens Bank Guyana', code: 'CITIZENS_GY', swift: '' },
         { name: 'Bank of Baroda Guyana', code: 'BOB_GY', swift: '' },
         { name: 'Scotiabank Guyana', code: 'SCOTIA_GY', swift: '' },
       ],
       paymentMethods: ['Bank Transfer', 'Cash Deposit', 'Mobile Money'],
     },
     VES: {
       code: 'VES',
       name: 'Venezuelan Bolívar',
       symbol: 'Bs.',
       flag: '🇻🇪',
       country: 'Venezuela',
       decimalPlaces: 2,
       banks: [
         { name: 'Banco de Venezuela', code: 'BDV', swift: 'BVENVECA' },
         { name: 'Banesco', code: 'BANESCO', swift: 'BABORVCA' },
         { name: 'Mercantil Banco', code: 'MERCANTIL', swift: 'BAMRVECA' },
         { name: 'BBVA Provincial', code: 'PROVINCIAL', swift: 'PROVVECA' },
         { name: 'Banco Nacional de Crédito (BNC)', code: 'BNC', swift: '' },
         { name: 'Banco Exterior', code: 'EXTERIOR', swift: '' },
         { name: 'Banco del Tesoro', code: 'TESORO', swift: '' },
         { name: 'Bancamiga', code: 'BANCAMIGA', swift: '' },
       ],
       paymentMethods: ['Bank Transfer', 'Pago Móvil', 'Zelle', 'Cash USD'],
     },
     EUR: {
       code: 'EUR',
       name: 'Euro',
       symbol: '€',
       flag: '🇪🇺',
       country: 'Martinique & Guadeloupe (French Overseas)',
       decimalPlaces: 2,
       banks: [
         { name: 'Banque des Antilles Françaises (BDAF)', code: 'BDAF', swift: '' },
         { name: 'BNP Paribas Martinique', code: 'BNP_MQ', swift: 'BNPAFRPP' },
         { name: 'Crédit Agricole Martinique/Guadeloupe', code: 'CA_MQ', swift: '' },
         { name: 'Société Générale Antilles', code: 'SG_MQ', swift: '' },
         { name: 'Bred Banque Populaire', code: 'BRED_MQ', swift: '' },
         { name: 'La Banque Postale', code: 'LBP_MQ', swift: '' },
         { name: 'Caisse d\'Épargne', code: 'CE_MQ', swift: '' },
         { name: 'Crédit Mutuel', code: 'CM_MQ', swift: '' },
       ],
       paymentMethods: ['Bank Transfer (SEPA)', 'Cash Deposit', 'Carte Bancaire'],
     },
     SRD: {
       code: 'SRD',
       name: 'Surinamese Dollar',
       symbol: 'Sr$',
       flag: '🇸🇷',
       country: 'Suriname',
       decimalPlaces: 2,
       banks: [
         { name: 'De Surinaamsche Bank (DSB)', code: 'DSB', swift: 'SABORSR2' },
         { name: 'Hakrinbank', code: 'HAKRIN', swift: 'HAKRSR2P' },
         { name: 'Finabank', code: 'FINA', swift: 'FINASRPA' },
         { name: 'Republic Bank Suriname', code: 'REPUBLIC_SR', swift: '' },
         { name: 'Surinaamse Postspaarbank', code: 'SPSB', swift: '' },
         { name: 'Volkscredietbank', code: 'VCB', swift: '' },
         { name: 'Godo (Government Owned)', code: 'GODO', swift: '' },
       ],
       paymentMethods: ['Bank Transfer', 'Cash Deposit'],
     },
     XCG: {
       code: 'XCG',
       name: 'Caribbean Guilder',
       symbol: 'Cg',
       flag: '🇨🇼',
       country: 'Curaçao & Sint Maarten',
       decimalPlaces: 2,
       peggedTo: { currency: 'USD', rate: 1.79 },
       banks: [
         { name: 'Maduro & Curiel\'s Bank (MCB)', code: 'MCB', swift: 'MCBKCWCU' },
         { name: 'Banco di Caribe', code: 'BDC', swift: 'BDCRCWCU' },
         { name: 'FirstCaribbean International Bank (Curaçao)', code: 'FCIB_CW', swift: '' },
         { name: 'RBC Royal Bank (Curaçao)', code: 'RBC_CW', swift: '' },
         { name: 'Orco Bank', code: 'ORCO', swift: 'ORCOCWCU' },
         { name: 'Vidanova Bank', code: 'VIDANOVA', swift: '' },
         { name: 'Windward Islands Bank (Sint Maarten)', code: 'WIB', swift: '' },
       ],
       paymentMethods: ['Bank Transfer', 'Cash Deposit'],
     },
   };

2. DATABASE SCHEMA UPDATES:
   - Add 'currency' field to the Order model/schema (default: 'TTD' for backwards compat)
   - Add 'currency' field to User preferences (preferred trading currency)
   - Migration: set currency = 'TTD' for all existing orders
   - Add index on (currency, status) for efficient order book queries

3. BOT COMMANDS — Update Telegram bot:
   - /setcurrency [CODE] — set preferred currency
   - /buy and /sell should accept currency: /sell 100 USDT for TTD at 6.80
   - /orderbook [CURRENCY] — optional currency filter
   - /rates — show all currencies with average rates
   - /currencies — list all supported currencies with flags

4. MINI APP FRONTEND:
   - Currency selector (dropdown or tab bar) on main page
   - Filter order book by selected currency
   - Show currency flag emoji next to amounts
   - Store preferred currency in Telegram Cloud Storage

5. MATCHING ENGINE:
   - Only match orders with the same currency pair

6. LANGUAGE NOTES for French territories (Martinique/Guadeloupe):
   - Consider adding French UI strings
   - Show bank names and payment labels in French where appropriate
```

---

## Change 5: Caribbean Theme & Branding

### Instructions

```
1. LOGO INTEGRATION:
   - Save ibisexchange_logo.jpg as app icon
   - Create sizes: 192x192, 512x512, 96x96
   - Place in: packages/miniapp/public/
   - Update Telegram bot profile photo via BotFather

2. COLOR PALETTE (extracted from logo):

   :root {
     --primary: #1A3A5C;         /* Deep Ocean Blue */
     --primary-light: #2E5D8C;
     --secondary: #00B4A6;       /* Caribbean Teal */
     --secondary-light: #4DD9CE;
     --accent: #D4380D;          /* Ibis Red */
     --accent-warm: #F5722B;
     --accent-gold: #F5A623;
     --buy-green: #00C853;
     --sell-red: #FF1744;
     --bg-primary: #FAFBF7;
     --bg-card: #FFFFFF;
     --text-primary: #1A2A3A;
   }

3. TYPOGRAPHY:
   - Primary: 'Inter' or 'Nunito'
   - Headings: 'Poppins'
   - Prices: 'JetBrains Mono'

4. UI COMPONENTS:
   - Rounded cards (16px), gradient buttons
   - Header: gradient from primary to secondary-dark
   - Wave pattern SVG backgrounds
   - Ibis silhouette for empty states
   - Respect Telegram theme via window.Telegram.WebApp.colorScheme
```

---

## Change 6: Reduce Minimum Trade Amount to $1.00 USDT

### Instructions

```
1. Search codebase for: MIN_AMOUNT, minAmount, minimum, min_trade, MINIMUM_ORDER

2. Set MIN_TRADE_AMOUNT = 1.0 USDT, configurable per currency:
   USDT: { min: 1.00, max: 10000.00 },
   TTD: { min: 5.00 }, BBD: { min: 2.00 }, JMD: { min: 150.00 },
   GYD: { min: 200.00 }, VES: { min: 35.00 }, XCD: { min: 3.00 },
   EUR: { min: 1.00 }, SRD: { min: 35.00 }, XCG: { min: 2.00 }

3. Update TON escrow contract minimum if hardcoded

4. Add warning for trades under $10: "Network fees may be significant"
```

---

## Change 7: Reputation System (Upvotes/Downvotes)

### Instructions

```
1. DATABASE SCHEMA:

   interface TradeReview {
     id: string;
     tradeId: string;
     reviewerId: string;
     revieweeId: string;
     vote: 'up' | 'down';
     comment?: string;         // max 280 chars
     createdAt: Date;
   }

   // Add to User model:
   totalUpvotes: number;
   totalDownvotes: number;
   reputationScore: number;
   completedTrades: number;
   isBanned: boolean;          // for ban system (Change 9)
   bannedAt?: Date;
   banReason?: string;

2. TIER SYSTEM:
   trades >= 100 && score >= 90 → '🏆 Trusted Trader'
   trades >= 50 && score >= 40  → '⭐ Experienced'
   trades >= 10 && score >= 8   → '✅ Verified'
   trades >= 1                  → '🆕 New Trader'
   else                         → '👤 Unrated'

3. API: POST /api/reviews, GET /api/users/:id/reputation

4. BOT: After trade completion, send [👍] [👎] inline keyboard
   /reputation @username — check any user

5. ANTI-GAMING: One review per side per trade, 24h window, flag suspicious patterns
```

---

## Change 8: Users/Leaderboard Page

### Instructions

```
1. API: GET /api/users/leaderboard?sort=reputation&page=1&limit=20
   Exclude banned users from public leaderboard

2. MINI APP — Leaderboard page:
   - Ranked list with: username, tier badge, upvotes, downvotes, trades, volume
   - Search by username
   - Sort by: reputation, trades, volume, newest
   - Infinite scroll

3. USER PROFILE (click through):
   - Stats card, positive ratio bar, preferred currencies
   - Recent reviews
   - "Trade with this user" button

4. BOT: /users, /profile @username, /leaderboard

5. Add "Traders" tab to Mini App bottom navigation
```

---

## Change 9: Dispute Resolution + Ban System + Admin Panel

### Description
Implement dispute resolution where either party can raise a dispute on a trade. Admins review evidence and can resolve disputes or ban users. Dedicated admin-only screen in Mini App.

### Instructions

```
1. DATABASE SCHEMA — Dispute model:

   interface Dispute {
     id: string;
     tradeId: string;
     raisedBy: string;            // Telegram user ID
     againstUser: string;
     reason: DisputeReason;
     description: string;         // max 1000 chars
     evidence: Evidence[];
     status: 'open' | 'under_review' | 'resolved' | 'dismissed';
     resolution?: {
       outcome: 'buyer_wins' | 'seller_wins' | 'mutual' | 'dismissed';
       action: 'release_to_buyer' | 'return_to_seller' | 'split' | 'no_action';
       banApplied: boolean;
       bannedUserId?: string;
       notes: string;
     };
     resolvedBy?: string;         // Admin Telegram ID
     resolvedAt?: Date;
     adminNotes?: string;
     createdAt: Date;
     updatedAt: Date;
   }

   enum DisputeReason {
     PAYMENT_NOT_RECEIVED = 'payment_not_received',
     PAYMENT_NOT_CONFIRMED = 'payment_not_confirmed',
     WRONG_AMOUNT = 'wrong_amount',
     SCAM_ATTEMPT = 'scam_attempt',
     UNRESPONSIVE = 'unresponsive',
     OTHER = 'other',
   }

   interface Evidence {
     id: string;
     type: 'image' | 'text' | 'transaction_hash';
     url?: string;               // For uploaded images
     content?: string;
     uploadedBy: string;
     uploadedAt: Date;
   }

2. BAN SYSTEM — Add to User model:
   {
     isBanned: boolean;          // default: false
     bannedAt?: Date;
     bannedBy?: string;          // Admin who issued ban
     banReason?: string;
     banDisputeId?: string;
     banType: 'permanent' | 'temporary';
     banExpiresAt?: Date;
   }

   BANNED USER RESTRICTIONS:
   - Cannot create new orders
   - Cannot accept/match orders
   - Cannot access trading features
   - Active orders auto-cancelled on ban
   - Show "Your account has been suspended" message
   - Grayed out on leaderboard with "Banned" badge
   - Cannot leave reviews

3. ADMIN ROLE SYSTEM:
   {
     isAdmin: boolean;           // default: false
     adminLevel: 'super' | 'moderator';
   }
   
   Set via env: ADMIN_TELEGRAM_IDS=123456789,987654321
   Super admins can ban. Moderators can review disputes.

4. DISPUTE FLOW:

   a) USER RAISES DISPUTE:
      - On active/matched trade, tap "Report Problem"
      - Select reason, write description (min 20 chars)
      - Upload evidence (screenshots of payment, bank confirmation)
      - Trade status → 'disputed', escrow stays locked
      - Both parties + admins notified via bot
   
   b) COUNTER-PARTY RESPONDS:
      - 24 hours to respond with their evidence
      - Bot reminders at 12h and 23h if no response
   
   c) ADMIN REVIEWS:
      - Dispute appears in Admin Panel
      - Admin sees: trade details, both profiles & reputation,
        all evidence, dispute reason
      - Status → 'under_review'
   
   d) ADMIN RESOLVES:
      - Choose: release to buyer / return to seller / split / dismiss
      - Optional: BAN the offending party
      - Write resolution notes
      - Escrow action executed
      - Both parties notified of outcome

5. ADMIN PANEL — Mini App page (admin-only):

   Route: /admin (check isAdmin before rendering)
   
   TABS:
   
   [Disputes] — Main admin workflow
   - List all disputes sorted by status (open first)
   - Each shows: dispute ID, parties, reason, trade amount, time
   - Click through to dispute detail view
   
   DISPUTE DETAIL VIEW:
   ┌─────────────────────────────────────┐
   │ Trade #123: 50 USDT → 339 TTD      │
   │ Seller: @alice (⭐ 45 trades)       │
   │ Buyer: @bob (🆕 3 trades)           │
   │                                     │
   │ 📋 Dispute Details                  │
   │ Raised by: @bob                     │
   │ Reason: Payment not received        │
   │ "I sent 339 TTD via Linx but        │
   │  seller hasn't confirmed..."        │
   │                                     │
   │ 📎 Evidence from @bob:              │
   │ [Payment screenshot] [Bank ref]     │
   │                                     │
   │ 📎 Evidence from @alice:            │
   │ [No evidence submitted yet]         │
   │                                     │
   │ ⚖️ Resolution                       │
   │ [Release to Buyer]                  │
   │ [Return to Seller]                  │
   │ [Dismiss Dispute]                   │
   │                                     │
   │ 🚫 Ban Action                       │
   │ [ ] Ban @alice  [ ] Ban @bob        │
   │ Type: [Permanent ▼]                 │
   │ Reason: [____________]              │
   │                                     │
   │ Admin notes: [____________]         │
   │ [Submit Resolution]                 │
   └─────────────────────────────────────┘
   
   [Users] — User management
   - Search users by username/ID
   - View full profile, all disputes, all trades
   - Ban/unban users directly (not just from disputes)
   - Override reputation if needed
   
   [Orders] — Order management
   - View all orders (all statuses)
   - Force-cancel any order
   - View order details & history
   
   [Stats] — Dashboard
   - Total trades today/week/month
   - Total volume by currency
   - Active users, open disputes
   - Revenue from fees (see Change 10)
   - Banned users count

6. API ENDPOINTS:

   USER-FACING:
   POST /api/disputes              — Raise a dispute
   POST /api/disputes/:id/evidence — Upload evidence
   GET  /api/disputes/:id          — View (participants only)
   GET  /api/my/disputes           — List my disputes

   ADMIN-ONLY (requireAdmin middleware):
   GET    /api/admin/disputes              — List all disputes
   GET    /api/admin/disputes/:id          — Full detail
   PUT    /api/admin/disputes/:id/status   — Set under_review
   POST   /api/admin/disputes/:id/resolve  — Resolve dispute
   POST   /api/admin/users/:id/ban         — Ban user
   DELETE /api/admin/users/:id/ban         — Unban user
   GET    /api/admin/users                 — List all users
   GET    /api/admin/users/:id             — Full user detail
   GET    /api/admin/stats                 — Dashboard stats
   GET    /api/admin/orders                — All orders
   PUT    /api/admin/orders/:id/cancel     — Force-cancel

7. BOT COMMANDS (admin):
   - /admin — link to admin panel
   - /ban @username [reason] — quick ban
   - /unban @username — remove ban
   - /disputes — list open disputes

8. BAN ENFORCEMENT MIDDLEWARE:
   Add to ALL user-facing endpoints:
   
   function checkBanned(req, res, next) {
     const user = await getUser(req.telegramUserId);
     if (user?.isBanned) {
       if (user.banType === 'temporary' && user.banExpiresAt < new Date()) {
         await unbanUser(user.id);
         return next();
       }
       return res.status(403).json({ 
         error: 'Account suspended',
         reason: user.banReason,
         type: user.banType,
         expiresAt: user.banExpiresAt,
       });
     }
     next();
   }

9. EVIDENCE STORAGE:
   - Accept images (JPEG, PNG, max 5MB)
   - Store in S3/Cloudflare R2 or Telegram file storage
   - Signed URLs for admin viewing
   - Auto-delete 90 days after resolution
```

---

## Change 10: 0.5% Fee Implementation

### Instructions

```
1. FEE CONFIGURATION:

   export const FEE_CONFIG = {
     baseFeePercent: 0.5,
     feeModel: 'seller',         // seller pays 0.5%, buyer pays 0%
     minFeeUSDT: 0.01,
     volumeDiscounts: [
       { minMonthlyVolume: 1000,  feePercent: 0.40 },
       { minMonthlyVolume: 10000, feePercent: 0.30 },
       { minMonthlyVolume: 50000, feePercent: 0.10 },
     ],
     promoFeePercent: null,       // Set to 0 for launch promo
     promoExpiresAt: null,
   };

2. FEE CALCULATION:

   function calculateFee(amountUSDT, userMonthlyVolume?) {
     let feePercent = FEE_CONFIG.baseFeePercent;
     // Check promo, then volume discounts
     const feeAmount = Math.max(
       amountUSDT * (feePercent / 100),
       FEE_CONFIG.minFeeUSDT
     );
     return {
       feePercent,
       feeAmount: Math.round(feeAmount * 100) / 100,
       netAmount: amountUSDT - feeAmount,
     };
   }

3. ESCROW INTEGRATION:
   - Lock FULL amount in escrow
   - On release: send (amount - fee) to recipient, fee to platform wallet
   - PLATFORM_FEE_WALLET env variable for TON wallet address

4. FEE DISPLAY — Show BEFORE confirmation:
   ┌──────────────────────────────┐
   │  You sell:     100.00 USDT   │
   │  Platform fee:   0.50 USDT   │
   │  Buyer gets:   99.50 USDT    │
   │  You receive:  678.00 TTD    │
   │  Network fee:  ~0.02 USDT    │
   └──────────────────────────────┘

5. FEE TRACKING:
   Record every fee: { tradeId, feeAmount, paidBy, txHash, createdAt }
   Show in admin stats: total fees collected today/week/month

6. BOT: /fees — show current fee structure
```

---

## Implementation Order (Recommended)

```
Phase 1 — Foundation (do first):
  1. Change 4:  Multi-Currency (DB schema, all features depend on it)
  2. Change 2:  Remove Completed Orders (DB query fix)
  3. Change 6:  Minimum $1 USDT (config change)
  4. Change 10: 0.5% Fee (core business logic)

Phase 2 — Trust & Safety:
  5. Change 7:  Reputation System (new schema + API)
  6. Change 9:  Dispute Resolution + Ban System + Admin Panel
  
Phase 3 — User Experience:
  7. Change 8:  Users/Leaderboard Page (depends on reputation)
  8. Change 1:  Average Rate (depends on multi-currency)
  9. Change 3:  Depth Chart (UI component)

Phase 4 — Polish (do last):
  10. Change 5: Caribbean Theme (visual pass over everything)
```

---

## Technical Notes

- Test each change independently before moving to the next
- Write reversible database migrations
- Test in Telegram's built-in browser (not regular browser)
- If modifying TON escrow contract (fees, minimums), redeploy and update contract address
- Add new config to .env.example
- Logo file: `/mnt/user-data/uploads/ibisexchange_logo.jpg`

---

## New Environment Variables

```env
# Admin
ADMIN_TELEGRAM_IDS=123456789,987654321

# Fees
PLATFORM_FEE_WALLET=UQ...your_ton_wallet_address
PLATFORM_FEE_PERCENT=0.5
PROMO_FEE_PERCENT=
PROMO_EXPIRES_AT=

# Evidence storage
S3_BUCKET=ibisexchange-evidence
S3_REGION=us-east-1
S3_ACCESS_KEY=
S3_SECRET_KEY=

# Supported currencies
ENABLED_CURRENCIES=TTD,BBD,XCD,JMD,GYD,VES,EUR,SRD,XCG
```

---

## File Structure Reference

```
IbisExchange/
├── packages/
│   ├── miniapp/              ← Telegram Mini App frontend
│   │   ├── src/
│   │   │   ├── pages/        ← Add: Users, Admin, DisputeDetail
│   │   │   ├── components/   ← Add: DepthChart, ReputationBadge, 
│   │   │   │                       CurrencySelector, DisputeForm,
│   │   │   │                       AdminPanel, BanDialog, FeeBreakdown
│   │   │   └── styles/       ← Caribbean theme CSS
│   │   └── public/           ← Logo, icons
│   ├── bot/                  ← Telegram bot commands
│   │   └── src/              ← Add: /ban, /unban, /disputes,
│   │                                /reputation, /setcurrency, /fees
│   ├── escrow/               ← TON smart contract
│   │   └── contracts/        ← Update: min amount, fee deduction
│   └── shared/               ← Shared types, config, utilities
│       └── src/
│           ├── config/       ← currencies.ts, limits.ts, fees.ts
│           ├── models/       ← Order, User, TradeReview, Dispute
│           └── types/        ← TypeScript interfaces
├── scripts/
├── reference-docs/
└── agent-prompts/
```
