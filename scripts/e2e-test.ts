/**
 * End-to-End Test Suite for Ibis P2P Exchange
 *
 * Tests both direct DB operations and API endpoints with generated Telegram auth.
 * Run: cd /var/www/ibis && npx tsx scripts/e2e-test.ts
 */

import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config({ path: '/var/www/ibis/.env' });

// Import Prisma after env is loaded
import prisma from '../packages/shared/src/db';

const API_BASE = 'http://localhost:3000';
const BOT_TOKEN = process.env.BOT_TOKEN!;

// --- Test Utilities ---
let passed = 0;
let failed = 0;
const errors: string[] = [];

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${msg}`);
  } else {
    failed++;
    errors.push(msg);
    console.log(`  FAIL: ${msg}`);
  }
}

function generateInitData(user: { id: number; first_name: string; username?: string; last_name?: string }): string {
  const authDate = Math.floor(Date.now() / 1000);
  const userStr = encodeURIComponent(JSON.stringify(user));

  const params = new URLSearchParams();
  params.set('auth_date', authDate.toString());
  params.set('user', userStr);
  params.set('query_id', 'test_' + Date.now());

  // Sort params and create data check string
  const entries = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');

  // Generate HMAC
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  params.set('hash', hash);
  return params.toString();
}

async function apiCall(method: string, path: string, initData: string, body?: Record<string, unknown>) {
  const headers: Record<string, string> = {
    'X-Telegram-Init-Data': initData,
    'Content-Type': 'application/json',
  };
  const opts: RequestInit = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  const json = await res.json();
  return { status: res.status, ...json };
}

// --- Test Users ---
const SELLER_TG = { id: 900001, first_name: 'TestSeller', username: 'test_seller' };
const BUYER_TG = { id: 900002, first_name: 'TestBuyer', username: 'test_buyer' };

async function cleanup() {
  console.log('\n--- Cleanup ---');
  // Delete trades, orders, then users for test accounts
  await prisma.trade.deleteMany({ where: { OR: [
    { buyer: { telegramId: SELLER_TG.id } },
    { buyer: { telegramId: BUYER_TG.id } },
    { seller: { telegramId: SELLER_TG.id } },
    { seller: { telegramId: BUYER_TG.id } },
  ]}});
  await prisma.order.deleteMany({ where: { user: { telegramId: { in: [SELLER_TG.id, BUYER_TG.id] } } } });
  await prisma.user.deleteMany({ where: { telegramId: { in: [SELLER_TG.id, BUYER_TG.id] } } });
  console.log('  Test data cleaned up');
}

async function testHealthEndpoint() {
  console.log('\n=== Test: Health Endpoint ===');
  const res = await fetch(`${API_BASE}/api/health`);
  const json = await res.json();
  assert(res.status === 200, 'Health returns 200');
  assert(json.success === true, 'Health returns success: true');
  assert(json.data.status === 'ok', 'Health status is ok');
}

async function testAuthRequired() {
  console.log('\n=== Test: Auth Required ===');
  const res = await fetch(`${API_BASE}/api/orders`);
  const json = await res.json();
  assert(res.status === 401, 'Orders without auth returns 401');
  assert(json.code === 'UNAUTHORIZED', 'Returns UNAUTHORIZED code');
}

async function testUserProfile() {
  console.log('\n=== Test: User Profile (auto-create) ===');
  const sellerInit = generateInitData(SELLER_TG);
  const buyerInit = generateInitData(BUYER_TG);

  // Get/create seller profile
  const seller = await apiCall('GET', '/api/users/me', sellerInit);
  assert(seller.status === 200, 'Seller profile created/retrieved');
  assert(seller.data.firstName === 'TestSeller', 'Seller first name correct');
  assert(seller.data.kycStatus === 'NOT_STARTED', 'Seller KYC is NOT_STARTED');

  // Get/create buyer profile
  const buyer = await apiCall('GET', '/api/users/me', buyerInit);
  assert(buyer.status === 200, 'Buyer profile created/retrieved');
  assert(buyer.data.firstName === 'TestBuyer', 'Buyer first name correct');

  return { seller: seller.data, buyer: buyer.data };
}

async function testCreateSellOrder() {
  console.log('\n=== Test: Create Sell Order ===');
  const sellerInit = generateInitData(SELLER_TG);

  // Try invalid order first
  const badOrder = await apiCall('POST', '/api/orders', sellerInit, {
    type: 'SELL',
    amount: 5, // Below minimum
    pricePerUsdt: 7.10,
    paymentMethods: ['Republic Bank'],
  });
  assert(badOrder.status === 400, 'Rejects order below minimum amount');

  // Try invalid payment method
  const badMethod = await apiCall('POST', '/api/orders', sellerInit, {
    type: 'SELL',
    amount: 50,
    pricePerUsdt: 7.10,
    paymentMethods: ['Bitcoin'],
  });
  assert(badMethod.status === 400, 'Rejects invalid payment method');

  // Create valid sell order
  const order = await apiCall('POST', '/api/orders', sellerInit, {
    type: 'SELL',
    amount: 100,
    pricePerUsdt: 7.10,
    paymentMethods: ['Republic Bank', 'Linx'],
    bankDetails: 'Republic Bank 170-TEST-XXXX',
  });
  assert(order.status === 201, 'Sell order created with status 201');
  assert(order.data.type === 'SELL', 'Order type is SELL');
  assert(order.data.amount === 100, 'Order amount is 100');
  assert(order.data.remainingAmount === 100, 'Remaining amount is 100');
  assert(order.data.status === 'ACTIVE', 'Order status is ACTIVE');
  assert(order.data.pricePerUsdt === 7.10, 'Price per USDT is 7.10');

  return order.data;
}

async function testListOrders() {
  console.log('\n=== Test: List Orders ===');
  const buyerInit = generateInitData(BUYER_TG);

  const orders = await apiCall('GET', '/api/orders?type=SELL', buyerInit);
  assert(orders.status === 200, 'Orders list returns 200');
  assert(orders.data.length > 0, 'At least one sell order exists');
  assert(orders.pagination !== undefined, 'Pagination included in response');

  // Filter by payment method
  const filtered = await apiCall('GET', '/api/orders?type=SELL&paymentMethod=Republic Bank', buyerInit);
  assert(filtered.status === 200, 'Filtered orders returns 200');
  assert(filtered.data.length > 0, 'Filtered results include our order');

  return orders.data;
}

async function testCreateTrade(orderId: string) {
  console.log('\n=== Test: Create Trade (Buyer Accepts Sell Order) ===');
  const buyerInit = generateInitData(BUYER_TG);
  const sellerInit = generateInitData(SELLER_TG);

  // Seller can't accept own order
  const selfAccept = await apiCall('POST', '/api/trades', sellerInit, { orderId });
  assert(selfAccept.status === 400, 'Cannot accept own order');

  // Buyer accepts the sell order
  const trade = await apiCall('POST', '/api/trades', buyerInit, { orderId, amount: 50 });
  assert(trade.status === 201, 'Trade created with 201');
  assert(trade.data.amount === 50, 'Trade amount is 50 USDT');
  assert(trade.data.fiatAmount === 355, 'Fiat amount is 355 TTD (50 * 7.10)');
  assert(trade.data.status === 'AWAITING_ESCROW', 'Trade status is AWAITING_ESCROW');
  assert(trade.data.buyerId !== null, 'Buyer ID set');
  assert(trade.data.sellerId !== null, 'Seller ID set');

  // Verify order was partially matched
  const checkOrder = await apiCall('GET', `/api/orders/${orderId}`, buyerInit);
  assert(checkOrder.data.remainingAmount === 50, 'Order remaining is now 50 USDT');
  assert(checkOrder.data.status === 'PARTIALLY_MATCHED', 'Order status is PARTIALLY_MATCHED');

  return trade.data;
}

async function testEscrowLock(tradeId: string) {
  console.log('\n=== Test: Escrow Lock (simulate TON monitor) ===');

  // The escrow-locked endpoint doesn't require Telegram auth (called by TON monitor)
  const res = await fetch(`${API_BASE}/api/trades/${tradeId}/escrow-locked`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': generateInitData(SELLER_TG) },
    body: JSON.stringify({ txHash: 'test_tx_hash_abc123' }),
  });
  const json = await res.json();
  assert(res.status === 200, 'Escrow lock returns 200');
  assert(json.data.status === 'ESCROW_LOCKED', 'Trade status is ESCROW_LOCKED');
  assert(json.data.escrowTxHash === 'test_tx_hash_abc123', 'TX hash stored');
  assert(json.data.escrowLockedAt !== null, 'escrowLockedAt timestamp set');
}

async function testFiatSent(tradeId: string) {
  console.log('\n=== Test: Buyer Confirms Fiat Sent ===');
  const buyerInit = generateInitData(BUYER_TG);
  const sellerInit = generateInitData(SELLER_TG);

  // Seller can't mark fiat sent (only buyer)
  const wrongUser = await apiCall('POST', `/api/trades/${tradeId}/fiat-sent`, sellerInit, {
    paymentReference: 'TEST-REF-001',
  });
  assert(wrongUser.status === 403, 'Seller cannot mark fiat sent');

  // Buyer confirms fiat sent
  const res = await apiCall('POST', `/api/trades/${tradeId}/fiat-sent`, buyerInit, {
    paymentReference: 'TEST-REF-001',
  });
  assert(res.status === 200, 'Fiat sent returns 200');
  assert(res.data.status === 'FIAT_SENT', 'Trade status is FIAT_SENT');
  assert(res.data.paymentReference === 'TEST-REF-001', 'Payment reference stored');
  assert(res.data.fiatSentAt !== null, 'fiatSentAt timestamp set');
}

async function testConfirmReceipt(tradeId: string) {
  console.log('\n=== Test: Seller Confirms Fiat Receipt (Trade Completion) ===');
  const buyerInit = generateInitData(BUYER_TG);
  const sellerInit = generateInitData(SELLER_TG);

  // Buyer can't confirm receipt (only seller)
  const wrongUser = await apiCall('POST', `/api/trades/${tradeId}/confirm-receipt`, buyerInit);
  assert(wrongUser.status === 403, 'Buyer cannot confirm receipt');

  // Seller confirms receipt → trade completes
  const res = await apiCall('POST', `/api/trades/${tradeId}/confirm-receipt`, sellerInit);
  assert(res.status === 200, 'Confirm receipt returns 200');
  assert(res.data.status === 'COMPLETED', 'Trade status is COMPLETED');
  assert(res.data.completedAt !== null, 'completedAt timestamp set');
}

async function testRateTrade(tradeId: string) {
  console.log('\n=== Test: Rate Trade ===');
  const buyerInit = generateInitData(BUYER_TG);
  const sellerInit = generateInitData(SELLER_TG);

  // Buyer rates the trade
  const buyerRate = await apiCall('POST', `/api/trades/${tradeId}/rate`, buyerInit, { rating: 5 });
  assert(buyerRate.status === 200, 'Buyer can rate completed trade');
  assert(buyerRate.data.buyerRating === 5, 'Buyer rating is 5');

  // Buyer can't rate again
  const duplicate = await apiCall('POST', `/api/trades/${tradeId}/rate`, buyerInit, { rating: 4 });
  assert(duplicate.status === 400, 'Cannot rate same trade twice');

  // Seller rates the trade
  const sellerRate = await apiCall('POST', `/api/trades/${tradeId}/rate`, sellerInit, { rating: 4 });
  assert(sellerRate.status === 200, 'Seller can rate completed trade');
  assert(sellerRate.data.sellerRating === 4, 'Seller rating is 4');

  // Invalid rating
  const badRating = await apiCall('POST', `/api/trades/${tradeId}/rate`, buyerInit, { rating: 6 });
  assert(badRating.status === 400, 'Rating > 5 rejected');
}

async function testReputationUpdate() {
  console.log('\n=== Test: Reputation Updated After Trade ===');
  const sellerInit = generateInitData(SELLER_TG);
  const buyerInit = generateInitData(BUYER_TG);

  const seller = await apiCall('GET', '/api/users/me', sellerInit);
  assert(seller.data.totalTrades >= 1, `Seller total trades >= 1 (got ${seller.data.totalTrades})`);
  assert(seller.data.successfulTrades >= 1, `Seller successful trades >= 1 (got ${seller.data.successfulTrades})`);

  const buyer = await apiCall('GET', '/api/users/me', buyerInit);
  assert(buyer.data.totalTrades >= 1, `Buyer total trades >= 1 (got ${buyer.data.totalTrades})`);
  assert(buyer.data.successfulTrades >= 1, `Buyer successful trades >= 1 (got ${buyer.data.successfulTrades})`);
}

async function testTradeHistory() {
  console.log('\n=== Test: Trade History ===');
  const buyerInit = generateInitData(BUYER_TG);

  const trades = await apiCall('GET', '/api/trades', buyerInit);
  assert(trades.status === 200, 'Trade history returns 200');
  assert(trades.data.length >= 1, 'At least 1 trade in history');
  assert(trades.data[0].status === 'COMPLETED', 'Latest trade is COMPLETED');
}

async function testCancelTrade(orderId: string) {
  console.log('\n=== Test: Cancel Trade Before Escrow ===');
  const buyerInit = generateInitData(BUYER_TG);
  const sellerInit = generateInitData(SELLER_TG);

  // Create another trade on the remaining 50 USDT
  const trade = await apiCall('POST', '/api/trades', buyerInit, { orderId, amount: 25 });
  assert(trade.status === 201, 'Second trade created');

  // Cancel it
  const cancel = await apiCall('POST', `/api/trades/${trade.data.id}/cancel`, buyerInit);
  assert(cancel.status === 200, 'Cancel returns 200');
  assert(cancel.data.status === 'CANCELLED', 'Trade status is CANCELLED');

  // Verify order amount restored
  const order = await apiCall('GET', `/api/orders/${orderId}`, buyerInit);
  assert(order.data.remainingAmount === 50, 'Order remaining restored to 50 after cancel');
}

async function testDisputeFlow(orderId: string) {
  console.log('\n=== Test: Dispute Flow ===');
  const buyerInit = generateInitData(BUYER_TG);
  const sellerInit = generateInitData(SELLER_TG);

  // Create a new trade for dispute testing
  const trade = await apiCall('POST', '/api/trades', buyerInit, { orderId, amount: 25 });
  assert(trade.status === 201, 'Dispute test trade created');

  // Lock escrow
  await fetch(`${API_BASE}/api/trades/${trade.data.id}/escrow-locked`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': generateInitData(SELLER_TG) },
    body: JSON.stringify({ txHash: 'dispute_test_tx' }),
  });

  // Can't dispute without reason
  const noReason = await apiCall('POST', `/api/trades/${trade.data.id}/dispute`, buyerInit, {});
  assert(noReason.status === 400, 'Cannot dispute without reason');

  // Open dispute
  const dispute = await apiCall('POST', `/api/trades/${trade.data.id}/dispute`, buyerInit, {
    reason: 'Seller is not responding',
  });
  assert(dispute.status === 200, 'Dispute opened');
  assert(dispute.data.status === 'DISPUTED', 'Trade status is DISPUTED');
  assert(dispute.data.disputeReason === 'Seller is not responding', 'Dispute reason stored');
}

async function testDeleteOrder(orderId: string) {
  console.log('\n=== Test: Cancel/Delete Order ===');
  const sellerInit = generateInitData(SELLER_TG);
  const buyerInit = generateInitData(BUYER_TG);

  // Buyer can't delete seller's order
  const wrongUser = await apiCall('DELETE', `/api/orders/${orderId}`, buyerInit);
  assert(wrongUser.status === 403, 'Buyer cannot delete seller order');

  // Seller cancels order
  const del = await apiCall('DELETE', `/api/orders/${orderId}`, sellerInit);
  assert(del.status === 200, 'Order cancelled');
  assert(del.data.status === 'CANCELLED', 'Order status is CANCELLED');
}

async function testKycStatus() {
  console.log('\n=== Test: KYC Status ===');
  const sellerInit = generateInitData(SELLER_TG);

  const status = await apiCall('GET', '/api/kyc/status', sellerInit);
  assert(status.status === 200, 'KYC status returns 200');
  assert(status.data.status === 'NOT_STARTED', 'KYC status is NOT_STARTED');
}

async function testKycWebhook() {
  console.log('\n=== Test: KYC Webhook (Veriff) ===');

  // First create user and start KYC to get a session
  const sellerInit = generateInitData(SELLER_TG);

  // Get user from DB
  const user = await prisma.user.findUnique({ where: { telegramId: SELLER_TG.id } });
  if (!user) {
    console.log('  SKIP: User not found for KYC webhook test');
    return;
  }

  // Simulate Veriff webhook with approved status
  const payload = JSON.stringify({
    status: 'success',
    verification: {
      id: 'test-veriff-session-id',
      status: 'approved',
      person: { firstName: 'Test', lastName: 'Seller' },
      vendorData: String(SELLER_TG.id), // Telegram ID is sent as vendorData
      reason: null,
    },
  });

  const signature = crypto
    .createHmac('sha256', process.env.VERIF_SECRET_KEY!)
    .update(Buffer.from(payload))
    .digest('hex');

  const res = await fetch(`${API_BASE}/api/webhooks/veriff`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hmac-signature': signature,
    },
    body: payload,
  });

  if (res.status === 200) {
    assert(true, 'Veriff webhook accepted (200)');

    // Check if user KYC was updated
    const updatedUser = await prisma.user.findUnique({ where: { telegramId: SELLER_TG.id } });
    if (updatedUser) {
      assert(updatedUser.kycStatus === 'VERIFIED', `KYC status updated to VERIFIED (got ${updatedUser.kycStatus})`);
    }
  } else {
    const text = await res.text();
    console.log(`  KYC webhook response: ${res.status} ${text}`);
    assert(false, `Veriff webhook returned ${res.status} (expected 200)`);
  }
}

async function testBuyOrder() {
  console.log('\n=== Test: Create Buy Order ===');
  const buyerInit = generateInitData(BUYER_TG);

  const order = await apiCall('POST', '/api/orders', buyerInit, {
    type: 'BUY',
    amount: 200,
    pricePerUsdt: 7.05,
    paymentMethods: ['First Citizens', 'PayWise'],
    bankDetails: 'First Citizens 01-XXXX-XXXX',
  });
  assert(order.status === 201, 'Buy order created with 201');
  assert(order.data.type === 'BUY', 'Order type is BUY');
  assert(order.data.amount === 200, 'Buy order amount is 200');

  // Seller accepts the buy order
  const sellerInit = generateInitData(SELLER_TG);
  const trade = await apiCall('POST', '/api/trades', sellerInit, { orderId: order.data.id, amount: 100 });
  assert(trade.status === 201, 'Trade created from buy order');

  // In a BUY order, the acceptor (seller) provides USDT
  // buyer is order creator, seller is acceptor
  assert(trade.data.buyerId !== null, 'Buyer set correctly');
  assert(trade.data.sellerId !== null, 'Seller set correctly');
  assert(trade.data.fiatAmount === 705, 'Fiat amount is 705 TTD (100 * 7.05)');

  // Clean up
  await prisma.trade.delete({ where: { id: trade.data.id } });
  await prisma.order.delete({ where: { id: order.data.id } });
  console.log('  Cleaned up buy order test data');
}

// --- Main ---
async function main() {
  console.log('============================================');
  console.log('  Ibis P2P Exchange - E2E Test Suite');
  console.log('============================================\n');
  console.log(`API: ${API_BASE}`);
  console.log(`Test time: ${new Date().toISOString()}\n`);

  try {
    // Clean up any leftover test data
    await cleanup();

    // Basic endpoint tests
    await testHealthEndpoint();
    await testAuthRequired();

    // User management
    await testUserProfile();

    // KYC
    await testKycStatus();

    // Sell order flow
    const order = await testCreateSellOrder();
    await testListOrders();

    // Trade flow (buy/sell E2E)
    const trade = await testCreateTrade(order.id);
    await testEscrowLock(trade.id);
    await testFiatSent(trade.id);
    await testConfirmReceipt(trade.id);
    await testRateTrade(trade.id);
    await testReputationUpdate();
    await testTradeHistory();

    // Cancel flow
    await testCancelTrade(order.id);

    // Dispute flow
    await testDisputeFlow(order.id);

    // Delete order
    await testDeleteOrder(order.id);

    // Buy order flow
    await testBuyOrder();

    // KYC webhook
    await testKycWebhook();

  } catch (err) {
    console.error('\nFATAL ERROR:', err);
    failed++;
  } finally {
    // Clean up
    await cleanup();
    await prisma.$disconnect();
  }

  // Summary
  console.log('\n============================================');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('============================================');
  if (errors.length > 0) {
    console.log('\nFailed tests:');
    errors.forEach(e => console.log(`  - ${e}`));
  }
  process.exit(failed > 0 ? 1 : 0);
}

main();
