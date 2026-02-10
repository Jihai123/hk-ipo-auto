export default function PerformanceRow({
  code,
  name,
  listingDate,
  offerPrice,
  closePrice,
  change,
  lotProfit,
  oversubscription
}) {
  const changePercent = parseFloat(change);
  const isPositive = changePercent >= 0;

  return (
    <div className="grid grid-cols-7 gap-4 py-4 border-b border-gray-100 hover:bg-gray-50 transition-colors items-center text-sm">
      <div className="font-semibold text-gray-900">
        <div>{code}</div>
        <div className="text-xs text-gray-500 font-normal">{name}</div>
      </div>

      <div className="text-gray-600 text-xs">{listingDate}</div>

      <div className="text-tabular">
        <div className="text-gray-900 font-medium">${offerPrice}</div>
        <div className="text-xs text-gray-500">→ ${closePrice}</div>
      </div>

      <div className={`font-bold text-tabular ${isPositive ? 'text-positive' : 'text-negative'}`}>
        {isPositive ? '+' : ''}{change}
      </div>

      <div className={`font-semibold text-tabular ${parseFloat(lotProfit) >= 0 ? 'text-positive' : 'text-negative'}`}>
        HK$ {lotProfit}
      </div>

      <div className="text-gray-700 font-medium text-tabular">
        {oversubscription}x
      </div>

      <div className="flex justify-end">
        <button className="text-xs text-accent-start hover:text-accent-end font-medium px-3 py-1 rounded hover:bg-indigo-50 transition-colors">
          Details
        </button>
      </div>
    </div>
  );
}
