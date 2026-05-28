import sqlite3
try:
    conn = sqlite3.connect('hybridquant.db')
    conn.execute('ALTER TABLE daily_assets ADD COLUMN avwap_anchor_date DATE;')
    conn.commit()
    print("Column added")
except Exception as e:
    print(e)
finally:
    conn.close()
