import os
import pandas as pd
import FinanceDataReader as fdr
from sqlalchemy.orm import Session
from datetime import datetime, timedelta

import sys
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from database import SessionLocal
from models import MarketHealth

def update_market_regime():
    db: Session = SessionLocal()
    
    try:
        end_date = datetime.today()
        start_date = end_date - timedelta(days=150)
        
        df = fdr.DataReader('KS11', start_date.strftime('%Y-%m-%d'), end_date.strftime('%Y-%m-%d'))
        
        if df.empty:
            print("Failed to fetch KOSPI data.")
            return
            
        df['SMA_20'] = df['Close'].rolling(window=20).mean()
        df['SMA_50'] = df['Close'].rolling(window=50).mean()
        
        latest_data = df.iloc[-1]
        prev_data = df.iloc[-2]
        latest_date = df.index[-1].date()
        
        close_price = latest_data['Close']
        sma_20 = latest_data['SMA_20']
        sma_50 = latest_data['SMA_50']
        sma50_slope = sma_50 - prev_data['SMA_50']
        
        is_bullish = 1 if (close_price > sma_20 and sma50_slope > 0) else 0
        
        # Mock AD Ratio (Advance/Decline Ratio)
        mock_ad_ratio = 0.55 if is_bullish else 0.45
        
        existing = db.query(MarketHealth).filter(MarketHealth.date == latest_date).first()
        if existing:
            existing.close = close_price
            existing.sma_20 = sma_20
            existing.sma_50 = sma_50
            existing.sma50_slope = sma50_slope
            existing.ad_ratio = mock_ad_ratio
            existing.is_bullish = is_bullish
        else:
            new_regime = MarketHealth(
                date=latest_date,
                index_symbol="KS11",
                close=close_price,
                sma_20=sma_20,
                sma_50=sma_50,
                sma50_slope=sma50_slope,
                ad_ratio=mock_ad_ratio,
                is_bullish=is_bullish
            )
            db.add(new_regime)
        
        db.commit()
        print("Market Health updated successfully.")
        
    except Exception as e:
        print(f"Error updating market health: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    update_market_regime()
