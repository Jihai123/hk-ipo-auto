export default function RankingCard({
  rank,
  sponsor,
  ipoCount,
  positiveRate,
  avgReturn,
  bestProject,
  worstProject
}) {
  const getRankColor = (rank) => {
    if (rank === 1) return 'bg-yellow-100 text-yellow-700 border-yellow-300';
    if (rank === 2) return 'bg-gray-100 text-gray-700 border-gray-300';
    if (rank === 3) return 'bg-orange-100 text-orange-700 border-orange-300';
    return 'bg-white text-gray-700 border-gray-200';
  };

  return (
    <div className={`rounded-lg p-5 border-2 shadow-card hover:shadow-card-hover transition-all duration-300 ${getRankColor(rank)}`}>
      <div className="flex items-start gap-4">
        <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg ${
          rank <= 3 ? 'bg-white shadow-md' : 'bg-gray-100'
        }`}>
          {rank}
        </div>

        <div className="flex-1 min-w-0">
          <div className="font-bold text-gray-900 mb-3">{sponsor}</div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
            <div>
              <div className="text-xs text-gray-600 mb-1">IPOs (2Y)</div>
              <div className="text-lg font-bold text-gray-900">{ipoCount}</div>
            </div>

            <div>
              <div className="text-xs text-gray-600 mb-1">Positive Rate</div>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${positiveRate >= 70 ? 'bg-positive' : positiveRate >= 50 ? 'bg-neutral' : 'bg-negative'}`}
                    style={{ width: `${positiveRate}%` }}
                  ></div>
                </div>
                <span className="text-sm font-bold">{positiveRate}%</span>
              </div>
            </div>

            <div>
              <div className="text-xs text-gray-600 mb-1">Avg Return</div>
              <div className={`text-lg font-bold ${
                parseFloat(avgReturn) >= 0 ? 'text-positive' : 'text-negative'
              }`}>
                {avgReturn}
              </div>
            </div>

            <div>
              <div className="text-xs text-gray-600 mb-1">Best / Worst</div>
              <div className="text-xs">
                <div className="text-positive font-semibold">{bestProject}</div>
                <div className="text-negative font-semibold">{worstProject}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
