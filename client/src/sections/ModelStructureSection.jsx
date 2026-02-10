export default function ModelStructureSection() {
  const modelStructure = [
    { name: 'Fundamentals', weight: 25, color: 'bg-green-500', description: 'Revenue growth, profitability, debt levels' },
    { name: 'Valuation', weight: 20, color: 'bg-blue-500', description: 'P/E ratio, P/S ratio, industry comparison' },
    { name: 'Market Sentiment', weight: 15, color: 'bg-purple-500', description: 'Subscription levels, media coverage, analyst opinions' },
    { name: 'Cornerstone Strength', weight: 15, color: 'bg-indigo-500', description: 'Investor quality, lock-up periods, allocation size' },
    { name: 'Industry Trend', weight: 15, color: 'bg-pink-500', description: 'Sector momentum, regulatory environment, peer performance' },
    { name: 'Risk Adjustments', weight: -10, color: 'bg-red-500', description: 'Legal issues, market volatility, execution risks' },
  ];

  return (
    <section className="py-16 bg-white">
      <div className="container mx-auto px-6 max-w-7xl">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">Quant Model Structure</h2>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            Our proprietary scoring system evaluates IPOs across 6 key dimensions with quantifiable metrics
          </p>
        </div>

        <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-2xl p-10 shadow-xl">
          {/* Tree Structure */}
          <div className="mb-8">
            <div className="bg-gradient-to-r from-indigo-500 to-purple-500 text-white text-center py-4 px-6 rounded-lg font-bold text-xl shadow-lg mb-8">
              Final IPO Score (0-100)
            </div>

            <div className="space-y-4">
              {modelStructure.map((dimension, index) => (
                <div key={index} className="flex items-center gap-4">
                  {/* Connector Line */}
                  <div className="w-12 border-t-2 border-gray-300"></div>

                  {/* Dimension Card */}
                  <div className="flex-1 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow p-5 border-l-4" style={{ borderColor: dimension.color.replace('bg-', '') === 'green-500' ? '#10b981' : dimension.color.replace('bg-', '') === 'blue-500' ? '#3b82f6' : dimension.color.replace('bg-', '') === 'purple-500' ? '#a855f7' : dimension.color.replace('bg-', '') === 'indigo-500' ? '#6366f1' : dimension.color.replace('bg-', '') === 'pink-500' ? '#ec4899' : '#ef4444' }}>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-bold text-gray-900 text-lg">{dimension.name}</h4>
                      <span className={`${dimension.color} text-white px-3 py-1 rounded-full font-bold text-sm`}>
                        {dimension.weight > 0 ? '+' : ''}{dimension.weight}%
                      </span>
                    </div>
                    <p className="text-sm text-gray-600">{dimension.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Summary */}
          <div className="bg-white rounded-lg p-6 shadow-md mt-8">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-3xl">⚙️</span>
              <h4 className="font-bold text-gray-900 text-lg">Model Methodology</h4>
            </div>
            <div className="grid md:grid-cols-3 gap-6 text-sm">
              <div>
                <div className="font-semibold text-gray-900 mb-2">📊 Data Sources</div>
                <div className="text-gray-600">HKEX filings, prospectuses, market data feeds, news sentiment</div>
              </div>
              <div>
                <div className="font-semibold text-gray-900 mb-2">🔄 Update Frequency</div>
                <div className="text-gray-600">Real-time during subscription period, daily for market data</div>
              </div>
              <div>
                <div className="font-semibold text-gray-900 mb-2">✅ Backtested Accuracy</div>
                <div className="text-gray-600">72% correlation with first-day performance (2022-2025)</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
