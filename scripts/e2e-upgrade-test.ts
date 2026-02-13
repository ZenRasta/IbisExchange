/**
 * End-to-End Test Suite for Ibis Exchange v2 Upgrade
 * Tests all 10 upgrade changes:
 *  1. Average rate on main page (GET /api/rates/average)
 *  2. Completed orders filtered from order book
 *  3. Depth chart (frontend only - not API testable)
 *  4. Multi-currency expansion (9 currencies)
 *  5. Caribbean theme (frontend only - not API testable)
 *  6. Minimum trade $1.00 USDT
 *  7. Reputation system (upvotes/downvotes via /api/reviews)
 *  8. Leaderboard (/api/users/leaderboard)
 *  9. Dispute resolution + ban + admin panel
 * 10. 0.5% fee implementation
 *
 * Run: cd /var/www/ibis && npx tsx scripts/e2e-upgrade-test.ts
 */

import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config({ path: '/var/www/ibis/.env' });

import prisma from '../packages/shared/src/db';

const API_BASE = process.env.TEST_API_BASE || 'http://localhost:3002';
const BOT_TOKEN = process.env.BOT_TOKEN!;

// --- Test Utilities ---
let passed = 0;
let failed = 0;
const errors: string[] = [];

function assert(condition: boolean, msg: string) {
    if (condition) {
        passed++;
        console.log(`  \x1b[32mPASS\x1b[0m: ${msg}`);
    } else {
        failed++;
        errors.push(msg);
        console.log(`  \x1b[31mFAIL\x1b[0m: ${msg}`);
    }
}

function generateInitData(user: { id: number; first_name: string; username?: string; last_name?: string }): string {
    const authDate = Math.floor(Date.now() / 1000);
    const userStr = encodeURIComponent(JSON.stringify(user));
    const params = new URLSearchParams();
    params.set('auth_date', authDate.toString());
    params.set('user', userStr);
    params.set('query_id', 'test_' + Date.now());
    const entries = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
    const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');
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

async function apiCallNoAuth(method: string, path: string, body?: Record<string, unknown>) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const opts: RequestInit = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${API_BASE}${path}`, opts);
    const json = await res.json();
    return { status: res.status, ...json };
}

// --- Test Users ---
const SELLER_TG = { id: 800001, first_name: 'UpgSeller', username: 'upg_seller' };
const BUYER_TG = { id: 800002, first_name: 'UpgBuyer', username: 'upg_buyer' };
const ADMIN_TG = { id: 800003, first_name: 'UpgAdmin', username: 'upg_admin' };

const sellerInit = generateInitData(SELLER_TG);
const buyerInit = generateInitData(BUYER_TG);
const adminInit = generateInitData(ADMIN_TG);

async function cleanup() {
    console.log('\n--- Cleanup ---');
    const tgIds = [SELLER_TG.id, BUYER_TG.id, ADMIN_TG.id];

    // Delete in dependency order
    await prisma.tradeReview.deleteMany({ where: { OR: [
        { reviewer: { telegramId: { in: tgIds } } },
        { reviewee: { telegramId: { in: tgIds } } },
    ] } });
    await prisma.dispute.deleteMany({ where: { OR: [
        { raiser: { telegramId: { in: tgIds } } },
        { target: { telegramId: { in: tgIds } } },
    ] } });
    await prisma.feeRecord.deleteMany({ where: { trade: { OR: [
        { buyer: { telegramId: { in: tgIds } } },
        { seller: { telegramId: { in: tgIds } } },
    ] } } });
    await prisma.trade.deleteMany({ where: { OR: [
        { buyer: { telegramId: { in: tgIds } } },
        { seller: { telegramId: { in: tgIds } } },
    ] } });
    await prisma.order.deleteMany({ where: { user: { telegramId: { in: tgIds } } } });
    await prisma.user.deleteMany({ where: { telegramId: { in: tgIds } } });
    console.log('  Test data cleaned up');
}

// =========================================================================
// CHANGE 1: Average Rate on Main Page
// =========================================================================
async function testAverageRates() {
    console.log('\n=== Change 1: Average Rate Endpoint (GET /api/rates/average) ===');

    const res = await apiCallNoAuth('GET', '/api/rates/average');
    assert(res.status === 200, 'Rates endpoint returns 200');
    assert(res.success === true, 'Rates returns success: true');
    assert(res.data !== undefined && res.data.averages !== undefined, 'Response has averages object');

    // Should have entries for all supported currencies
    const currencies = ['TTD', 'BBD', 'XCD', 'JMD', 'GYD', 'VES', 'EUR', 'SRD', 'XCG'];
    for (const code of currencies) {
        assert(res.data.averages[code] !== undefined, `Averages includes ${code}`);
    }

    // Each entry should have the expected fields
    const ttd = res.data.averages.TTD;
    assert(typeof ttd.avgSellRate === 'number', 'TTD has avgSellRate (number)');
    assert(typeof ttd.orderCount === 'number', 'TTD has orderCount (number)');
    assert(typeof ttd.minRate === 'number', 'TTD has minRate (number)');
    assert(typeof ttd.maxRate === 'number', 'TTD has maxRate (number)');
    assert(typeof ttd.updated === 'string', 'TTD has updated timestamp');
}

// =========================================================================
// CHANGE 2: Remove Completed Orders from Order Book
// =========================================================================
async function testOrderBookFiltering() {
    console.log('\n=== Change 2: Order Book Only Shows Active Orders ===');

    const orders = await apiCall('GET', '/api/orders', sellerInit);
    assert(orders.status === 200, 'Order book returns 200');

    // All returned orders should be ACTIVE or PARTIALLY_MATCHED
    if (orders.data && orders.data.length > 0) {
        const allActive = orders.data.every(
            (o: any) => o.status === 'ACTIVE' || o.status === 'PARTIALLY_MATCHED'
        );
        assert(allActive, 'All orders in book are ACTIVE or PARTIALLY_MATCHED');
    } else {
        assert(true, 'Order book is empty (no active orders yet - OK)');
    }
}

// =========================================================================
// CHANGE 4: Multi-Currency Expansion
// =========================================================================
async function testMultiCurrency() {
    console.log('\n=== Change 4: Multi-Currency Orders ===');

    // Create TTD order (default)
    const ttdOrder = await apiCall('POST', '/api/orders', sellerInit, {
        type: 'SELL',
        amount: 50,
        pricePerUsdt: 7.10,
        paymentMethods: ['Bank Transfer'],
        currency: 'TTD',
    });
    assert(ttdOrder.status === 201, 'TTD sell order created');
    assert(ttdOrder.data?.currency === 'TTD', 'Order currency is TTD');

    // Create BBD order
    const bbdOrder = await apiCall('POST', '/api/orders', sellerInit, {
        type: 'SELL',
        amount: 50,
        pricePerUsdt: 2.70,
        paymentMethods: ['Bank Transfer'],
        currency: 'BBD',
    });
    assert(bbdOrder.status === 201, 'BBD sell order created');
    assert(bbdOrder.data?.currency === 'BBD', 'Order currency is BBD');

    // Create JMD order
    const jmdOrder = await apiCall('POST', '/api/orders', sellerInit, {
        type: 'SELL',
        amount: 50,
        pricePerUsdt: 157.00,
        paymentMethods: ['Bank Transfer'],
        currency: 'JMD',
    });
    assert(jmdOrder.status === 201, 'JMD sell order created');
    assert(jmdOrder.data?.currency === 'JMD', 'Order currency is JMD');

    // Test invalid currency
    const badCurrency = await apiCall('POST', '/api/orders', sellerInit, {
        type: 'SELL',
        amount: 50,
        pricePerUsdt: 1.00,
        paymentMethods: ['Bank Transfer'],
        currency: 'INVALID',
    });
    assert(badCurrency.status === 400, 'Invalid currency rejected');

    // Test invalid payment method for BBD (Linx is TTD only, not valid for BBD)
    const badPayment = await apiCall('POST', '/api/orders', sellerInit, {
        type: 'SELL',
        amount: 50,
        pricePerUsdt: 2.70,
        paymentMethods: ['Linx'],
        currency: 'BBD',
    });
    assert(badPayment.status === 400, 'Invalid payment method for currency rejected');

    // Filter by currency
    const ttdOrders = await apiCall('GET', '/api/orders?currency=TTD', sellerInit);
    assert(ttdOrders.status === 200, 'Currency filter works');
    if (ttdOrders.data && ttdOrders.data.length > 0) {
        const allTTD = ttdOrders.data.every((o: any) => o.currency === 'TTD');
        assert(allTTD, 'All filtered orders are TTD');
    }

    // Clean up BBD and JMD orders, keep TTD for trade tests
    await prisma.order.delete({ where: { id: bbdOrder.data.id } });
    await prisma.order.delete({ where: { id: jmdOrder.data.id } });

    return ttdOrder.data;
}

// =========================================================================
// CHANGE 6: Minimum Trade $1.00 USDT
// =========================================================================
async function testMinimumTrade() {
    console.log('\n=== Change 6: Minimum Trade $1.00 USDT ===');

    // Try creating an order below $1 USDT
    const tooSmall = await apiCall('POST', '/api/orders', sellerInit, {
        type: 'SELL',
        amount: 0.50,
        pricePerUsdt: 7.10,
        paymentMethods: ['Bank Transfer'],
    });
    assert(tooSmall.status === 400, 'Order below $1 USDT rejected');
    assert(tooSmall.error?.includes('1'), 'Error mentions minimum amount');

    // Exactly $1 should work
    const exactMin = await apiCall('POST', '/api/orders', sellerInit, {
        type: 'SELL',
        amount: 1,
        pricePerUsdt: 7.10,
        paymentMethods: ['Bank Transfer'],
    });
    assert(exactMin.status === 201, 'Exactly $1 USDT order accepted');

    // Clean up
    if (exactMin.data?.id) {
        await prisma.order.delete({ where: { id: exactMin.data.id } });
    }
}

// =========================================================================
// CHANGE 10: 0.5% Fee Implementation
// =========================================================================
async function testFeeImplementation(orderId: string) {
    console.log('\n=== Change 10: 0.5% Fee Implementation ===');

    // Create a trade to test fee calculation
    const trade = await apiCall('POST', '/api/trades', buyerInit, {
        orderId,
        amount: 50,
    });
    assert(trade.status === 201, 'Trade created for fee test');

    // Check that fee fields are populated
    assert(trade.data.feeAmount !== undefined && trade.data.feeAmount !== null, 'Trade has feeAmount');
    assert(trade.data.feePercent !== undefined && trade.data.feePercent !== null, 'Trade has feePercent');

    // 0.5% of 50 USDT = 0.25 USDT
    const expectedFee = 0.25;
    assert(
        Math.abs(trade.data.feeAmount - expectedFee) < 0.01,
        `Fee amount is ~${expectedFee} USDT (got ${trade.data.feeAmount})`
    );
    assert(trade.data.feePercent === 0.5, `Fee percent is 0.5% (got ${trade.data.feePercent})`);

    return trade.data;
}

// =========================================================================
// Full Trade Flow + Fee Record Verification
// =========================================================================
async function testFullTradeWithFee(trade: any) {
    console.log('\n=== Full Trade Flow with Fee Record ===');

    // Lock escrow
    const lockRes = await apiCall('POST', `/api/trades/${trade.id}/escrow-locked`, sellerInit, {
        txHash: 'upgrade_test_tx_hash',
    });
    assert(lockRes.status === 200, 'Escrow locked');
    assert(lockRes.data.status === 'ESCROW_LOCKED', 'Status is ESCROW_LOCKED');

    // Buyer sends fiat
    const fiatRes = await apiCall('POST', `/api/trades/${trade.id}/fiat-sent`, buyerInit, {
        paymentReference: 'UPG-TEST-001',
    });
    assert(fiatRes.status === 200, 'Fiat sent confirmed');
    assert(fiatRes.data.status === 'FIAT_SENT', 'Status is FIAT_SENT');

    // Seller confirms receipt -> COMPLETED
    const confirmRes = await apiCall('POST', `/api/trades/${trade.id}/confirm-receipt`, sellerInit);
    assert(confirmRes.status === 200, 'Receipt confirmed');
    assert(confirmRes.data.status === 'COMPLETED', 'Trade is COMPLETED');

    // Verify FeeRecord was created
    const feeRecords = await prisma.feeRecord.findMany({ where: { tradeId: trade.id } });
    assert(feeRecords.length > 0, 'FeeRecord created for completed trade');
    if (feeRecords.length > 0) {
        assert(feeRecords[0].feeAmount > 0, `FeeRecord amount is ${feeRecords[0].feeAmount}`);
        assert(feeRecords[0].paidBy === trade.sellerId, 'Fee paid by seller');
    }

    return trade;
}

// =========================================================================
// CHANGE 7: Reputation System (Reviews with Upvotes/Downvotes)
// =========================================================================
async function testReviewSystem(tradeId: string) {
    console.log('\n=== Change 7: Review System (Upvotes/Downvotes) ===');

    // Buyer reviews the trade (upvote seller)
    const buyerReview = await apiCall('POST', '/api/reviews', buyerInit, {
        tradeId,
        vote: 'up',
        comment: 'Great seller, fast payment!',
    });
    assert(buyerReview.status === 201, 'Buyer review created');
    assert(buyerReview.data.vote === 'up', 'Review vote is up');
    assert(buyerReview.data.comment === 'Great seller, fast payment!', 'Review comment stored');

    // Seller reviews the trade (upvote buyer)
    const sellerReview = await apiCall('POST', '/api/reviews', sellerInit, {
        tradeId,
        vote: 'up',
        comment: 'Smooth transaction',
    });
    assert(sellerReview.status === 201, 'Seller review created');

    // Can't review same trade twice
    const duplicate = await apiCall('POST', '/api/reviews', buyerInit, {
        tradeId,
        vote: 'down',
        comment: 'Changed my mind',
    });
    assert(duplicate.status === 400, 'Duplicate review rejected');

    // Invalid vote value
    const badVote = await apiCall('POST', '/api/reviews', buyerInit, {
        tradeId: 'some-other-trade',
        vote: 'maybe',
    });
    assert(badVote.status === 400, 'Invalid vote value rejected');

    // Get reviews for seller
    const sellerUser = await prisma.user.findUnique({ where: { telegramId: SELLER_TG.id } });
    if (sellerUser) {
        const reviews = await apiCall('GET', `/api/reviews/${sellerUser.id}`, buyerInit);
        assert(reviews.status === 200, 'Get user reviews returns 200');
        assert(reviews.data.reviews.length >= 1, 'At least 1 review for seller');
        assert(reviews.data.user.totalUpvotes >= 1, `Seller has totalUpvotes >= 1 (got ${reviews.data.user.totalUpvotes})`);
    }
}

// =========================================================================
// CHANGE 8: Leaderboard
// =========================================================================
async function testLeaderboard() {
    console.log('\n=== Change 8: Leaderboard ===');

    // Default sort (reputation)
    const lb = await apiCall('GET', '/api/users/leaderboard', buyerInit);
    assert(lb.status === 200, 'Leaderboard returns 200');
    assert(Array.isArray(lb.data), 'Leaderboard data is an array');
    assert(lb.pagination !== undefined, 'Leaderboard has pagination');

    // Check leaderboard entry fields
    if (lb.data.length > 0) {
        const entry = lb.data[0];
        assert(entry.reputationScore !== undefined, 'Entry has reputationScore');
        assert(entry.totalTrades !== undefined, 'Entry has totalTrades');
        assert(entry.totalUpvotes !== undefined, 'Entry has totalUpvotes');
        assert(entry.totalDownvotes !== undefined, 'Entry has totalDownvotes');
        assert(entry.reputationTier !== undefined, 'Entry has reputationTier');
    }

    // Sort by trades
    const byTrades = await apiCall('GET', '/api/users/leaderboard?sort=trades', buyerInit);
    assert(byTrades.status === 200, 'Sort by trades works');

    // Sort by volume
    const byVolume = await apiCall('GET', '/api/users/leaderboard?sort=volume', buyerInit);
    assert(byVolume.status === 200, 'Sort by volume works');

    // Search
    const search = await apiCall('GET', '/api/users/leaderboard?search=Upg', buyerInit);
    assert(search.status === 200, 'Leaderboard search works');
    if (search.data.length > 0) {
        assert(
            search.data.some((u: any) => u.firstName.includes('Upg') || (u.username && u.username.includes('upg'))),
            'Search results include test users'
        );
    }

    // Pagination
    const page2 = await apiCall('GET', '/api/users/leaderboard?page=2&limit=5', buyerInit);
    assert(page2.status === 200, 'Leaderboard pagination works');
}

// =========================================================================
// CHANGE 9: Dispute Resolution + Ban System + Admin Panel
// =========================================================================
async function testDisputeAndAdmin() {
    console.log('\n=== Change 9: Dispute Resolution + Ban + Admin ===');

    // -- Setup: Create a fresh order and trade for dispute testing --
    const freshOrder = await apiCall('POST', '/api/orders', sellerInit, {
        type: 'SELL',
        amount: 50,
        pricePerUsdt: 7.10,
        paymentMethods: ['Bank Transfer'],
        currency: 'TTD',
    });
    assert(freshOrder.status === 201, 'Fresh order for dispute test created');

    const trade = await apiCall('POST', '/api/trades', buyerInit, {
        orderId: freshOrder.data.id,
        amount: 10,
    });
    assert(trade.status === 201, 'Dispute test trade created');

    // Lock escrow
    await apiCall('POST', `/api/trades/${trade.data.id}/escrow-locked`, sellerInit, {
        txHash: 'dispute_test_tx',
    });

    // -- Test Dispute API (POST /api/disputes) --
    // Missing fields
    const noReason = await apiCall('POST', '/api/disputes', buyerInit, {
        tradeId: trade.data.id,
    });
    assert(noReason.status === 400, 'Dispute without reason rejected');

    // Invalid reason
    const badReason = await apiCall('POST', '/api/disputes', buyerInit, {
        tradeId: trade.data.id,
        reason: 'invalid_reason',
        description: 'This is a test description for dispute that is long enough',
    });
    assert(badReason.status === 400, 'Dispute with invalid reason rejected');

    // Valid dispute
    const dispute = await apiCall('POST', '/api/disputes', buyerInit, {
        tradeId: trade.data.id,
        reason: 'unresponsive',
        description: 'Seller is not responding to my messages after escrow was locked',
    });
    assert(dispute.status === 201, 'Dispute created successfully');
    assert(dispute.data.reason === 'unresponsive', 'Dispute reason stored');
    assert(dispute.data.status === 'open', 'Dispute status is open');

    // -- Add evidence --
    const evidence = await apiCall('POST', `/api/disputes/${dispute.data.id}/evidence`, buyerInit, {
        text: 'I sent a message at 2pm but got no reply',
    });
    assert(evidence.status === 200, 'Evidence added to dispute');

    // -- View dispute --
    const viewDispute = await apiCall('GET', `/api/disputes/${dispute.data.id}`, buyerInit);
    assert(viewDispute.status === 200, 'View dispute returns 200');

    // -- My disputes --
    const myDisputes = await apiCall('GET', '/api/my/disputes', buyerInit);
    assert(myDisputes.status === 200, 'My disputes returns 200');
    assert(myDisputes.data.length >= 1, 'At least 1 dispute in my disputes');

    // -- Setup admin user --
    // Make admin user in DB
    await apiCall('GET', '/api/users/me', adminInit); // auto-create
    const adminUser = await prisma.user.findUnique({ where: { telegramId: ADMIN_TG.id } });
    if (adminUser) {
        await prisma.user.update({
            where: { id: adminUser.id },
            data: { isAdmin: true },
        });
    }

    // -- Admin: Non-admin should be rejected --
    const nonAdmin = await apiCall('GET', '/api/admin/stats', buyerInit);
    assert(nonAdmin.status === 403, 'Non-admin rejected from admin API');

    // -- Admin: Stats --
    const stats = await apiCall('GET', '/api/admin/stats', adminInit);
    assert(stats.status === 200, 'Admin stats returns 200');
    assert(stats.data.totalTrades !== undefined, 'Stats has totalTrades');
    assert(stats.data.totalUsers !== undefined, 'Stats has totalUsers');
    assert(stats.data.openDisputes !== undefined, 'Stats has openDisputes');
    assert(stats.data.feesCollected !== undefined, 'Stats has feesCollected');
    assert(stats.data.volumeByCurrency !== undefined, 'Stats has volumeByCurrency');

    // -- Admin: List disputes --
    const adminDisputes = await apiCall('GET', '/api/admin/disputes', adminInit);
    assert(adminDisputes.status === 200, 'Admin disputes list returns 200');
    assert(adminDisputes.data.length >= 1, 'Admin sees at least 1 dispute');

    // -- Admin: Update dispute status to under_review --
    const reviewStatus = await apiCall('PUT', `/api/admin/disputes/${dispute.data.id}/status`, adminInit, {
        status: 'under_review',
    });
    assert(reviewStatus.status === 200, 'Dispute status updated to under_review');

    // -- Admin: Resolve dispute --
    const resolve = await apiCall('POST', `/api/admin/disputes/${dispute.data.id}/resolve`, adminInit, {
        outcome: 'buyer_wins',
        action: 'release_to_buyer',
        notes: 'Seller was unresponsive for over 24 hours',
    });
    assert(resolve.status === 200, 'Dispute resolved');
    assert(resolve.data.status === 'resolved', 'Dispute status is resolved');

    // -- Admin: List users --
    const users = await apiCall('GET', '/api/admin/users', adminInit);
    assert(users.status === 200, 'Admin users list returns 200');
    assert(users.data.length >= 3, 'At least 3 test users exist');

    // -- Admin: List orders --
    const orders = await apiCall('GET', '/api/admin/orders', adminInit);
    assert(orders.status === 200, 'Admin orders list returns 200');

    // -- Admin: Ban user --
    const sellerUser = await prisma.user.findUnique({ where: { telegramId: SELLER_TG.id } });
    if (sellerUser) {
        const ban = await apiCall('POST', `/api/admin/users/${sellerUser.id}/ban`, adminInit, {
            reason: 'Test ban for unresponsive behavior',
            type: 'temporary',
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        });
        assert(ban.status === 200, 'User banned successfully');
        assert(ban.data.isBanned === true, 'User isBanned is true');
        assert(ban.data.banType === 'temporary', 'Ban type is temporary');

        // Banned user can't create orders
        const bannedOrder = await apiCall('POST', '/api/orders', sellerInit, {
            type: 'SELL',
            amount: 50,
            pricePerUsdt: 7.10,
            paymentMethods: ['Bank Transfer'],
        });
        assert(bannedOrder.status === 403, 'Banned user cannot create orders');

        // Unban user
        const unban = await apiCall('DELETE', `/api/admin/users/${sellerUser.id}/ban`, adminInit);
        assert(unban.status === 200, 'User unbanned successfully');
        assert(unban.data.isBanned === false, 'User isBanned is false after unban');

        // Unbanned user can create orders again
        const unbannedOrder = await apiCall('POST', '/api/orders', sellerInit, {
            type: 'SELL',
            amount: 50,
            pricePerUsdt: 7.10,
            paymentMethods: ['Bank Transfer'],
        });
        assert(unbannedOrder.status === 201, 'Unbanned user can create orders');
        if (unbannedOrder.data?.id) {
            await prisma.order.delete({ where: { id: unbannedOrder.data.id } });
        }
    }

    // -- Admin: Force-cancel order --
    // Create a new order to force-cancel
    const newOrder = await apiCall('POST', '/api/orders', sellerInit, {
        type: 'SELL',
        amount: 25,
        pricePerUsdt: 7.10,
        paymentMethods: ['Bank Transfer'],
    });
    if (newOrder.status === 201) {
        const forceCancel = await apiCall('PUT', `/api/admin/orders/${newOrder.data.id}/cancel`, adminInit);
        assert(forceCancel.status === 200, 'Admin force-cancel order works');
        assert(forceCancel.data.status === 'CANCELLED', 'Force-cancelled order status is CANCELLED');
    }
}

// =========================================================================
// CHANGE 1 (continued): Rates after creating orders
// =========================================================================
async function testRatesWithData() {
    console.log('\n=== Change 1 (continued): Rates with Active Orders ===');

    // Create a sell order so there's data
    const order = await apiCall('POST', '/api/orders', sellerInit, {
        type: 'SELL',
        amount: 100,
        pricePerUsdt: 7.15,
        paymentMethods: ['Bank Transfer'],
        currency: 'TTD',
    });

    if (order.status === 201) {
        const rates = await apiCallNoAuth('GET', '/api/rates/average');
        assert(rates.status === 200, 'Rates returns 200 with data');
        assert(rates.data.averages.TTD.orderCount >= 1, `TTD has orders (count: ${rates.data.averages.TTD.orderCount})`);
        assert(rates.data.averages.TTD.avgSellRate > 0, `TTD avgSellRate > 0 (${rates.data.averages.TTD.avgSellRate})`);

        await prisma.order.delete({ where: { id: order.data.id } });
    }
}

// =========================================================================
// Reputation Update Verification
// =========================================================================
async function testReputationUpdated() {
    console.log('\n=== Reputation Score Updated ===');

    const seller = await apiCall('GET', '/api/users/me', sellerInit);
    assert(seller.data.totalTrades >= 1, `Seller totalTrades >= 1 (got ${seller.data.totalTrades})`);
    assert(seller.data.successfulTrades >= 1, `Seller successfulTrades >= 1 (got ${seller.data.successfulTrades})`);

    const buyer = await apiCall('GET', '/api/users/me', buyerInit);
    assert(buyer.data.totalTrades >= 1, `Buyer totalTrades >= 1 (got ${buyer.data.totalTrades})`);

    // Check reputation data
    const sellerUser = await prisma.user.findUnique({ where: { telegramId: SELLER_TG.id } });
    if (sellerUser) {
        const rep = await apiCall('GET', `/api/users/${sellerUser.id}/reputation`, sellerInit);
        assert(rep.status === 200, 'Reputation endpoint returns 200');
        assert(rep.data.reputationScore !== undefined, 'Reputation has reputationScore');
        assert(rep.data.totalTrades >= 1, `Reputation totalTrades >= 1 (got ${rep.data.totalTrades})`);
        assert(rep.data.successRate >= 0, 'Reputation has successRate');
    }
}

// =========================================================================
// Main
// =========================================================================
async function main() {
    console.log('==================================================');
    console.log('  Ibis Exchange v2 Upgrade - E2E Test Suite');
    console.log('==================================================');
    console.log(`API: ${API_BASE}`);
    console.log(`Time: ${new Date().toISOString()}\n`);

    try {
        // Clean up any leftover test data
        await cleanup();

        // Setup: Create test users
        await apiCall('GET', '/api/users/me', sellerInit);
        await apiCall('GET', '/api/users/me', buyerInit);
        await apiCall('GET', '/api/users/me', adminInit);

        // Change 1: Average rates
        await testAverageRates();

        // Change 2: Order book filtering
        await testOrderBookFiltering();

        // Change 4: Multi-currency
        const ttdOrder = await testMultiCurrency();

        // Change 6: Minimum trade
        await testMinimumTrade();

        // Change 10: Fee implementation (uses TTD order from change 4)
        const trade = await testFeeImplementation(ttdOrder.id);

        // Full trade flow with fee verification
        const completedTrade = await testFullTradeWithFee(trade);

        // Change 7: Review system
        await testReviewSystem(completedTrade.id);

        // Reputation verification
        await testReputationUpdated();

        // Change 8: Leaderboard
        await testLeaderboard();

        // Change 1 continued: Rates with actual data
        await testRatesWithData();

        // Change 9: Dispute + Ban + Admin (creates new orders/trades internally)
        await testDisputeAndAdmin();

    } catch (err) {
        console.error('\nFATAL ERROR:', err);
        failed++;
    } finally {
        await cleanup();
        await prisma.$disconnect();
    }

    // Summary
    console.log('\n==================================================');
    console.log(`  Results: \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m`);
    console.log('==================================================');
    if (errors.length > 0) {
        console.log('\nFailed tests:');
        errors.forEach(e => console.log(`  \x1b[31m- ${e}\x1b[0m`));
    }
    console.log('\nChanges tested:');
    console.log('  1. Average rate on main page      - API tested');
    console.log('  2. Order book filtering            - API tested');
    console.log('  3. Depth chart visualization       - Frontend only (Vite build verified)');
    console.log('  4. Multi-currency expansion        - API tested (TTD, BBD, JMD)');
    console.log('  5. Caribbean theme + branding      - Frontend only (Vite build verified)');
    console.log('  6. Minimum trade $1.00 USDT        - API tested');
    console.log('  7. Reputation (upvotes/downvotes)  - API tested');
    console.log('  8. Leaderboard                     - API tested');
    console.log('  9. Dispute + ban + admin panel     - API tested');
    console.log(' 10. 0.5% fee implementation         - API tested');

    process.exit(failed > 0 ? 1 : 0);
}

main();
