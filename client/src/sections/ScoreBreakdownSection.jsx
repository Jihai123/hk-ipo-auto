import ScoreBadge from '../components/ScoreBadge';

export default function ScoreBreakdownSection() {
  const exampleStock = {
    code: '09660',
    name: '新氧',
    totalScore: 82,
    rating: '强烈推荐',
    breakdown: [
      {
        dimension: '行业赛道',
        score: '+2',
        icon: '🚀',
        color: 'text-positive',
        bgColor: 'bg-green-50',
        explanation: '医疗美容属当前热门赛道，市场关注度高'
      },
      {
        dimension: '基石投资者',
        score: '+2',
        icon: '💎',
        color: 'text-positive',
        bgColor: 'bg-green-50',
        explanation: '引入高瓴、红杉等明星基金，增强市场信心'
      },
      {
        dimension: '保荐人历史表现',
        score: '+1',
        icon: '🏆',
        color: 'text-positive',
        bgColor: 'bg-green-50',
        explanation: '保荐人过往IPO破发率低于30%'
      },
      {
        dimension: 'Pre-IPO锁定期',
        score: '0',
        icon: '🔒',
        color: 'text-gray-600',
        bgColor: 'bg-gray-50',
        explanation: '设有12个月禁售期，减少上市初期抛压'
      },
      {
        dimension: '旧股发售比例',
        score: '-2',
        icon: '⚠️',
        color: 'text-negative',
        bgColor: 'bg-red-50',
        explanation: '存在老股东套现，占比达30%'
      }
    ]
  };

  const ScoreDimensionRow = ({ item }) => (
    <div className={`flex items-center gap-4 p-4 rounded-lg ${item.bgColor} border-l-4 ${item.color.replace('text', 'border')}`}>
      <span className="text-3xl">{item.icon}</span>
      <div className="flex-1">
        <div className="flex items-center justify-between mb-1">
          <h4 className="font-bold text-gray-900">{item.dimension}</h4>
          <span className={`text-2xl font-bold text-tabular ${item.color}`}>
            {item.score}
          </span>
        </div>
        <p className="text-sm text-gray-600">{item.explanation}</p>
      </div>
    </div>
  );

  return (
    <section className="py-20 bg-white">
      <div className="container mx-auto px-6 max-w-6xl">
        {/* 标题区 */}
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            一只新股的评分是如何得出的？
          </h2>
          <p className="text-xl text-gray-600">
            透明化评分逻辑，让每一分都有据可依
          </p>
        </div>

        {/* 示例卡片 */}
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-8 shadow-xl border-2 border-blue-200">
          {/* 股票头部 */}
          <div className="flex items-center justify-between mb-8 pb-6 border-b-2 border-blue-200">
            <div>
              <h3 className="text-3xl font-bold text-gray-900 mb-2">
                {exampleStock.name} {exampleStock.code}
              </h3>
              <p className="text-lg text-gray-600">
                打新评分示例拆解
              </p>
            </div>
            <div className="text-center">
              <ScoreBadge score={exampleStock.totalScore} size="lg" showRating={false} />
              <p className="mt-2 text-sm font-semibold text-positive">
                {exampleStock.rating}
              </p>
            </div>
          </div>

          {/* 维度拆解 */}
          <div className="mb-6">
            <h4 className="text-xl font-bold text-gray-900 mb-4">维度拆解：</h4>
            <div className="space-y-3">
              {exampleStock.breakdown.map((item, index) => (
                <ScoreDimensionRow key={index} item={item} />
              ))}
            </div>
          </div>

          {/* 说明文字 */}
          <div className="bg-white rounded-lg p-6 border-2 border-blue-300">
            <div className="flex items-start gap-3">
              <span className="text-2xl">💡</span>
              <div>
                <h5 className="font-bold text-gray-900 mb-2">评分说明：</h5>
                <ul className="text-sm text-gray-700 space-y-1">
                  <li>• 总分范围：0-100分，由多个维度加权计算得出</li>
                  <li>• 每个维度根据招股书内容及历史数据动态打分</li>
                  <li>• 正向因素加分，负向因素扣分，最终形成综合评分</li>
                  <li>• 评分结果仅供参考，不构成投资建议</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* 底部提示 */}
        <div className="mt-8 text-center">
          <p className="text-gray-500">
            所有评分逻辑完全透明，您可以在评分详情页查看每个维度的具体证据
          </p>
        </div>
      </div>
    </section>
  );
}
