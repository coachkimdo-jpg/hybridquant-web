import os
import pandas as pd
from opendartreader import OpenDartReader
import FinanceDataReader as fdr
from sqlalchemy.orm import Session
from dotenv import load_dotenv

import sys
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from database import SessionLocal
from models import FundamentalData
from datetime import datetime

load_dotenv()

DART_API_KEY = os.getenv("OPENDART_API_KEY")

if DART_API_KEY:
    dart = OpenDartReader(DART_API_KEY)
else:
    dart = None

def fetch_financial_metrics(ticker: str, year: int = 2023):
    """
    Simplified fundamental data fetcher for MVP.
    In a production system, this requires robust mapping of IFRS accounts.
    """
    if not dart:
        print("DART API Key is missing.")
        return None
        
    try:
        # 11011: 사업보고서
        fin = dart.finstate(ticker, year, '11011')
        if fin is None or fin.empty:
            return None
            
        # Helper to extract value safely
        def get_value(account_nm, column='thstrm_amount'):
            try:
                # Find partial match in account_nm to handle variations like '유동자산', 'I. 유동자산'
                match = fin[fin['account_nm'].str.contains(account_nm, na=False)]
                if not match.empty:
                    val = match[column].values[0]
                    # Handle empty strings or non-numeric
                    if isinstance(val, str):
                        return float(val.replace(',', '')) if val.strip() else 0.0
                    return float(val) if not pd.isna(val) else 0.0
                return 0.0
            except:
                return 0.0

        net_income = get_value('당기순이익')
        total_assets = get_value('자산총계')
        roa = net_income / total_assets if total_assets > 0 else 0
        cfo = get_value('영업활동현금흐름')
        
        # F-Score Components (Simplified)
        f_score = 0
        if net_income > 0: f_score += 1
        if roa > 0: f_score += 1
        if cfo > 0: f_score += 1
        if cfo > net_income: f_score += 1
        
        current_assets = get_value('유동자산')
        current_liabs = get_value('유동부채')
        current_ratio = current_assets / current_liabs if current_liabs > 0 else 0
        
        prev_current_assets = get_value('유동자산', 'frmtrm_amount')
        prev_current_liabs = get_value('유동부채', 'frmtrm_amount')
        prev_current_ratio = prev_current_assets / prev_current_liabs if prev_current_liabs > 0 else 0
        
        if current_ratio > prev_current_ratio: f_score += 1
        
        long_term_debt = get_value('비유동부채')
        prev_long_term_debt = get_value('비유동부채', 'frmtrm_amount')
        if long_term_debt < prev_long_term_debt: f_score += 1
        
        f_score = min(f_score + 3, 9) # Give base points for missing complex fields
        
        # Z-Score
        total_liabilities = get_value('부채총계')
        z_score = 0.0
        if total_assets > 0:
            working_capital = current_assets - current_liabs
            retained_earnings = get_value('이익잉여금')
            ebit = get_value('영업이익')
            equity = get_value('자본총계')
            sales = get_value('매출액')
            
            A = working_capital / total_assets
            B = retained_earnings / total_assets
            C = ebit / total_assets
            D = equity / total_liabilities if total_liabilities > 0 else 0
            E = sales / total_assets
            
            z_score = 1.2 * A + 1.4 * B + 3.3 * C + 0.6 * D + 1.0 * E
            
        # FCF Yield
        equity = get_value('자본총계')
        mock_market_cap = equity * 1.5 if total_assets > 0 else 100000000000
        fcf = cfo - get_value('유형자산') * 0.1 # Very rough capex approx
        fcf_yield = fcf / mock_market_cap if mock_market_cap > 0 else 0
        
        return {
            "f_score": f_score,
            "z_score": round(z_score, 2),
            "fcf_yield": round(fcf_yield, 4)
        }
        
    except Exception as e:
        print(f"Error processing {ticker}: {e}")
        return None

def run_screening():
    # Only pick a few tickers for MVP to avoid long wait
    # 005930 Samsung, 000660 SK Hynix, 035420 Naver, 035720 Kakao, 005380 Hyundai
    tickers = ['005930', '000660', '035420', '035720', '005380']
    
    db: Session = SessionLocal()
    
    for ticker in tickers:
        print(f"Fetching data for {ticker}...")
        metrics = fetch_financial_metrics(ticker)
        if metrics:
            print(f"Metrics for {ticker}: {metrics}")
            
            existing = db.query(FundamentalData).filter(FundamentalData.ticker == ticker).first()
            if existing:
                existing.f_score = metrics['f_score']
                existing.z_score = metrics['z_score']
                existing.fcf_yield = metrics['fcf_yield']
                existing.date = datetime.today().date()
            else:
                new_data = FundamentalData(
                    ticker=ticker,
                    date=datetime.today().date(),
                    f_score=metrics['f_score'],
                    z_score=metrics['z_score'],
                    fcf_yield=metrics['fcf_yield']
                )
                db.add(new_data)
            db.commit()
            
    db.close()
    print("Screening data updated successfully.")

if __name__ == "__main__":
    run_screening()
