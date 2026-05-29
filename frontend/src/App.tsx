import React, { useState, useEffect } from 'react';
import { ShieldAlert, Zap, TrendingUp, Search, Activity, AlertTriangle, Shield, Layers, Crosshair, Bot, Bell, Settings, Wifi, WifiOff } from 'lucide-react';
import TradingChart from './components/TradingChart';
import axios from 'axios';


// 배포 환경에서는 VITE_BACKEND_URL 환경 변수를 사용하고, 로컬에서는 8000번 포트를 사용합니다.
// Render 환경 등에서 VITE_BACKEND_URL 설정이 누락되거나 잘못되었을 때를 대비한 자동 감지(Auto-detect) 폴백을 포함합니다.
const getBackendUrl = () => {
  if (typeof window !== 'undefined' && window.localStorage) {
    const savedUrl = window.localStorage.getItem('VITE_BACKEND_URL');
    if (savedUrl) {
      return savedUrl;
    }
  }
  const envUrl = import.meta.env.VITE_BACKEND_URL;
  if (envUrl && envUrl !== 'http://localhost:8000') {
    return envUrl;
  }
  if (typeof window !== 'undefined' && window.location) {
    const hostname = window.location.hostname;
    if (hostname.includes('onrender.com')) {
      if (hostname.includes('-frontend')) {
        const protocol = window.location.protocol;
        const backendHost = hostname.replace('-frontend', '-backend');
        return `${protocol}//${backendHost}`;
      }
    }
  }
  return 'http://localhost:8000';
};

const BACKEND_URL = getBackendUrl();
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

  // Backend URL Connection States
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [backendUrlInput, setBackendUrlInput] = useState(BACKEND_URL);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'error' | 'testing' | 'idle'>('idle');
  const [connectionErrorMessage, setConnectionErrorMessage] = useState('');

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
  const [sectorAnalysis, setSectorAnalysis] = useState<any>(null);

  // Load ALL tickers once and test connection
  useEffect(() => {
    const fetchAllStocks = async () => {
      setConnectionStatus('testing');
      try {
        const res = await axios.get(`${BACKEND_URL}/api/v4/stocks`, { 
          headers: { "Bypass-Tunnel-Reminder": "true" },
          timeout: 50000
        });
        if (res.data) {
          setAllTickerNames(res.data);
          setConnectionStatus('connected');
        }
      } catch (err: any) {
        console.error("Backend connection failed:", err);
        setConnectionStatus('error');
        setConnectionErrorMessage(err.message || 'connection failed');
        // Automatically open settings modal if on Render and connection failed
        if (typeof window !== 'undefined' && window.location.hostname.includes('onrender.com')) {
          setShowSettingsModal(true);
        }
      }
    };
    fetchAllStocks();
  }, []);

  const handleSaveBackendUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    setConnectionStatus('testing');
    try {
      let targetUrl = backendUrlInput.trim();
      if (targetUrl.endsWith('/')) {
        targetUrl = targetUrl.slice(0, -1);
      }
      
      // Ping check
      await axios.get(`${targetUrl}/api/v4/stocks`, { 
        headers: { "Bypass-Tunnel-Reminder": "true" },
        timeout: 50000 
      });
      
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('VITE_BACKEND_URL', targetUrl);
      }
      
      setConnectionStatus('connected');
      setShowSettingsModal(false);
      window.location.reload();
    } catch (err: any) {
      console.error("Failed to connect to custom backend:", err);
      setConnectionStatus('error');
      setConnectionErrorMessage(`Connection test failed: ${err.message}. Please verify the URL.`);
    }
  };

  const handleResetBackendUrl = () => {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem('VITE_BACKEND_URL');
    }
    window.location.reload();
  };

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
          
          if (res.data.sectors && Object.keys(res.data.sectors).length > 0) {
            setSectorAnalysis({
              sectors: res.data.sectors,
              topPicks: res.data.sector_top_picks || {}
            });
          }
          
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
              
              // Also fetch final status to get final sector data
              const finalStatusRes = await axios.get(`${BACKEND_URL}/api/v4/screener/status`, { headers: { "Bypass-Tunnel-Reminder": "true" } });
              if (finalStatusRes.data && finalStatusRes.data.sectors) {
                setSectorAnalysis({
                  sectors: finalStatusRes.data.sectors,
                  topPicks: finalStatusRes.data.sector_top_picks || {}
                });
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

    const cci = latest.cci_20 !== undefined ? latest.cci_20 : 0;
    
    // Check if CCI recovered from below -100 to above -100 in the last 5 days
    const cdata = chartDataPayload.chart_data;
    let cciRecovered = false;
    if (cdata.length >= 5) {
      const pastCcis = cdata.slice(-5, -1).map((d: any) => d.cci_20 !== undefined ? d.cci_20 : 0);
      if (pastCcis.some((v: number) => v <= -100) && cci > -100) {
        cciRecovered = true;
      }
    }

    // Determine current market trend regime (상승 추세 vs 하락 추세)
    // 상승 추세: 주가가 200EMA 위, 20EMA > 50EMA, 주가가 AVWAP 또는 POC 위
    const isUpwardTrend = latest.close > latest.ema_200 && latest.ema_20 > latest.ema_50 && (latest.close > latest.avwap || latest.close > poc);

    const isStructSafe = latest.close > latest.avwap || latest.close > poc;
    const isMomSafe = latest.ema_20 > latest.ema_50 || latest.macd_hist > 0;
    const isPatSafe = latest.chandelier_exit > 0 && latest.close > latest.chandelier_exit;

    // Advanced Composite Scoring (out of 10 points)
    let cciPoints = 0;
    if (cci > 100) cciPoints += 2;
    else if (cci > 0) cciPoints += 1;
    
    if (cci < -100) cciPoints -= 1;
    if (cci > 200) cciPoints -= 1; // penalty for short-term overbought
    if (cciRecovered) cciPoints += 1; // bonus for rebound/pullback recovery

    // Make sure momentum score doesn't exceed 5 or fall below 0
    let momPillPoints = (latest.ema_20 > latest.ema_50 ? 1 : 0) + (latest.macd_hist > 0 ? 1 : 0) + cciPoints;
    momPillPoints = Math.max(0, Math.min(5, momPillPoints));

    const structPillPoints = (latest.close > latest.avwap ? 1 : 0) + (latest.close > poc ? 1 : 0);
    const riskPillPoints = (latest.chandelier_exit > 0 && latest.close > latest.chandelier_exit) ? 2 : 0;
    const fundPillPoints = 1;

    const totalCompositeScore = fundPillPoints + structPillPoints + momPillPoints + riskPillPoints;

    let opinionTitle = "";
    let opinionText = "";
    let opinionColor = "";

    if (totalCompositeScore >= 9) {
      opinionTitle = "👑 적극 매수 / 추세 추종 (Strong Buy & Trend Following)";
      opinionText = "시장 구조, 모멘텀(CCI 강세), 리스크 방어선이 모두 강력한 상승 에너지와 견고한 지지를 나타냅니다. 모멘텀이 최대로 활성화된 핵심 주도주 국면으로 즉각적인 추세 추종 진입이 유리합니다.";
      opinionColor = "bg-emerald-950/40 border-emerald-500/50 text-emerald-400";
    } else if (totalCompositeScore >= 7) {
      opinionTitle = "📈 분할 매수 / 눌림목 진입 (Buy on Dips / Hold)";
      opinionText = "상승 추세가 안전하게 유지되는 상태에서, CCI 지표가 0선이나 -100 근처까지 하락 조을 받았다가 반등하거나 눌림목을 형성하는 건전한 조정 구간입니다. 저점 분할 매수 타이밍으로 가장 적합합니다.";
      opinionColor = "bg-blue-950/40 border-blue-500/50 text-blue-400";
    } else if (totalCompositeScore >= 4) {
      opinionTitle = "⚠️ 주의 / 관망 요망 (Caution / Wait & See)";
      opinionText = "단기 하락 모멘텀이 강하게 작용 중이거나 과열 우려가 있어 진입을 잠시 멈추고 관망해야 하는 단계입니다. CCI 지표가 -100을 복구하고 주가가 핵심 이평선 또는 AVWAP을 안착하는 것을 먼저 확인해야 합니다.";
      opinionColor = "bg-amber-950/40 border-amber-500/50 text-amber-400";
    } else {
      opinionTitle = "❌ 매수 금지 / 리스크 관리 (Strong Sell / Avoid)";
      opinionText = "주요 하방 지지선이 이탈하고 CCI가 -100 이하의 하락 모멘텀 깊은 곳에 갇혀 있습니다. 단순 낙폭과대로 매수(칼날 잡기)하는 것을 금하며, 즉각적인 진입 보류 및 보유 물량의 리스크 관리가 절대적으로 필요합니다.";
      opinionColor = "bg-rose-950/40 border-rose-500/50 text-rose-400";
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
            <div className={`flex items-center font-bold text-xs mb-2 ${isMomSafe ? 'text-emerald-400' : 'text-slate-500'}`}><Activity className="w-4 h-4 mr-1"/> 모멘텀 (CCI 반영)</div>
            <div className="text-xs text-slate-400 leading-relaxed space-y-1">
              <p>• <strong>CCI(20):</strong> <span className={`font-bold ${cci > 100 ? "text-emerald-400" : cci < -100 ? "text-rose-400" : "text-blue-400"}`}>{cci.toFixed(1)}</span> ({
                cci > 200 ? "단기 과열 경계" :
                cci > 100 ? "상승 모멘텀 강세" :
                cci > 0 ? "평균 이상 강세" :
                cci < -200 ? "단기 투매 과매도" :
                cci < -100 ? "하락 모멘텀 강세" :
                "평균 이하 약세"
              })</p>
              <p>• {isMomSafe ? "20EMA가 50EMA 위에 있거나 MACD 에너지가 상승 흐름을 보이고 있습니다." : "이평선 역배열 또는 MACD 음수 구간으로 하방 힘이 작용하고 있습니다."}</p>
              {cciRecovered && <p className="text-emerald-400 text-[10px] font-semibold animate-pulse">• CCI -100 선 탈출 (눌림 반등 확인 신호)</p>}
            </div>
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
        <div className={`mt-4 p-4 rounded-lg border flex flex-col md:flex-row md:items-start ${opinionColor} gap-3`}>
          <div className="flex-shrink-0">
            {totalCompositeScore >= 9 ? <TrendingUp className="w-6 h-6" /> : 
             totalCompositeScore >= 7 ? <Activity className="w-6 h-6" /> : 
             totalCompositeScore >= 4 ? <AlertTriangle className="w-6 h-6" /> : 
             <ShieldAlert className="w-6 h-6" />}
          </div>
          <div className="flex-1 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="font-bold text-sm">💡 종합 의견: {opinionTitle}</h4>
              <div className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-950/40 border border-slate-700">
                Composite Score: <span className="font-mono">{totalCompositeScore}/10</span>
              </div>
            </div>
            <p className="text-xs opacity-90 leading-relaxed">{opinionText}</p>
            
            <div className="p-3 bg-slate-950/30 rounded-lg border border-white/5 space-y-1 text-[11px] text-slate-350">
              <p className="font-bold text-slate-200">🔍 CCI 지표 연계 분석 요약</p>
              {isUpwardTrend ? (
                <div className="space-y-1">
                  <p>• <strong>현재 국면:</strong> 📈 장기 상승 추세 (Bullish Regime)</p>
                  {cci > 200 && <p className="text-amber-400 font-bold">• [주의] CCI {cci.toFixed(1)} (단기 과열): 상승장이지만 신규 추격 매수는 늦을 수 있으므로 이격 조정을 대기해야 합니다.</p>}
                  {cci > 100 && cci <= 200 && <p className="text-emerald-400 font-semibold">• [강한 매수] CCI {cci.toFixed(1)} (+100 위): 모멘텀이 매우 강력한 구간으로 추세 추종 매매에 최적의 시기입니다.</p>}
                  {cci <= 100 && cci >= -100 && <p className="text-blue-400">• [눌림목/관망] CCI {cci.toFixed(1)} (평균 조정): 주가가 20EMA/AVWAP 지지를 받으며 CCI가 다시 0선 또는 +100을 재돌파하는 시점이 최적의 진입 찬스입니다.</p>}
                  {cci < -100 && <p className="text-rose-400 font-semibold">• [과매도 조정] CCI {cci.toFixed(1)} (-100 이하): 상승 추세 중 단기 깊은 조정 상태입니다. 양봉 반등과 CCI 복구를 기다리는 것이 유리합니다.</p>}
                </div>
              ) : (
                <div className="space-y-1">
                  <p>• <strong>현재 국면:</strong> 📉 단기 하락/조정 국면 (Bearish Regime)</p>
                  {cci < -100 && <p className="text-rose-400 font-bold">• [매수 금지] CCI {cci.toFixed(1)} (-100 이하): 하락 압력이 매우 강합니다. 칼날 잡기를 피하고 바닥 신호가 확정될 때까지 대기하세요.</p>}
                  {cciRecovered && <p className="text-emerald-400 font-semibold">• [반등 신호] CCI {cci.toFixed(1)} (-100 상방 탈출): 단기 기술적 반등 가능성이 열립니다. 20EMA 또는 AVWAP 돌파를 2차 조건으로 확인하세요.</p>}
                  {cci >= 0 && cci < 100 && <p className="text-amber-400">• [압력 완화] CCI {cci.toFixed(1)} (0선 회복): 하락 세력이 누그러지고 바닥을 다지는 신호입니다. 거래대금 증가 여부가 결정적입니다.</p>}
                  {cci >= 100 && <p className="text-emerald-400 font-bold">• [추세 전환] CCI {cci.toFixed(1)} (+100 돌파): 하락 추세 탈출 및 상승 추세 전환 에너지가 매우 강하게 유입되는 신호입니다.</p>}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderTradingAdvice = () => {
    if (!chartDataPayload || !chartDataPayload.chart_data || chartDataPayload.chart_data.length === 0) return null;
    const latest = chartDataPayload.chart_data[chartDataPayload.chart_data.length - 1];
    const poc = chartDataPayload.poc_price;

    const cci = latest.cci_20 !== undefined ? latest.cci_20 : 0;
    
    const cdata = chartDataPayload.chart_data;
    let cciRecovered = false;
    if (cdata.length >= 5) {
      const pastCcis = cdata.slice(-5, -1).map((d: any) => d.cci_20 !== undefined ? d.cci_20 : 0);
      if (pastCcis.some((v: number) => v <= -100) && cci > -100) {
        cciRecovered = true;
      }
    }

    const cciPoints = (cci > 100 ? 2 : (cci > 0 ? 1 : 0)) + (cci < -100 ? -1 : 0) + (cci > 200 ? -1 : 0) + (cciRecovered ? 1 : 0);
    let momPillPoints = (latest.ema_20 > latest.ema_50 ? 1 : 0) + (latest.macd_hist > 0 ? 1 : 0) + cciPoints;
    momPillPoints = Math.max(0, Math.min(5, momPillPoints));

    const structPillPoints = (latest.close > latest.avwap ? 1 : 0) + (latest.close > poc ? 1 : 0);
    const riskPillPoints = (latest.chandelier_exit > 0 && latest.close > latest.chandelier_exit) ? 2 : 0;
    const fundPillPoints = 1;

    const totalCompositeScore = fundPillPoints + structPillPoints + momPillPoints + riskPillPoints;

    if (!(latest.chandelier_exit > 0 && systemStatus)) return null;

    let suggested_entry = latest.close;
    let entry_text = "";
    
    if (totalCompositeScore >= 9) {
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
      <div className="mt-4 p-4 border border-slate-800/50 flex flex-col gap-4 bg-slate-900/30 rounded-lg animate-fade-in shadow-xl">
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
            <button 
              onClick={() => {
                setBackendUrlInput(BACKEND_URL);
                setShowSettingsModal(true);
              }}
              className={`p-1.5 border rounded-full transition-colors flex items-center justify-center ${
                connectionStatus === 'connected' 
                  ? 'bg-slate-800/80 hover:bg-slate-700/80 border-slate-700 text-slate-350 hover:text-white' 
                  : 'bg-rose-950/20 hover:bg-rose-900/30 border-rose-900/50 text-rose-400 animate-pulse'
              }`}
              title="Backend Server Settings"
            >
              <Settings className="w-4 h-4" />
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
                <span className="font-bold">{scoredStocks[activeTicker]?.name || allTickerNames[activeTicker] || activeTicker} <span className="text-slate-400 text-sm font-normal">({activeTicker})</span></span>
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
            {renderTradingAdvice()}

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

          {/* Sector Trend Tracker */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl flex flex-col mb-4">
            <h2 className="font-semibold text-slate-100 flex items-center mb-2 text-sm">
              <Layers className="w-4 h-4 mr-2 text-blue-400" />
              주도 섹터 트래커 (Leading Sectors)
            </h2>
            <p className="text-[11px] text-slate-400 mb-4 leading-relaxed">
              상승 추세 종목 비중(Bullish Ratio)이 높은 주도 섹터와 핵심 탑픽 종목을 실시간으로 분석합니다. (기준: Close &gt; 200EMA 및 20EMA &gt; 50EMA)
            </p>
            
            {!sectorAnalysis ? (
              <div className="flex flex-col items-center justify-center py-6 text-center bg-slate-950/40 border border-slate-800/80 rounded-xl p-3">
                <Activity className="w-6 h-6 mb-2 text-slate-600 animate-pulse" />
                <p className="text-xs text-slate-400 font-medium">섹터 데이터 분석 대기 중</p>
                <p className="text-[10px] text-slate-500 mt-1 leading-normal">
                  위의 스캔 시작 버튼을 누르면 실시간으로 10대 테마별 업종 분석이 진행됩니다.
                </p>
              </div>
            ) : (
              <div className="space-y-4 max-h-[350px] overflow-y-auto pr-1 custom-scrollbar">
                {/* Sector List */}
                <div className="space-y-2.5">
                  {Object.entries(sectorAnalysis.sectors)
                    .sort((a: any, b: any) => b[1] - a[1]) // Sort by bullish ratio descending
                    .map(([secName, ratio]: any) => {
                      const isLeading = ratio >= 50;
                      const barColor = ratio >= 60 ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]' : ratio >= 45 ? 'bg-blue-500' : 'bg-slate-600';
                      
                      return (
                        <div key={secName} className="space-y-1">
                          <div className="flex justify-between text-[11px] font-semibold">
                            <span className="text-slate-200 flex items-center">
                              {secName}
                              {isLeading && <span className="ml-1.5 text-[8px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-1 rounded uppercase tracking-wider font-sans">주도</span>}
                            </span>
                            <span className={ratio >= 60 ? 'text-emerald-400 font-mono' : ratio >= 45 ? 'text-blue-400 font-mono' : 'text-slate-400 font-mono'}>
                              {ratio.toFixed(0)}% Bullish
                            </span>
                          </div>
                          <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden border border-slate-850">
                            <div 
                              className={`h-1.5 rounded-full transition-all duration-700 ease-out ${barColor}`}
                              style={{ width: `${ratio}%` }}
                            ></div>
                          </div>
                        </div>
                      );
                    })}
                </div>

                {/* Leading Sector Top Picks */}
                <div className="border-t border-slate-800/80 pt-3">
                  <h3 className="text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-2 flex items-center">
                    <Zap className="w-3.5 h-3.5 mr-1 text-yellow-400" />
                    주도 섹터 핵심 탑픽 (Top Picks)
                  </h3>
                  <div className="space-y-1.5">
                    {(() => {
                      // Get top picks from sectors with ratio >= 45%
                      const leadingSectors = Object.entries(sectorAnalysis.sectors)
                        .filter(([_, ratio]: any) => ratio >= 45) // Show picks from >=45% bullish sectors
                        .map(([name]) => name);
                      
                      const picks: any[] = [];
                      leadingSectors.forEach(secName => {
                        const sectorPicks = (sectorAnalysis.topPicks as any)[secName] || [];
                        sectorPicks.forEach((p: any) => {
                          picks.push({ ...p, sector: secName });
                        });
                      });

                      const uniquePicks = picks
                        .filter((v, i, a) => a.findIndex(t => t.ticker === v.ticker) === i)
                        .sort((a, b) => b.score - a.score)
                        .slice(0, 4);

                      if (uniquePicks.length === 0) {
                        return (
                          <p className="text-[10px] text-slate-500 leading-relaxed text-center py-2 bg-slate-950/20 rounded-lg font-sans">
                            현재 주도 섹터(상승 추세 45% 이상) 내에 4점 이상을 획득한 추천 탑픽 종목이 없습니다. 스캔이 완료되면 채워집니다.
                          </p>
                        );
                      }

                      return uniquePicks.map((pick: any) => (
                        <div 
                          key={pick.ticker} 
                          onClick={() => setActiveTicker(pick.ticker)}
                          className={`flex items-center justify-between p-2 bg-slate-950/40 hover:bg-slate-800/50 border border-slate-800/60 hover:border-slate-700/80 rounded-xl cursor-pointer transition-all ${
                            activeTicker === pick.ticker ? 'border-blue-500/50 bg-blue-950/20 shadow-[0_0_10px_rgba(59,130,246,0.15)]' : ''
                          }`}
                        >
                          <div className="flex flex-col">
                            <span className="text-xs font-bold text-slate-200">{pick.name}</span>
                            <span className="text-[9px] text-slate-500 font-mono mt-0.5">{pick.ticker} · {pick.sector}</span>
                          </div>
                          <div className="flex items-center space-x-1.5">
                            <span className="text-[10px] font-bold text-yellow-400 bg-yellow-500/10 border border-yellow-500/30 px-1.5 py-0.5 rounded font-mono">
                              {pick.score} Pts
                            </span>
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
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
                            <span className="font-medium text-slate-200 mr-2 text-sm">{scoredStocks[ticker]?.name || allTickerNames[ticker] || 'Unknown'}</span>
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

      {/* Backend Settings Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden transform scale-in transition-all text-slate-100">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-855 bg-slate-950/40">
              <div className="flex items-center space-x-2">
                <Settings className="w-4 h-4 text-blue-400" />
                <h3 className="text-sm font-bold text-slate-200">백엔드 서버 연결 설정 (Backend Connection)</h3>
              </div>
              <button 
                onClick={() => setShowSettingsModal(false)}
                className="text-slate-500 hover:text-slate-350 text-sm font-semibold transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Modal Content */}
            <form onSubmit={handleSaveBackendUrl} className="p-6 space-y-4">
              <div className="space-y-2">
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  백엔드 서버 주소 (Backend API URL)
                </label>
                <div className="relative">
                  <input
                    type="url"
                    value={backendUrlInput}
                    onChange={(e) => setBackendUrlInput(e.target.value)}
                    placeholder="https://joosik-backend-xxxx.onrender.com"
                    required
                    className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-slate-200 transition-all font-mono"
                  />
                  <div className="absolute right-3.5 top-1/2 transform -translate-y-1/2 flex items-center">
                    {connectionStatus === 'connected' && <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></span>}
                    {connectionStatus === 'error' && <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]"></span>}
                    {connectionStatus === 'testing' && <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.5)]"></span>}
                  </div>
                </div>
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  Render 대시보드에서 <strong>joosik-backend</strong> 서비스 주소를 복사하여 입력해 주세요. (예: <code className="text-blue-400 bg-slate-950/80 px-1 py-0.5 rounded font-mono">https://joosik-backend-c6tc.onrender.com</code>)
                </p>
              </div>

              {/* Status Alert */}
              {connectionStatus === 'error' && (
                <div className="flex items-start space-x-2.5 p-3.5 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-xs">
                  <WifiOff className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <div className="space-y-1">
                    <p className="font-bold">서버 연결 실패</p>
                    <p className="text-slate-400 leading-normal text-[11px]">{connectionErrorMessage}</p>
                  </div>
                </div>
              )}

              {connectionStatus === 'connected' && (
                <div className="flex items-center space-x-2.5 p-3.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-xs font-semibold">
                  <Wifi className="w-4 h-4 flex-shrink-0 text-emerald-400 animate-pulse" />
                  <p>백엔드 서버와 성공적으로 연결되었습니다!</p>
                </div>
              )}

              {connectionStatus === 'testing' && (
                <div className="flex items-start space-x-2.5 p-3.5 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-400 text-xs font-medium">
                  <div className="w-3.5 h-3.5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin flex-shrink-0 mt-0.5"></div>
                  <div className="space-y-1">
                    <p className="font-bold">서버 연결 상태 테스트 중...</p>
                    <p className="text-slate-400 text-[10px] leading-relaxed font-normal">
                      Render 무료 서버 특성상 장시간 미사용 시 서버가 휴면 상태로 전환됩니다. 깨어나는 데 <strong>최대 50초</strong> 정도 소요될 수 있으니 잠시만 기다려 주세요!
                    </p>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex space-x-3 pt-4 border-t border-slate-800/80">
                <button
                  type="button"
                  onClick={handleResetBackendUrl}
                  className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-750 text-slate-300 text-xs font-bold rounded-xl transition-all border border-slate-700/40"
                >
                  기본값 초기화
                </button>
                <button
                  type="submit"
                  disabled={connectionStatus === 'testing'}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-all shadow-lg shadow-blue-500/20"
                >
                  연결 테스트 및 저장
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
