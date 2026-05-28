from sqlalchemy import Column, Integer, String, Float, Date
from database import Base

class FundamentalData(Base):
    __tablename__ = "fundamental_data"

    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String, index=True)
    date = Column(Date, index=True)
    f_score = Column(Float)
    z_score = Column(Float)
    fcf_yield = Column(Float)

class DailyOHLCV(Base):
    __tablename__ = "daily_ohlcv"

    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String, index=True)
    date = Column(Date, index=True)
    open = Column(Float)
    high = Column(Float)
    low = Column(Float)
    close = Column(Float)
    volume = Column(Float)
    ema_20 = Column(Float, nullable=True)
    ema_50 = Column(Float, nullable=True)
    ema_200 = Column(Float, nullable=True)
    rsi_14 = Column(Float, nullable=True)
    atr_14 = Column(Float, nullable=True)
    avwap = Column(Float, nullable=True)

class MarketHealth(Base):
    __tablename__ = "market_health"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date, index=True)
    index_symbol = Column(String, index=True)
    close = Column(Float)
    sma_20 = Column(Float)
    sma_50 = Column(Float, nullable=True)
    sma50_slope = Column(Float, nullable=True)
    ad_ratio = Column(Float, nullable=True) # Advance/Decline ratio or similar
    is_bullish = Column(Integer) # 1 for True, 0 for False (SQLite boolean)

class DailyAssets(Base):
    __tablename__ = "daily_assets"
    
    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String, index=True, unique=True)
    avg_vol_20d = Column(Float, nullable=True)
    earnings_date = Column(Date, nullable=True)
    is_cb_bw_risk = Column(Integer, default=0) # 1 for True, 0 for False
    avwap_anchor_date = Column(Date, nullable=True)

class SignalHistory(Base):
    __tablename__ = "signal_history"

    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String, index=True)
    signal_date = Column(Date, index=True)
    pattern_type = Column(String)
    entry_price = Column(Float)
    stop_loss_price = Column(Float, nullable=True)
    target_1r = Column(Float, nullable=True)
    calculated_shares = Column(Integer, nullable=True)

class PriceAlert(Base):
    __tablename__ = "price_alerts"

    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String, index=True)
    target_price = Column(Float)
    condition = Column(String) # 'above' or 'below'
    message = Column(String)
    is_active = Column(Integer, default=1) # 1 for True, 0 for False
    created_at = Column(Date)
