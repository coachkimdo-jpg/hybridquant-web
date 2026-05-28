import os
import pandas as pd
import numpy as np

DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')
PROCESSED_DIR = os.path.join(DATA_DIR, 'processed')

def get_regime_classification():
    """
    Returns a DataFrame with a daily 'regime' column and 'risk_score'
    based on KOSPI and Market Breadth.
    """
    kospi_path = os.path.join(PROCESSED_DIR, 'kospi_processed.parquet')
    breadth_path = os.path.join(DATA_DIR, 'market_breadth.parquet')
    
    if not os.path.exists(kospi_path) or not os.path.exists(breadth_path):
        raise FileNotFoundError("Data not processed yet. Run data_loader and indicators first.")
        
    kospi = pd.read_parquet(kospi_path)
    breadth = pd.read_parquet(breadth_path)
    
    # Align dates
    df = kospi.join(breadth, how='inner')
    
    # 1. Calculate Risk Score
    # 1. KOSPI Close < 20EMA
    c1 = (df['close'] < df['ema_20']).astype(int)
    # 2. 20EMA slope < 0
    c2 = (df['ema_20_slope'] < 0).astype(int)
    # 3. 50EMA slope < 0
    c3 = (df['ema_50_slope'] < 0).astype(int)
    # 4. AD Ratio < 45%
    c4 = (df['ad_ratio_10d'] < 0.45).astype(int)
    # 5. AD Ratio < 40% (Proxy for new lows/extreme weakness)
    c5 = (df['ad_ratio_10d'] < 0.40).astype(int)
    
    df['risk_score'] = c1 + c2 + c3 + c4 + c5
    
    # Bear State Flapping prevention (Hysteresis)
    # Bear Entry: Score >= 4
    # Bear Exit: Score <= 2
    is_bear = np.zeros(len(df), dtype=bool)
    current_bear = False
    
    for i in range(len(df)):
        score = df['risk_score'].iloc[i]
        if not current_bear and score >= 4:
            current_bear = True
        elif current_bear and score <= 2:
            current_bear = False
        is_bear[i] = current_bear
        
    df['is_bear'] = is_bear
    
    # 2. Define Market 4 Regimes
    # Default is Recovery
    regime = pd.Series('Recovery', index=df.index)
    
    # Apply conditions sequentially (later overwrites earlier if multiple true, but we use logic)
    
    # condition: Broad Bull
    broad_bull = (df['close'] > df['ema_20']) & (df['ad_ratio_10d'] >= 0.55)
    regime[broad_bull] = 'Broad Bull'
    
    # condition: Narrow Bull
    narrow_bull = (df['close'] > df['ema_20']) & (df['ad_ratio_10d'] >= 0.45) & (df['ad_ratio_10d'] < 0.55)
    regime[narrow_bull] = 'Narrow Bull'
    
    # condition: Bear overrides everything
    regime[df['is_bear']] = 'Bear'
    
    # Anything else stays 'Recovery' (e.g. Close < 20EMA but not Bear, or recovering AD ratio)
    
    df['regime'] = regime
    return df[['close', 'ema_20', 'ad_ratio_10d', 'risk_score', 'regime']]

if __name__ == "__main__":
    df = get_regime_classification()
    print("Regime classification sample (Last 10 days):")
    print(df.tail(10))
    print("\\nRegime Distribution:")
    print(df['regime'].value_counts(normalize=True) * 100)
