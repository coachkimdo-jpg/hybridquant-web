import sqlite3
conn = sqlite3.connect('hybridquant.db')
c = conn.cursor()
c.execute("SELECT DISTINCT ticker FROM daily_ohlcv")
res = c.fetchall()
print([r[0] for r in res])
