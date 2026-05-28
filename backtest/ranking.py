import pandas as pd
import numpy as np

def calculate_distance_penalty(dist_ratio):
    """
    dist_ratio: close / ema_20
    """
    # > 15% deviation is hard cut (Score -1000)
    # 10~15% is -25
    # 5~10% is -10
    # <= 5% is 0
    
    dist_pct = (dist_ratio - 1.0) * 100
    
    conditions = [
        dist_pct > 15,
        dist_pct > 10,
        dist_pct > 5
    ]
    choices = [-1000, -25, -10]
    return np.select(conditions, choices, default=0)

def rank_candidates(df_daily):
    """
    df_daily: Filtered candidates for a single day.
    Returns df sorted by final score.
    """
    if df_daily.empty:
        return df_daily
        
    # We need at least 2 stocks to calculate meaningful percentiles, otherwise just give max score
    if len(df_daily) == 1:
        df_daily['score'] = 100 - calculate_distance_penalty(df_daily['dist_ema20'])
        return df_daily
        
    # Calculate Percentiles (0 to 100)
    p_rs20 = df_daily['rs_20'].rank(pct=True) * 100
    p_rs5 = df_daily['rs_5'].rank(pct=True) * 100
    p_vol = df_daily['vol_growth'].rank(pct=True) * 100
    
    dist_penalty = calculate_distance_penalty(df_daily['dist_ema20'])
    
    # Score = (P_RS20 * 0.5 + P_RS5 * 0.3 + P_VolGrowth * 0.2)
    # The final combined score is mostly driven by the soft_score (points 4, 5, 6).
    # We will add the percentile score as a decimal to break ties.
    base_percentile = (p_rs20 * 0.5) + (p_rs5 * 0.3) + (p_vol * 0.2)
    
    df_daily['score'] = (df_daily['soft_score'] * 1000) + base_percentile + dist_penalty
    
    # Remove hard cuts
    df_daily = df_daily[df_daily['score'] > -500]
    
    return df_daily.sort_values(by='score', ascending=False)
