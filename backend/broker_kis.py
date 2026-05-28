import os
import time
import requests
import json
from dotenv import load_dotenv

load_dotenv()

APP_KEY = os.environ.get("KIS_APP_KEY")
APP_SECRET = os.environ.get("KIS_APP_SECRET")
ACCOUNT_NO = os.environ.get("KIS_ACCOUNT_NO")
DOMAIN = os.environ.get("KIS_DOMAIN", "https://openapi.koreainvestment.com:9443")

# In-memory token cache
_ACCESS_TOKEN = None
_TOKEN_EXPIRES_AT = 0

def get_access_token():
    global _ACCESS_TOKEN, _TOKEN_EXPIRES_AT
    
    # Check if token is still valid (add 60 seconds buffer)
    if _ACCESS_TOKEN and time.time() < _TOKEN_EXPIRES_AT - 60:
        return _ACCESS_TOKEN
        
    if not APP_KEY or not APP_SECRET:
        raise Exception("KIS_APP_KEY or KIS_APP_SECRET is not set in .env")

    url = f"{DOMAIN}/oauth2/tokenP"
    headers = {"content-type": "application/json"}
    body = {
        "grant_type": "client_credentials",
        "appkey": APP_KEY,
        "appsecret": APP_SECRET
    }
    
    res = requests.post(url, headers=headers, data=json.dumps(body))
    if res.status_code == 200:
        data = res.json()
        _ACCESS_TOKEN = data.get("access_token")
        expires_in = int(data.get("expires_in", 86400))
        _TOKEN_EXPIRES_AT = time.time() + expires_in
        return _ACCESS_TOKEN
    else:
        raise Exception(f"Failed to get KIS token: {res.text}")

def get_account_balance():
    try:
        token = get_access_token()
    except Exception as e:
        return {"balance": 100000000, "message": str(e)}

    url = f"{DOMAIN}/uapi/domestic-stock/v1/trading/inquire-balance"
    
    cano = ACCOUNT_NO.split("-")[0] if ACCOUNT_NO and "-" in ACCOUNT_NO else ACCOUNT_NO
    acnt_prdt_cd = ACCOUNT_NO.split("-")[1] if ACCOUNT_NO and "-" in ACCOUNT_NO else "01"
    
    # 모의투자인지 실전투자인지 구별하여 TR_ID 설정
    tr_id = "VTTC8434R" if "vts" in DOMAIN else "TTTC8434R"
    
    headers = {
        "content-type": "application/json; charset=utf-8",
        "authorization": f"Bearer {token}",
        "appkey": APP_KEY,
        "appsecret": APP_SECRET,
        "tr_id": tr_id,
    }
    
    params = {
        "CANO": cano,
        "ACNT_PRDT_CD": acnt_prdt_cd,
        "AFHR_FLPR_YN": "N",
        "OFL_YN": "",
        "INQR_DVSN": "02",
        "UNPR_DVSN": "01",
        "FUND_STTL_ICLD_YN": "N",
        "FNCG_AMT_AUTO_RDPT_YN": "N",
        "PRCS_DVSN": "00",
        "CTX_AREA_FK100": "",
        "CTX_AREA_NK100": ""
    }
    
    res = requests.get(url, headers=headers, params=params)
    if res.status_code == 200:
        data = res.json()
        if data.get("rt_cd") == "0":
            output2 = data.get("output2", [{}])[0]
            # prvs_rcdl_excc_amt: 전일매수체결 기준 주문가능현금
            total_cash = float(output2.get("prvs_rcdl_excc_amt", 100000000))
            return {"balance": total_cash, "message": "Success"}
        else:
            return {"balance": 100000000, "message": f"KIS API Error: {data.get('msg1')}"}
    else:
        return {"balance": 100000000, "message": f"HTTP Error: {res.status_code}"}

def place_order(ticker: str, price: float, quantity: int, order_type: str = "BUY"):
    try:
        token = get_access_token()
    except Exception as e:
        return {"success": False, "msg": str(e)}

    url = f"{DOMAIN}/uapi/domestic-stock/v1/trading/order-cash"
    
    cano = ACCOUNT_NO.split("-")[0] if ACCOUNT_NO and "-" in ACCOUNT_NO else ACCOUNT_NO
    acnt_prdt_cd = ACCOUNT_NO.split("-")[1] if ACCOUNT_NO and "-" in ACCOUNT_NO else "01"
    
    is_mock = "vts" in DOMAIN
    if order_type.upper() == "BUY":
        tr_id = "VTTC0802U" if is_mock else "TTTC0802U"
    else:
        tr_id = "VTTC0801U" if is_mock else "TTTC0801U"
        
    headers = {
        "content-type": "application/json; charset=utf-8",
        "authorization": f"Bearer {token}",
        "appkey": APP_KEY,
        "appsecret": APP_SECRET,
        "tr_id": tr_id,
        "custtype": "P",
    }
    
    body = {
        "CANO": cano,
        "ACNT_PRDT_CD": acnt_prdt_cd,
        "PDNO": ticker,
        "ORD_DVSN": "00", # 00: 지정가
        "ORD_QTY": str(quantity),
        "ORD_UNPR": str(int(price))
    }
    
    res = requests.post(url, headers=headers, data=json.dumps(body))
    if res.status_code == 200:
        data = res.json()
        if data.get("rt_cd") == "0":
            return {"success": True, "msg": data.get("msg1"), "order_no": data.get("output", {}).get("ODNO")}
        else:
            return {"success": False, "msg": data.get("msg1")}
    else:
        return {"success": False, "msg": f"HTTP Error {res.status_code}: {res.text}"}
