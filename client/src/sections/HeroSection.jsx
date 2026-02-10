import StatCard from '../components/StatCard';

export default function HeroSection() {
  return (
    <section className="py-20 bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50">
      <div className="container mx-auto px-6 max-w-7xl">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left: Hero Content */}
          <div>
            <h1 className="text-5xl font-bold text-gray-900 mb-6 leading-tight">
              Quantitative Ratings for{' '}
              <span className="gradient-accent bg-clip-text text-transparent">
                Hong Kong IPOs
              </span>
            </h1>
            <p className="text-xl text-gray-600 mb-8 leading-relaxed">
              Multi-factor quantitative model analyzing IPO fundamentals, valuation, market sentiment, and cornerstone strength to deliver data-driven investment decisions.
            </p>
            <div className="flex flex-wrap gap-4">
              <button className="gradient-accent text-white px-8 py-4 rounded-lg font-semibold shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105">
                Analyze the Next IPO
              </button>
              <button className="bg-white text-gray-900 px-8 py-4 rounded-lg font-semibold shadow-md hover:shadow-lg transition-all duration-300 border-2 border-gray-200 hover:border-accent-start">
                View Market Dashboard
              </button>
            </div>
          </div>

          {/* Right: Live Market Snapshot */}
          <div className="bg-white rounded-2xl p-8 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold text-gray-900">Live IPO Market Snapshot</h3>
              <span className="flex items-center gap-2 text-sm text-gray-500">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                Live
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <StatCard
                label="IPO Heat Score"
                value="8.5"
                subtext="Market Sentiment"
                trend="positive"
              />
              <StatCard
                label="Avg First-Day Return"
                value="+12.3%"
                subtext="Last 30 Days"
                trend="positive"
              />
              <StatCard
                label="IPO Break Rate"
                value="28%"
                subtext="30-Day Window"
                trend="neutral"
              />
              <StatCard
                label="Active IPOs Now"
                value="6"
                subtext="Subscribing"
                trend="neutral"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
