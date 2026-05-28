class RiskManager:
    def __init__(self):
        # Configurable Risk Limits
        self.max_open_risk = 0.04  # 4%
        
        # Kill Switches
        self.daily_kill_pct = -0.02
        self.weekly_kill_pct = -0.04
        self.monthly_kill_pct = -0.08
        
        # State Flags
        self.kill_switch_active = False
        self.weekly_brake = False
        
    def get_regime_risk(self, regime):
        if regime == 'Broad Bull': return 0.01
        elif regime == 'Narrow Bull': return 0.005
        elif regime == 'Recovery': return 0.0025
        else: return 0.0 # Bear
        
    def can_open_new_position(self, current_open_risk, regime_risk, daily_ret, weekly_ret, monthly_ret):
        """
        Check if we have enough risk budget and no kill switches are tripped.
        """
        if self.kill_switch_active:
            return False, "Kill Switch (Monthly) is Active. Trading Halted."
            
        if monthly_ret <= self.monthly_kill_pct:
            self.kill_switch_active = True
            return False, "Monthly Kill Switch (-8%) Hit! Trading Halted."
            
        if daily_ret <= self.daily_kill_pct:
            return False, "Daily Kill Switch (-2%) Hit! No new entries today."
            
        # Weekly brake reduces risk exposure by 50%
        if weekly_ret <= self.weekly_kill_pct:
            self.weekly_brake = True
            regime_risk = regime_risk * 0.5
        else:
            self.weekly_brake = False
            
        if regime_risk <= 0:
            return False, "Regime prevents new entries."
            
        if current_open_risk + regime_risk > self.max_open_risk:
            return False, f"Max open risk ({self.max_open_risk*100}%) exceeded."
            
        return True, "OK"
