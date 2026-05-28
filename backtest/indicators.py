import os
import pandas as pd
import numpy as np
from tqdm import tqdm

DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')
TICKERS_DIR = os.path.join(DATA_DIR, 'tickers')
PROCESSED_DIR = os.path.join(DATA_DIR, 'processed')

def setup_dirs():
    os.makedirs(PROCESSED_DIR, exist_ok=True)

def calc_atr(df, period=14):
    high_low = df['high'] - df['low']
    high_close = np.abs(df['high'] - df['close'].shift())
    low_close = np.abs(df['low'] - df['close'].shift())
    ranges = pd.concat([high_low, high_close, low_close], axis=1)
    true_range = np.max(ranges, axis=1)
    return true_range.rolling(period).mean()

def calc_chandelier_exit(df, period=22, multiplier=3):
    atr = calc_atr(df, period)
    highest_high = df['high'].rolling(period).max()
    chand_exit = highest_high - (atr * multiplier)
    # Forward fill or logic to make sure the stop loss only goes up can be applied in execution layer
    return chand_exit

def calc_macd(df, fast=12, slow=26, signal=9):
    exp1 = df['close'].ewm(span=fast, adjust=False).mean()
    exp2 = df['close'].ewm(span=slow, adjust=False).mean()
    macd = exp1 - exp2
    sig = macd.ewm(span=signal, adjust=False).mean()
    hist = macd - sig
    return macd, sig, hist

def process_kospi():
    kospi_path = os.path.join(DATA_DIR, 'kospi.parquet')
    if not os.path.exists(kospi_path):
        print("KOSPI data not found!")
        return None
        
    df = pd.read_parquet(kospi_path)
    df['ema_20'] = df['close'].ewm(span=20, adjust=False).mean()
    df['ema_50'] = df['close'].ewm(span=50, adjust=False).mean()
    
    # Calculate slopes (momentum)
    df['ema_20_slope'] = df['ema_20'].diff()
    df['ema_50_slope'] = df['ema_50'].diff()
    
    # KOSPI returns for RS calculation
    df['kospi_ret'] = df['close'].pct_change()
    
    out_path = os.path.join(PROCESSED_DIR, 'kospi_processed.parquet')
    df.to_parquet(out_path)
    print("KOSPI indicators processed.")
    return df

def process_tickers(kospi_df):
    if kospi_df is None: return
    
    print("Processing individual tickers...")
    files = [f for f in os.listdir(TICKERS_DIR) if f.endswith('.parquet')]
    
    for file in tqdm(files, desc="Calculating Indicators"):
        filepath = os.path.join(TICKERS_DIR, file)
        df = pd.read_parquet(filepath)
        if df.empty or len(df) < 200:
            continue
            
        # Basic EMAs
        df['ema_20'] = df['close'].ewm(span=20, adjust=False).mean()
        df['ema_50'] = df['close'].ewm(span=50, adjust=False).mean()
        df['ema_60'] = df['close'].ewm(span=60, adjust=False).mean()
        df['ema_120'] = df['close'].ewm(span=120, adjust=False).mean()
        df['ema_200'] = df['close'].ewm(span=200, adjust=False).mean()
        
        # ATR & Chandelier
        df['atr_14'] = calc_atr(df, 14)
        df['chandelier_exit'] = calc_chandelier_exit(df, 22, 5) # V3: Widen to 5x ATR to avoid whipsaw
        
        # MACD
        df['macd'], df['macd_signal'], df['macd_hist'] = calc_macd(df)
        
        # Volume features
        df['vol_20ma'] = df['volume'].rolling(20).mean()
        # Handle zero division
        df['vol_growth'] = df['volume'] / df['vol_20ma'].replace(0, np.nan)
        
        # AVWAP & POC (Simplified for daily backtest: assume anchored to 60-day high volume or fixed periods)
        # For true backtesting, AVWAP should be anchored dynamically, here we use a rolling 60-day VWAP as a proxy
        rolling_vol = df['volume'].rolling(60).sum()
        rolling_vol_price = (df['close'] * df['volume']).rolling(60).sum()
        df['avwap_60d'] = rolling_vol_price / rolling_vol.replace(0, np.nan)
        
        # Relative Strength (RS) against KOSPI
        # We align with KOSPI index and calculate RS
        aligned_kospi = kospi_df['kospi_ret'].reindex(df.index).fillna(0)
        df['ticker_ret'] = df['close'].pct_change().fillna(0)
        
        # RS is often calculated as cumulative outperformance over N days
        # E.g., RS_20 = Ticker Return(20d) - KOSPI Return(20d)
        df['ret_20d'] = df['close'].pct_change(20)
        kospi_ret_20d = kospi_df['close'].pct_change(20).reindex(df.index)
        df['rs_20'] = df['ret_20d'] - kospi_ret_20d
        
        df['ret_5d'] = df['close'].pct_change(5)
        kospi_ret_5d = kospi_df['close'].pct_change(5).reindex(df.index)
        df['rs_5'] = df['ret_5d'] - kospi_ret_5d
        
        # Distance Penalty (Close to EMA20 distance)
        df['dist_ema20'] = df['close'] / df['ema_20']
        
        # Save processed
        out_path = os.path.join(PROCESSED_DIR, file)
        df.to_parquet(out_path)

if __name__ == "__main__":
    setup_dirs()
    kospi = process_kospi()
    process_tickers(kospi)
    print("Indicator processing complete!")
