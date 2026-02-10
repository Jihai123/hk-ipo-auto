export default function FinalCTASection() {
  return (
    <section className="py-20 gradient-accent">
      <div className="container mx-auto px-6 max-w-7xl text-center">
        <h2 className="text-4xl font-bold text-white mb-6">
          Start Screening the Next IPO Opportunity
        </h2>
        <p className="text-xl text-indigo-100 mb-10 max-w-2xl mx-auto">
          Access real-time quantitative ratings, market data, and sponsor performance analytics
        </p>

        <div className="flex flex-wrap justify-center gap-4">
          <button className="bg-white text-indigo-600 px-10 py-4 rounded-lg font-bold text-lg shadow-xl hover:shadow-2xl transition-all duration-300 hover:scale-105">
            Open IPO Screener
          </button>
          <button className="bg-indigo-700 text-white px-10 py-4 rounded-lg font-bold text-lg shadow-xl hover:bg-indigo-800 transition-all duration-300 border-2 border-indigo-400">
            View API Documentation
          </button>
        </div>

        <div className="mt-12 grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
          <div className="text-center">
            <div className="text-4xl font-bold text-white mb-2">500+</div>
            <div className="text-indigo-200">IPOs Analyzed</div>
          </div>
          <div className="text-center">
            <div className="text-4xl font-bold text-white mb-2">72%</div>
            <div className="text-indigo-200">Model Accuracy</div>
          </div>
          <div className="text-center">
            <div className="text-4xl font-bold text-white mb-2">Real-time</div>
            <div className="text-indigo-200">Data Updates</div>
          </div>
        </div>
      </div>
    </section>
  );
}
