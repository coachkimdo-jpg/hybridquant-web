import json
try:
    with open('../result.json') as f:
        d = json.load(f)
        if len(d['chart_data']) > 0:
            print(f"Data length: {len(d['chart_data'])}")
            print(f"Sample: {d['chart_data'][-1]}")
            print(f"Markers length: {len(d['markers'])}")
            print(f"POC: {d['poc_price']}")
        else:
            print("chart_data is empty")
except Exception as e:
    print(f"Error: {e}")
