import { useState } from 'react';
import StockSearchInput from '../components/StockSearchInput';
import ScoreBadge from '../components/ScoreBadge';

export default function NewHeroSection() {
  const [searchResult, setSearchResult] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // 模拟Top新股列表数据（后续可改为API调用）
  const topIPOs = [
    { code: '09660', name: '新氧', score: 82, rating: '强烈推荐', icon: '🔥' },
    { code: '02768', name: '佳源国际', score: 78, rating: '建议申购', icon: '👍' },
    { code: '01234', name: '科技创新', score: 74, rating: '可以考虑', icon: '✓' },
    { code: '05678', name: '医药健康', score: 71, rating: '可以考虑', icon: '✓' },
    { code: '09876', name: '消费服务', score: 68, rating: '可以考虑', icon: '⚠️' },
  ];

  const handleSearch = async (stockCode) => {
    setIsLoading(true);
    setError(null);
    const requestUrl = `/api/score/${stockCode}`;
    const requestStartAt = Date.now();
    console.log('[score/front/react][request][start]', {
      triggerSource: 'hero_search',
      code: stockCode,
      url: requestUrl,
      timeout: 'browser-default',
    });

    try {
      const response = await fetch(requestUrl);
      const data = await response.json();

      if (data.success) {
        setSearchResult(data);
      } else {
        setError(data.message || '评分失败，请重试');
      }
      console.log('[score/front/react][request][end]', {
        triggerSource: 'hero_search',
        code: stockCode,
        url: requestUrl,
        timeout: 'browser-default',
        duration: Date.now() - requestStartAt,
        status: response.status,
        requestId: response.headers.get('X-Request-Id') || '',
      });
    } catch (err) {
      setError('网络错误，请检查连接');
      console.error('[score/front/react][request][fail]', {
        triggerSource: 'hero_search',
        code: stockCode,
        url: requestUrl,
        timeout: 'browser-default',
        duration: Date.now() - requestStartAt,
        errorMessage: err.message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const getRatingColor = (score) => {
    if (score >= 80) return 'text-positive';
    if (score >= 70) return 'text-neutral';
    if (score >= 60) return 'text-gray-600';
    return 'text-negative';
  };

  const getRatingBg = (score) => {
    if (score >= 80) return 'bg-green-50';
    if (score >= 70) return 'bg-yellow-50';
    if (score >= 60) return 'bg-gray-50';
    return 'bg-red-50';
  };

  return (
    <section className="pt-32 pb-20 bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <div className="container mx-auto px-6 max-w-7xl">
        {/* 产品定位标题 */}
        <div className="text-center mb-16">
          <h1 className="text-5xl font-bold text-gray-900 mb-4">
            港股打新量化评分系统
          </h1>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            基于基本面、基石结构、行业热度与市场环境的综合打新决策评分
          </p>
        </div>

        {/* 双核心模块 */}
        <div className="grid lg:grid-cols-2 gap-8 items-start">
          {/* 左侧：快速评分入口（核心功能） */}
          <div className="bg-white rounded-2xl p-8 shadow-2xl border-2 border-accent-start">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-2 flex items-center gap-2">
                <span className="text-3xl">🎯</span>
                快速评分入口
              </h2>
              <p className="text-gray-600">
                输入股票代码或公司名称，立即获取量化打新评分
              </p>
            </div>

            <StockSearchInput onSearch={handleSearch} isLoading={isLoading} />

            {/* 搜索结果展示 */}
            {searchResult && (
              <div className="mt-6 p-6 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border border-blue-200">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-xl font-bold text-gray-900">
                      {searchResult.prospectus?.name || searchResult.stockCode}
                    </h3>
                    <p className="text-sm text-gray-600">股票代码: {searchResult.stockCode}</p>
                  </div>
                  <ScoreBadge score={searchResult.totalScore} size="md" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-lg font-semibold text-gray-700">评级：</span>
                  <span className={`text-lg font-bold ${getRatingColor(searchResult.totalScore)}`}>
                    {searchResult.rating}
                  </span>
                </div>
                <button
                  onClick={() => window.location.href = `#score-${searchResult.stockCode}`}
                  className="mt-4 w-full bg-accent-start text-white py-2 rounded-lg font-semibold hover:bg-accent-mid transition-colors"
                >
                  查看完整评分详情
                </button>
              </div>
            )}

            {/* 错误提示 */}
            {error && (
              <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-700 text-sm">{error}</p>
              </div>
            )}
          </div>

          {/* 右侧：当前新股评分榜 */}
          <div className="bg-white rounded-2xl p-8 shadow-xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <span className="text-3xl">📊</span>
                当前新股评分榜
              </h2>
              <span className="flex items-center gap-2 text-sm text-gray-500">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                实时更新
              </span>
            </div>

            <p className="text-gray-600 mb-6">
              系统已自动评分的在招股或即将上市新股
            </p>

            <div className="space-y-3">
              {topIPOs.map((ipo, index) => (
                <div
                  key={ipo.code}
                  className="flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 rounded-xl transition-colors cursor-pointer border border-gray-200 hover:border-accent-start"
                  onClick={() => handleSearch(ipo.code)}
                >
                  <div className="flex items-center gap-4">
                    <span className="text-2xl font-bold text-gray-400 w-8">
                      #{index + 1}
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-gray-900">{ipo.code}</span>
                        <span className="text-gray-600">{ipo.name}</span>
                      </div>
                      <span className={`text-sm font-semibold ${getRatingColor(ipo.score)}`}>
                        {ipo.rating}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{ipo.icon}</span>
                    <div className={`text-3xl font-bold ${getRatingColor(ipo.score)}`}>
                      {ipo.score}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <button className="mt-6 w-full py-3 border-2 border-gray-300 text-gray-700 rounded-lg font-semibold hover:border-accent-start hover:text-accent-start transition-colors">
              查看完整榜单 →
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
