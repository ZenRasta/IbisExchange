import { useRef, useEffect, useState } from 'react';
import { getCurrencySymbol } from '../lib/currencies';
import type { Order } from '../lib/types';

interface DepthChartProps {
  orders: Order[];
  currency: string;
}

export default function DepthChart({ orders, currency }: DepthChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        setDimensions({ width, height: Math.max(250, width * 0.5) });
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dimensions.width === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = dimensions.width * dpr;
    canvas.height = dimensions.height * dpr;
    ctx.scale(dpr, dpr);

    const buyOrders = orders
      .filter(o => o.type === 'BUY' && (o.status === 'ACTIVE' || o.status === 'PARTIALLY_MATCHED'))
      .sort((a, b) => b.pricePerUsdt - a.pricePerUsdt);

    const sellOrders = orders
      .filter(o => o.type === 'SELL' && (o.status === 'ACTIVE' || o.status === 'PARTIALLY_MATCHED'))
      .sort((a, b) => a.pricePerUsdt - b.pricePerUsdt);

    if (buyOrders.length === 0 && sellOrders.length === 0) {
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--tg-theme-hint-color').trim() || '#999';
      ctx.font = '14px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No order data available', dimensions.width / 2, dimensions.height / 2);
      return;
    }

    // Build cumulative data
    const buyData: { price: number; cumVol: number }[] = [];
    let cumVol = 0;
    for (const order of buyOrders) {
      cumVol += order.remainingAmount;
      buyData.push({ price: order.pricePerUsdt, cumVol });
    }

    const sellData: { price: number; cumVol: number }[] = [];
    cumVol = 0;
    for (const order of sellOrders) {
      cumVol += order.remainingAmount;
      sellData.push({ price: order.pricePerUsdt, cumVol });
    }

    // Determine price range
    const allPrices = [...buyData.map(d => d.price), ...sellData.map(d => d.price)];
    const minPrice = Math.min(...allPrices);
    const maxPrice = Math.max(...allPrices);
    const priceRange = maxPrice - minPrice || 1;
    const pricePadding = priceRange * 0.1;

    const plotMinPrice = minPrice - pricePadding;
    const plotMaxPrice = maxPrice + pricePadding;
    const plotPriceRange = plotMaxPrice - plotMinPrice;

    // Max volume
    const maxVol = Math.max(
      buyData.length > 0 ? buyData[buyData.length - 1].cumVol : 0,
      sellData.length > 0 ? sellData[sellData.length - 1].cumVol : 0,
      1
    );

    // Drawing area
    const padding = { top: 20, right: 16, bottom: 40, left: 50 };
    const plotW = dimensions.width - padding.left - padding.right;
    const plotH = dimensions.height - padding.top - padding.bottom;

    // Helpers
    const priceToX = (price: number) => padding.left + ((price - plotMinPrice) / plotPriceRange) * plotW;
    const volToY = (vol: number) => padding.top + plotH - (vol / maxVol) * plotH;

    // Colors
    const buyColor = getComputedStyle(document.documentElement).getPropertyValue('--ibis-buy-green').trim() || '#00C853';
    const sellColor = getComputedStyle(document.documentElement).getPropertyValue('--ibis-sell-red').trim() || '#FF1744';
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--tg-theme-text-color').trim() || '#000';
    const hintColor = getComputedStyle(document.documentElement).getPropertyValue('--tg-theme-hint-color').trim() || '#999';
    const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--tg-theme-secondary-bg-color').trim() || '#f0f0f0';

    // Clear
    ctx.clearRect(0, 0, dimensions.width, dimensions.height);

    // Grid lines
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 0.5;
    const numGridLines = 4;
    for (let i = 0; i <= numGridLines; i++) {
      const y = padding.top + (plotH / numGridLines) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(dimensions.width - padding.right, y);
      ctx.stroke();

      // Y-axis labels
      const vol = maxVol - (maxVol / numGridLines) * i;
      ctx.fillStyle = hintColor;
      ctx.font = '10px -apple-system, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(vol.toFixed(0), padding.left - 6, y + 3);
    }

    // X-axis labels
    const numXLabels = Math.min(5, allPrices.length);
    ctx.fillStyle = hintColor;
    ctx.font = '10px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    for (let i = 0; i <= numXLabels; i++) {
      const price = plotMinPrice + (plotPriceRange / numXLabels) * i;
      const x = priceToX(price);
      ctx.fillText(price.toFixed(2), x, dimensions.height - padding.bottom + 16);
    }

    // Axis labels
    ctx.fillStyle = hintColor;
    ctx.font = '10px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Price (${getCurrencySymbol(currency)})`, dimensions.width / 2, dimensions.height - 4);

    ctx.save();
    ctx.translate(10, padding.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Volume (USDT)', 0, 0);
    ctx.restore();

    // Draw buy side (step chart, filled)
    if (buyData.length > 0) {
      ctx.beginPath();
      // Start from the bottom-left of buy area
      const firstBuyX = priceToX(buyData[0].price);
      ctx.moveTo(firstBuyX, padding.top + plotH);
      ctx.lineTo(firstBuyX, volToY(buyData[0].cumVol));

      for (let i = 1; i < buyData.length; i++) {
        const prevX = priceToX(buyData[i - 1].price);
        const currX = priceToX(buyData[i].price);
        const currY = volToY(buyData[i].cumVol);
        // Horizontal step then vertical
        ctx.lineTo(currX, volToY(buyData[i - 1].cumVol));
        ctx.lineTo(currX, currY);
      }

      // Close to bottom
      const lastBuyX = priceToX(buyData[buyData.length - 1].price);
      ctx.lineTo(lastBuyX, padding.top + plotH);
      ctx.closePath();

      ctx.fillStyle = buyColor + '33';
      ctx.fill();
      ctx.strokeStyle = buyColor;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Draw sell side (step chart, filled)
    if (sellData.length > 0) {
      ctx.beginPath();
      const firstSellX = priceToX(sellData[0].price);
      ctx.moveTo(firstSellX, padding.top + plotH);
      ctx.lineTo(firstSellX, volToY(sellData[0].cumVol));

      for (let i = 1; i < sellData.length; i++) {
        const prevX = priceToX(sellData[i - 1].price);
        const currX = priceToX(sellData[i].price);
        const currY = volToY(sellData[i].cumVol);
        ctx.lineTo(currX, volToY(sellData[i - 1].cumVol));
        ctx.lineTo(currX, currY);
      }

      const lastSellX = priceToX(sellData[sellData.length - 1].price);
      ctx.lineTo(lastSellX, padding.top + plotH);
      ctx.closePath();

      ctx.fillStyle = sellColor + '33';
      ctx.fill();
      ctx.strokeStyle = sellColor;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Spread indicator
    if (buyOrders.length > 0 && sellOrders.length > 0) {
      const highestBid = buyOrders[0].pricePerUsdt;
      const lowestAsk = sellOrders[0].pricePerUsdt;
      const spread = lowestAsk - highestBid;

      if (spread > 0) {
        const bidX = priceToX(highestBid);
        const askX = priceToX(lowestAsk);

        ctx.strokeStyle = hintColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(bidX, padding.top);
        ctx.lineTo(bidX, padding.top + plotH);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(askX, padding.top);
        ctx.lineTo(askX, padding.top + plotH);
        ctx.stroke();
        ctx.setLineDash([]);

        // Spread label
        const midX = (bidX + askX) / 2;
        ctx.fillStyle = textColor;
        ctx.font = 'bold 11px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`Spread: ${spread.toFixed(2)}`, midX, padding.top + 14);
      }
    }

    // Legend
    ctx.font = '11px -apple-system, sans-serif';
    ctx.textAlign = 'left';

    ctx.fillStyle = buyColor;
    ctx.fillRect(padding.left, padding.top - 14, 10, 10);
    ctx.fillStyle = textColor;
    ctx.fillText('Buy', padding.left + 14, padding.top - 5);

    ctx.fillStyle = sellColor;
    ctx.fillRect(padding.left + 50, padding.top - 14, 10, 10);
    ctx.fillStyle = textColor;
    ctx.fillText('Sell', padding.left + 64, padding.top - 5);

  }, [orders, currency, dimensions]);

  return (
    <div ref={containerRef} className="w-full">
      {dimensions.width > 0 ? (
        <canvas
          ref={canvasRef}
          style={{ width: dimensions.width, height: dimensions.height }}
          className="rounded-xl"
        />
      ) : (
        <div className="flex items-center justify-center" style={{ minHeight: 250 }}>
          <div className="animate-spin h-6 w-6 border-2 border-tg-button border-t-transparent rounded-full" />
        </div>
      )}
    </div>
  );
}
