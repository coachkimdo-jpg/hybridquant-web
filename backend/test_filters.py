import requests

res = requests.get('http://localhost:8000/api/v2/chart/signals/003230')
d = res.json()
if d and len(d['chart_data']) > 0:
    latest = d['chart_data'][-1]
    c_close = latest.get('close', 0)
    avwap = latest.get('avwap', 0)
    poc = d.get('poc_price', 0)
    ema20 = latest.get('ema_20', 0)
    ema50 = latest.get('ema_50', 0)
    macd_hist = latest.get('macd_hist', 0)
    chand = latest.get('chandelier_exit', 0)
    
    struct = c_close > avwap and c_close > poc
    mom = ema20 > ema50 and macd_hist > 0
    pat = c_close > chand
    
    print(f"003230: struct={struct}, mom={mom}, pat={pat}")
    print(f"close={c_close}, avwap={avwap}, poc={poc}, ema20={ema20}, ema50={ema50}, macd_hist={macd_hist}, chand={chand}")
else:
    print("Empty")
