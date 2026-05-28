import os
import re

app_file = r'c:\Users\PC\Desktop\joosik\frontend\src\App.tsx'

with open(app_file, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Replace State
state_search = """  // 4 Advanced Modules State
  const [filterFundamental, setFilterFundamental] = useState(false);
  const [showMarketStructure, setShowMarketStructure] = useState(false);
  const [showMomentum, setShowMomentum] = useState(false);
  const [showPattern, setShowPattern] = useState(false);"""
state_replace = """  // Scoring Engine State
  const [scoredStocks, setScoredStocks] = useState<Record<string, any>>({});"""
content = content.replace(state_search, state_replace)

# 2. Update fetchAllStocks slightly to not set watchlist if not needed (we'll set it in fetchFiltered)
fetch_all_search = """          if (!filterFundamental) {
            setWatchlistTickers(Object.keys(res.data));
          }"""
fetch_all_replace = """          // Watchlist will be populated by the scoring engine"""
content = content.replace(fetch_all_search, fetch_all_replace)

# 3. Update fetchFiltered
fetch_filter_search = """  // Handle Watchlist Filtering
  useEffect(() => {
    const fetchFiltered = async () => {
      try {
        if (!filterFundamental && !showMarketStructure && !showMomentum && !showPattern) {
          setWatchlistTickers(Object.keys(allTickerNames));
          return;
        }
        
        const params = new URLSearchParams({
            fund: filterFundamental.toString(),
            struct: showMarketStructure.toString(),
            mom: showMomentum.toString(),
            pat: showPattern.toString()
        });
        
        const res = await axios.get(`http://localhost:8000/api/v4/screener/auto?${params.toString()}`);
        if (res.data) setWatchlistTickers(Object.keys(res.data));
      } catch (err) {
        console.error('Error fetching filtered stocks:', err);
      }
    };
    if (Object.keys(allTickerNames).length > 0) {
        fetchFiltered();
    }
  }, [filterFundamental, showMarketStructure, showMomentum, showPattern, allTickerNames]);"""

fetch_filter_replace = """  // Handle Scoring Engine Run
  const runScoringEngine = async () => {
    try {
      const res = await axios.get(`http://localhost:8000/api/v4/screener/auto`);
      if (res.data) {
        setScoredStocks(res.data);
        setWatchlistTickers(Object.keys(res.data));
      }
    } catch (err) {
      console.error('Error fetching scored stocks:', err);
    }
  };

  useEffect(() => {
    if (Object.keys(allTickerNames).length > 0) {
        runScoringEngine();
    }
  }, [allTickerNames]);"""
content = content.replace(fetch_filter_search, fetch_filter_replace)

# 4. Update AI Quant Insight
insight_search = """          <div className={`p-3 rounded-lg border ${filterFundamental ? 'bg-indigo-900/20 border-indigo-500/30' : 'bg-slate-800/30 border-slate-700/50'}`}>
            <div className={`flex items-center font-bold text-xs mb-2 ${filterFundamental ? 'text-indigo-400' : 'text-slate-500'}`}><Shield className="w-4 h-4 mr-1"/> 펀더멘털</div>
            <p className="text-xs text-slate-400 leading-relaxed">
              {filterFundamental 
                ? "우량주 필터 통과: 재무 건전성(F-Score) 및 파산 위험(Z-Score) 안전망을 통과한 초우량 기업입니다."
                : "펀더멘털 필터 OFF: 기업의 재무 상태보다는 차트 기술적 반등을 우선적으로 노리는 상태입니다."}
            </p>
          </div>"""
insight_replace = """          <div className={`p-3 rounded-lg border bg-indigo-900/20 border-indigo-500/30`}>
            <div className={`flex items-center font-bold text-xs mb-2 text-indigo-400`}><Shield className="w-4 h-4 mr-1"/> 펀더멘털</div>
            <p className="text-xs text-slate-400 leading-relaxed">
              유동성/우량주 필터 통과: 안정적인 거래대금과 최소 시가총액 요건을 만족하는 검증된 기업입니다.
            </p>
          </div>"""
content = content.replace(insight_search, insight_replace)

# 5. Update Advanced Analysis Modules Panel
panel_search_start = "          {/* Advanced Analysis Modules */}"
panel_search_end = "          <div className=\"bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl flex-1 flex flex-col min-h-[400px]\">"

panel_pattern = re.compile(r'          \{/\* Advanced Analysis Modules \*/\}.*?          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl flex-1 flex flex-col min-h-\[400px\]">', re.DOTALL)

panel_replace = """          {/* Advanced Analysis Modules */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl">
            <h2 className="font-semibold text-slate-100 flex items-center mb-2 text-sm">
              <Zap className="w-4 h-4 mr-2 text-yellow-400" />
              Scoring Engine (점수제 필터)
            </h2>
            <p className="text-xs text-slate-400 mb-4 leading-relaxed">
              엄격한 탈락(Hard Filter) 대신 6개의 핵심 기준을 통과할 때마다 점수를 부여하여 시장 상황에 유연하게 대응합니다. (4점 이상: 관심, 5점: 우수, 6점: A-Grade)
            </p>
            <button 
              onClick={runScoringEngine}
              className="w-full flex items-center justify-center px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded shadow-lg shadow-indigo-500/20 transition-all"
            >
              <Activity className="w-4 h-4 mr-2" />
              Run Auto Scoring Engine
            </button>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl flex-1 flex flex-col min-h-[400px]">"""

content = panel_pattern.sub(panel_replace, content)

# 6. Update Watchlist items
watch_search_start = "            <h2 className=\"font-semibold text-slate-100 flex items-center mb-4\">"
watch_search_end = "                  </div>\n                ))\n              )}\n            </div>"

watch_pattern = re.compile(r'            <h2 className="font-semibold text-slate-100 flex items-center mb-4">.*?                  </div>\n                \)\)\n              \)\}\n            </div>', re.DOTALL)

watch_replace = """            <h2 className="font-semibold text-slate-100 flex items-center mb-4">
              <Search className="w-4 h-4 mr-2 text-blue-400" />
              Watchlist
            </h2>
            <div className="space-y-2 overflow-y-auto flex-1 pr-2 custom-scrollbar">
              {watchlistTickers.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-500 p-4 text-center">
                  <ShieldAlert className="w-8 h-8 mb-2 opacity-50" />
                  <p className="text-sm font-medium text-slate-400">조건을 만족하는 종목이 없습니다</p>
                  <p className="text-xs mt-1">현재 시장 장세가 불안정하여 4점 이상을 획득한 주도주 후보가 없습니다.</p>
                </div>
              ) : (
                watchlistTickers.map(ticker => {
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
                        <span className="font-medium text-slate-200 mr-2">{allTickerNames[ticker] || 'Unknown'}</span>
                        {isAGrade && <span className="text-[9px] font-bold bg-yellow-500/20 text-yellow-400 border border-yellow-500/50 px-1.5 py-0.5 rounded uppercase">A-Grade</span>}
                        {isGood && <span className="text-[9px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 px-1.5 py-0.5 rounded uppercase">5 Points</span>}
                        {!isAGrade && !isGood && <span className="text-[9px] font-bold bg-slate-500/20 text-slate-400 border border-slate-500/50 px-1.5 py-0.5 rounded uppercase">{score} Pts</span>}
                      </div>
                      <span className="text-xs text-slate-500 font-mono">{ticker}</span>
                    </div>
                  );
                })
              )}
            </div>"""

content = watch_pattern.sub(watch_replace, content)

with open(app_file, 'w', encoding='utf-8') as f:
    f.write(content)
print("App.tsx rewritten successfully!")
