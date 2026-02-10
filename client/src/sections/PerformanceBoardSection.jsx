import PerformanceRow from '../components/PerformanceRow';

export default function PerformanceBoardSection() {
  const performances = [
    {
      code: '09988',
      name: 'Tech Innovation',
      listingDate: '2026-02-05',
      offerPrice: '18.50',
      closePrice: '24.80',
      change: '+34.1%',
      lotProfit: '+3,150',
      oversubscription: '128.5',
    },
    {
      code: '02768',
      name: 'Green Energy',
      listingDate: '2026-02-03',
      offerPrice: '12.00',
      closePrice: '15.60',
      change: '+30.0%',
      lotProfit: '+1,800',
      oversubscription: '85.2',
    },
    {
      code: '01234',
      name: 'FinTech Solutions',
      listingDate: '2026-01-28',
      offerPrice: '22.00',
      closePrice: '25.30',
      change: '+15.0%',
      lotProfit: '+1,650',
      oversubscription: '56.8',
    },
    {
      code: '05678',
      name: 'Healthcare Inn.',
      listingDate: '2026-01-25',
      offerPrice: '16.50',
      closePrice: '14.20',
      change: '-13.9%',
      lotProfit: '-1,150',
      oversubscription: '12.4',
    },
    {
      code: '08899',
      name: 'AI Robotics',
      listingDate: '2026-01-20',
      offerPrice: '28.00',
      closePrice: '35.70',
      change: '+27.5%',
      lotProfit: '+3,850',
      oversubscription: '142.6',
    },
  ];

  return (
    <section className="py-16 bg-white">
      <div className="container mx-auto px-6 max-w-7xl">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-3xl font-bold text-gray-900">IPO First-Day Performance Board</h2>
          <button className="text-accent-start hover:text-accent-end font-semibold flex items-center gap-2">
            View All 247 IPOs
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        <div className="bg-white rounded-card shadow-card overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-7 gap-4 px-6 py-4 bg-gray-50 border-b-2 border-gray-200 font-semibold text-sm text-gray-700">
            <div>Stock</div>
            <div>Listing Date</div>
            <div>Price</div>
            <div>First-Day %</div>
            <div>Lot Profit/Loss</div>
            <div>Oversubscription</div>
            <div className="text-right">Action</div>
          </div>

          {/* Rows */}
          <div className="divide-y divide-gray-100">
            {performances.map((performance) => (
              <PerformanceRow key={performance.code} {...performance} />
            ))}
          </div>
        </div>

        <div className="mt-6 text-center">
          <p className="text-sm text-gray-500">
            Showing top 5 recent IPOs. Updated in real-time after market close.
          </p>
        </div>
      </div>
    </section>
  );
}
