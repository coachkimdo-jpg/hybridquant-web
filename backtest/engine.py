import os
import pandas as pd
import numpy as np
from tqdm import tqdm

from regime import get_regime_classification
from universe import filter_trend_x, filter_turn_x
from ranking import rank_candidates
from risk_manager import RiskManager
from execution import ExecutionManager

DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')
PROCESSED_DIR = os.path.join(DATA_DIR, 'processed')

class BacktestEngine:
    def __init__(self, initial_capital=100_000_000):
        self.capital = initial_capital
        self.cash = initial_capital
        self.positions = {} # ticker -> {qty, entry_price, stop_loss, target, risk_pct}
        self.history = []
        
        self.risk_manager = RiskManager()
        self.execution = ExecutionManager(slippage_pct=0.003)
        
        self.regime_df = get_regime_classification()
        self.trading_days = self.regime_df.index.sort_values()
        
        self.tickers_data = {}
        self.load_data()
        
    def load_data(self):
        print("Loading all processed ticker data into memory...")
        files = [f for f in os.listdir(PROCESSED_DIR) if f != 'kospi_processed.parquet']
        for f in tqdm(files):
            ticker = f.split('.')[0]
            df = pd.read_parquet(os.path.join(PROCESSED_DIR, f))
            self.tickers_data[ticker] = df

    def get_portfolio_value(self, date):
        val = self.cash
        for ticker, pos in self.positions.items():
            df = self.tickers_data.get(ticker)
            if df is not None and date in df.index:
                val += pos['qty'] * df.loc[date, 'close']
            else:
                val += pos['qty'] * pos['entry_price'] # fallback
        return val

    def run(self):
        print("Starting Backtest Core Loop...")
        
        for i in tqdm(range(60, len(self.trading_days)), desc="Simulating Days"):
            today = self.trading_days[i]
            yesterday = self.trading_days[i-1]
            
            # 1. Update Portfolio Returns for Kill Switches
            port_val = self.get_portfolio_value(yesterday)
            daily_ret = (port_val / self.get_portfolio_value(self.trading_days[i-2])) - 1 if i >= 2 else 0
            weekly_ret = (port_val / self.get_portfolio_value(self.trading_days[i-5])) - 1 if i >= 5 else 0
            monthly_ret = (port_val / self.get_portfolio_value(self.trading_days[i-20])) - 1 if i >= 20 else 0
            
            # 2. Get Regime
            regime_row = self.regime_df.loc[today]
            current_regime = regime_row['regime']
            
            # 3. Process Exits (Stops, Targets, Gaps)
            closed_tickers = []
            for ticker, pos in self.positions.items():
                df = self.tickers_data[ticker]
                if today not in df.index: continue
                
                row = df.loc[today]
                open_p, high_p, low_p, close_p = row['open'], row['high'], row['low'], row['close']
                
                # Gap Down Check (-3% from stop loss)
                if open_p < pos['stop_loss'] * 0.97:
                    # Execute market sell at open
                    sell_price = self.execution.apply_slippage(open_p, False)
                    self.cash += pos['qty'] * sell_price
                    closed_tickers.append(ticker)
                    continue
                    
                # Normal Stop Loss Check
                if low_p <= pos['stop_loss']:
                    sell_price = self.execution.apply_slippage(pos['stop_loss'], False)
                    self.cash += pos['qty'] * sell_price
                    closed_tickers.append(ticker)
                    continue
                    
                # Target 1R Check (Simplified: full exit for now to track basic win rate)
                if high_p >= pos['target']:
                    sell_price = self.execution.apply_slippage(pos['target'], False)
                    self.cash += pos['qty'] * sell_price
                    closed_tickers.append(ticker)
                    continue
                    
                # Update Trailing Stop (Chandelier)
                if row['chandelier_exit'] > pos['stop_loss']:
                    pos['stop_loss'] = row['chandelier_exit']
                    
            for t in closed_tickers:
                del self.positions[t]
                
            # 4. Filter Candidates & Enter New Positions
            regime_risk = self.risk_manager.get_regime_risk(current_regime)
            current_open_risk = sum(p['risk_pct'] for p in self.positions.values())
            
            can_trade, msg = self.risk_manager.can_open_new_position(
                current_open_risk, regime_risk, daily_ret, weekly_ret, monthly_ret)
                
            if can_trade:
                # Build cross-sectional dataframe for 'today'
                cross_sectional = []
                for ticker, df in self.tickers_data.items():
                    if today in df.index:
                        row = df.loc[today].copy()
                        row['ticker'] = ticker
                        cross_sectional.append(row)
                
                if cross_sectional:
                    df_daily = pd.DataFrame(cross_sectional)
                    
                    if current_regime in ['Broad Bull', 'Narrow Bull']:
                        candidates = filter_trend_x(df_daily)
                    elif current_regime == 'Recovery':
                        candidates = filter_turn_x(df_daily)
                    else:
                        candidates = pd.DataFrame()
                        
                    if not candidates.empty:
                        ranked = rank_candidates(candidates)
                        
                        # Try to buy top candidates
                        for _, cand in ranked.iterrows():
                            # Check if we still have open risk room
                            current_open_risk = sum(p['risk_pct'] for p in self.positions.values())
                            if current_open_risk + regime_risk > self.risk_manager.max_open_risk:
                                break
                                
                            ticker = cand['ticker']
                            if ticker in self.positions: continue # Already hold
                            
                            qty, entry_price, target = self.execution.calculate_order_sizing(
                                cand['close'], cand['atr_14'], cand['chandelier_exit'], self.capital, regime_risk
                            )
                            
                            cost = qty * entry_price
                            if qty > 0 and self.cash >= cost:
                                self.cash -= cost
                                self.positions[ticker] = {
                                    'qty': qty,
                                    'entry_price': entry_price,
                                    'stop_loss': cand['chandelier_exit'],
                                    'target': target,
                                    'risk_pct': regime_risk
                                }

            # Record daily state
            self.history.append({
                'date': today,
                'regime': current_regime,
                'portfolio_value': self.get_portfolio_value(today),
                'cash': self.cash,
                'open_positions': len(self.positions)
            })
            
        print("Backtest complete!")
        
        hist_df = pd.DataFrame(self.history)
        hist_df.set_index('date', inplace=True)
        hist_df.to_csv('backtest_results.csv')
        
        # Print basic stats
        total_ret = (hist_df['portfolio_value'].iloc[-1] / self.capital) - 1
        mdd = ((hist_df['portfolio_value'] / hist_df['portfolio_value'].cummax()) - 1).min()
        print(f"\\n--- BACKTEST RESULTS ---")
        print(f"Total Return: {total_ret*100:.2f}%")
        print(f"Max Drawdown (MDD): {mdd*100:.2f}%")

if __name__ == "__main__":
    engine = BacktestEngine()
    engine.run()
