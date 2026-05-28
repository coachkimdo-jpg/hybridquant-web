import pandas as pd
import numpy as np

def score_and_filter_candidates(df_daily):
    """
    Apply Soft Scoring Engine (6-point scale).
    Returns candidates that score >= 4.
    """
    if df_daily.empty:
        return df_daily
        
    required = ['close', 'ema_200', 'ema_20', 'ema_50', 'avwap_60d', 'chandelier_exit', 'macd_hist', 'rs_20']
    if not all(col in df_daily.columns for col in required):
        return pd.DataFrame()
        
    # Hard Filter
    # In MVP, basic liquidity is already assumed by our pool. We add EMA200 filter for trend safety
    df_filtered = df_daily[df_daily['close'] > df_daily['ema_200']].copy()
    if df_filtered.empty:
        return df_filtered
        
    # Soft Scoring
    # 1. Fundamental (Assume 1 for MVP large caps)
    score = pd.Series(1, index=df_filtered.index)
    
    # 2. VWAP
    score += (df_filtered['close'] > df_filtered['avwap_60d']).astype(int)
    
    # 3. POC (Simulated as being near or above 60-day high volume node. Since we don't have POC in backtest data easily, we proxy it with volume growth and recent price action)
    # We will give +1 if it has strong volume recently (vol_growth > 1) as a proxy for overcoming supply
    score += (df_filtered['vol_growth'] > 1.0).astype(int)
    
    # 4. Momentum (EMA)
    score += (df_filtered['ema_20'] > df_filtered['ema_50']).astype(int)
    
    # 5. Momentum (MACD)
    score += (df_filtered['macd_hist'] > 0).astype(int)
    
    # 6. Risk (Chandelier)
    score += (df_filtered['close'] > df_filtered['chandelier_exit']).astype(int)
    
    df_filtered['soft_score'] = score
    
    # Filter >= 4 points
    return df_filtered[df_filtered['soft_score'] >= 4].copy()

def filter_trend_x(df_daily):
    return score_and_filter_candidates(df_daily)

def filter_turn_x(df_daily):
    # Recovery regime might allow below 200 EMA. 
    df_filtered = df_daily.copy()
    
    score = pd.Series(1, index=df_filtered.index)
    score += (df_filtered['close'] > df_filtered['avwap_60d']).astype(int)
    score += (df_filtered['vol_growth'] > 1.2).astype(int) # Stronger volume needed for turn
    score += (df_filtered['ema_20'] > df_filtered['ema_50']).astype(int)
    score += (df_filtered['macd_hist'] > 0).astype(int)
    score += (df_filtered['close'] > df_filtered['chandelier_exit']).astype(int)
    
    df_filtered['soft_score'] = score
    return df_filtered[df_filtered['soft_score'] >= 4].copy()
