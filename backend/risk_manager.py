def calculate_position_size(total_capital: float, current_price: float, atr_value: float, is_market_healthy: bool) -> dict:
    """
    Calculates position sizing based on the 1% risk rule (or 0.5% if market is not healthy).
    """
    if atr_value <= 0 or current_price <= 0:
        return {"shares": 0, "stop_loss_price": 0, "target_1r": 0, "risk_pct": 0, "total_risk_amount": 0}
        
    risk_pct = 0.01 if is_market_healthy else 0.005
    stop_loss_price = current_price - (1.5 * atr_value)
    
    # 1R Target Price (Risk = Reward)
    risk_per_share = current_price - stop_loss_price
    
    if risk_per_share <= 0:
        return {"shares": 0, "stop_loss_price": 0, "target_1r": 0, "risk_pct": 0, "total_risk_amount": 0}
        
    target_1r = current_price + risk_per_share
    
    total_risk_amount = total_capital * risk_pct
    shares = int(total_risk_amount / risk_per_share)
    
    # Do not exceed total capital or 25% max allocation per stock
    max_allocation = total_capital * 0.25
    calculated_amount = shares * current_price
    
    if calculated_amount > max_allocation:
        shares = int(max_allocation / current_price)
        
    return {
        "shares": shares,
        "stop_loss_price": round(stop_loss_price, 2),
        "target_1r": round(target_1r, 2),
        "risk_pct": risk_pct,
        "total_risk_amount": round(total_risk_amount, 2)
    }
