import ScoreBadge from '../components/ScoreBadge';

export default function FeaturedIPOSection() {
  return (
    <section className="py-16 bg-gradient-to-br from-indigo-50 to-purple-50">
      <div className="container mx-auto px-6 max-w-7xl">
        <h2 className="text-3xl font-bold text-gray-900 mb-8 text-center">Featured IPO Quant Rating</h2>

        <div className="bg-white rounded-2xl p-10 shadow-2xl max-w-4xl mx-auto">
          <div className="grid md:grid-cols-2 gap-10 items-center">
            {/* Left: Score */}
            <div className="text-center">
              <div className="mb-4">
                <h3 className="text-2xl font-bold text-gray-900">Tech Innovation Limited</h3>
                <p className="text-gray-600">Software & Services</p>
              </div>

              <div className="mb-4">
                <div className="text-sm text-gray-500 mb-2">Listing Countdown</div>
                <div className="text-3xl font-bold text-accent-start">2 days 14 hours</div>
              </div>

              <div className="flex justify-center mb-4">
                <ScoreBadge score={78} size="xl" />
              </div>

              <div className="text-center">
                <div className="text-lg font-semibold text-gray-900 mb-2">
                  Strong fundamentals with positive market sentiment
                </div>
                <div className="inline-block px-4 py-2 bg-green-100 text-green-700 rounded-lg text-sm font-medium">
                  📊 Top 18% among IPOs in last 2 years
                </div>
              </div>
            </div>

            {/* Right: Score Breakdown */}
            <div className="space-y-4">
              <h4 className="font-bold text-gray-900 mb-4">Score Breakdown</h4>

              {[
                { label: 'Fundamentals', score: 22, max: 25, color: 'bg-green-500' },
                { label: 'Valuation', score: 16, max: 20, color: 'bg-blue-500' },
                { label: 'Market Sentiment', score: 12, max: 15, color: 'bg-purple-500' },
                { label: 'Cornerstone Strength', score: 13, max: 15, color: 'bg-indigo-500' },
                { label: 'Industry Trend', score: 12, max: 15, color: 'bg-pink-500' },
                { label: 'Risk Adjustments', score: 3, max: 10, color: 'bg-red-500' },
              ].map((item, index) => (
                <div key={index}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-700 font-medium">{item.label}</span>
                    <span className="text-gray-900 font-bold text-tabular">
                      {item.score}/{item.max}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className={`${item.color} h-2 rounded-full transition-all duration-500`}
                      style={{ width: `${(item.score / item.max) * 100}%` }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-gray-100 flex justify-center gap-4">
            <button className="gradient-accent text-white px-8 py-3 rounded-lg font-semibold hover:opacity-90 transition-opacity">
              View Detailed Report
            </button>
            <button className="bg-gray-100 text-gray-900 px-8 py-3 rounded-lg font-semibold hover:bg-gray-200 transition-colors">
              Compare with Others
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
