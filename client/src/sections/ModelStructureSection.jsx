export default function ModelStructureSection() {
  const scoringRules = [
    {
      icon: '🚀',
      name: '行业赛道评分',
      range: '-2 ~ +2',
      color: 'border-blue-500',
      examples: [
        { label: '热门赛道', value: '+2', desc: 'AI、芯片、新能源等' },
        { label: '成长赛道', value: '+1', desc: '医疗、SaaS、消费升级' },
        { label: '低弹性赛道', value: '-1', desc: '传统制造、地产' },
        { label: '回避赛道', value: '-2', desc: '教培、小贷' }
      ]
    },
    {
      icon: '💎',
      name: '基石投资者评分',
      range: '0 ~ +2',
      color: 'border-green-500',
      examples: [
        { label: '明星基石', value: '+2', desc: '高瓴、红杉、淡马锡等' },
        { label: '普通基石', value: '0', desc: '无明星机构' }
      ]
    },
    {
      icon: '🏆',
      name: '保荐人历史表现',
      range: '-2 ~ +2',
      color: 'border-purple-500',
      examples: [
        { label: '优秀保荐人', value: '+2', desc: '平均涨幅≥70%' },
        { label: '中等保荐人', value: '0', desc: '平均涨幅40-70%' },
        { label: '较差保荐人', value: '-2', desc: '平均涨幅<40%' }
      ]
    },
    {
      icon: '🔒',
      name: 'Pre-IPO锁定期',
      range: '-2 ~ 0',
      color: 'border-indigo-500',
      examples: [
        { label: '有禁售期', value: '0', desc: '≥6个月锁定期' },
        { label: '无禁售期', value: '-2', desc: '上市即可抛售' }
      ]
    },
    {
      icon: '⚠️',
      name: '旧股发售比例',
      range: '-2 ~ 0',
      color: 'border-red-500',
      examples: [
        { label: '无旧股', value: '0', desc: '全部新股发售' },
        { label: '有旧股', value: '-2', desc: '存在老股东套现' }
      ]
    }
  ];

  return (
    <section className="py-16 bg-gradient-to-br from-gray-50 to-slate-50" id="model">
      <div className="container mx-auto px-6 max-w-7xl">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">评分模型构成</h2>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            了解我们如何对新股进行量化评分
          </p>
        </div>

        {/* 评分规则卡片网格 */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
          {scoringRules.map((rule, index) => (
            <div
              key={index}
              className={`bg-white rounded-xl p-6 shadow-lg border-l-4 ${rule.color} hover:shadow-xl transition-shadow`}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{rule.icon}</span>
                  <h3 className="font-bold text-gray-900">{rule.name}</h3>
                </div>
                <span className="text-sm font-semibold text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
                  {rule.range}
                </span>
              </div>

              <div className="space-y-2">
                {rule.examples.map((example, idx) => (
                  <div key={idx} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700">{example.label}</span>
                    <span className={`font-bold ${
                      example.value.startsWith('+') ? 'text-positive' :
                      example.value.startsWith('-') ? 'text-negative' :
                      'text-gray-600'
                    }`}>
                      {example.value}
                    </span>
                  </div>
                ))}
              </div>

              <div className="mt-4 pt-4 border-t border-gray-200">
                <p className="text-xs text-gray-500">{rule.examples[0].desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* 评分说明 */}
        <div className="bg-white rounded-2xl p-8 shadow-xl border-2 border-gray-200">
          <div className="flex items-center gap-3 mb-6">
            <span className="text-3xl">⚙️</span>
            <h3 className="font-bold text-gray-900 text-2xl">评分方法说明</h3>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            <div>
              <div className="flex items-center gap-2 font-semibold text-gray-900 mb-2">
                <span>📊</span>
                <span>数据来源</span>
              </div>
              <div className="text-gray-600 text-sm">港交所披露易招股书、保荐人历史数据、行业分类数据库</div>
            </div>
            <div>
              <div className="flex items-center gap-2 font-semibold text-gray-900 mb-2">
                <span>🔄</span>
                <span>更新频率</span>
              </div>
              <div className="text-gray-600 text-sm">招股期实时更新，保荐人数据每周更新，行业数据每月更新</div>
            </div>
            <div>
              <div className="flex items-center gap-2 font-semibold text-gray-900 mb-2">
                <span>✅</span>
                <span>历史准确率</span>
              </div>
              <div className="text-gray-600 text-sm">基于2023-2025年历史数据回测，整体准确率78.2%</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
