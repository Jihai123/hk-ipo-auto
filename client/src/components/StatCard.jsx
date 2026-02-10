export default function StatCard({ label, value, subtext, trend, icon }) {
  const trendColor = trend === 'positive' ? 'text-positive' : trend === 'negative' ? 'text-negative' : 'text-neutral';

  return (
    <div className="bg-white rounded-card p-6 shadow-card hover:shadow-card-hover transition-all duration-300 hover:-translate-y-1">
      <div className="flex items-start justify-between mb-3">
        <div className="text-sm text-gray-500 font-medium">{label}</div>
        {icon && <div className="text-gray-400">{icon}</div>}
      </div>
      <div className={`text-3xl font-bold text-tabular mb-1 ${trendColor}`}>
        {value}
      </div>
      {subtext && (
        <div className="text-sm text-gray-500">{subtext}</div>
      )}
    </div>
  );
}
