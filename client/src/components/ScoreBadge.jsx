export default function ScoreBadge({ score, size = 'md', showRating = true }) {
  const getRating = (score) => {
    if (score >= 80) return { label: 'Strong', color: 'text-positive', bg: 'bg-green-50' };
    if (score >= 60) return { label: 'Neutral', color: 'text-neutral', bg: 'bg-yellow-50' };
    return { label: 'Risky', color: 'text-negative', bg: 'bg-red-50' };
  };

  const rating = getRating(score);

  const sizeClasses = {
    sm: 'w-16 h-16 text-xl',
    md: 'w-24 h-24 text-3xl',
    lg: 'w-32 h-32 text-4xl',
    xl: 'w-40 h-40 text-5xl',
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <div className={`${sizeClasses[size]} rounded-full border-4 ${rating.color.replace('text', 'border')} flex items-center justify-center font-bold ${rating.color} ${rating.bg} relative`}>
        <svg className="absolute inset-0 transform -rotate-90" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeDasharray={`${score * 2.827} 282.7`}
            className={rating.color}
            opacity="0.2"
          />
        </svg>
        <span className="relative z-10">{score}</span>
      </div>
      {showRating && (
        <span className={`text-sm font-semibold px-3 py-1 rounded-full ${rating.bg} ${rating.color}`}>
          {rating.label}
        </span>
      )}
    </div>
  );
}
