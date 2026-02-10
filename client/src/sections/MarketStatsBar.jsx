export default function MarketStatsBar() {
  const stats = [
    { label: 'YTD IPO Count', value: '147', trend: 'positive' },
    { label: 'Avg First-Day Return', value: '+18.2%', trend: 'positive' },
    { label: 'IPO Positive Rate', value: '68%', trend: 'neutral' },
    { label: 'Total Funds Raised', value: 'HK$ 52.3B', trend: 'positive' },
  ];

  return (
    <section className="py-8 bg-gray-900 text-white">
      <div className="container mx-auto px-6 max-w-7xl">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {stats.map((stat, index) => (
            <div key={index} className="text-center border-l border-gray-700 first:border-l-0">
              <div className="text-sm text-gray-400 mb-2 font-medium">{stat.label}</div>
              <div className={`text-3xl font-bold text-tabular ${
                stat.trend === 'positive' ? 'text-green-400' : 'text-yellow-400'
              }`}>
                {stat.value}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
