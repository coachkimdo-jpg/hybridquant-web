from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy.orm import Session
from fastapi.middleware.cors import CORSMiddleware
import models
from database import engine, get_db

models.Base.metadata.create_all(bind=engine)

import broker_kis
from pydantic import BaseModel

class OrderRequest(BaseModel):
    ticker: str
    price: float
    quantity: int
    order_type: str = "BUY"

class AlertRequest(BaseModel):
    ticker: str
    target_price: float
    condition: str
    message: str

app = FastAPI(title="HybridQuant Web API")

scan_status = {
    "is_running": False,
    "total": 0,
    "current": 0,
    "results": {}
}

import threading
import time
from database import SessionLocal

def bg_scan_market():
    global scan_status
    if scan_status["is_running"]:
        return
    scan_status["is_running"] = True
    scan_status["current"] = 0
    scan_status["results"] = {}

    import json
    import os
    from concurrent.futures import ThreadPoolExecutor, as_completed
    
    file_path = os.path.join(os.path.dirname(__file__), "tickers.json")
    if not os.path.exists(file_path):
        scan_status["is_running"] = False
        return
        
    with open(file_path, "r", encoding="utf-8") as f:
        all_stocks = json.load(f)
        
    keys = list(all_stocks.keys())
    scan_status["total"] = len(keys)
    
    def scan_single_ticker(ticker: str, name: str):
        if not scan_status["is_running"]:
            return
        db = SessionLocal()
        try:
            chart_res = get_v2_chart_data(ticker, db)
            cdata = chart_res.get("chart_data", [])
            if cdata:
                latest = cdata[-1]
                c_close = latest.get("close", 0)
                
                score = 0
                passes = []
                
                score += 1
                passes.append("fundamental")
                
                if c_close > latest.get("avwap", 0):
                    score += 1
                    passes.append("vwap")
                    
                poc = chart_res.get("poc_price", 0)
                if poc > 0 and (c_close > poc or abs(c_close - poc)/poc <= 0.02):
                    score += 1
                    passes.append("poc")
                    
                if latest.get("ema_20", 0) > latest.get("ema_50", 0):
                    score += 1
                    passes.append("ema_cross")
                    
                if latest.get("macd_hist", 0) > 0:
                    score += 1
                    passes.append("macd")
                    
                chand = latest.get("chandelier_exit", 0)
                if chand > 0 and c_close > chand:
                    score += 1
                    passes.append("chandelier")
                    
                if score >= 4:
                    scan_status["results"][ticker] = {
                        "name": name,
                        "score": score,
                        "passes": passes
                    }
        except Exception as e:
            print(f"Error scanning ticker {ticker}: {e}")
        finally:
            db.close()

    # Use ThreadPoolExecutor for highly concurrent network fetching (up to 15 concurrent threads)
    max_workers = 15
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(scan_single_ticker, ticker, name) for ticker, name in all_stocks.items()]
        for i, future in enumerate(as_completed(futures)):
            if not scan_status["is_running"]:
                break
            scan_status["current"] = i + 1

    scan_status["is_running"] = False

@app.get("/api/v4/screener/start-scan")
def start_scan():
    if scan_status["is_running"]:
        return {"message": "Scan already running"}
    t = threading.Thread(target=bg_scan_market)
    t.start()
    return {"message": "Scan started"}

@app.get("/api/v4/screener/status")
def get_scan_status():
    return scan_status

@app.get("/api/v4/screener/results")
def get_scan_results():
    return scan_status["results"]

@app.get("/api/v4/stocks")
def get_all_stocks():
    import json
    import os
    file_path = os.path.join(os.path.dirname(__file__), "tickers.json")
    if os.path.exists(file_path):
        with open(file_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}

@app.get("/api/v4/screener/fundamentals")
def get_fundamental_filtered_stocks():
    import json
    import os
    import random
    file_path = os.path.join(os.path.dirname(__file__), "tickers.json")
    if os.path.exists(file_path):
        with open(file_path, "r", encoding="utf-8") as f:
            all_stocks = json.load(f)
            # Mock filtering: Randomly select 30 stocks as "fundamentally strong"
            keys = list(all_stocks.keys())
            random.seed(42) # Consistent mock
            selected = random.sample(keys, min(30, len(keys)))
            return {k: all_stocks[k] for k in selected}
    return {}

@app.get("/api/v4/screener/auto")
def get_auto_screener(db: Session = Depends(get_db)):
    """
    V4 Full Auto Screener (Soft Scoring Version)
    Computes a 6-point score for each stock in the pool.
    Hard Filter: Only top liquid/large cap (simulated by our pool).
    Score >= 4 passes.
    """
    import json
    import os
    import random
    from concurrent.futures import ThreadPoolExecutor, as_completed
    
    file_path = os.path.join(os.path.dirname(__file__), "tickers.json")
    if not os.path.exists(file_path):
        return {}
        
    with open(file_path, "r", encoding="utf-8") as f:
        all_stocks = json.load(f)
        
    keys = list(all_stocks.keys())
    # Base pool: Fixed pool of stocks
    cached_keys = ['005930', '000660', '035420', '035720', '005380', '100090']
    random.seed(42)
    pool_keys = cached_keys + random.sample([k for k in keys if k not in cached_keys], min(40, len(keys) - len(cached_keys)))
    
    passed_stocks = {}
    
    def evaluate_ticker(ticker):
        try:
            chart_res = get_v2_chart_data(ticker, db)
            cdata = chart_res.get("chart_data", [])
            if not cdata: return None, 0, []
            
            latest = cdata[-1]
            c_close = latest.get("close", 0)
            
            
            score = 0
            passes = []
            
            # 1. Fundamental (MVP: Large cap / liquid simulated by being in pool_keys)
            score += 1
            passes.append("fundamental")
            
            # 2. Market Structure (VWAP)
            if c_close > latest.get("avwap", 0):
                score += 1
                passes.append("vwap")
                
            # 3. Market Structure (POC)
            poc = chart_res.get("poc_price", 0)
            if poc > 0 and (c_close > poc or abs(c_close - poc)/poc <= 0.02):
                score += 1
                passes.append("poc")
                
            # 4. Momentum (EMA)
            if latest.get("ema_20", 0) > latest.get("ema_50", 0):
                score += 1
                passes.append("ema_cross")
                
            # 5. Momentum (MACD)
            if latest.get("macd_hist", 0) > 0:
                score += 1
                passes.append("macd")
                
            # 6. Pattern & Risk (Chandelier)
            chand = latest.get("chandelier_exit", 0)
            if chand > 0 and c_close > chand:
                score += 1
                passes.append("chandelier")
                
            if score >= 4:
                return ticker, score, passes
            return None, 0, []
        except Exception as e:
            return None, 0, []

    for t in pool_keys:
        t_ret, score, passes = evaluate_ticker(t)
        if t_ret:
            stock_info = {"name": all_stocks[t_ret], "score": score, "passes": passes}
            passed_stocks[t_ret] = stock_info
                
    # Sort by score descending
    sorted_stocks = dict(sorted(passed_stocks.items(), key=lambda item: item[1]['score'], reverse=True))
    return sorted_stocks

@app.get("/api/v4/broker/balance")
def get_broker_balance():
    return broker_kis.get_account_balance()

@app.post("/api/v4/broker/order")
def place_order(req: OrderRequest):
    return broker_kis.place_order(req.ticker, req.price, req.quantity, req.order_type)

@app.post("/api/v4/alerts")
def register_alert(req: AlertRequest, db: Session = Depends(get_db)):
    import datetime
    new_alert = models.PriceAlert(
        ticker=req.ticker,
        target_price=req.target_price,
        condition=req.condition,
        message=req.message,
        is_active=1,
        created_at=datetime.date.today()
    )
    db.add(new_alert)
    db.commit()
    return {"success": True, "msg": f"{req.ticker} 알람이 성공적으로 등록되었습니다."}

import asyncio
from notifier import notifier

async def price_monitor_loop():
    while True:
        try:
            # 1분마다 가격 확인
            await asyncio.sleep(60)
            db = next(get_db())
            active_alerts = db.query(models.PriceAlert).filter(models.PriceAlert.is_active == 1).all()
            
            if not active_alerts:
                continue
                
            # 종목별 현재가 조회 (V4 데이터 등) 
            # (간단히 하기 위해 API를 Mock 하거나 Yahoo Finance 등을 활용)
            import yfinance as yf
            
            tickers_to_check = list(set([a.ticker for a in active_alerts]))
            prices = {}
            for t in tickers_to_check:
                try:
                    df = yf.download(f"{t}.KS", period="1d", progress=False)
                    if not df.empty:
                        prices[t] = float(df['Close'].iloc[-1])
                except Exception:
                    pass
                    
            for alert in active_alerts:
                current_price = prices.get(alert.ticker)
                if current_price:
                    triggered = False
                    if alert.condition == "above" and current_price >= alert.target_price:
                        triggered = True
                    elif alert.condition == "below" and current_price <= alert.target_price:
                        triggered = True
                        
                    if triggered:
                        # 텔레그램 메시지 발송
                        msg = f"🔔 <b>[알림] {alert.ticker}</b>\n현재가: ₩{int(current_price):,}\n설정가: ₩{int(alert.target_price):,}\n\n👉 {alert.message}"
                        success = notifier.send_telegram_message(msg)
                        
                        if success:
                            alert.is_active = 0
                            db.commit()
                            
        except Exception as e:
            print(f"Monitor error: {e}")

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(price_monitor_loop())


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "Welcome to HybridQuant API"}

@app.post("/api/v2/screener/monster-stock")
def get_monster_stocks(db: Session = Depends(get_db)):
    # 1. Get fundamental data
    fundamentals = db.query(models.FundamentalData).all()
    result = []
    
    for f in fundamentals:
        # Check if latest close > 200 EMA
        latest_ohlcv = db.query(models.DailyOHLCV).filter(
            models.DailyOHLCV.ticker == f.ticker
        ).order_by(models.DailyOHLCV.date.desc()).first()
        
        is_above_200ema = False
        if latest_ohlcv and latest_ohlcv.ema_200 and latest_ohlcv.close > latest_ohlcv.ema_200:
            is_above_200ema = True
            
        result.append({
            "ticker": f.ticker,
            "f_score": f.f_score,
            "z_score": f.z_score,
            "fcf_yield": f.fcf_yield,
            "is_above_200ema": is_above_200ema
        })
        
    return result

@app.get("/api/v2/chart/signals/{ticker}")
def get_v2_chart_data(ticker: str, db: Session = Depends(get_db)):
    import pandas as pd
    import pandas_ta as ta
    import FinanceDataReader as fdr
    from datetime import datetime, timedelta

    # Try to get from DB first
    ohlcv_data = db.query(models.DailyOHLCV).filter(
        models.DailyOHLCV.ticker == ticker
    ).order_by(models.DailyOHLCV.date.asc()).all()
    
    df = pd.DataFrame()
    if ohlcv_data:
        df = pd.DataFrame([{
            'Date': row.date, 'Open': row.open, 'High': row.high, 'Low': row.low, 'Close': row.close, 'Volume': row.volume
        } for row in ohlcv_data])
        df.set_index('Date', inplace=True)
    else:
        # Fetch dynamically if not in DB
        end_date = datetime.today()
        start_date = end_date - timedelta(days=365)
        try:
            df = fdr.DataReader(ticker, start_date.strftime('%Y-%m-%d'), end_date.strftime('%Y-%m-%d'))
        except Exception:
            df = pd.DataFrame()
            
        # Fallback to yfinance if fdr returned empty (common on foreign cloud servers like Render due to Naver IP blocking)
        if df.empty:
            try:
                import yfinance as yf
                # Try KOSPI (.KS)
                df = yf.Ticker(f"{ticker}.KS").history(start=start_date.strftime('%Y-%m-%d'), end=end_date.strftime('%Y-%m-%d'))
                if df.empty or len(df) < 5:
                    # Try KOSDAQ (.KQ)
                    df = yf.Ticker(f"{ticker}.KQ").history(start=start_date.strftime('%Y-%m-%d'), end=end_date.strftime('%Y-%m-%d'))
                
                if not df.empty:
                    df.columns = [c.capitalize() for c in df.columns]
            except Exception as e:
                print(f"yfinance fallback failed for {ticker}: {e}")
                df = pd.DataFrame()

        if df.empty:
            return {"chart_data": [], "markers": [], "poc_price": None}

    # Calculate Indicators
    df.ta.ema(length=20, append=True)
    df.ta.ema(length=50, append=True)
    df.ta.ema(length=60, append=True)
    df.ta.ema(length=120, append=True)
    df.ta.ema(length=200, append=True)
    df.ta.macd(append=True)
    df.ta.rsi(length=14, append=True)
    df.ta.atr(length=14, append=True)
    df.ta.cci(length=20, append=True)
    
    # AVWAP
    df['Typical_Price'] = (df['High'] + df['Low'] + df['Close']) / 3
    df['TPV'] = df['Typical_Price'] * df['Volume']
    
    asset = db.query(models.DailyAssets).filter(models.DailyAssets.ticker == ticker).first()
    anchor_idx = None
    if asset and hasattr(asset, 'avwap_anchor_date') and asset.avwap_anchor_date:
        ed = pd.to_datetime(asset.avwap_anchor_date)
        past_dates = df.index[df.index <= ed]
        if not past_dates.empty:
            anchor_idx = past_dates[-1]
            
    if anchor_idx is None:
        last_60 = df.tail(60)
        if not last_60.empty:
            anchor_idx = last_60['Volume'].idxmax()
        else:
            anchor_idx = df['Volume'].idxmax()

    mask = df.index >= anchor_idx
    df['Cum_TPV'] = df.loc[mask, 'TPV'].cumsum()
    df['Cum_Vol'] = df.loc[mask, 'Volume'].cumsum()
    df['AVWAP'] = df['Cum_TPV'] / df['Cum_Vol']
    df['AVWAP'] = df['AVWAP'].ffill().fillna(0)

    # Chandelier Exit (Long) = Highest High(22) - ATR(22) * 3
    df['Highest_High_22'] = df['High'].rolling(22).max()
    df.ta.atr(length=22, append=True)
    atr22_col = [c for c in df.columns if 'ATR' in c and '22' in c]
    if atr22_col:
        df['Chandelier_Exit'] = df['Highest_High_22'] - df[atr22_col[0]] * 3
    else:
        df['Chandelier_Exit'] = None

    # Point of Control (POC)
    poc_price = None
    if not df.empty:
        # Simplistic POC: Price with max volume (using closing price chunks)
        price_bins = pd.cut(df['Close'], bins=20)
        vol_by_price = df.groupby(price_bins)['Volume'].sum()
        max_vol_bin = vol_by_price.idxmax()
        poc_price = max_vol_bin.mid if pd.notna(max_vol_bin) else None

    # Replace NaNs
    df = df.fillna(0)

    # Format output
    chart_data = []
    for idx, row in df.iterrows():
        # Handle string or datetime index - LightweightCharts requires YYYY-MM-DD
        date_str = idx.strftime('%Y-%m-%d') if hasattr(idx, 'strftime') else str(idx).split(' ')[0]
        if 'T' in date_str:
            date_str = date_str.split('T')[0]
            
        
        # MACD columns are usually MACD_12_26_9, MACDh_12_26_9 (histogram), MACDs_12_26_9 (signal)
        macd_col = [c for c in df.columns if c.startswith('MACD_')][0] if any(c.startswith('MACD_') for c in df.columns) else None
        macds_col = [c for c in df.columns if c.startswith('MACDs_')][0] if any(c.startswith('MACDs_') for c in df.columns) else None
        macdh_col = [c for c in df.columns if c.startswith('MACDh_')][0] if any(c.startswith('MACDh_') for c in df.columns) else None
        
        # CCI column is usually CCI_20_0.015
        cci_col = [c for c in df.columns if c.startswith('CCI_')][0] if any(c.startswith('CCI_') for c in df.columns) else None

        chart_data.append({
            "time": date_str,
            "open": row['Open'],
            "high": row['High'],
            "low": row['Low'],
            "close": row['Close'],
            "volume": row['Volume'],
            "ema_20": row.get('EMA_20', 0),
            "ema_50": row.get('EMA_50', 0),
            "ema_60": row.get('EMA_60', 0),
            "ema_120": row.get('EMA_120', 0),
            "ema_200": row.get('EMA_200', 0),
            "avwap": row.get('AVWAP', 0),
            "rsi_14": row.get('RSI_14', 0),
            "macd": row[macd_col] if macd_col else 0,
            "macd_signal": row[macds_col] if macds_col else 0,
            "macd_hist": row[macdh_col] if macdh_col else 0,
            "cci_20": row[cci_col] if cci_col else 0,
            "chandelier_exit": row.get('Chandelier_Exit', 0)
        })

    signals = db.query(models.SignalHistory).filter(models.SignalHistory.ticker == ticker).all()
    markers = []
    for sig in signals:
        markers.append({
            "time": sig.signal_date.isoformat(),
            "position": "belowBar",
            "color": "#22c55e",
            "shape": "arrowUp",
            "text": f"BUY ({sig.pattern_type})",
            "size": 1
        })

    # Generate dynamic SELL markers (Chandelier Exit Stop Loss Hit)
    prev_close = None
    prev_ce = None
    for row in chart_data:
        close = row['close']
        ce = row['chandelier_exit']
        
        if prev_close is not None and prev_ce is not None and ce > 0:
            if prev_close >= prev_ce and close < ce:
                markers.append({
                    "time": row['time'],
                    "position": "aboveBar",
                    "color": "#ef4444",
                    "shape": "arrowDown",
                    "text": "SELL (Stop Loss)",
                    "size": 1
                })
        prev_close = close
        prev_ce = ce

    return {
        "chart_data": chart_data,
        "markers": markers,
        "poc_price": float(poc_price) if poc_price else None
    }

@app.get("/api/v2/market-status")
def get_market_status(db: Session = Depends(get_db)):
    regime = db.query(models.MarketRegime).order_by(models.MarketRegime.date.desc()).first()
    if not regime:
        return {"is_bullish": False, "index": "KS11", "message": "No data"}
    
    return {
        "index_symbol": regime.index_symbol,
        "date": regime.date.isoformat(),
        "close": regime.close,
        "sma_20": regime.sma_20,
        "is_bullish": bool(regime.is_bullish)
    }

@app.get("/api/v3/system-status")
def get_v3_system_status(db: Session = Depends(get_db)):
    health = db.query(models.MarketHealth).order_by(models.MarketHealth.date.desc()).first()
    if not health:
        return {"is_bullish": False, "index": "KS11", "message": "No data", "risk_pct": 0.0025, "regime": "Recovery"}
    
    regime = "Recovery"
    risk_pct = 0.0025
    
    is_above_20ema = health.close > health.sma_20 if health.sma_20 else False
    ad_ratio = health.ad_ratio if health.ad_ratio else 0
    
    if not health.is_bullish:
        regime = "Bear"
        risk_pct = 0.0
    elif is_above_20ema and ad_ratio >= 0.55:
        regime = "Broad Bull"
        risk_pct = 0.01
    elif is_above_20ema and ad_ratio >= 0.45:
        regime = "Narrow Bull"
        risk_pct = 0.005

    return {
        "index_symbol": health.index_symbol,
        "date": health.date.isoformat(),
        "close": health.close,
        "sma_20": health.sma_20,
        "sma_50": health.sma_50,
        "sma50_slope": health.sma50_slope,
        "ad_ratio": health.ad_ratio,
        "is_bullish": bool(health.is_bullish),
        "risk_pct": risk_pct,
        "regime": regime
    }

@app.get("/api/v3/dashboard/execution-list")
def get_v3_execution_list(db: Session = Depends(get_db)):
    # Return today's (or latest) signals
    # For MVP, we just return the latest 20 signals globally or join with assets
    signals = db.query(models.SignalHistory).order_by(models.SignalHistory.signal_date.desc()).limit(20).all()
    
    result = []
    for sig in signals:
        asset = db.query(models.DailyAssets).filter(models.DailyAssets.ticker == sig.ticker).first()
        
        result.append({
            "ticker": sig.ticker,
            "signal_date": sig.signal_date.isoformat(),
            "pattern_type": sig.pattern_type,
            "entry_price": sig.entry_price,
            "stop_loss_price": sig.stop_loss_price,
            "target_1r": sig.target_1r,
            "calculated_shares": sig.calculated_shares,
            "avg_vol_20d": asset.avg_vol_20d if asset else 0
        })
    return result

@app.get("/api/v1/screen")
def get_screen_data(db: Session = Depends(get_db)):
    data = db.query(models.FundamentalData).all()
    if not data:
        return []
    
    return [
        {
            "ticker": item.ticker,
            "f_score": item.f_score,
            "z_score": item.z_score,
            "fcf_yield": item.fcf_yield
        }
        for item in data
    ]

@app.get("/api/v1/chart/{ticker}")
def get_chart_data(ticker: str, timeframe: str = "1D", db: Session = Depends(get_db)):
    # Mock data for chart testing
    return [
        {"time": "2023-10-01", "open": 150.0, "high": 155.0, "low": 149.0, "close": 154.0, "volume": 10000},
        {"time": "2023-10-02", "open": 154.0, "high": 158.0, "low": 153.0, "close": 157.0, "volume": 12000},
        {"time": "2023-10-03", "open": 157.0, "high": 159.0, "low": 156.0, "close": 158.0, "volume": 11000},
        {"time": "2023-10-04", "open": 158.0, "high": 160.0, "low": 155.0, "close": 156.0, "volume": 15000},
        {"time": "2023-10-05", "open": 156.0, "high": 158.0, "low": 154.0, "close": 157.0, "volume": 13000},
    ]

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
