export default function IPOListItem({
  code,
  name,
  status,
  date,
  entryFee,
  priceRange,
  isActive = false,
  countdown = null
}) {
  const statusColors = {
    'Subscribing Now': 'bg-green-100 text-green-700 border-green-300',
    'Listing Soon': 'bg-blue-100 text-blue-700 border-blue-300',
    'Filed': 'bg-gray-100 text-gray-700 border-gray-300',
  };

  return (
    <div className={`bg-white rounded-lg p-4 border-2 transition-all duration-200 ${
      isActive
        ? 'border-accent-start shadow-lg'
        : 'border-gray-100 hover:border-gray-300 shadow-card hover:shadow-card-hover'
    }`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-bold text-gray-900">{code}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full border ${statusColors[status] || statusColors['Filed']}`}>
              {status}
            </span>
          </div>
          <div className="text-sm text-gray-600">{name}</div>
        </div>
        {countdown && (
          <div className="text-right">
            <div className="text-xs text-gray-500">Ends in</div>
            <div className="text-sm font-bold text-accent-start">{countdown}</div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs">
        <div>
          <div className="text-gray-500 mb-1">Date</div>
          <div className="font-semibold text-gray-900">{date}</div>
        </div>
        <div>
          <div className="text-gray-500 mb-1">Entry Fee</div>
          <div className="font-semibold text-gray-900">{entryFee}</div>
        </div>
        <div>
          <div className="text-gray-500 mb-1">Price Range</div>
          <div className="font-semibold text-gray-900">{priceRange}</div>
        </div>
      </div>
    </div>
  );
}
