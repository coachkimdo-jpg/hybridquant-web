import os
import json
import pandas as pd
import FinanceDataReader as fdr
from concurrent.futures import ThreadPoolExecutor, as_completed
from tqdm import tqdm
import warnings
warnings.filterwarnings('ignore')

DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')
TICKERS_DIR = os.path.join(DATA_DIR, 'tickers')
BACKEND_TICKERS_FILE = os.path.join(os.path.dirname(__file__), '..', 'backend', 'tickers.json')

START_DATE = '2019-01-01'

def setup_dirs():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(TICKERS_DIR, exist_ok=True)

def fetch_and_save_ticker(ticker, name):
    filepath = os.path.join(TICKERS_DIR, f"{ticker}.parquet")
    if os.path.exists(filepath):
        return ticker, True  # Already cached
        
    try:
        df = fdr.DataReader(ticker, START_DATE)
        if df.empty:
            return ticker, False
        df.columns = [c.lower() for c in df.columns]
        df.to_parquet(filepath)
        return ticker, True
    except Exception as e:
        return ticker, False

def load_universe():
    with open(BACKEND_TICKERS_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def download_all_tickers():
    tickers_dict = load_universe()
    print(f"Downloading historical data for {len(tickers_dict)} tickers since {START_DATE}...")
    
    success_count = 0
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(fetch_and_save_ticker, t, name): t for t, name in tickers_dict.items()}
        for future in tqdm(as_completed(futures), total=len(futures), desc="Downloading Tickers"):
            t, success = future.result()
            if success:
                success_count += 1
                
    print(f"Successfully downloaded {success_count}/{len(tickers_dict)} tickers.")

def download_kospi():
    print("Downloading KOSPI Index (KS11)...")
    filepath = os.path.join(DATA_DIR, 'kospi.parquet')
    if not os.path.exists(filepath):
        df = fdr.DataReader('KS11', START_DATE)
        df.columns = [c.lower() for c in df.columns]
        df.to_parquet(filepath)
    print("KOSPI download complete.")

def build_market_breadth():
    """
    Calculate AD Line / AD Ratio based on downloaded tickers.
    Since we don't have the entire 900 KOSPI stocks, calculating breadth 
    based on our universe of ~300 major stocks serves as a robust proxy.
    """
    print("Calculating Market Breadth (AD Ratio)...")
    breadth_file = os.path.join(DATA_DIR, 'market_breadth.parquet')
    if os.path.exists(breadth_file):
        print("Market breadth already calculated.")
        return
        
    all_dates = pd.Series(dtype='datetime64[ns]')
    dfs = []
    
    for file in tqdm(os.listdir(TICKERS_DIR), desc="Loading Tickers for Breadth"):
        if not file.endswith('.parquet'): continue
        df = pd.read_parquet(os.path.join(TICKERS_DIR, file))
        if 'close' not in df.columns or df.empty: continue
        
        # Calculate daily change
        df['change'] = df['close'].pct_change()
        df['advancing'] = (df['change'] > 0).astype(int)
        df['declining'] = (df['change'] < 0).astype(int)
        
        # Keep only necessary columns for memory efficiency
        dfs.append(df[['advancing', 'declining']])
        
    print("Aggregating breadth data...")
    # Combine all and sum by date
    combined = pd.concat(dfs)
    breadth = combined.groupby(combined.index).sum()
    
    # Calculate AD Ratio = Advancing / (Advancing + Declining)
    # Using 10-day SMA of the ratio for smoother regime classification
    total_issues = breadth['advancing'] + breadth['declining']
    breadth['ad_ratio'] = breadth['advancing'] / total_issues.replace(0, 1) # Avoid div by zero
    breadth['ad_ratio_10d'] = breadth['ad_ratio'].rolling(window=10).mean()
    
    breadth.to_parquet(breadth_file)
    print("Market breadth calculation complete.")

if __name__ == "__main__":
    setup_dirs()
    download_kospi()
    download_all_tickers()
    build_market_breadth()
    print("Data loading phase complete!")
