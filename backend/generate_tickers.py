import FinanceDataReader as fdr
import json

df = fdr.StockListing('KOSPI')
tickers = {}
for idx, row in df.iterrows():
    # Code is usually 6 digits
    ticker = str(row['Code'])
    if len(ticker) == 6:
        tickers[ticker] = row['Name']

with open('tickers.json', 'w', encoding='utf-8') as f:
    json.dump(tickers, f, ensure_ascii=False)

print(f"Generated {len(tickers)} tickers.")
