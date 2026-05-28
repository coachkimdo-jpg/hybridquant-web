import React, { useState, useEffect } from 'react';
import { ShieldAlert, Zap, TrendingUp, Search, Activity, AlertTriangle, Shield, Layers, Crosshair, Bot, Bell } from 'lucide-react';
import TradingChart from './components/TradingChart';
import axios from 'axios';


// 배포 환경에서는 VITE_BACKEND_URL 환경 변수를 사용하고, 로컬에서는 8000번 포트를 사용합니다.
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';
const API_BASE_URL = `${BACKEND_URL}/api/v3`;
const V2_API_BASE_URL = `${BACKEND_URL}/api/v2`;

const getChartData = async (ticker: string) => {
  const response = await axios.get(`${V2_API_BASE_URL}/chart/signals/${ticker}`, { headers: { "Bypass-Tunnel-Reminder": "true" } });
  return response.data;
};

const getSystemStatus = async () => {
  const response = await axios.get(`${API_BASE_URL}/system-status`, { headers: { "Bypass-Tunnel-Reminder": "true" } });
  return response.data;
};

const getBrokerBalance = async () => {
  try {
    const response = await axios.get(`${BACKEND_URL}/api/v4/broker/balance`, { headers: { "Bypass-Tunnel-Reminder": "true" } });
    return response.data.balance;
  } catch {
    return 100000000;
  }
};

const executeBrokerTrade = async (ticker: string, price: number, quantity: number) => {
  try {
    const response = await axios.post(`${BACKEND_URL}/api/v4/broker/order`, {
      ticker,
      price,
      quantity,
      order_type: 'BUY'
    }, { headers: { "Bypass-Tunnel-Reminder": "true" } });
    if (response.data.success) {
      alert(`[주문 완료] ${ticker} ${quantity}주 실전(모의) 매수 주문이 접수되었습니다.\n주문번호: ${response.data.order_no}`);
    } else {
      alert(`[주문 실패] ${response.data.msg}`);
    }
  } catch (error) {
    alert(`주문 전송 오류: ${error}`);
  }
};

const registerAlert = async (ticker: string, target_price: number, condition: string, message: string) => {
  try {
    const response = await axios.post(`${BACKEND_URL}/api/v4/alerts`, {
      ticker,
      target_price,
      condition,
      message
    }, { headers: { "Bypass-Tunnel-Reminder": "true" } });
    return response.data.success;
  } catch (error) {
    console.error("Alert registration failed", error);
    return false;
  }
};

class ChartErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean}> {
  constructor(props: any) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError(_error: any) { return { hasError: true }; }
  componentDidCatch(error: any, errorInfo: any) { console.error("Chart Error:", error, errorInfo); }
  render() { 
    if (this.state.hasError) return <div className="p-4 text-rose-500">Failed to load chart. Please check console.</div>; 
    return this.props.children; 
  }
}

function App() {

  const [chartDataPayload, setChartDataPayload] = useState<any>(null);
  const [systemStatus, setSystemStatus] = useState<any>(null);
  const [brokerBalance, setBrokerBalance] = useState<number>(100000000);
  const [activeTicker, setActiveTicker] = useState<string>('005930');
  const [rightTab, setRightTab] = useState<'watchlist' | 'all'>('watchlist');
  const [searchQuery, setSearchQuery] = useState('');
  const [topSearch, setTopSearch] = useState('');

  const handleTopSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (topSearch) {
      setActiveTicker(topSearch);
      setTopSearch('');
    }
  };
  const [loading, setLoading] = useState(true);

  const [allTickerNames, setAllTickerNames] = useState<Record<string, string>>({});
  const [watchlistTickers, setWatchlistTickers] = useState<string[]>([]);

  // Scoring Engine State
  const [scoredStocks, setScoredStocks] = useState<Record<string, any>>({});
  const [isScoring, setIsScoring] = useState(false);
  const [scanProgress, setScanProgress] = useState<{total: number, current: number, is_running: boolean}>({total: 0, current: 0, is_running: false});
  const [scanStartTime, setScanStartTime] = useState<number | null>(null);

  // Load ALL tickers once
  useEffect(() => {
    const fetchAllStocks = async () => {
      try {
        const res = await axios.get(`${BACKEND_URL}/api/v4/stocks`, { headers: { "Bypass-Tunnel-Reminder": "true" } });
        if (res.data) {
          setAllTickerNames(res.data);
          // Watchlist will be populated by the scoring engine
        }
      } catch (err) {
        console.error(err);
      }
    };
    fetchAllStocks();
  }, []);

  // Handle Scoring Engine Run
  const runScoringEngine = async (showFeedback = false) => {
    setIsScoring(true);
    setScanStartTime(Date.now());
    try {
      await axios.get(`${BACKEND_URL}/api/v4/screener/start-scan`, { headers: { "Bypass-Tunnel-Reminder": "true" } });
      if (showFeedback) {
          // Do not alert to prevent blocking the UI, let the progress bar speak for itself
      }
    } catch (err: any) {
      console.error('Error starting scan:', err);
      setIsScoring(false);
      alert(`[서버 연결 실패] 백엔드 서버에 연결할 수 없습니다. (에러: ${err.message}) Render 대시보드에서 joosik-backend가 정상 작동 중인지 확인해주세요!`);
    }
  };

  // Polling for Scan Status
  useEffect(() => {
    let interval: any = null;
    
    const checkStatus = async () => {
      try {
        const res = await axios.get(`${BACKEND_URL}/api/v4/screener/status`, { headers: { "Bypass-Tunnel-Reminder": "true" } });
        if (res.data) {
          setScanProgress({
            total: res.data.total,
            current: res.data.current,
            is_running: res.data.is_running
          });
          
          if (res.data.is_running) {
            setIsScoring(true);
          } else {
            // Once finished or not running, stop scoring state
            if (isScoring) {
              setIsScoring(false);
              // Fetch results
              const resultRes = await axios.get(`${BACKEND_URL}/api/v4/screener/results`, { headers: { "Bypass-Tunnel-Reminder": "true" } });
              if (resultRes.data) {
                setScoredStocks(resultRes.data);
                setWatchlistTickers(Object.keys(resultRes.data));
              }
            }
          }
        }
      } catch (err) {
        console.error("Error checking scan status:", err);
      }
    };

    if (isScoring) {
      interval = setInterval(checkStatus, 1500);
    }
    
    // Initial check just in case it's already running on the server
    if (!isScoring) {
      checkStatus();
    }

    return () => clearInterval(interval);
  }, [isScoring]);

  useEffect(() => {
    if (Object.keys(allTickerNames).length > 0) {
        runScoringEngine(false);
    }
  }, [allTickerNames]);

  useEffect(() => {
    const fetchInitial = async () => {
      try {
        const [status, balance] = await Promise.all([
          getSystemStatus(),
          getBrokerBalance()
        ]);
        setSystemStatus(status);
        setBrokerBalance(balance);
      } catch (error) {
        console.error('Error fetching initial data:', error);
      }
    };
    fetchInitial();
  }, []);

  useEffect(() => {
    const fetchChart = async () => {
      if (!activeTicker) return;
      setLoading(true);
      try {
        const chart = await getChartData(activeTicker);
        setChartDataPayload(chart);
      } catch (error) {
        console.error('Error fetching chart data:', error);
      }
      setLoading(false);
    };
    fetchChart();
  }, [activeTicker]);

  const getAnalysisInsight = () => {
    if (!chartDataPayload || !chartDataPayload.chart_data || chartDataPayload.chart_data.length === 0) return null;
    const latest = chartDataPayload.chart_data[chartDataPayload.chart_data.length - 1];
    const poc = chartDataPayload.poc_price;

    const isStructSafe = latest.close > latest.avwap || latest.close > poc;
    const isMomSafe = latest.ema_20 > latest.ema_50 || latest.macd_hist > 0;
    const isPatSafe = latest.chandelier_exit > 0 && latest.close > latest.chandelier_exit;

    const safeCount = (isStructSafe ? 1 : 0) + (isMomSafe ? 1 : 0) + (isPatSafe ? 1 : 0);
    let opinionTitle = "";
    let opinionText = "";
    let opinionColor = "";

    if (safeCount === 3) {
      opinionTitle = "적극 매수 (Strong Buy)";
      opinionText = "시장 구조, 모멘텀, 리스크 방어선이 모두 완벽한 상승 추세를 가리키고 있습니다. 지금이 진입하기 가장 좋은 타이밍입니다.";
      opinionColor = "bg-emerald-900/30 border-emerald-500/50 text-emerald-400";
    } else if (safeCount === 2) {
      opinionTitle = "분할 매수 / 관망 (Hold & Watch)";
      opinionText = "대체로 긍정적인 흐름이나 일부 지표가 아직 완벽하지 않습니다. 소액으로 분할 매수하거나 확실한 돌파를 기다리는 것이 좋습니다.";
      opinionColor = "bg-yellow-900/30 border-yellow-500/50 text-yellow-400";
    } else if (safeCount === 1) {
      opinionTitle = "주의 요망 (Caution)";
      opinionText = "대부분의 지표가 하락세를 가리키고 있습니다. 신규 진입은 매우 위험하며, 보유 중이라면 리스크 관리에 집중해야 합니다.";
      opinionColor = "bg-orange-900/30 border-orange-500/50 text-orange-400";
    } else {
      opinionTitle = "매수 금지 / 매도 (Strong Sell)";
      opinionText = "모든 지표가 붕괴되었습니다. 즉각적인 매도 또는 진입을 절대적으로 피해야 하는 구간입니다.";
      opinionColor = "bg-rose-900/30 border-rose-500/50 text-rose-400";
    }

    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl shrink-0 mt-4">
        <h3 className="font-bold text-slate-200 flex items-center mb-3 text-sm">
          <Bot className="w-5 h-5 mr-2 text-indigo-400" />
          AI Quant Insight (종목 분석 리포트)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className={`p-3 rounded-lg border bg-indigo-900/20 border-indigo-500/30`}>
            <div className={`flex items-center font-bold text-xs mb-2 text-indigo-400`}><Shield className="w-4 h-4 mr-1"/> 펀더멘털</div>
            <p className="text-xs text-slate-400 leading-relaxed">
              유동성/우량주 필터 통과: 안정적인 거래대금과 최소 시가총액 요건을 만족하는 검증된 기업입니다.
            </p>
          </div>

          <div className={`p-3 rounded-lg border ${isStructSafe ? 'bg-blue-900/20 border-blue-500/30' : 'bg-slate-800/30 border-slate-700/50'}`}>
            <div className={`flex items-center font-bold text-xs mb-2 ${isStructSafe ? 'text-blue-400' : 'text-slate-500'}`}><Layers className="w-4 h-4 mr-1"/> 시장 구조</div>
            <p className="text-xs text-slate-400 leading-relaxed">
              {isStructSafe 
                ? `현재가(₩${latest.close.toLocaleString()})가 기관 평균단가(VWAP) 또는 핵심 매물대(POC) 위에서 견고하게 지지를 받고 있습니다.`
                : "주가가 세력의 핵심 매물대나 평균단가 아래에 갇혀 있어 상승 시 강한 저항이 예상됩니다."}
            </p>
          </div>

          <div className={`p-3 rounded-lg border ${isMomSafe ? 'bg-emerald-900/20 border-emerald-500/30' : 'bg-slate-800/30 border-slate-700/50'}`}>
            <div className={`flex items-center font-bold text-xs mb-2 ${isMomSafe ? 'text-emerald-400' : 'text-slate-500'}`}><Activity className="w-4 h-4 mr-1"/> 모멘텀</div>
            <p className="text-xs text-slate-400 leading-relaxed">
              {isMomSafe 
                ? "단기 이평선(20일)이 중기 이평선(50일)을 돌파했거나, MACD 에너지가 양(+)으로 전환되며 상승 추세를 탔습니다."
                : "이평선 역배열 또는 MACD 음수 구간으로 단기적인 하락 모멘텀이 강하게 작용 중입니다."}
            </p>
          </div>

          <div className={`p-3 rounded-lg border ${isPatSafe ? 'bg-rose-900/20 border-rose-500/30' : 'bg-slate-800/30 border-slate-700/50'}`}>
            <div className={`flex items-center font-bold text-xs mb-2 ${isPatSafe ? 'text-rose-400' : 'text-slate-500'}`}><Crosshair className="w-4 h-4 mr-1"/> 리스크 (방어선)</div>
            <p className="text-xs text-slate-400 leading-relaxed">
              {isPatSafe 
                ? `주가가 샹들리에 손절선(₩${latest.chandelier_exit.toLocaleString()}) 위에서 머무르며 리스크가 완벽히 통제 중입니다.`
                : "주가가 샹들리에 방어선을 이탈하여 즉각적인 손절 혹은 진입 보류가 권장되는 위험 구간입니다."}
            </p>
          </div>
        </div>

        {/* 💡 Comprehensive Opinion */}
        <div className={`mt-4 p-4 rounded-lg border flex items-start ${opinionColor}`}>
          <div className="mr-3 mt-0.5">
            {safeCount === 3 ? <TrendingUp className="w-5 h-5" /> : 
             safeCount === 2 ? <Activity className="w-5 h-5" /> : 
             safeCount === 1 ? <AlertTriangle className="w-5 h-5" /> : 
             <ShieldAlert className="w-5 h-5" />}
          </div>
          <div>
            <h4 className="font-bold text-sm mb-1">💡 종합 의견: {opinionTitle}</h4>
            <p className="text-xs opacity-90 leading-relaxed">{opinionText}</p>
          </div>
        </div>

        {/* 🎯 Recommended Prices Section */}
        {latest.chandelier_exit > 0 && systemStatus && (() => {
          const poc = chartDataPayload?.poc_price || 0;
          let suggested_entry = latest.close;
          let entry_text = "";
          
          if (safeCount === 3) {
              suggested_entry = latest.close;
              entry_text = "강한 모멘텀 상태로 현재가 부근 즉시 진입 (돌파 매수)";
          } else {
              if (systemStatus.regime === 'Recovery') {
                  suggested_entry = Math.max(latest.ema_60 || 0, latest.ema_120 || 0, poc) || latest.close;
                  entry_text = "60/120EMA 지지 및 양봉 전환 시 (눌림 매수)";
              } else if (systemStatus.regime === 'Broad Bull' || systemStatus.regime === 'Narrow Bull') {
                  suggested_entry = Math.max(latest.ema_20 || 0, latest.avwap || 0, poc) || latest.close;
                  entry_text = "20EMA/VWAP 지지 및 양봉 전환 시 (눌림 매수)";
              } else {
                  suggested_entry = latest.close;
                  entry_text = "신규 진입 보류 권장 (리스크 관리 구간)";
              }
          }
          
          if (suggested_entry >= latest.close) suggested_entry = latest.close;
          
          let stop_loss = latest.chandelier_exit;
          if (stop_loss >= suggested_entry) {
              stop_loss = suggested_entry * 0.95; // 5% stop loss for pullback
          }
          
          const risk = suggested_entry - stop_loss;
          const target_1r = suggested_entry + risk;
          const target_2r = suggested_entry + risk * 2;
          const target_08r = suggested_entry + risk * 0.8;
          const target_15r = suggested_entry + risk * 1.5;

          return (
          <div className="mt-4 p-4 border border-slate-800/50 flex flex-col gap-4 bg-slate-900/30 rounded-lg">
            <h4 className="font-bold text-sm text-slate-300 flex items-center justify-between">
              <div className="flex items-center">
                <Crosshair className="w-4 h-4 mr-2 text-indigo-400" />
                장세 맞춤형 매매 플랜 ({systemStatus.regime || '분석 중...'})
              </div>
              <div className="flex items-center space-x-3">
                <div className="bg-slate-800/50 px-3 py-1 rounded-full border border-slate-700/50 hidden sm:flex items-center">
                  <span className="text-[10px] text-slate-400 mr-2 uppercase tracking-wider">현재가</span>
                  <span className="text-sm font-bold text-white">₩{latest.close.toLocaleString()}</span>
                </div>
                <button 
                  onClick={async () => {
                  let successCount = 0;
                  const t1 = Math.floor(target_1r);
                  if (await registerAlert(activeTicker, t1, 'above', '1차 목표가 도달! 일부 익절을 고려하세요.')) successCount++;
                  
                  const t2 = Math.floor(target_2r);
                  if (await registerAlert(activeTicker, t2, 'above', '2차 목표가 도달! 추가 익절을 고려하세요.')) successCount++;
                  
                  const sl = Math.floor(stop_loss);
                  if (await registerAlert(activeTicker, sl, 'below', '손절가 이탈! 리스크 관리가 필요합니다.')) successCount++;
                  
                  if (successCount > 0) alert(`[알림 등록] ${activeTicker}의 목표가 및 손절가 알림이 텔레그램으로 전송되도록 설정되었습니다.`);
                }}
                className="flex items-center text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded transition-colors"
              >
                <Bell className="w-3.5 h-3.5 mr-1 text-amber-400" /> 모두 알람 켜기
              </button>
              </div>
            </h4>
            
            {systemStatus.regime === 'Bear' ? (
              <div className="text-rose-400 bg-rose-900/20 p-3 rounded text-sm text-center border border-rose-500/30">
                <AlertTriangle className="w-4 h-4 inline mr-1" />
                현재 하락장(Bear) 국면입니다. 원칙적으로 신규 매수를 금지하며, 기존 보유 종목은 리스크 관리에 집중하세요.
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {/* Entries */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider block mb-1">1차 매수가 (1st Entry)</span>
                    <span className="text-sm font-bold text-blue-400 block mb-1">
                      ₩{Math.floor(suggested_entry).toLocaleString()} 부근
                    </span>
                    <span className="text-xs text-slate-400">
                      {entry_text}
                    </span>
                  </div>
                  
                  <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider block mb-1">2차 매수가 (2nd Entry)</span>
                    <span className="text-sm font-bold text-blue-400 block mb-1">
                      {systemStatus.regime === 'Broad Bull' ? '전고점 또는 POC 돌파 시' : '추가 진입 보류 권장 (리스크 관리)'}
                    </span>
                    <span className="text-xs text-slate-400">
                      {systemStatus.regime === 'Broad Bull' ? '15분봉 종가 지지 안착 확인 후 진입' : '현재 장세에서는 피라미딩을 제한합니다'}
                    </span>
                  </div>
                </div>

                {/* Targets & Stop Loss */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-slate-800 pt-4">
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider block mb-0.5">
                      1차 목표가 ({systemStatus.regime === 'Recovery' ? '0.8R~1R' : '1R'})
                    </span>
                    <span className="text-sm font-bold text-emerald-400 block mb-1">
                      {systemStatus.regime === 'Recovery' ? (
                        `₩${Math.floor(target_08r).toLocaleString()} ~ ₩${Math.floor(target_1r).toLocaleString()}`
                      ) : (
                        `₩${Math.floor(target_1r).toLocaleString()}`
                      )}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {systemStatus.regime === 'Broad Bull' ? '도달 시 30~50% 익절 (리스크 회수)' : 
                       systemStatus.regime === 'Narrow Bull' ? '도달 시 50% 적극 익절 (수익 우선)' :
                       '빠른 50% 이상 익절 (욕심 자제)'}
                    </span>
                  </div>
                  
                  <div className="md:border-l border-slate-700 md:pl-4">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider block mb-0.5">
                      2차 목표가 ({systemStatus.regime === 'Narrow Bull' ? '1.5R~2R' : systemStatus.regime === 'Recovery' ? '저항선' : '2R'})
                    </span>
                    <span className="text-sm font-bold text-emerald-400 block mb-1">
                      {systemStatus.regime === 'Narrow Bull' ? (
                         `₩${Math.floor(target_15r).toLocaleString()} ~`
                      ) : systemStatus.regime === 'Recovery' ? (
                         `120/200EMA 부근`
                      ) : (
                         `₩${Math.floor(target_2r).toLocaleString()}`
                      )}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {systemStatus.regime === 'Broad Bull' ? '도달 시 20~30% 익절 (목표 달성)' : 
                       systemStatus.regime === 'Narrow Bull' ? '도달 시 추가 익절 (잔량은 짧게)' :
                       '박스권 상단 또는 이평 저항선 익절'}
                    </span>
                  </div>
                  
                  <div className="md:border-l border-slate-700 md:pl-4">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider block mb-0.5">기계적 손절가 & 최종 청산</span>
                    <span className="text-sm font-bold text-rose-400 block mb-1">
                      ₩{Math.floor(stop_loss).toLocaleString()}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      최초 손절 이탈 시 전량 매도.<br/>
                      수익 중엔 Chandelier/20EMA 이탈 시 잔량 청산.
                    </span>
                  </div>
                </div>

                <div className="flex justify-end mt-2">
                  <button 
                    onClick={() => {
                      const riskAmt = brokerBalance * (systemStatus?.risk_pct || 0);
                      if (risk <= 0) return alert('손절가가 매수가보다 높거나 같습니다.');
                      const calcShares = Math.floor(riskAmt / risk);
                      executeBrokerTrade(activeTicker, latest.close, calcShares > 0 ? calcShares : 1);
                    }}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded shadow-lg shadow-blue-500/20 transition-all flex items-center"
                  >
                    <Zap className="w-3.5 h-3.5 mr-1" />
                    추천 가격으로 1차 즉시 매수 ({(systemStatus?.risk_pct * 100 || 0).toFixed(2)}% 리스크)
                  </button>
                </div>
              </div>
            )}
          </div>
          );
        })()}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans">
      {/* System Status Alert Bar */}
      {systemStatus && (
        <div className={`w-full py-2 px-6 flex items-center justify-center font-medium text-sm transition-colors ${
          systemStatus.regime === 'Broad Bull' || systemStatus.regime === 'Narrow Bull' ? 'bg-emerald-900/40 text-emerald-400 border-b border-emerald-900/50' : 
          systemStatus.regime === 'Recovery' ? 'bg-yellow-900/40 text-yellow-400 border-b border-yellow-900/50' :
          'bg-rose-900/40 text-rose-400 border-b border-rose-900/50'
        }`}>
          {systemStatus.regime === 'Broad Bull' || systemStatus.regime === 'Narrow Bull' ? (
            <><TrendingUp className="w-4 h-4 mr-2" /> System Status: {systemStatus.regime} (KOSPI &gt; 20MA, <span title="시장의 상승/하락 종목 비율" className="underline decoration-dotted cursor-help">AD Ratio: {(systemStatus.ad_ratio * 100).toFixed(1)}%</span>) | <span title="1회 매매 시 내 자본금에서 감수할 최대 손실 허용치" className="underline decoration-dotted cursor-help">Allowed Risk: {(systemStatus.risk_pct * 100).toFixed(2)}% per Trade</span></>
          ) : systemStatus.regime === 'Recovery' ? (
            <><Activity className="w-4 h-4 mr-2" /> System Status: {systemStatus.regime} (회복 초기장) | <span title="소액 테스트 매수만 권장" className="underline decoration-dotted cursor-help">Allowed Risk: {(systemStatus.risk_pct * 100).toFixed(2)}% per Trade</span></>
          ) : (
            <><AlertTriangle className="w-4 h-4 mr-2" /> System Status: {systemStatus.regime} (하락장) | <span title="원칙적 신규 매수 금지" className="underline decoration-dotted cursor-help">Allowed Risk: {(systemStatus.risk_pct * 100).toFixed(2)}% (신규 진입 불가)</span></>
          )}
        </div>
      )}

      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="bg-blue-500/20 p-2 rounded-lg border border-blue-500/30">
              <Zap className="w-6 h-6 text-blue-400" />
            </div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
              QuantMaster Web
            </h1>
          </div>
          
          <div className="flex items-center space-x-4">
            <form onSubmit={handleTopSearch} className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
              <input 
                type="text" 
                value={topSearch}
                onChange={(e) => setTopSearch(e.target.value)}
                placeholder="Search ticker (e.g. 005930)..." 
                className="bg-slate-800/50 border border-slate-700 text-sm rounded-full pl-9 pr-4 py-1.5 focus:outline-none focus:border-blue-500 transition-colors"
              />
            </form>
            <button 
              onClick={() => alert("증권사 연동 기능은 프리미엄 기능으로, 현재 준비 중입니다!")}
              className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded-full text-sm font-medium transition-colors shadow-[0_0_15px_rgba(37,99,235,0.3)]">
              Connect Broker
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-[1600px] mx-auto px-4 py-6 flex gap-6">
        


        {/* Right Panel: Chart */}
        <div className="flex-1 flex flex-col gap-4">
          <div className="flex-1 relative rounded-xl overflow-hidden border border-slate-800/50 bg-slate-900 shadow-xl min-h-[500px]">
            
            {/* Chart Toolbar & Position Sizing Info */}
            <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
              <div className="flex items-center space-x-2 text-white font-mono bg-slate-900/80 px-3 py-1.5 rounded-lg border border-slate-700 backdrop-blur-sm shadow-lg">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                <span className="font-bold">{allTickerNames[activeTicker] || activeTicker} <span className="text-slate-400 text-sm font-normal">({activeTicker})</span></span>
                <span className="text-slate-500">|</span>
                <span className="text-slate-400">1D</span>
              </div>
                

            </div>

            <div className="absolute top-4 right-4 flex space-x-2">
              <button className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-sm font-medium rounded-lg transition-colors">Indicators</button>
            </div>
            
            <div className="flex-1 relative rounded-xl overflow-hidden border border-slate-800/50 bg-slate-950/50">
              {loading ? (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm z-10">
                  <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
              ) : chartDataPayload ? (
                <ChartErrorBoundary>
                  <TradingChart 
                    dataPayload={chartDataPayload} 
                    showMarketStructure={false}
                    showMomentum={false}
                    showPattern={false}
                  />
                </ChartErrorBoundary>
              ) : (
                <div className="flex items-center justify-center h-full text-slate-500">No chart data available.</div>
              )}
            </div>
            
            {/* AI Quant Insight Panel */}
            {getAnalysisInsight()}

          </div>
        </div>

        {/* Right Panel: Watchlist & Modules */}
        <aside className="w-[300px] flex-shrink-0 flex flex-col gap-4">
          
          {/* Advanced Analysis Modules */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl">
            <h2 className="font-semibold text-slate-100 flex items-center mb-2 text-sm">
              <Zap className="w-4 h-4 mr-2 text-yellow-400" />
              Scoring Engine (점수제 필터)
            </h2>
            <p className="text-xs text-slate-400 mb-4 leading-relaxed">
              엄격한 탈락(Hard Filter) 대신 6개의 핵심 기준을 통과할 때마다 점수를 부여하여 시장 상황에 유연하게 대응합니다. (4점 이상: 관심, 5점: 우수, 6점: A-Grade)
            </p>
            {!isScoring ? (
              <button 
                onClick={() => runScoringEngine(true)}
                className="w-full flex items-center justify-center px-4 py-2 text-white text-xs font-bold rounded shadow-lg transition-all bg-indigo-600 hover:bg-indigo-500 shadow-indigo-500/20"
              >
                <Activity className="w-4 h-4 mr-2" />
                🚀 전체 시장 스캔 시작 (약 5~10분 소요)
              </button>
            ) : (
              <div className="w-full bg-slate-800 rounded p-3 shadow-inner">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-medium text-indigo-400 flex items-center">
                    <Activity className="w-3 h-3 mr-1 animate-spin" />
                    스캔 분석 중...
                  </span>
                  <span className="text-xs text-slate-300 font-bold">
                    {scanProgress.total > 0 ? `${Math.round((scanProgress.current / scanProgress.total) * 100)}%` : '0%'}
                  </span>
                </div>
                <div className="w-full bg-slate-700 rounded-full h-2 mb-1 overflow-hidden">
                  <div 
                    className="bg-indigo-500 h-2 rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${scanProgress.total > 0 ? (scanProgress.current / scanProgress.total) * 100 : 0}%` }}
                  ></div>
                </div>
                <div className="text-[10px] text-slate-400 flex justify-between mt-1">
                  <span>
                    {scanStartTime && scanProgress.current > 0 ? (
                      (() => {
                        const elapsed = Date.now() - scanStartTime;
                        const msPerItem = elapsed / scanProgress.current;
                        const remain = (scanProgress.total - scanProgress.current) * msPerItem;
                        return remain > 60000 
                          ? `⏳ 약 ${Math.ceil(remain / 60000)}분 남음`
                          : `⏳ 약 ${Math.ceil(remain / 1000)}초 남음`;
                      })()
                    ) : '⏳ 계산 중...'}
                  </span>
                  <span>{scanProgress.current.toLocaleString()} / {scanProgress.total.toLocaleString()} 완료</span>
                </div>
              </div>
            )}
          </div>

          {/* Watchlist / All Stocks Panel */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl flex-1 flex flex-col min-h-[400px]">
            {/* Tabs */}
            <div className="flex mb-4 p-1 bg-slate-800/50 rounded-lg shrink-0">
              <button 
                onClick={() => setRightTab('watchlist')} 
                className={`flex-1 text-sm font-medium py-1.5 rounded-md transition-colors ${rightTab === 'watchlist' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}
              >
                Watchlist
              </button>
              <button 
                onClick={() => setRightTab('all')} 
                className={`flex-1 text-sm font-medium py-1.5 rounded-md transition-colors ${rightTab === 'all' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}
              >
                All Stocks
              </button>
            </div>

            {rightTab === 'watchlist' ? (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="space-y-2 overflow-y-auto flex-1 pr-2 custom-scrollbar">
                  {watchlistTickers.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-slate-500 p-4 text-center">
                      <ShieldAlert className="w-8 h-8 mb-2 opacity-50" />
                      <p className="text-sm font-medium text-slate-400">조건을 만족하는 종목이 없습니다</p>
                      <p className="text-xs mt-1">현재 시장 장세가 불안정하여 4점 이상을 획득한 주도주 후보가 없습니다.</p>
                    </div>
                  ) : (
                    [...watchlistTickers].sort((a, b) => {
                      const scoreA = scoredStocks[a]?.score || 0;
                      const scoreB = scoredStocks[b]?.score || 0;
                      return scoreB - scoreA;
                    }).map(ticker => {
                      const score = scoredStocks[ticker]?.score || 0;
                      const isAGrade = score === 6;
                      const isGood = score === 5;
                      return (
                        <div 
                          key={ticker}
                          className={`flex justify-between items-center p-2 rounded-lg cursor-pointer transition-colors ${
                            activeTicker === ticker ? 'bg-blue-900/30 border border-blue-500/30 shadow-[0_0_10px_rgba(59,130,246,0.15)]' : 'hover:bg-slate-800/50 border border-transparent'
                          }`}
                          onClick={() => setActiveTicker(ticker)}
                        >
                          <div className="flex items-center">
                            <span className="font-medium text-slate-200 mr-2 text-sm">{allTickerNames[ticker] || 'Unknown'}</span>
                            {isAGrade && <span className="text-[9px] font-bold bg-yellow-500/20 text-yellow-400 border border-yellow-500/50 px-1.5 py-0.5 rounded uppercase">A-Grade</span>}
                            {isGood && <span className="text-[9px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 px-1.5 py-0.5 rounded uppercase">5 Points</span>}
                            {!isAGrade && !isGood && <span className="text-[9px] font-bold bg-slate-500/20 text-slate-400 border border-slate-500/50 px-1.5 py-0.5 rounded uppercase">{score} Pts</span>}
                          </div>
                          <span className="text-xs text-slate-500 font-mono">{ticker}</span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="relative mb-3 shrink-0">
                  <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                  <input 
                    type="text" 
                    placeholder="종목명 또는 코드 검색..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg py-2 pl-9 pr-3 text-sm focus:outline-none focus:border-blue-500 text-slate-200 transition-colors"
                  />
                </div>
                <div className="space-y-1 overflow-y-auto flex-1 pr-2 custom-scrollbar">
                  {Object.entries(allTickerNames)
                    .filter(([ticker, name]) => name.includes(searchQuery) || ticker.includes(searchQuery))
                    .map(([ticker, name]) => (
                      <div 
                        key={ticker}
                        className={`flex justify-between items-center p-2 rounded-lg cursor-pointer transition-colors ${
                          activeTicker === ticker ? 'bg-blue-900/30 border border-blue-500/30' : 'hover:bg-slate-800/50 border border-transparent'
                        }`}
                        onClick={() => setActiveTicker(ticker)}
                      >
                        <span className="font-medium text-slate-200 text-sm">{name}</span>
                        <span className="text-xs text-slate-500 font-mono">{ticker}</span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        </aside>

      </main>
    </div>
  );
}

export default App;
