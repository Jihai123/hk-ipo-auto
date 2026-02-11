export default function MarketSnapshotSection() {
  const marketData = {
    avgReturn: {
      value: '+18.2%',
      label: '近10只IPO首日平均涨幅',
      trend: 'up',
      detail: '数据更新：2026-02-10'
    },
    breakRate: {
      value: '32%',
      label: '近10只新股破发率',
      trend: 'neutral',
      detail: '低于历史平均值'
    },
    heatIndex: {
      value: '78',
      label: '打新热度指数',
      trend: 'up',
      detail: '市场情绪：积极'
    },
    subscriptionMultiple: {
      value: '12.5x',
      label: '平均超额认购倍数',
      trend: 'up',
      detail: '资金追捧程度较高'
    }
  };

  const MetricCard = ({ data }) => {
    const getTrendIcon = (trend) => {
      if (trend === 'up') return '📈';
      if (trend === 'down') return '📉';
      return '➡️';
    };

    const getTrendColor = (trend) => {
      if (trend === 'up') return 'text-positive';
      if (trend === 'down') return 'text-negative';
      return 'text-neutral';
    };

    return (
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-6 border border-slate-700 hover:border-accent-start transition-colors">
        <div className="flex items-start justify-between mb-3">
          <span className="text-3xl">{getTrendIcon(data.trend)}</span>
          <span className={`text-4xl font-bold text-tabular ${getTrendColor(data.trend)}`}>
            {data.value}
          </span>
        </div>
        <h3 className="text-white font-semibold mb-2">
          {data.label}
        </h3>
        <p className="text-slate-400 text-sm">
          {data.detail}
        </p>
      </div>
    );
  };

  return (
    <section className="py-16 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="container mx-auto px-6 max-w-7xl">
        {/* 标题区 */}
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold text-white mb-4 flex items-center justify-center gap-3">
            <span className="text-5xl">🌐</span>
            当前打新市场环境
          </h2>
          <p className="text-slate-300 text-lg">
            实时追踪港股IPO市场表现，为您的决策提供数据支持
          </p>
        </div>

        {/* 数据指标网格 */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          <MetricCard data={marketData.avgReturn} />
          <MetricCard data={marketData.breakRate} />
          <MetricCard data={marketData.heatIndex} />
          <MetricCard data={marketData.subscriptionMultiple} />
        </div>

        {/* 底部说明 */}
        <div className="mt-8 text-center">
          <p className="text-slate-400 text-sm">
            数据每日更新 | 基于港交所官方数据与市场公开信息
          </p>
        </div>
      </div>
    </section>
  );
}
