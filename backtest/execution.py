import math

class ExecutionManager:
    def __init__(self, slippage_pct=0.0015): # 0.15% slippage per leg (0.3% round trip)
        self.slippage_pct = slippage_pct
        
    def calculate_order_sizing(self, current_close, atr, chandelier_exit, capital, risk_pct):
        """
        Calculates position size based on Worst Expected Entry and Chandelier Exit stop loss.
        """
        atr_pct = atr / current_close
        protection_width = min(max(0.1 * atr_pct, 0.0015), 0.005)
        worst_expected_entry = current_close * (1 + protection_width)
        
        stop_loss = chandelier_exit
        if worst_expected_entry <= stop_loss:
            return 0, 0, 0 # Invalid
            
        risk_amount = capital * risk_pct
        stop_distance = worst_expected_entry - stop_loss
        
        qty = math.floor(risk_amount / stop_distance)
        
        # Position Sizing Cap (V3): Never bet more than 20% of total capital on a single trade, 
        # even if the stop loss is very tight. This prevents massive gap-down blowups.
        max_qty = math.floor((capital * 0.20) / worst_expected_entry)
        if qty > max_qty:
            qty = max_qty
            
        target_price = float('inf') # Pure Trend Following: No 1R target, let it run until Chandelier exit
        
        return qty, worst_expected_entry, target_price

    def apply_slippage(self, price, is_buy):
        if is_buy:
            return price * (1 + self.slippage_pct)
        else:
            return price * (1 - self.slippage_pct)
