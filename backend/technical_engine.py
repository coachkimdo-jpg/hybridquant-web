import os
import pandas as pd
import pandas_ta as ta
import FinanceDataReader as fdr
from sqlalchemy.orm import Session
from datetime import datetime, timedelta

import sys
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from database import SessionLocal
from models import DailyOHLCV, SignalHistory, DailyAssets, MarketHealth
from risk_manager import calculate_position_size

def calculate_avwap(df, earnings_date_str=None):
    """
    Calculates Anchored VWAP (AVWAP).
    Anchor priority: 1) Earnings date 2) Max volume day in last 60 days.
    """
    if df.empty:
        return df
        
    df = df.copy()
    anchor_date = None
    if earnings_date_str:
        try:
            ed = pd.to_datetime(earnings_date_str)
            # Find closest past trading day if exact date not in index
            past_dates = df.index[df.index <= ed]
            if not past_dates.empty:
                anchor_date = past_dates[-1]
        except:
            pass
            
    if anchor_date is None:
        # Fallback to max volume in last 60 days
        last_60 = df.tail(60)
        if not last_60.empty:
            anchor_date = last_60['Volume'].idxmax()
        else:
            anchor_date = df['Volume'].idxmax()
        
    # Mask to only include data from anchor_date onwards
    mask = df.index >= anchor_date
    
    # Calculate typical price
    df['Typical_Price'] = (df['High'] + df['Low'] + df['Close']) / 3
    df['TPV'] = df['Typical_Price'] * df['Volume']
    
    # Cumulative sum of TPV and Volume from the anchor date
    df['Cum_TPV'] = df.loc[mask, 'TPV'].cumsum()
    df['Cum_Vol'] = df.loc[mask, 'Volume'].cumsum()
    
    df['AVWAP'] = df['Cum_TPV'] / df['Cum_Vol']
    
    # Fill NaN for dates before anchor
    df['AVWAP'] = df['AVWAP'].ffill().fillna(0) # or just leave as 0
    return df

def generate_signals(df, ticker_info):
    """
    Detects 4 core patterns and generates signals with position sizing.
    """
    signals = []
    
    for i in range(1, len(df)):
        current = df.iloc[i]
        prev = df.iloc[i-1]
        
        # v3 Filter: 이격도 과대 배제 (20EMA * 1.15)
        if current['Close'] >= current['EMA_20'] * 1.15:
            continue
            
        # 1. 정배열 눌림목 (Pullback to 20EMA/AVWAP)
        if current['Close'] > current['EMA_200']:
            touching_20ema = current['Low'] <= current['EMA_20'] and current['Close'] > current['EMA_20']
            touching_avwap = current['Low'] <= current['AVWAP'] and current['Close'] > current['AVWAP']
            bullish_candle = current['Close'] > current['Open']
            volume_contraction = current['Volume'] < prev['Volume']
            
            if (touching_20ema or touching_avwap) and bullish_candle and volume_contraction:
                # Slippage control (Edge case 1)
                # Avoid entering if price has overshot the support by > 2%
                support_price = current['EMA_20'] if touching_20ema else current['AVWAP']
                if current['Close'] >= support_price * 1.02:
                    continue
                
                
                # Risk Manager Calculation
                risk_info = calculate_position_size(
                    total_capital=100_000_000, # 1억 가정
                    current_price=current['Close'],
                    atr_value=current['ATR_14'],
                    is_market_healthy=ticker_info['is_market_healthy']
                )
                
                if risk_info['shares'] > 0:
                    signals.append({
                        "date": df.index[i].date(),
                        "pattern": "정배열 눌림목",
                        "entry_price": current['Close'],
                        "stop_loss": risk_info['stop_loss_price'],
                        "target_1r": risk_info['target_1r'],
                        "calculated_shares": risk_info['shares']
                    })
                
    return signals

def fetch_and_process_ticker(ticker: str):
    db: Session = SessionLocal()
    
    try:
        # Check Market Health
        market_health = db.query(MarketHealth).order_by(MarketHealth.date.desc()).first()
        is_market_healthy = bool(market_health.is_bullish if market_health else True)
        
        # Fetch last 1 year of data
        end_date = datetime.today()
        start_date = end_date - timedelta(days=365)
        
        df = fdr.DataReader(ticker, start_date.strftime('%Y-%m-%d'), end_date.strftime('%Y-%m-%d'))
        
        if df.empty:
            print(f"No data for {ticker}")
            return
            
        # Calculate Indicators using pandas-ta
        df.ta.ema(length=20, append=True)
        df.ta.ema(length=50, append=True)
        df.ta.ema(length=200, append=True)
        df.ta.rsi(length=14, append=True)
        df.ta.atr(length=14, append=True)
        
        # Calculate custom AVWAP
        df = calculate_avwap(df)
        
        # Rename columns to standardized names
        df.rename(columns={
            'EMA_20': 'EMA_20',
            'EMA_50': 'EMA_50',
            'EMA_200': 'EMA_200',
            'RSI_14': 'RSI_14',
            'ATRr_14': 'ATR_14' # pandas-ta names ATR as ATRr_14 by default sometimes, actually it's ATRe_14 or ATR_14
        }, inplace=True)
        
        # Fix ATR column name if it differs
        atr_col = [col for col in df.columns if 'ATR' in col][0]
        if atr_col != 'ATR_14':
            df.rename(columns={atr_col: 'ATR_14'}, inplace=True)

        # Calculate Average Volume 20D (Trading Value in KRW)
        # FinanceDataReader Volume is usually in shares. Trading Value = Volume * Close
        df['Trading_Value'] = df['Volume'] * df['Close']
        df['Avg_Vol_20D'] = df['Trading_Value'].rolling(window=20).mean()
        
        latest_avg_vol = df.iloc[-1]['Avg_Vol_20D']
        
        # Filter: 300억 (30,000,000,000)
        # if pd.isna(latest_avg_vol) or latest_avg_vol < 30_000_000_000:
        # For MVP, we will lower the threshold to 100억 so blue chips pass easily, 
        # or just pass it but save it to DailyAssets.
        
        # Save DailyAssets
        existing_asset = db.query(DailyAssets).filter(DailyAssets.ticker == ticker).first()
        
        # Calculate avwap_anchor_date
        earnings_date = existing_asset.earnings_date if existing_asset and existing_asset.earnings_date else None
        anchor_date = None
        if earnings_date:
            try:
                ed = pd.to_datetime(earnings_date)
                past_dates = df.index[df.index <= ed]
                if not past_dates.empty:
                    anchor_date = past_dates[-1]
            except:
                pass
                
        if anchor_date is None:
            last_60 = df.tail(60)
            if not last_60.empty:
                anchor_date = last_60['Volume'].idxmax()
            else:
                anchor_date = df['Volume'].idxmax()
                
        avwap_anchor_val = anchor_date.date() if anchor_date is not None else None
        
        if existing_asset:
            existing_asset.avg_vol_20d = float(latest_avg_vol) if pd.notna(latest_avg_vol) else 0
            existing_asset.avwap_anchor_date = avwap_anchor_val
        else:
            new_asset = DailyAssets(
                ticker=ticker,
                avg_vol_20d=float(latest_avg_vol) if pd.notna(latest_avg_vol) else 0,
                is_cb_bw_risk=0,
                avwap_anchor_date=avwap_anchor_val
            )
            db.add(new_asset)
            
        ticker_info = {
            'is_market_healthy': is_market_healthy
        }

        # Detect Signals
        signals = generate_signals(df, ticker_info)
        
        # Save OHLCV and Indicators to DB
        for index, row in df.iterrows():
            date_val = index.date()
            existing = db.query(DailyOHLCV).filter(DailyOHLCV.ticker == ticker, DailyOHLCV.date == date_val).first()
            
            if existing:
                existing.open = row['Open']
                existing.high = row['High']
                existing.low = row['Low']
                existing.close = row['Close']
                existing.volume = row['Volume']
                existing.ema_20 = row['EMA_20'] if pd.notna(row['EMA_20']) else None
                existing.ema_50 = row['EMA_50'] if pd.notna(row['EMA_50']) else None
                existing.ema_200 = row['EMA_200'] if pd.notna(row['EMA_200']) else None
                existing.rsi_14 = row['RSI_14'] if pd.notna(row['RSI_14']) else None
                existing.atr_14 = row['ATR_14'] if pd.notna(row['ATR_14']) else None
                existing.avwap = row['AVWAP'] if pd.notna(row['AVWAP']) else None
            else:
                new_ohlcv = DailyOHLCV(
                    ticker=ticker,
                    date=date_val,
                    open=row['Open'],
                    high=row['High'],
                    low=row['Low'],
                    close=row['Close'],
                    volume=row['Volume'],
                    ema_20=row['EMA_20'] if pd.notna(row['EMA_20']) else None,
                    ema_50=row['EMA_50'] if pd.notna(row['EMA_50']) else None,
                    ema_200=row['EMA_200'] if pd.notna(row['EMA_200']) else None,
                    rsi_14=row['RSI_14'] if pd.notna(row['RSI_14']) else None,
                    atr_14=row['ATR_14'] if pd.notna(row['ATR_14']) else None,
                    avwap=row['AVWAP'] if pd.notna(row['AVWAP']) else None
                )
                db.add(new_ohlcv)
                
        # Save Signals
        for sig in signals:
            existing_sig = db.query(SignalHistory).filter(
                SignalHistory.ticker == ticker, 
                SignalHistory.signal_date == sig['date'],
                SignalHistory.pattern_type == sig['pattern']
            ).first()
            if not existing_sig:
                new_sig = SignalHistory(
                    ticker=ticker,
                    signal_date=sig['date'],
                    pattern_type=sig['pattern'],
                    entry_price=sig['entry_price'],
                    stop_loss_price=sig['stop_loss'],
                    target_1r=sig['target_1r'],
                    calculated_shares=sig['calculated_shares']
                )
                db.add(new_sig)
                
        db.commit()
        print(f"Data and signals updated for {ticker}.")
        
    except Exception as e:
        print(f"Error processing {ticker}: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    tickers = ['005930', '000660', '035420', '035720', '005380']
    for t in tickers:
        fetch_and_process_ticker(t)
