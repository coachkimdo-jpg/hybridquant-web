import { useEffect, useRef } from 'react';
import { createChart, ColorType } from 'lightweight-charts';
import type { IChartApi } from 'lightweight-charts';

interface TradingChartProps {
    dataPayload: any;
    showMarketStructure?: boolean;
    showMomentum?: boolean;
    showPattern?: boolean;
}

export default function TradingChart({ dataPayload, showMarketStructure, showMomentum, showPattern }: TradingChartProps) {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);

    useEffect(() => {
        if (!chartContainerRef.current || !dataPayload || !dataPayload.chart_data || dataPayload.chart_data.length === 0) return;
        
        const data = dataPayload.chart_data;
        const markersData = dataPayload.markers;

        const handleResize = () => {
            chartRef.current?.applyOptions({ width: chartContainerRef.current?.clientWidth });
        };

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: '#0f172a' },
                textColor: '#f8fafc',
            },
            grid: {
                vertLines: { color: '#1e293b' },
                horzLines: { color: '#1e293b' },
            },
            width: chartContainerRef.current.clientWidth,
            height: 500,
        });
        chartRef.current = chart;

        const candlestickSeries = chart.addCandlestickSeries({
            upColor: '#22c55e',
            downColor: '#ef4444',
            borderVisible: false,
            wickUpColor: '#22c55e',
            wickDownColor: '#ef4444',
        });

        if (data && data.length > 0) {
            try {
                candlestickSeries.setData(data as any);

                // Add volume as a histogram series
                const volumeSeries = chart.addHistogramSeries({
                    color: '#3b82f6',
                    priceFormat: {
                        type: 'volume',
                    },
                    priceScaleId: '', // set as an overlay
                });
                
                volumeSeries.priceScale().applyOptions({
                    scaleMargins: {
                        top: 0.8, // highest point of the series will be at 80% from the top
                        bottom: 0,
                    },
                });

                const volumeData = data.map((d: any) => ({
                    time: d.time,
                    value: d.volume,
                    color: d.close >= d.open ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.4)'
                }));
                
                volumeSeries.setData(volumeData as any);

                // Add EMA 20
                const ema20Series = chart.addLineSeries({
                    color: '#f59e0b', // amber
                    lineWidth: 2,
                    crosshairMarkerVisible: false,
                });
                const ema20Data = data
                    .filter((d: any) => d.ema_20 != null && !isNaN(d.ema_20))
                    .map((d: any) => ({ time: d.time, value: d.ema_20 }));
                if (ema20Data.length > 0) ema20Series.setData(ema20Data);

                // Add EMA 200
                const ema200Series = chart.addLineSeries({
                    color: '#8b5cf6', // violet
                    lineWidth: 2,
                    crosshairMarkerVisible: false,
                });
                const ema200Data = data
                    .filter((d: any) => d.ema_200 != null && !isNaN(d.ema_200))
                    .map((d: any) => ({ time: d.time, value: d.ema_200 }));
                if (ema200Data.length > 0) ema200Series.setData(ema200Data);

                // Add AVWAP
                const avwapSeries = chart.addLineSeries({
                    color: '#ec4899', // pink
                    lineWidth: 2,
                    lineStyle: 2, // Dashed
                    crosshairMarkerVisible: false,
                });
                const avwapData = data
                    .filter((d: any) => d.avwap != null && !isNaN(d.avwap) && d.avwap > 0)
                    .map((d: any) => ({ time: d.time, value: d.avwap }));
                if (avwapData.length > 0) avwapSeries.setData(avwapData);

                // Add Basic Markers if pattern mode is NOT on but we still want them
                if (!showPattern && markersData && markersData.length > 0) {
                    const validMarkers = markersData
                        .filter((m: any) => m.time && m.position && m.shape && m.color)
                        .map((m: any) => ({
                            time: m.time,
                            position: m.position,
                            color: m.color,
                            shape: m.shape,
                            text: m.text
                        }))
                        .sort((a: any, b: any) => new Date(a.time).getTime() - new Date(b.time).getTime());
                    
                    // Filter duplicates
                    const uniqueMarkers = validMarkers.filter((v: any, i: number, a: any[]) => a.findIndex(t => (t.time === v.time && t.text === v.text)) === i);
                    if (uniqueMarkers.length > 0) candlestickSeries.setMarkers(uniqueMarkers);
                }

                // Option 2: Market Structure (VWAP & POC)
                if (showMarketStructure) {
                    const vwapSeries = chart.addLineSeries({
                        color: '#fbbf24', // Amber
                        lineWidth: 2,
                        lineStyle: 1, // Dotted
                        title: 'VWAP',
                    });
                    const vwapData = data
                        .filter((d: any) => d.avwap != null && d.avwap > 0)
                        .map((d: any) => ({ time: d.time, value: d.avwap }));
                    if (vwapData.length > 0) vwapSeries.setData(vwapData);

                    if (dataPayload.poc_price) {
                        candlestickSeries.createPriceLine({
                            price: dataPayload.poc_price,
                            color: '#ec4899', // Pink
                            lineWidth: 2,
                            lineStyle: 2, // Dashed
                            axisLabelVisible: true,
                            title: 'POC',
                        });
                    }
                }

                // Option 3: Momentum (EMA)
                if (showMomentum) {
                    const ema20 = chart.addLineSeries({ color: '#facc15', lineWidth: 1, title: 'EMA 20' });
                    const ema50 = chart.addLineSeries({ color: '#3b82f6', lineWidth: 2, title: 'EMA 50' });
                    const ema200 = chart.addLineSeries({ color: '#a855f7', lineWidth: 2, title: 'EMA 200' });
                    
                    ema20.setData(data.filter((d:any)=>d.ema_20>0).map((d: any) => ({ time: d.time, value: d.ema_20 })));
                    ema50.setData(data.filter((d:any)=>d.ema_50>0).map((d: any) => ({ time: d.time, value: d.ema_50 })));
                    ema200.setData(data.filter((d:any)=>d.ema_200>0).map((d: any) => ({ time: d.time, value: d.ema_200 })));
                }

                // Option 4: Pattern & Risk (Chandelier Exit & Markers)
                if (showPattern) {
                    const chandelierSeries = chart.addLineSeries({
                        color: '#f43f5e', // Rose
                        lineWidth: 2,
                        lineStyle: 2, // Dashed
                        title: 'Chandelier Exit',
                    });
                    const chandData = data
                        .map((d: any) => ({ time: d.time, value: d.chandelier_exit }))
                        .filter((d: any) => d.value !== undefined && d.value !== null && d.value !== 0 && !isNaN(d.value));
                    if (chandData.length > 0) {
                        chandelierSeries.setData(chandData);
                    }
                    
                    if (markersData && markersData.length > 0) {
                        const validMarkers = markersData
                            .filter((m: any) => m.time && m.position && m.shape && m.color)
                            .map((m: any) => ({
                                time: m.time, position: m.position, color: m.color, shape: m.shape, text: m.text
                            }))
                            .sort((a: any, b: any) => new Date(a.time).getTime() - new Date(b.time).getTime());
                        const uniqueMarkers = validMarkers.filter((v: any, i: number, a: any[]) => a.findIndex(t => (t.time === v.time && t.text === v.text)) === i);
                        if (uniqueMarkers.length > 0) candlestickSeries.setMarkers(uniqueMarkers);
                    }
                }

                chart.timeScale().fitContent();
            } catch (error) {
                console.error("Error setting chart data:", error);
            }
        }

        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            chart.remove();
        };
    }, [dataPayload, showMarketStructure, showMomentum, showPattern]);

    return <div ref={chartContainerRef} className="w-full h-[500px]" />;
};
